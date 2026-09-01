import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PDFDocument, PDFPage, PDFFont, PDFImage, StandardFonts, degrees, rgb } from "pdf-lib";
import { calculateProjectDetailsReport, calculateProjectMetrics } from "../utils/calculations";
import { useEditor } from "../state/EditorContext";
import { createEntityFromTool } from "../state/editorReducer";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
import { exportProjectAsJson, importProjectFromJson } from "../utils/persistence";
import { getUtilityIconByToolId, isUtilityToolId } from "../assets/utilityIcons";
import compassIcon from "../../assets/svgs/compass-icon.svg";
import doorToolIcon from "../../assets/building-icons/door.png";
import doubleDoorToolIcon from "../../assets/building-icons/double-door.png";
import slidingGlassToolIcon from "../../assets/building-icons/sliding-glass.png";
import windowToolIcon from "../../assets/building-icons/window.png";
import skylightToolIcon from "../../assets/building-icons/skylight.png";
import { WindowModal } from "./WindowModal";
import type { WindowModalSubmit } from "./WindowModal";
import { UtilityLabelModal } from "./UtilityLabelModal";
import type { UtilityLabelInitialValues, UtilityLabelSubmit } from "./UtilityLabelModal";
import { ExportPdfModal } from "./ExportPdfModal";
import type { ExportPdfStyleOptions, ExportPdfThemePreset } from "./ExportPdfModal";
import { GRAYSCALE_COLOR_TOKEN } from "./ExportPdfModal";
import { MAX_ZOOM, MIN_ZOOM, clamp, screenToWorld, snapPointToGrid } from "../utils/geometry";
import type { CameraState, FloorData, MapEntity, Orientation, ToolId } from "../types";

type DoorToolType = "single" | "double" | "sliding";

function getDoorToolTypeFromProjectMetadata(metadata: Record<string, string | number | boolean | null>): DoorToolType {
  const value = String(metadata.doorDefaultType ?? "single").toLowerCase();
  if (value === "double" || value === "sliding") {
    return value;
  }
  return "single";
}

const DOOR_TOOL_OPTIONS: Array<{ id: DoorToolType; label: string }> = [
  { id: "single", label: "DOOR" },
  { id: "double", label: "DOUBLE" },
  { id: "sliding", label: "SLIDING" },
];

const RECTANGLE_TOOL_OPTIONS: Array<{ id: "rectangle" | "bumpout"; label: string }> = [
  { id: "rectangle", label: "RECTANGLE" },
  { id: "bumpout", label: "BUMP OUT" },
];

const ORIENTATION_LABELS: Record<Orientation, string> = {
  N: "North",
  NE: "Northeast",
  E: "East",
  SE: "Southeast",
  S: "South",
  SW: "Southwest",
  W: "West",
  NW: "Northwest",
};

function clampPositiveInt(value: number, fallback: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(1, Math.round(normalized));
}

function toSafeFileBaseName(projectName: string): string {
  const normalized = String(projectName ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "home-layout";
}

interface UtilityDragState {
  toolId: ToolId;
  pointerId: number;
  x: number;
  y: number;
}

interface UtilityLabelModalState {
  entityId: string;
  initialValues: UtilityLabelInitialValues;
}

interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface LevelRender {
  name: string;
  pngDataUrl: string;
}

const UTILITY_EXPORT_ENTITY_SELECTORS = [
  ".map-entity-condenser",
  ".map-entity-heater",
  ".map-entity-dhw",
  ".map-entity-gas",
  ".map-entity-electric",
  ".map-entity-other",
  ".ghost-entity-utility",
].join(", ");

function isUtilityEntityType(type: MapEntity["type"]): boolean {
  return type === "condenser" || type === "heater" || type === "dhw" || type === "gas" || type === "electric" || type === "other";
}

function expandBounds(base: WorldBounds | null, next: WorldBounds | null): WorldBounds | null {
  if (!next) {
    return base;
  }
  if (!base) {
    return next;
  }
  return {
    minX: Math.min(base.minX, next.minX),
    minY: Math.min(base.minY, next.minY),
    maxX: Math.max(base.maxX, next.maxX),
    maxY: Math.max(base.maxY, next.maxY),
  };
}

function getEntityWorldBounds(entity: MapEntity): WorldBounds {
  if (entity.type === "rectangle" || entity.type === "line") {
    return {
      minX: Math.min(entity.x, entity.x + entity.width),
      minY: Math.min(entity.y, entity.y + entity.height),
      maxX: Math.max(entity.x, entity.x + entity.width),
      maxY: Math.max(entity.y, entity.y + entity.height),
    };
  }

  if (entity.type === "skylight" || isUtilityEntityType(entity.type)) {
    const halfW = Math.abs(entity.width) / 2;
    const halfH = Math.abs(entity.height) / 2;
    return {
      minX: entity.x - halfW,
      minY: entity.y - halfH,
      maxX: entity.x + halfW,
      maxY: entity.y + halfH,
    };
  }

  return {
    minX: entity.x,
    minY: entity.y,
    maxX: entity.x + Math.abs(entity.width),
    maxY: entity.y + Math.abs(entity.height),
  };
}

function getFloorFrameBounds(floor: FloorData): WorldBounds | null {
  let bounds: WorldBounds | null = null;

  for (const entity of floor.entities) {
    bounds = expandBounds(bounds, getEntityWorldBounds(entity));
  }

  for (const point of floor.wallPoints) {
    bounds = expandBounds(bounds, {
      minX: point.x - 0.6,
      minY: point.y - 0.6,
      maxX: point.x + 0.6,
      maxY: point.y + 0.6,
    });
  }

  const pointsById = new Map(floor.wallPoints.map((point) => [point.id, point]));
  for (const segment of floor.wallSegments) {
    const start = pointsById.get(segment.startPointId);
    const end = pointsById.get(segment.endPointId);
    if (!start || !end) {
      continue;
    }
    bounds = expandBounds(bounds, {
      minX: Math.min(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x),
      maxY: Math.max(start.y, end.y),
    });
  }

  return bounds;
}

function frameCameraForBounds(bounds: WorldBounds, viewportWidth: number, viewportHeight: number): CameraState {
  const padding = 4;
  const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  const zoom = clamp(Math.min(viewportWidth / width, viewportHeight / height), MIN_ZOOM, MAX_ZOOM);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    zoom,
    x: viewportWidth / 2 - centerX * zoom,
    y: viewportHeight / 2 - centerY * zoom,
  };
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function collectDocumentCssText(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      for (const rule of Array.from(rules)) {
        chunks.push(rule.cssText);
      }
    } catch {
      // Ignore unreadable stylesheets (e.g. browser internals).
    }
  }
  return chunks.join("\n");
}

function removeElementsBySelector(root: ParentNode, selector: string): void {
  for (const element of Array.from(root.querySelectorAll(selector))) {
    element.remove();
  }
}

function findWorkspaceBackgroundRect(svg: SVGSVGElement): SVGRectElement | null {
  return svg.querySelector("rect[fill='url(#workspace-bg)']");
}

function getGridLines(svg: SVGSVGElement): SVGLineElement[] {
  return Array.from(svg.querySelectorAll("line[data-export-grid='true']"));
}

function markGridLines(svg: SVGSVGElement): void {
  const baseGridLines = svg.querySelectorAll<SVGLineElement>("line[stroke='#a8c8ee']");
  for (const line of Array.from(baseGridLines)) {
    line.setAttribute("data-export-grid", "true");
  }
}

function recolorVisibleStrokes(svg: SVGSVGElement, stroke: string): void {
  const stroked = svg.querySelectorAll<SVGElement>("line,path,rect,circle,ellipse,polygon,polyline");
  for (const element of Array.from(stroked)) {
    const currentStroke = element.getAttribute("stroke");
    if (!currentStroke) {
      continue;
    }
    const normalized = currentStroke.trim().toLowerCase();
    if (normalized === "none" || normalized === "transparent" || normalized.startsWith("url(")) {
      continue;
    }
    element.setAttribute("stroke", stroke);
  }
}

function recolorAllText(svg: SVGSVGElement, fill: string, stroke: string): void {
  const texts = svg.querySelectorAll<SVGTextElement>("text");
  for (const text of Array.from(texts)) {
    text.setAttribute("fill", fill);
    if (stroke === "none") {
      text.setAttribute("stroke", "none");
      text.setAttribute("stroke-width", "0");
      text.style.setProperty("stroke", "none", "important");
      text.style.setProperty("stroke-width", "0", "important");
      text.style.setProperty("paint-order", "normal", "important");
    } else {
      text.setAttribute("stroke", stroke);
      text.style.setProperty("stroke", stroke, "important");
    }
    text.style.setProperty("fill", fill, "important");
  }
}

function applyExportThemePreset(svg: SVGSVGElement, preset: ExportPdfThemePreset): void {
  if (preset === "default" || preset === "standard") {
    return;
  }

  const backgroundRect = findWorkspaceBackgroundRect(svg);
  const gridLines = getGridLines(svg);

  if (preset === "light") {
    if (backgroundRect) {
      backgroundRect.setAttribute("fill", "#ffffff");
    }
    for (const line of gridLines) {
      line.setAttribute("stroke", "#f6f8fb");
      line.setAttribute("opacity", "0.22");
    }

    recolorVisibleStrokes(svg, "#55606b");
    recolorAllText(svg, "#4e5760", "none");

    for (const ceilingText of Array.from(svg.querySelectorAll<SVGTextElement>("text.ceiling-number, text.ceiling-caption"))) {
      ceilingText.setAttribute("fill", "#ffffff");
      ceilingText.style.setProperty("fill", "#ffffff", "important");
      ceilingText.setAttribute("stroke", "none");
      ceilingText.setAttribute("stroke-width", "0");
      ceilingText.style.setProperty("stroke", "none", "important");
      ceilingText.style.setProperty("stroke-width", "0", "important");
      ceilingText.style.setProperty("paint-order", "normal", "important");
    }

    for (const marker of Array.from(svg.querySelectorAll<SVGElement>(".rect-guides polygon, .rect-drag-size-cue polygon, .ceiling-overlay polygon"))) {
      marker.setAttribute("fill", "#55606b");
    }
    return;
  }

  if (preset === "dark") {
    if (backgroundRect) {
      backgroundRect.setAttribute("fill", "#172733");
    }
    for (const line of gridLines) {
      line.setAttribute("stroke", "#223848");
      line.setAttribute("opacity", "0.78");
    }

    recolorAllText(svg, "#ffffff", "none");
  }
}

function applyExportVisibilityOptions(svg: SVGSVGElement, options: ExportPdfStyleOptions): void {
  if (options.hideGrid) {
    for (const line of getGridLines(svg)) {
      line.remove();
    }
  }

  if (options.hideLinearFeetMarkers) {
    removeElementsBySelector(svg, ".rect-guides");
    removeElementsBySelector(svg, ".rect-drag-size-cue");
    removeElementsBySelector(svg, "text.dim-label");
  }

  if (options.hideLabels) {
    removeElementsBySelector(svg, "text:not(.dim-label)");
    removeElementsBySelector(svg, ".ceiling-height-box");
    removeElementsBySelector(svg, ".ceiling-height-badge");
  }

  if (options.hideUtilities) {
    removeElementsBySelector(svg, UTILITY_EXPORT_ENTITY_SELECTORS);
  }
}

function applyExportStyleToSvgClone(svg: SVGSVGElement, options: ExportPdfStyleOptions): void {
  markGridLines(svg);
  applyExportThemePreset(svg, options.themePreset);
  applyExportVisibilityOptions(svg, options);
}

async function captureWorkspacePngDataUrl(svg: SVGSVGElement, options: ExportPdfStyleOptions, scale = 2): Promise<string> {
  const width = Math.max(1, Math.round(svg.clientWidth));
  const height = Math.max(1, Math.round(svg.clientHeight));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const cssText = collectDocumentCssText();
  if (cssText) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.setAttribute("type", "text/css");
    style.textContent = cssText;
    clone.insertBefore(style, clone.firstChild);
  }

  applyExportStyleToSvgClone(clone, options);

  const serialized = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error("Unable to load workspace SVG for export."));
      next.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create export canvas context.");
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.drawImage(image, 0, 0, width, height);

    if (options.hueColor === GRAYSCALE_COLOR_TOKEN) {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempContext = tempCanvas.getContext("2d");
      if (!tempContext) {
        throw new Error("Unable to create grayscale processing context.");
      }
      tempContext.drawImage(canvas, 0, 0);

      context.clearRect(0, 0, width, height);
      context.filter = "grayscale(1)";
      context.drawImage(tempCanvas, 0, 0, width, height);
      context.filter = "none";
    } else if (options.hueColor) {
      context.globalCompositeOperation = "hue";
      context.fillStyle = options.hueColor;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";
    }

    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const COMPASS_RING: Orientation[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

interface PdfDetailLine {
  text: string;
  style: "title" | "section" | "subsection" | "row" | "spacer";
}

function wrapPdfText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [""];
  }

  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (!current) {
      let remaining = word;
      while (remaining.length > 0) {
        let sliceLength = remaining.length;
        while (sliceLength > 1 && font.widthOfTextAtSize(remaining.slice(0, sliceLength), fontSize) > maxWidth) {
          sliceLength -= 1;
        }
        lines.push(remaining.slice(0, sliceLength));
        remaining = remaining.slice(sliceLength);
      }
      current = "";
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function drawPdfCompass(
  page: PDFPage,
  options: {
    x: number;
    y: number;
    size: number;
    orientation: Orientation;
    font: PDFFont;
    icon: PDFImage;
    color: ReturnType<typeof rgb>;
  },
): void {
  const { x, y, size, orientation, font, icon, color } = options;
  const centerX = x + size / 2;
  const centerY = y + size / 2;
  const iconSize = size * 0.72;
  const iconX = x + (size - iconSize) / 2;
  const iconY = y + (size - iconSize) / 2;
  const ringRadius = size * 0.43;
  const orientationIndex = COMPASS_RING.indexOf(orientation);
  const startIndex = orientationIndex >= 0 ? orientationIndex : COMPASS_RING.indexOf("S");

  page.drawImage(icon, {
    x: iconX,
    y: iconY,
    width: iconSize,
    height: iconSize,
  });

  const labelSize = Math.max(5.5, size * 0.1);
  for (let position = 0; position < 8; position += 1) {
    const angle = (-90 + position * 45) * (Math.PI / 180);
    const label = COMPASS_RING[(startIndex + position) % COMPASS_RING.length];
    const lx = centerX + Math.cos(angle) * ringRadius;
    const ly = centerY + Math.sin(angle) * ringRadius;
    const width = font.widthOfTextAtSize(label, labelSize);
    page.drawText(label, {
      x: lx - width / 2,
      y: ly - labelSize / 2,
      size: labelSize,
      font,
      color,
    });
  }
}

async function createCompassIconPngDataUrl(size: number): Promise<string> {
  const safeSize = Math.max(48, Math.round(size));
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error("Unable to load compass icon for export."));
    next.src = compassIcon;
  });

  const canvas = document.createElement("canvas");
  canvas.width = safeSize;
  canvas.height = safeSize;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create compass icon canvas for export.");
  }

  context.clearRect(0, 0, safeSize, safeSize);
  context.drawImage(image, 0, 0, safeSize, safeSize);
  return canvas.toDataURL("image/png");
}

function buildPdfDetailsLines(report: ReturnType<typeof calculateProjectDetailsReport>): PdfDetailLine[] {
  const lines: PdfDetailLine[] = [];
  lines.push({ text: "TOTALS", style: "section" });
  lines.push({ text: `Total ft²: ${report.totals.totalSqFt.toFixed(0)}`, style: "row" });
  lines.push({ text: `Avg Ceiling Height: ${report.totals.averageCeilingHeightFt.toFixed(1)}'`, style: "row" });
  lines.push({ text: `Total Volume: ${report.totals.totalVolumeFt3.toFixed(0)} ft³`, style: "row" });
  lines.push({ text: `Front Door Orientation: ${ORIENTATION_LABELS[report.totals.frontDoorOrientation]} (${report.totals.frontDoorOrientation})`, style: "row" });
  lines.push({ text: `Total Attic ft²: ${report.totals.totalAtticSqFt.toFixed(0)}`, style: "row" });
  lines.push({ text: `Total Basement ft² (Basement label): ${report.totals.totalBasementSqFt.toFixed(0)}`, style: "row" });
  lines.push({ text: `Total Crawlspace ft² (Crawlspace label): ${report.totals.totalCrawlspaceSqFt.toFixed(0)}`, style: "row" });
  lines.push({ text: `Total Slab ft² (Slab label): ${report.totals.totalSlabSqFt.toFixed(0)}`, style: "row" });
  lines.push({ text: "", style: "spacer" });

  lines.push({ text: "OPENING SUMMARY", style: "section" });
  lines.push({ text: `Total Windows: ${report.totals.totalWindowCount}`, style: "row" });
  lines.push({ text: `Total Doors: ${report.totals.totalDoorCount}`, style: "row" });
  lines.push({ text: `Total Window Area: ${report.totals.totalWindowAreaFt2.toFixed(0)} ft²`, style: "row" });
  lines.push({ text: `Total Door Area: ${report.totals.totalDoorAreaFt2.toFixed(0)} ft²`, style: "row" });
  lines.push({ text: "", style: "spacer" });

  lines.push({ text: "FLOOR BREAKDOWN", style: "section" });
  for (const floor of report.floorBreakdown) {
    lines.push({ text: floor.floorName, style: "subsection" });
    lines.push({ text: `Floor Total ft²: ${floor.totalAreaFt2.toFixed(0)}`, style: "row" });
    lines.push({ text: `Conditioned ft²: ${floor.conditionedAreaFt2.toFixed(0)}`, style: "row" });
    for (const rectangle of floor.rectangles) {
      lines.push({
        text: `• ${rectangle.conditioned ? rectangle.name : `${rectangle.name} (unconditioned)`}: ${rectangle.areaFt2.toFixed(0)} ft²`,
        style: "row",
      });
    }
  }
  lines.push({ text: "", style: "spacer" });

  lines.push({ text: "OVERHANGS", style: "section" });
  lines.push({ text: `Total Overhang Areas: ${report.overhangs.totalAreaCount}`, style: "row" });
  lines.push({ text: `Total Overhang ft²: ${report.overhangs.totalAreaFt2.toFixed(0)} ft²`, style: "row" });
  for (const side of report.overhangs.bySide) {
    lines.push({
      text: `${ORIENTATION_LABELS[side.side]} (${side.side}): ${side.areaCount} (${side.totalAreaFt2.toFixed(0)} ft²)`,
      style: "row",
    });
  }
  for (const area of report.overhangs.areas) {
    lines.push({
      text: `• ${area.floorName} - ${ORIENTATION_LABELS[area.side]} (${area.side}): ${area.areaFt2.toFixed(0)} ft²`,
      style: "row",
    });
  }
  lines.push({ text: "", style: "spacer" });

  lines.push({ text: "AREAS OVER UNCONDITIONED SPACE", style: "section" });
  lines.push({ text: `Total Areas: ${report.overUnconditionedAreas.totalAreaCount}`, style: "row" });
  lines.push({ text: `Total ft²: ${report.overUnconditionedAreas.totalAreaFt2.toFixed(0)} ft²`, style: "row" });
  for (const area of report.overUnconditionedAreas.areas) {
    lines.push({ text: `• ${area.floorName}: ${area.areaFt2.toFixed(0)} ft²`, style: "row" });
  }
  lines.push({ text: "", style: "spacer" });

  lines.push({ text: "WINDOW + DOOR BY ORIENTATION SIDE", style: "section" });
  for (const sideSummary of report.openingsBySide) {
    lines.push({ text: `${ORIENTATION_LABELS[sideSummary.side]} (${sideSummary.side}) Side`, style: "subsection" });
    lines.push({ text: `Total Openings: ${sideSummary.totalCount}`, style: "row" });
    lines.push({ text: `Windows / Doors: ${sideSummary.windowCount} / ${sideSummary.doorCount}`, style: "row" });
    lines.push({ text: `Total Window Area: ${sideSummary.totalWindowAreaFt2.toFixed(0)} ft²`, style: "row" });
    lines.push({ text: `Total Door Area: ${sideSummary.totalDoorAreaFt2.toFixed(0)} ft²`, style: "row" });
    lines.push({ text: `Total Opening Area: ${sideSummary.totalAreaFt2.toFixed(0)} ft²`, style: "row" });

    const sizeBuckets = new Map<string, { count: number; totalAreaFt2: number }>();
    for (const opening of sideSummary.openings) {
      const key = `${opening.kind === "window" ? "Window" : "Door"} ${opening.sizeLabel}`;
      const current = sizeBuckets.get(key) ?? { count: 0, totalAreaFt2: 0 };
      sizeBuckets.set(key, {
        count: current.count + 1,
        totalAreaFt2: current.totalAreaFt2 + opening.areaFt2,
      });
    }

    for (const [sizeKey, data] of sizeBuckets.entries()) {
      lines.push({ text: `• ${sizeKey}: ${data.count} (${data.totalAreaFt2.toFixed(0)} ft²)`, style: "row" });
    }

    for (const opening of sideSummary.openings) {
      lines.push({
        text: `• ${opening.kind === "window" ? "Window" : "Door"} ${opening.sizeLabel} - ${opening.floorName}: ${opening.areaFt2.toFixed(0)} ft²`,
        style: "row",
      });
    }
  }

  return lines;
}

function appendDetailsPages(
  pdfDoc: PDFDocument,
  details: ReturnType<typeof calculateProjectDetailsReport>,
  projectName: string,
  headerFont: PDFFont,
  textFont: PDFFont,
  pageWidth: number,
  pageHeight: number,
  color: ReturnType<typeof rgb>,
): void {
  const marginX = 34;
  const topMargin = 74;
  const bottomMargin = 36;
  const gutter = 20;
  const columnWidth = (pageWidth - marginX * 2 - gutter) / 2;
  const title = `${(projectName || "NEW ASSESSMENT").toUpperCase()} - DETAILED REPORT`;
  const lines = buildPdfDetailsLines(details);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let column = 0;
  let cursorY = pageHeight - topMargin;

  const resetForNewPage = (continued: boolean) => {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    column = 0;
    cursorY = pageHeight - topMargin;
    page.drawText(continued ? `${title} (CONT.)` : title, {
      x: marginX,
      y: pageHeight - 46,
      size: 15,
      font: headerFont,
      color,
    });
  };

  page.drawText(title, {
    x: marginX,
    y: pageHeight - 46,
    size: 15,
    font: headerFont,
    color,
  });

  for (const line of lines) {
    const isTitle = line.style === "title";
    const isSection = line.style === "section";
    const isSubsection = line.style === "subsection";
    const isSpacer = line.style === "spacer";
    const font = isTitle || isSection || isSubsection ? headerFont : textFont;
    const size = isTitle ? 13 : isSection ? 10 : isSubsection ? 9 : 8;
    const lineHeight = isSpacer ? 6 : size + (isSection ? 4 : 2);
    const wrapped = isSpacer ? [""] : wrapPdfText(line.text, font, size, columnWidth);
    const neededHeight = wrapped.length * lineHeight;

    if (cursorY - neededHeight < bottomMargin) {
      if (column === 0) {
        column = 1;
        cursorY = pageHeight - topMargin;
      } else {
        resetForNewPage(true);
      }
    }

    const x = marginX + (column === 1 ? columnWidth + gutter : 0);
    for (const wrappedLine of wrapped) {
      if (wrappedLine) {
        page.drawText(wrappedLine, {
          x,
          y: cursorY,
          size,
          font,
          color,
        });
      }
      cursorY -= lineHeight;
    }
  }
}

async function downloadLevelsPdf(
  levels: LevelRender[],
  details: ReturnType<typeof calculateProjectDetailsReport>,
  projectName: string,
): Promise<void> {
  const pdfDoc = await PDFDocument.create();
  const headerFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const textFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pageWidth = 612;
  const pageHeight = 792;
  const navy = rgb(0.13, 0.22, 0.37);
  const pages = Math.max(1, Math.ceil(levels.length / 2));
  const compassPngDataUrl = await createCompassIconPngDataUrl(120);
  const compassIconImage = await pdfDoc.embedPng(compassPngDataUrl);

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const left = 0;
    const right = pageWidth;
    const headerHeight = 110;
    const divider = 6;
    const bodyTop = pageHeight - headerHeight;
    const bodyHeight = bodyTop;
    const sectionHeight = (bodyHeight - divider) / 2;

    page.drawText("HOME LAYOUT", {
      x: 48,
      y: pageHeight - 62,
      size: 40,
      font: headerFont,
      color: navy,
    });

    const titleRight = (projectName || "NEW ASSESSMENT").toUpperCase();
    const titleRightSize = 13;
    const titleRightWidth = textFont.widthOfTextAtSize(titleRight, titleRightSize);
    page.drawText(titleRight, {
      x: Math.max(250, pageWidth - 30 - titleRightWidth),
      y: pageHeight - 52,
      size: titleRightSize,
      font: textFont,
      color: navy,
    });

    const slots = [
      { y: sectionHeight + divider, level: levels[pageIndex * 2] },
      { y: 0, level: levels[pageIndex * 2 + 1] },
    ];

    for (const slot of slots) {
      if (!slot.level) {
        continue;
      }

      const label = slot.level.name.toUpperCase();
      const labelSize = 22;
      const labelWidth = textFont.widthOfTextAtSize(label, labelSize);
      const labelCenterY = slot.y + sectionHeight / 2;
      page.drawText(label, {
        x: 30,
        y: labelCenterY - labelWidth / 2,
        size: labelSize,
        rotate: degrees(90),
        font: textFont,
        color: navy,
      });

      const image = await pdfDoc.embedPng(slot.level.pngDataUrl);
      const innerLeft = left + 44;
      const innerRight = right - 14;
      const innerBottom = slot.y + 12;
      const innerTop = slot.y + sectionHeight - 12;
      const innerWidth = innerRight - innerLeft;
      let targetHeight = innerTop - innerBottom;
      let targetWidth = targetHeight * (image.width / image.height);
      if (targetWidth > innerWidth) {
        targetWidth = innerWidth;
        targetHeight = targetWidth * (image.height / image.width);
      }

      const x = innerLeft + (innerWidth - targetWidth) / 2;
      const y = innerBottom + ((innerTop - innerBottom) - targetHeight) / 2;
      page.drawImage(image, {
        x,
        y,
        width: targetWidth,
        height: targetHeight,
      });

      drawPdfCompass(page, {
        x: x + 8,
        y: y + 8,
        size: Math.min(64, Math.max(44, targetWidth * 0.12)),
        orientation: details.totals.frontDoorOrientation,
        font: textFont,
        icon: compassIconImage,
        color: navy,
      });
    }
  }

  appendDetailsPages(pdfDoc, details, projectName, headerFont, textFont, pageWidth, pageHeight, navy);

  const bytes = await pdfDoc.save();
  const pdfBytes = new Uint8Array(bytes);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${toSafeFileBaseName(projectName)}.pdf`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function ToolIcon({
  toolId,
  fallback,
  doorType = "single",
}: {
  toolId: ToolId;
  fallback: string;
  doorType?: DoorToolType;
}) {
  if (isUtilityToolId(toolId)) {
    return <img className="tool-icon-image" src={getUtilityIconByToolId(toolId)} alt="" aria-hidden="true" />;
  }

  if (toolId === "select") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 2 L4 20 L8.6 15.9 L11.6 22 L14.6 20.5 L11.5 14.6 L18 14.3 Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (toolId === "rectangle") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.2" y="6" width="17.6" height="12" fill="rgba(0,0,0,0.08)" stroke="currentColor" strokeWidth="2.4" />
      </svg>
    );
  }

  if (toolId === "door") {
    const iconSource =
      doorType === "double"
        ? doubleDoorToolIcon
        : doorType === "sliding"
          ? slidingGlassToolIcon
          : doorToolIcon;
    return (
      <span
        className="tool-icon-image tool-icon-building tool-icon-door tool-icon-building-mask"
        style={{ "--building-icon": `url(${iconSource})` } as React.CSSProperties}
        aria-hidden="true"
      />
    );
  }

  if (toolId === "window") {
    return (
      <span
        className="tool-icon-image tool-icon-building tool-icon-window tool-icon-building-mask"
        style={{ "--building-icon": `url(${windowToolIcon})` } as React.CSSProperties}
        aria-hidden="true"
      />
    );
  }

  if (toolId === "skylight") {
    return (
      <span
        className="tool-icon-image tool-icon-building tool-icon-skylight tool-icon-building-mask"
        style={{ "--building-icon": `url(${skylightToolIcon})` } as React.CSSProperties}
        aria-hidden="true"
      />
    );
  }

  if (toolId === "text") {
    return <span className="tool-icon-text-heavy">T</span>;
  }

  if (toolId === "bumpout") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 20 L21 20 L21 13 L18 8 L15 6 L9 6 L6 8 L3 13 Z"
          fill="rgba(0,0,0,0.08)"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return <span className="icon">{fallback}</span>;
}

function ToolGroup({
  title,
  ids,
  onWindowToolConfigRequest,
  doorType,
  onDoorTypeChange,
  collapsed,
  onToolPressed,
}: {
  title: string;
  ids: ToolId[];
  onWindowToolConfigRequest?: () => void;
  doorType?: DoorToolType;
  onDoorTypeChange?: (next: DoorToolType) => void;
  collapsed?: boolean;
  onToolPressed?: (toolId: ToolId) => void;
}) {
  const { state, dispatch } = useEditor();
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPointerIdRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const longPressTargetToolRef = useRef<ToolId | null>(null);
  const longPressFiredRef = useRef(false);
  const doorButtonRef = useRef<HTMLButtonElement | null>(null);
  const doorSelectorRef = useRef<HTMLDivElement | null>(null);
  const rectangleButtonRef = useRef<HTMLButtonElement | null>(null);
  const rectangleSelectorRef = useRef<HTMLDivElement | null>(null);
  const [doorSelectorOpen, setDoorSelectorOpen] = useState(false);
  const [rectangleSelectorOpen, setRectangleSelectorOpen] = useState(false);
  const [doorSelectorAnchor, setDoorSelectorAnchor] = useState({ left: 0, top: 0, width: 0 });
  const [rectangleSelectorAnchor, setRectangleSelectorAnchor] = useState({ left: 0, top: 0, width: 0 });

  const clearToolLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = null;
    longPressPointerIdRef.current = null;
    longPressTargetToolRef.current = null;
  };

  const openDoorSelector = () => {
    if (!doorButtonRef.current) {
      return;
    }
    setDoorSelectorAnchor({
      left: doorButtonRef.current.offsetLeft,
      top: doorButtonRef.current.offsetTop + doorButtonRef.current.offsetHeight + 6,
      width: doorButtonRef.current.offsetWidth,
    });
    setDoorSelectorOpen(true);
  };

  const openRectangleSelector = () => {
    if (!rectangleButtonRef.current) {
      return;
    }
    setRectangleSelectorAnchor({
      left: rectangleButtonRef.current.offsetLeft,
      top: rectangleButtonRef.current.offsetTop + rectangleButtonRef.current.offsetHeight + 6,
      width: rectangleButtonRef.current.offsetWidth,
    });
    setRectangleSelectorOpen(true);
  };

  const orderedTools = ids
    .map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));
  const activeRectangleTool: "rectangle" | "bumpout" = state.activeTool === "bumpout" ? "bumpout" : "rectangle";

  useEffect(() => {
    if (!doorSelectorOpen) {
      return;
    }

    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (doorButtonRef.current?.contains(target)) {
        return;
      }
      if (doorSelectorRef.current?.contains(target)) {
        return;
      }
      setDoorSelectorOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDownOutside);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDownOutside);
    };
  }, [doorSelectorOpen]);

  useEffect(() => {
    if (!rectangleSelectorOpen) {
      return;
    }

    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (rectangleButtonRef.current?.contains(target)) {
        return;
      }
      if (rectangleSelectorRef.current?.contains(target)) {
        return;
      }
      setRectangleSelectorOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDownOutside);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDownOutside);
    };
  }, [rectangleSelectorOpen]);

  return (
    <div className="tool-group tool-group-with-overlay">
      <h3>{title}</h3>
      <div className="tool-grid">
        {orderedTools.map((tool) => (
          <button
            key={tool.id}
            ref={tool.id === "door" ? doorButtonRef : tool.id === "rectangle" ? rectangleButtonRef : undefined}
            type="button"
            className={`tool-btn ${state.activeTool === tool.id ? "active" : ""}`}
            draggable={false}
            onClick={() => {
              if (isUtilityToolId(tool.id)) {
                return;
              }
              if ((tool.id === "window" || tool.id === "door" || tool.id === "rectangle") && longPressFiredRef.current) {
                longPressFiredRef.current = false;
                return;
              }
              if (tool.id !== "door") {
                setDoorSelectorOpen(false);
              }
              if (tool.id !== "rectangle") {
                setRectangleSelectorOpen(false);
              }
              onToolPressed?.(tool.id);
              dispatch({ type: "SET_TOOL", tool: tool.id });
            }}
            onContextMenu={(event) => {
              if (tool.id === "window") {
                event.preventDefault();
                onToolPressed?.("window");
                dispatch({ type: "SET_TOOL", tool: "window" });
                onWindowToolConfigRequest?.();
                return;
              }
              if (tool.id === "door") {
                event.preventDefault();
                onToolPressed?.("door");
                dispatch({ type: "SET_TOOL", tool: "door" });
                openDoorSelector();
              }
            }}
            onPointerDown={(event) => {
              if ((tool.id !== "window" && tool.id !== "door" && tool.id !== "rectangle") || event.button !== 0) {
                return;
              }
              clearToolLongPress();
              longPressFiredRef.current = false;
              longPressPointerIdRef.current = event.pointerId;
              longPressTargetToolRef.current = tool.id;
              longPressStartRef.current = { x: event.clientX, y: event.clientY };
              longPressTimerRef.current = setTimeout(() => {
                longPressFiredRef.current = true;
                if (tool.id === "window") {
                  onToolPressed?.("window");
                  dispatch({ type: "SET_TOOL", tool: "window" });
                  onWindowToolConfigRequest?.();
                } else if (tool.id === "rectangle") {
                  onToolPressed?.(activeRectangleTool);
                  dispatch({ type: "SET_TOOL", tool: activeRectangleTool });
                  openRectangleSelector();
                } else {
                  onToolPressed?.("door");
                  dispatch({ type: "SET_TOOL", tool: "door" });
                  openDoorSelector();
                }
                clearToolLongPress();
              }, 520);
            }}
            onPointerMove={(event) => {
              if (
                (tool.id !== "window" && tool.id !== "door" && tool.id !== "rectangle") ||
                longPressPointerIdRef.current !== event.pointerId ||
                longPressTargetToolRef.current !== tool.id
              ) {
                return;
              }
              const dx = event.clientX - longPressStartRef.current.x;
              const dy = event.clientY - longPressStartRef.current.y;
              if (Math.hypot(dx, dy) > 8) {
                clearToolLongPress();
              }
            }}
            onPointerUp={(event) => {
              if (
                (tool.id !== "window" && tool.id !== "door" && tool.id !== "rectangle") ||
                longPressPointerIdRef.current !== event.pointerId ||
                longPressTargetToolRef.current !== tool.id
              ) {
                return;
              }
              clearToolLongPress();
            }}
            onPointerCancel={(event) => {
              if (
                (tool.id !== "window" && tool.id !== "door" && tool.id !== "rectangle") ||
                longPressPointerIdRef.current !== event.pointerId ||
                longPressTargetToolRef.current !== tool.id
              ) {
                return;
              }
              clearToolLongPress();
            }}
            onPointerLeave={() => {
              if (tool.id !== "window" && tool.id !== "door" && tool.id !== "rectangle") {
                return;
              }
              clearToolLongPress();
            }}
          >
            <ToolIcon toolId={tool.id} fallback={tool.icon} doorType={tool.id === "door" ? doorType : undefined} />
            <span className="label">{tool.label}</span>
          </button>
        ))}
      </div>

      {doorSelectorOpen && onDoorTypeChange && doorType && (
        <div
          ref={doorSelectorRef}
          className={`door-type-selector ${collapsed ? "is-collapsed" : ""}`}
          style={{ left: `${doorSelectorAnchor.left}px`, top: `${doorSelectorAnchor.top}px`, minWidth: `${doorSelectorAnchor.width}px` }}
        >
          {DOOR_TOOL_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`door-type-option ${doorType === option.id ? "active" : ""}`}
              onClick={() => {
                onDoorTypeChange(option.id);
                onToolPressed?.("door");
                dispatch({ type: "SET_TOOL", tool: "door" });
                setDoorSelectorOpen(false);
              }}
            >
              <ToolIcon toolId="door" fallback="◖" doorType={option.id} />
              {!collapsed && <span>{option.label}</span>}
            </button>
          ))}
        </div>
      )}

      {rectangleSelectorOpen && (
        <div
          ref={rectangleSelectorRef}
          className={`door-type-selector ${collapsed ? "is-collapsed" : ""}`}
          style={{ left: `${rectangleSelectorAnchor.left}px`, top: `${rectangleSelectorAnchor.top}px`, minWidth: `${rectangleSelectorAnchor.width}px` }}
        >
          {RECTANGLE_TOOL_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`door-type-option ${activeRectangleTool === option.id ? "active" : ""}`}
              onClick={() => {
                onToolPressed?.(option.id);
                dispatch({ type: "SET_TOOL", tool: option.id });
                setRectangleSelectorOpen(false);
              }}
            >
              <ToolIcon toolId={option.id} fallback={option.id === "bumpout" ? "7" : "▭"} />
              {!collapsed && <span>{option.label}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UtilityStickerGroup({
  ids,
  onStartDrag,
}: {
  ids: ToolId[];
  onStartDrag: (toolId: ToolId, event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const orderedTools = ids
    .map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));

  return (
    <div className="tool-group">
      <h3>UTILITIES</h3>
      <div className="tool-grid">
        {orderedTools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="tool-btn utility-sticker-btn"
            draggable={false}
            onClick={(event) => {
              event.preventDefault();
            }}
            onPointerDown={(event) => {
              onStartDrag(tool.id, event);
            }}
          >
            <ToolIcon toolId={tool.id} fallback={tool.icon} />
            <span className="label">{tool.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface LeftToolbarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function LeftToolbar({ collapsed, onToggleCollapse }: LeftToolbarProps) {
  const { state, dispatch } = useEditor();
  const metrics = calculateProjectMetrics(state.project, state.previewEntity);
  const detailsReport = useMemo(() => calculateProjectDetailsReport(state.project), [state.project]);
  const defaultDoorType = getDoorToolTypeFromProjectMetadata(state.project.metadata);
  const [windowToolModalOpen, setWindowToolModalOpen] = useState(false);
  const [utilityDrag, setUtilityDrag] = useState<UtilityDragState | null>(null);
  const [utilityLabelModalState, setUtilityLabelModalState] = useState<UtilityLabelModalState | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isRenameProjectModalOpen, setIsRenameProjectModalOpen] = useState(false);
  const [renameProjectDraft, setRenameProjectDraft] = useState("");
  const [isExportPdfModalOpen, setIsExportPdfModalOpen] = useState(false);
  const [exportPreviewImageUrl, setExportPreviewImageUrl] = useState<string | null>(null);
  const [exportPreviewLoading, setExportPreviewLoading] = useState(false);
  const exportPreviewRequestRef = useRef(0);
  const exportPreviewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const windowDefaultWidthFt = clampPositiveInt(Number(state.project.metadata.windowDefaultWidthFt ?? 3), 3);
  const windowDefaultHeightFt = clampPositiveInt(Number(state.project.metadata.windowDefaultHeightFt ?? 4), 4);

  const selectedEntityType = useMemo(() => {
    const selection = state.selection;
    if (selection.kind !== "entity") {
      return null;
    }
    const floor = state.project.floors.find((item) => item.id === state.project.activeFloorId) ?? state.project.floors[0];
    if (!floor) {
      return null;
    }
    const selected = floor.entities.find((entity) => entity.id === selection.id);
    return selected?.type ?? null;
  }, [state.project.activeFloorId, state.project.floors, state.selection]);

  const maybeClearSelectionForTool = (toolId: ToolId) => {
    if (state.selection.kind !== "entity") {
      return;
    }
    if (toolId === "select" || selectedEntityType === toolId) {
      return;
    }
    dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
  };

  useEffect(() => {
    if (!utilityDrag) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      setUtilityDrag((current) =>
        current && current.pointerId === event.pointerId
          ? {
              ...current,
              x: event.clientX,
              y: event.clientY,
            }
          : null,
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      setUtilityDrag((current) => {
        if (!current || current.pointerId !== event.pointerId) {
          return null;
        }

        const workspace = document.querySelector("svg.workspace") as SVGSVGElement | null;
        if (workspace) {
          const rect = workspace.getBoundingClientRect();
          const insideWorkspace =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;

          if (insideWorkspace) {
            const world = snapPointToGrid(
              screenToWorld(
                {
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                },
                state.camera,
              ),
            );
            const sticker = createEntityFromTool(current.toolId as any, world.x, world.y);
            dispatch({ type: "UPSERT_ENTITY", entity: sticker });
            dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: sticker.id } });
            dispatch({ type: "SET_TOOL", tool: "select" });

            if (sticker.type === "other") {
              setUtilityLabelModalState({
                entityId: sticker.id,
                initialValues: {
                  text: "",
                  color: "WHITE",
                },
              });
            }
          }
        }
        return null;
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dispatch, state.camera, utilityDrag]);

  const startUtilityDrag = (toolId: ToolId, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isUtilityToolId(toolId)) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    maybeClearSelectionForTool(toolId);
    setUtilityDrag({
      toolId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const utilityGhost =
    utilityDrag && isUtilityToolId(utilityDrag.toolId) ? (
      <div className="utility-drag-ghost" style={{ left: utilityDrag.x, top: utilityDrag.y }}>
        <img src={getUtilityIconByToolId(utilityDrag.toolId)} alt="" aria-hidden="true" />
      </div>
    ) : null;

  const utilityLabelModal = (
    <UtilityLabelModal
      isOpen={utilityLabelModalState !== null}
      initialValues={utilityLabelModalState?.initialValues ?? { text: "", color: "WHITE" }}
      onCancel={() => setUtilityLabelModalState(null)}
      onSubmit={(payload: UtilityLabelSubmit) => {
        if (!utilityLabelModalState) {
          return;
        }

        const floor =
          state.project.floors.find((item) => item.id === state.project.activeFloorId) ??
          state.project.floors[0];
          if (!floor) {
            setUtilityLabelModalState(null);
            return;
          }
        const existing = floor.entities.find((entity) => entity.id === utilityLabelModalState.entityId);
        if (!existing || existing.type !== "other") {
          setUtilityLabelModalState(null);
          return;
        }

        dispatch({
          type: "UPSERT_ENTITY",
          entity: {
            ...existing,
            label: payload.text.toUpperCase(),
            metadata: {
              ...existing.metadata,
              color: payload.color,
            },
          },
        });
        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: existing.id } });
        setUtilityLabelModalState(null);
      }}
    />
  );

  const windowToolModal = (
    <WindowModal
      isOpen={windowToolModalOpen}
      initialWidthFt={windowDefaultWidthFt}
      initialHeightFt={windowDefaultHeightFt}
      onCancel={() => setWindowToolModalOpen(false)}
      onSubmit={(payload: WindowModalSubmit) => {
        dispatch({
          type: "SET_DEFAULT_WINDOW_SIZE",
          widthFt: payload.widthFt,
          heightFt: payload.heightFt,
        });
        setWindowToolModalOpen(false);
      }}
    />
  );

  const renameProjectModal = (
    <div className="modal-backdrop" onPointerDown={() => setIsRenameProjectModalOpen(false)}>
      <section className="text-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>RENAME PROJECT</h2>
        <div className="modal-row">
          <label htmlFor="renameProjectName">PROJECT NAME:</label>
          <input
            id="renameProjectName"
            className="text-content-input"
            value={renameProjectDraft}
            onChange={(event) => setRenameProjectDraft(event.target.value)}
            placeholder="Enter project name"
            autoFocus
          />
        </div>
        <div className="modal-actions level-modal-actions">
          <button
            type="button"
            className="okay"
            onClick={() => {
              const trimmed = renameProjectDraft.trim();
              if (!trimmed) {
                return;
              }
              dispatch({ type: "SET_PROJECT_NAME", projectName: trimmed });
              setIsRenameProjectModalOpen(false);
            }}
          >
            SAVE
          </button>
          <button type="button" className="cancel" onClick={() => setIsRenameProjectModalOpen(false)}>
            CANCEL
          </button>
        </div>
      </section>
    </div>
  );

  const exportPdf = async (options: ExportPdfStyleOptions) => {
    if (isExportingPdf || state.project.floors.length === 0) {
      return;
    }

    const workspaceSvg = document.querySelector("svg.workspace") as SVGSVGElement | null;
    if (!workspaceSvg) {
      window.alert("Unable to find workspace for PDF export.");
      return;
    }

    const viewportWidth = workspaceSvg.clientWidth;
    const viewportHeight = workspaceSvg.clientHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      window.alert("Workspace has invalid dimensions for export.");
      return;
    }

    const originalFloorId = state.project.activeFloorId;
    const originalCamera = { ...state.camera };
    const originalSelection = state.selection;

    const floorSnapshot = [...state.project.floors];
    const levelRenders: LevelRender[] = [];

    setIsExportingPdf(true);
    try {
      dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
      dispatch({ type: "CLEAR_PREVIEW_ENTITY" });

      for (const floor of floorSnapshot) {
        dispatch({ type: "SET_ACTIVE_FLOOR", floorId: floor.id });
        await waitForPaint();

        const frameButton = document.querySelector("button.workspace-frame-btn") as HTMLButtonElement | null;
        if (frameButton) {
          frameButton.click();
          await waitForPaint();
        } else {
          const bounds = getFloorFrameBounds(floor);
          if (bounds) {
            const framed = frameCameraForBounds(bounds, viewportWidth, viewportHeight);
            dispatch({ type: "SET_CAMERA", camera: framed });
            await waitForPaint();
          }
        }

        const pngDataUrl = await captureWorkspacePngDataUrl(workspaceSvg, options, 2);
        levelRenders.push({ name: floor.name, pngDataUrl });
      }

      await downloadLevelsPdf(levelRenders, detailsReport, state.project.projectName || "NEW ASSESSMENT");
    } catch (error) {
      console.error(error);
      window.alert("PDF export failed. Please try again.");
    } finally {
      dispatch({ type: "SET_ACTIVE_FLOOR", floorId: originalFloorId });
      dispatch({ type: "SET_CAMERA", camera: originalCamera });
      dispatch({ type: "SET_SELECTION", selection: originalSelection });
      setIsExportingPdf(false);
    }
  };

  const handleExportPdfRequest = (options: ExportPdfStyleOptions) => {
    void exportPdf(options);
  };

  const frameSceneAndOpenExportModal = async () => {
    if (isExportingPdf || state.project.floors.length === 0) {
      return;
    }

    const workspaceSvg = document.querySelector("svg.workspace") as SVGSVGElement | null;
    if (!workspaceSvg || workspaceSvg.clientWidth <= 0 || workspaceSvg.clientHeight <= 0) {
      setIsExportPdfModalOpen(true);
      return;
    }

    const activeFloor =
      state.project.floors.find((floor) => floor.id === state.project.activeFloorId) ??
      state.project.floors[0] ??
      null;

    if (activeFloor) {
      const bounds = getFloorFrameBounds(activeFloor);
      if (bounds) {
        const framed = frameCameraForBounds(bounds, workspaceSvg.clientWidth, workspaceSvg.clientHeight);
        dispatch({ type: "SET_CAMERA", camera: framed });
        await waitForPaint();
      }
    }

    setIsExportPdfModalOpen(true);
  };

  const refreshExportPreview = useCallback((options: ExportPdfStyleOptions) => {
    if (!isExportPdfModalOpen) {
      return;
    }

    const workspaceSvg = document.querySelector("svg.workspace") as SVGSVGElement | null;
    if (!workspaceSvg || workspaceSvg.clientWidth <= 0 || workspaceSvg.clientHeight <= 0) {
      setExportPreviewImageUrl(null);
      setExportPreviewLoading(false);
      return;
    }

    if (exportPreviewDebounceRef.current) {
      clearTimeout(exportPreviewDebounceRef.current);
    }

    exportPreviewDebounceRef.current = setTimeout(() => {
      const requestId = exportPreviewRequestRef.current + 1;
      exportPreviewRequestRef.current = requestId;
      setExportPreviewLoading(true);

      void (async () => {
        try {
          const previewDataUrl = await captureWorkspacePngDataUrl(workspaceSvg, options, 1);
          if (exportPreviewRequestRef.current !== requestId) {
            return;
          }
          setExportPreviewImageUrl(previewDataUrl);
        } catch {
          if (exportPreviewRequestRef.current !== requestId) {
            return;
          }
          setExportPreviewImageUrl(null);
        } finally {
          if (exportPreviewRequestRef.current === requestId) {
            setExportPreviewLoading(false);
          }
        }
      })();
    }, 120);
  }, [isExportPdfModalOpen]);

  useEffect(() => {
    if (!isExportPdfModalOpen) {
      exportPreviewRequestRef.current += 1;
      if (exportPreviewDebounceRef.current) {
        clearTimeout(exportPreviewDebounceRef.current);
        exportPreviewDebounceRef.current = null;
      }
      setExportPreviewLoading(false);
      return;
    }

    const workspaceSvg = document.querySelector("svg.workspace") as SVGSVGElement | null;
    if (!workspaceSvg) {
      setExportPreviewImageUrl(null);
      setExportPreviewLoading(false);
    }
  }, [isExportPdfModalOpen]);

  useEffect(() => {
    return () => {
      if (exportPreviewDebounceRef.current) {
        clearTimeout(exportPreviewDebounceRef.current);
      }
    };
  }, []);

  const saveProjectToDevice = () => {
    const json = exportProjectAsJson(state.project);
    const blob = new Blob([json], { type: "application/json" });
    const safeName = toSafeFileBaseName(state.project.projectName || "home-layout");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const loadProjectFromDevice = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const raw = await file.text();
      const imported = importProjectFromJson(raw);
      const looksValid =
        imported &&
        typeof imported === "object" &&
        Array.isArray(imported.floors) &&
        typeof imported.activeFloorId === "string";

      if (!looksValid) {
        throw new Error("Invalid project format");
      }

      dispatch({ type: "LOAD_PROJECT", project: imported });
      dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
    } catch (error) {
      console.error(error);
      window.alert("Unable to load file. Please choose a valid project JSON export.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <aside className={`left-toolbar ${collapsed ? "collapsed" : ""}`}>
      <button
        type="button"
        className="sidebar-collapse-btn"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand" : "Collapse"}
        onClick={onToggleCollapse}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d={collapsed ? "M9 6.5 L14.5 12 L9 17.5" : "M15 6.5 L9.5 12 L15 17.5"}
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <ToolGroup
        title="TOOLS"
        ids={["select", "rectangle", "text"]}
        collapsed={collapsed}
        onToolPressed={maybeClearSelectionForTool}
      />
      <ToolGroup
        title="BUILDING"
        ids={["door", "window", "skylight"]}
        collapsed={collapsed}
        doorType={defaultDoorType}
        onDoorTypeChange={(next) => dispatch({ type: "SET_DEFAULT_DOOR_TYPE", doorType: next })}
        onWindowToolConfigRequest={() => setWindowToolModalOpen(true)}
        onToolPressed={maybeClearSelectionForTool}
      />
      <UtilityStickerGroup
        ids={["condenser", "heater", "dhw", "gas", "electric", "other"]}
        onStartDrag={startUtilityDrag}
      />

      {!collapsed && (
        <section className="details-panel">
          <h3>PROJECT DETAILS</h3>
          <div className="details-project-name">{state.project.projectName || "NEW ASSESSMENT"}</div>
          <div className="stats-row">
            <span>Total Ft²</span>
            <strong>{metrics.conditionedAreaFt2.toFixed(0)}</strong>
          </div>
          <div className="stats-row">
            <span>Avg Ceiling Height</span>
            <strong>{metrics.averageCeilingHeightFt.toFixed(1)}</strong>
          </div>
          <div className="stats-row">
            <span>Total Volume</span>
            <strong>{metrics.volumeFt3.toFixed(0)}</strong>
          </div>
          <button type="button" className="view-all-details-btn" onClick={() => setIsDetailsModalOpen(true)}>
            VIEW ALL DETAILS
          </button>
        </section>
      )}

      {!collapsed && (
        <div className="sidebar-file-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="load-file-input"
            onChange={(event) => {
              void loadProjectFromDevice(event);
            }}
          />
          <div className="save-load-row">
            <button
              className="save-load-btn"
              type="button"
              onClick={saveProjectToDevice}
              title="Save"
              aria-label="Save"
            >
              SAVE
            </button>
            <button
              className="save-load-btn"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Load"
              aria-label="Load"
            >
              LOAD
            </button>
          </div>

          <button
            className="export-pdf-btn"
            type="button"
            onClick={() => {
              void frameSceneAndOpenExportModal();
            }}
            title="Export PDF"
            aria-label="Export PDF"
            disabled={isExportingPdf}
          >
            {isExportingPdf ? "Exporting PDF..." : "EXPORT PDF"}
          </button>

          <button
            className="return-btn"
            type="button"
            onClick={() => window.history.back()}
            title="Return"
            aria-label="Return"
          >
            Return To Job
          </button>
        </div>
      )}

      {collapsed && (
        <button
          className="return-btn"
          type="button"
          onClick={() => window.history.back()}
          title="Return"
          aria-label="Return"
        >
          {"<-"}
        </button>
      )}

      {typeof document !== "undefined" ? createPortal(windowToolModal, document.body) : windowToolModal}
      {typeof document !== "undefined" ? createPortal(utilityLabelModal, document.body) : utilityLabelModal}
      {isRenameProjectModalOpen && typeof document !== "undefined"
        ? createPortal(renameProjectModal, document.body)
        : null}
      {isDetailsModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="modal-backdrop" onPointerDown={() => setIsDetailsModalOpen(false)}>
              <section className="text-modal details-breakdown-modal" onPointerDown={(event) => event.stopPropagation()}>
                <div className="details-modal-header-row">
                  <div className="details-modal-project-name">{state.project.projectName || "NEW ASSESSMENT"}</div>
                  <button
                    type="button"
                    className="view-all-details-btn details-modal-rename-btn"
                    onClick={() => {
                      setRenameProjectDraft(state.project.projectName || "New Assessment");
                      setIsRenameProjectModalOpen(true);
                    }}
                  >
                    RENAME PROJECT
                  </button>
                </div>
                <h2>TOTALS + LAYOUT DETAILS</h2>

                <section className="details-section">
                  <h3>TOTALS</h3>
                  <div className="details-breakdown-row">
                    <span>Total ft²</span>
                    <strong>{detailsReport.totals.totalSqFt.toFixed(0)}</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Avg Ceiling Height</span>
                    <strong>{detailsReport.totals.averageCeilingHeightFt.toFixed(1)}'</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total Volume</span>
                    <strong>{detailsReport.totals.totalVolumeFt3.toFixed(0)} ft³</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Front Door Orientation</span>
                    <strong>
                      {ORIENTATION_LABELS[detailsReport.totals.frontDoorOrientation]} ({detailsReport.totals.frontDoorOrientation})
                    </strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total Attic ft²</span>
                    <strong>{detailsReport.totals.totalAtticSqFt.toFixed(0)}</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total Basement ft² (Basement label)</span>
                    <strong>{detailsReport.totals.totalBasementSqFt.toFixed(0)}</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total Crawlspace ft² (Crawlspace label)</span>
                    <strong>{detailsReport.totals.totalCrawlspaceSqFt.toFixed(0)}</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total Slab ft² (Slab label)</span>
                    <strong>{detailsReport.totals.totalSlabSqFt.toFixed(0)}</strong>
                  </div>
                </section>

                <section className="details-section">
                  <h3>OPENING SUMMARY</h3>
                  <div className="details-breakdown-row">
                    <span>Total Windows</span>
                    <strong>{detailsReport.totals.totalWindowCount}</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total Doors</span>
                    <strong>{detailsReport.totals.totalDoorCount}</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total Window Area</span>
                    <strong>{detailsReport.totals.totalWindowAreaFt2.toFixed(0)} ft²</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total Door Area</span>
                    <strong>{detailsReport.totals.totalDoorAreaFt2.toFixed(0)} ft²</strong>
                  </div>
                </section>

                <section className="details-section">
                  <h3>FLOOR BREAKDOWN</h3>
                  {detailsReport.floorBreakdown.map((floor) => (
                    <div key={`floor-breakdown-${floor.floorId}`} className="details-card">
                      <div className="details-card-title">{floor.floorName}</div>
                      <div className="details-breakdown-row">
                        <span>Floor Total ft²</span>
                        <strong>{floor.totalAreaFt2.toFixed(0)}</strong>
                      </div>
                      <div className="details-breakdown-row">
                        <span>Conditioned ft²</span>
                        <strong>{floor.conditionedAreaFt2.toFixed(0)}</strong>
                      </div>
                      {floor.rectangles.map((rectangle) => (
                        <div key={rectangle.id} className="details-breakdown-row details-breakdown-row-indent">
                          <span>{rectangle.conditioned ? rectangle.name : `${rectangle.name} (unconditioned)`}</span>
                          <strong>{rectangle.areaFt2.toFixed(0)} ft²</strong>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>

                <section className="details-section">
                  <h3>OVERHANGS</h3>
                  <div className="details-breakdown-row">
                    <span>Total Overhang Areas</span>
                    <strong>{detailsReport.overhangs.totalAreaCount}</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total Overhang ft²</span>
                    <strong>{detailsReport.overhangs.totalAreaFt2.toFixed(0)} ft²</strong>
                  </div>

                  {detailsReport.overhangs.bySide.map((side) => (
                    <div key={`overhang-side-${side.side}`} className="details-breakdown-row details-breakdown-row-indent">
                      <span>
                        {ORIENTATION_LABELS[side.side]} ({side.side})
                      </span>
                      <strong>
                        {side.areaCount} ({side.totalAreaFt2.toFixed(0)} ft²)
                      </strong>
                    </div>
                  ))}

                  {detailsReport.overhangs.areas.map((area, index) => (
                    <div
                      key={`overhang-area-${area.floorId}-${index}`}
                      className="details-breakdown-row details-breakdown-row-indent details-breakdown-row-fine"
                    >
                      <span>
                        {area.floorName} • {ORIENTATION_LABELS[area.side]} ({area.side})
                      </span>
                      <strong>{area.areaFt2.toFixed(0)} ft²</strong>
                    </div>
                  ))}
                </section>

                <section className="details-section">
                  <h3>AREAS OVER UNCONDITIONED SPACE</h3>
                  <div className="details-breakdown-row">
                    <span>Total Areas</span>
                    <strong>{detailsReport.overUnconditionedAreas.totalAreaCount}</strong>
                  </div>
                  <div className="details-breakdown-row">
                    <span>Total ft²</span>
                    <strong>{detailsReport.overUnconditionedAreas.totalAreaFt2.toFixed(0)} ft²</strong>
                  </div>

                  {detailsReport.overUnconditionedAreas.areas.map((area, index) => (
                    <div
                      key={`over-unconditioned-area-${area.floorId}-${index}`}
                      className="details-breakdown-row details-breakdown-row-indent details-breakdown-row-fine"
                    >
                      <span>{area.floorName}</span>
                      <strong>{area.areaFt2.toFixed(0)} ft²</strong>
                    </div>
                  ))}
                </section>

                <section className="details-section">
                  <h3>WINDOW + DOOR BY ORIENTATION SIDE</h3>
                  {detailsReport.openingsBySide.map((sideSummary) => {
                    const sizeBuckets = new Map<string, { count: number; totalAreaFt2: number }>();
                    for (const opening of sideSummary.openings) {
                      const key = `${opening.kind === "window" ? "Window" : "Door"} ${opening.sizeLabel}`;
                      const current = sizeBuckets.get(key) ?? { count: 0, totalAreaFt2: 0 };
                      sizeBuckets.set(key, {
                        count: current.count + 1,
                        totalAreaFt2: current.totalAreaFt2 + opening.areaFt2,
                      });
                    }

                    return (
                      <div key={`side-summary-${sideSummary.side}`} className="details-card">
                        <div className="details-card-title">
                          {ORIENTATION_LABELS[sideSummary.side]} ({sideSummary.side}) Side
                        </div>
                        <div className="details-breakdown-row">
                          <span>Total Openings</span>
                          <strong>{sideSummary.totalCount}</strong>
                        </div>
                        <div className="details-breakdown-row">
                          <span>Windows / Doors</span>
                          <strong>
                            {sideSummary.windowCount} / {sideSummary.doorCount}
                          </strong>
                        </div>
                        <div className="details-breakdown-row">
                          <span>Total Window Area</span>
                          <strong>{sideSummary.totalWindowAreaFt2.toFixed(0)} ft²</strong>
                        </div>
                        <div className="details-breakdown-row">
                          <span>Total Door Area</span>
                          <strong>{sideSummary.totalDoorAreaFt2.toFixed(0)} ft²</strong>
                        </div>
                        <div className="details-breakdown-row">
                          <span>Total Opening Area</span>
                          <strong>{sideSummary.totalAreaFt2.toFixed(0)} ft²</strong>
                        </div>

                        {[...sizeBuckets.entries()].map(([sizeKey, data]) => (
                          <div key={`${sideSummary.side}-${sizeKey}`} className="details-breakdown-row details-breakdown-row-indent">
                            <span>{sizeKey}</span>
                            <strong>
                              {data.count} ({data.totalAreaFt2.toFixed(0)} ft²)
                            </strong>
                          </div>
                        ))}

                        {sideSummary.openings.map((opening, index) => (
                          <div key={`${opening.id}-${index}`} className="details-breakdown-row details-breakdown-row-indent details-breakdown-row-fine">
                            <span>
                              {opening.kind === "window" ? "Window" : "Door"} {opening.sizeLabel} • {opening.floorName}
                            </span>
                            <strong>{opening.areaFt2.toFixed(0)} ft²</strong>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </section>

                <div className="modal-actions level-modal-actions">
                  <button type="button" className="cancel" onClick={() => setIsDetailsModalOpen(false)}>
                    CLOSE
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
      {typeof document !== "undefined" ? createPortal(
        <ExportPdfModal
          isOpen={isExportPdfModalOpen}
          isExporting={isExportingPdf}
          previewImageUrl={exportPreviewImageUrl}
          previewLoading={exportPreviewLoading}
          onCancel={() => setIsExportPdfModalOpen(false)}
          onOptionsChange={refreshExportPreview}
          onExport={(options) => {
            void handleExportPdfRequest(options);
            setIsExportPdfModalOpen(false);
          }}
        />,
        document.body,
      ) : null}

      {utilityGhost && typeof document !== "undefined" ? createPortal(utilityGhost, document.body) : null}
    </aside>
  );
}

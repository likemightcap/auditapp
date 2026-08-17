import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { calculateProjectMetrics } from "../utils/calculations";
import { useEditor } from "../state/EditorContext";
import { createEntityFromTool } from "../state/editorReducer";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
import { exportProjectAsJson, importProjectFromJson } from "../utils/persistence";
import { getUtilityIconByToolId, isUtilityToolId } from "../assets/utilityIcons";
import doorToolIcon from "../../assets/building-icons/door.png";
import doubleDoorToolIcon from "../../assets/building-icons/double-door.png";
import slidingGlassToolIcon from "../../assets/building-icons/sliding-glass.png";
import windowToolIcon from "../../assets/building-icons/window.png";
import skylightToolIcon from "../../assets/building-icons/skylight.png";
import { WindowModal } from "./WindowModal";
import type { WindowModalSubmit } from "./WindowModal";
import { UtilityLabelModal } from "./UtilityLabelModal";
import type { UtilityLabelInitialValues, UtilityLabelSubmit } from "./UtilityLabelModal";
import { MAX_ZOOM, MIN_ZOOM, clamp, screenToWorld, snapPointToGrid } from "../utils/geometry";
import type { CameraState, FloorData, MapEntity, ToolId } from "../types";

type DoorToolType = "single" | "double" | "sliding";

function getDoorToolTypeFromProjectMetadata(metadata: Record<string, string | number | boolean>): DoorToolType {
  const value = String(metadata.doorDefaultType ?? "single").toLowerCase();
  if (value === "double" || value === "sliding") {
    return value;
  }
  return "single";
}

function getRectangleStickyModeFromProjectMetadata(metadata: Record<string, string | number | boolean>): boolean {
  return Boolean(metadata.rectangleStickyMode);
}

const DOOR_TOOL_OPTIONS: Array<{ id: DoorToolType; label: string }> = [
  { id: "single", label: "DOOR" },
  { id: "double", label: "DOUBLE" },
  { id: "sliding", label: "SLIDING" },
];

function clampPositiveInt(value: number, fallback: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(1, Math.round(normalized));
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

async function captureWorkspacePngDataUrl(svg: SVGSVGElement, scale = 2): Promise<string> {
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
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function downloadLevelsPdf(levels: LevelRender[], metrics: ReturnType<typeof calculateProjectMetrics>): Promise<void> {
  const pdfDoc = await PDFDocument.create();
  const headerFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const textFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const blue = rgb(0.38, 0.56, 0.78);
  const navy = rgb(0.13, 0.22, 0.37);
  const white = rgb(1, 1, 1);
  const pages = Math.max(1, Math.ceil(levels.length / 2));

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const left = 0;
    const right = pageWidth;
    const headerHeight = 92;
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

    const detailSize = 13;
    const detailX = pageWidth - 210;
    page.drawText(`${metrics.conditionedAreaFt2.toFixed(0)} :TOTAL FT²`, {
      x: detailX,
      y: pageHeight - 34,
      size: detailSize,
      font: textFont,
      color: navy,
    });
    page.drawText(`${metrics.averageCeilingHeightFt.toFixed(1)} :AVERAGE CEILING HEIGHT`, {
      x: detailX,
      y: pageHeight - 52,
      size: detailSize,
      font: textFont,
      color: navy,
    });
    page.drawText(`${metrics.volumeFt3.toFixed(0)} :TOTAL VOLUME`, {
      x: detailX,
      y: pageHeight - 70,
      size: detailSize,
      font: textFont,
      color: navy,
    });

    const slots = [
      { y: sectionHeight + divider, level: levels[pageIndex * 2] },
      { y: 0, level: levels[pageIndex * 2 + 1] },
    ];

    for (const slot of slots) {
      page.drawRectangle({
        x: left,
        y: slot.y,
        width: right - left,
        height: sectionHeight,
        color: blue,
      });

      if (!slot.level) {
        continue;
      }

      const label = slot.level.name.toUpperCase();
      const labelSize = 26;
      const labelWidth = textFont.widthOfTextAtSize(label, labelSize);
      const labelCenterY = slot.y + sectionHeight / 2;
      page.drawText(label, {
        x: 30,
        y: labelCenterY - labelWidth / 2,
        size: labelSize,
        rotate: degrees(90),
        font: textFont,
        color: white,
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
    }
  }

  const bytes = await pdfDoc.save();
  const pdfBytes = new Uint8Array(bytes);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "home-layout-export.pdf";
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

  return <span className="icon">{fallback}</span>;
}

function ToolGroup({
  title,
  ids,
  onWindowToolConfigRequest,
  doorType,
  rectangleStickyMode,
  onDoorTypeChange,
  collapsed,
  onToolPressed,
}: {
  title: string;
  ids: ToolId[];
  onWindowToolConfigRequest?: () => void;
  doorType?: DoorToolType;
  rectangleStickyMode?: boolean;
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
  const [doorSelectorOpen, setDoorSelectorOpen] = useState(false);
  const [doorSelectorAnchor, setDoorSelectorAnchor] = useState({ left: 0, top: 0, width: 0 });

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

  const orderedTools = ids
    .map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));

  return (
    <div className="tool-group tool-group-with-overlay">
      <h3>{title}</h3>
      <div className="tool-grid">
        {orderedTools.map((tool) => (
          <button
            key={tool.id}
            ref={tool.id === "door" ? doorButtonRef : undefined}
            type="button"
            className={`tool-btn ${state.activeTool === tool.id ? "active" : ""} ${
              tool.id === "rectangle" && rectangleStickyMode ? "tool-btn-sticky" : ""
            }`}
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
                  onToolPressed?.("rectangle");
                  dispatch({ type: "SET_RECTANGLE_STICKY_MODE", enabled: !rectangleStickyMode });
                  dispatch({ type: "SET_TOOL", tool: "rectangle" });
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
  const defaultDoorType = getDoorToolTypeFromProjectMetadata(state.project.metadata);
  const rectangleStickyMode = getRectangleStickyModeFromProjectMetadata(state.project.metadata);
  const [windowToolModalOpen, setWindowToolModalOpen] = useState(false);
  const [utilityDrag, setUtilityDrag] = useState<UtilityDragState | null>(null);
  const [utilityLabelModalState, setUtilityLabelModalState] = useState<UtilityLabelModalState | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
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

  const exportPdf = async () => {
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

        const pngDataUrl = await captureWorkspacePngDataUrl(workspaceSvg, 2);
        levelRenders.push({ name: floor.name, pngDataUrl });
      }

      await downloadLevelsPdf(levelRenders, metrics);
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

  const saveProjectToDevice = () => {
    const json = exportProjectAsJson(state.project);
    const blob = new Blob([json], { type: "application/json" });
    const safeName = (state.project.projectName || "home-layout")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "home-layout";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName}.audit.json`;
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
        {collapsed ? ">" : "<"}
      </button>

      <ToolGroup
        title="TOOLS"
        ids={["select", "rectangle", "text"]}
        collapsed={collapsed}
        rectangleStickyMode={rectangleStickyMode}
        onToolPressed={maybeClearSelectionForTool}
      />
      <ToolGroup
        title="BUILDING"
        ids={["door", "window", "skylight"]}
        collapsed={collapsed}
        doorType={defaultDoorType}
        rectangleStickyMode={rectangleStickyMode}
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
              void exportPdf();
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

      {utilityGhost && typeof document !== "undefined" ? createPortal(utilityGhost, document.body) : null}
    </aside>
  );
}

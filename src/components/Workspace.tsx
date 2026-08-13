import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { RectangleModal } from "./RectangleModal";
import type { RectangleModalInitialValues, RectangleModalSubmit } from "./RectangleModal";
import { TextModal } from "./TextModal";
import type { TextModalInitialValues, TextModalSubmit } from "./TextModal";
import { DoorModal } from "./DoorModal";
import type { DoorModalSubmit } from "./DoorModal";
import { WindowModal } from "./WindowModal";
import type { WindowModalSubmit } from "./WindowModal";
import { UtilityLabelModal } from "./UtilityLabelModal";
import type { UtilityLabelSubmit } from "./UtilityLabelModal";
import { useEditor } from "../state/EditorContext";
import { createEntityFromTool, createWallPoint, createWallSegment } from "../state/editorReducer";
import { getToolDefinition } from "../tools/toolDefinitions";
import { getUtilityIconByEntityType, isUtilityEntityType } from "../assets/utilityIcons";
import type { MapEntity, Point, WallPoint, WallSegment } from "../types";
import {
  clamp,
  constrainOrthogonal,
  distance,
  MAX_ZOOM,
  MIN_ZOOM,
  midpoint,
  screenToWorld,
  snapPointToGrid,
} from "../utils/geometry";

interface InteractionState {
  type:
    | "none"
    | "pan"
    | "drag-entity"
    | "drag-wall-point"
    | "draw-rect"
    | "draw-line"
    | "resize-rect"
    | "resize-window"
    | "resize-skylight";
  pointerId: number | null;
  startScreen: Point;
  startWorld: Point;
  targetId?: string;
  sourceRectangleId?: string;
  windowHandle?: "start" | "end";
  tapAction?: "flip-door";
  entitySnapshot?: MapEntity;
  pointSnapshot?: WallPoint;
  resizeHandle?: ResizeHandle;
  dragStarted?: boolean;
  latestWorld?: Point;
}

interface PinchGestureState {
  active: boolean;
  startDistance: number;
  startZoom: number;
  anchorWorld: Point;
}

const EMPTY_FLOOR = {
  id: "",
  name: "",
  entities: [],
  wallPoints: [],
  wallSegments: [],
};

function getFloor(state: ReturnType<typeof useEditor>["state"]) {
  return state.project.floors.find((floor) => floor.id === state.project.activeFloorId) ?? state.project.floors[0] ?? EMPTY_FLOOR;
}

function fmtFeet(value: number): string {
  return `${Math.round(value)}'`;
}

const WINDOW_FILL_THICKNESS = 0.56;
const WINDOW_SELECTION_PADDING = 0.12;
const WINDOW_ANCHOR_WIDTH = 0.22;
const WINDOW_ANCHOR_HEIGHT = 0.46;
const WINDOW_LABEL_OFFSET = 1.02;
const LINEAR_MARKER_COLOR = "#96677a";

function getRectangleFillColor(color: string): string {
  switch (color.toLowerCase()) {
    case "blue":
      return "rgba(56, 142, 255, 0.5)";
    case "red":
      return "rgba(217, 74, 67, 0.5)";
    case "yellow":
      return "rgba(242, 202, 69, 0.5)";
    case "white":
    default:
      return "rgba(255, 255, 255, 0.5)";
  }
}

function RectangleCeilingOverlay({ entity }: { entity: MapEntity }) {
  if (entity.type !== "rectangle") {
    return null;
  }

  const ceilingType = entity.metadata.ceilingType ?? "standard";
  if (ceilingType === "none") {
    return null;
  }

  const standardHeight = Number(entity.metadata.standardHeightFt ?? 8);
  const lowHeight = Number(entity.metadata.lowHeightFt ?? 8);
  const highHeight = Number(entity.metadata.highHeightFt ?? 12);

  const xCenter = entity.width / 2;
  const yCenter = entity.height / 2;
  const inset = 1.2;
  const heightLabelY = Math.max(0.8, yCenter - 1.8);
  const isCathedralVertical = ceilingType === "cathedral";
  const isCathedralHorizontal = ceilingType === "cathedral-horizontal";
  const isSlopedHorizontal = ceilingType === "sloped-horizontal";

  if (ceilingType === "standard") {
    return (
      <g className="ceiling-overlay" pointerEvents="none">
        <text x={xCenter} y={heightLabelY} textAnchor="middle" className="ceiling-caption">
          HEIGHT
        </text>
        <text x={xCenter} y={yCenter} textAnchor="middle" className="ceiling-label">
          {fmtFeet(standardHeight)}
        </text>
      </g>
    );
  }

  if (isCathedralVertical || isCathedralHorizontal) {
    const centerGap = 1.25;
    const arrowSize = 0.42;
    const leftArrowX = xCenter - centerGap;
    const rightArrowX = xCenter + centerGap;
    const topArrowY = yCenter - centerGap;
    const bottomArrowY = yCenter + centerGap;

    if (isCathedralHorizontal) {
      return (
        <g className="ceiling-overlay" pointerEvents="none">
          <line x1={xCenter} y1={0} x2={xCenter} y2={yCenter - 1.8} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.2} />
          <line x1={xCenter} y1={yCenter + 1.8} x2={xCenter} y2={entity.height} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.2} />

          <line x1={inset} y1={yCenter} x2={leftArrowX - arrowSize} y2={yCenter} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.18} />
          <line x1={entity.width - inset} y1={yCenter} x2={rightArrowX + arrowSize} y2={yCenter} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.18} />

          <polygon
            points={`${leftArrowX - arrowSize},${yCenter - arrowSize} ${leftArrowX - arrowSize},${yCenter + arrowSize} ${leftArrowX},${yCenter}`}
            fill={LINEAR_MARKER_COLOR}
          />
          <polygon
            points={`${rightArrowX + arrowSize},${yCenter - arrowSize} ${rightArrowX + arrowSize},${yCenter + arrowSize} ${rightArrowX},${yCenter}`}
            fill={LINEAR_MARKER_COLOR}
          />

          <text x={(inset + leftArrowX) / 2 - 0.1} y={yCenter - 0.65} textAnchor="middle" className="ceiling-label">
            {fmtFeet(lowHeight)}
          </text>
          <text
            x={(entity.width - inset + rightArrowX) / 2 + 0.1}
            y={yCenter - 0.65}
            textAnchor="middle"
            className="ceiling-label"
          >
            {fmtFeet(lowHeight)}
          </text>
          <text x={xCenter} y={yCenter - 0.58} textAnchor="middle" className="ceiling-caption cathedral-caption">
            CATHEDRAL
          </text>
          <text x={xCenter} y={yCenter + 0.74} textAnchor="middle" className="ceiling-value cathedral-value">
            {fmtFeet(highHeight)}
          </text>
        </g>
      );
    }

    return (
      <g className="ceiling-overlay" pointerEvents="none">
        <line x1={0} y1={yCenter} x2={xCenter - 1.8} y2={yCenter} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.2} />
        <line x1={xCenter + 1.8} y1={yCenter} x2={entity.width} y2={yCenter} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.2} />

        <line x1={xCenter} y1={inset} x2={xCenter} y2={topArrowY - arrowSize} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.18} />
        <line x1={xCenter} y1={entity.height - inset} x2={xCenter} y2={bottomArrowY + arrowSize} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.18} />

        <polygon
          points={`${xCenter - arrowSize},${topArrowY - arrowSize} ${xCenter + arrowSize},${topArrowY - arrowSize} ${xCenter},${topArrowY}`}
          fill={LINEAR_MARKER_COLOR}
        />
        <polygon
          points={`${xCenter - arrowSize},${bottomArrowY + arrowSize} ${xCenter + arrowSize},${bottomArrowY + arrowSize} ${xCenter},${bottomArrowY}`}
          fill={LINEAR_MARKER_COLOR}
        />

        <text x={xCenter + 1.05} y={(inset + topArrowY) / 2 + 0.2} textAnchor="start" className="ceiling-label">
          {fmtFeet(lowHeight)}
        </text>
        <text
          x={xCenter + 1.05}
          y={(entity.height - inset + bottomArrowY) / 2 + 0.25}
          textAnchor="start"
          className="ceiling-label"
        >
          {fmtFeet(lowHeight)}
        </text>
        <text x={xCenter} y={yCenter - 0.58} textAnchor="middle" className="ceiling-caption cathedral-caption">
          CATHEDRAL
        </text>
        <text x={xCenter} y={yCenter + 0.74} textAnchor="middle" className="ceiling-value cathedral-value">
          {fmtFeet(highHeight)}
        </text>
      </g>
    );
  }

  if (isSlopedHorizontal) {
    const arrowSize = 0.5;
    const lineStartX = inset + 0.8;
    const lineEndX = entity.width - inset;
    return (
      <g className="ceiling-overlay" pointerEvents="none">
        <line x1={lineStartX} y1={yCenter} x2={lineEndX} y2={yCenter} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.18} />
        <polygon
          points={`${lineStartX},${yCenter - arrowSize} ${lineStartX},${yCenter + arrowSize} ${inset},${yCenter}`}
          fill={LINEAR_MARKER_COLOR}
        />
        <text x={lineStartX + 0.55} y={yCenter + 0.88} textAnchor="start" className="ceiling-value cathedral-value">
          {fmtFeet(highHeight)}
        </text>
        <text x={xCenter} y={yCenter + 0.88} textAnchor="middle" className="ceiling-caption cathedral-caption">
          SLOPED
        </text>
        <text x={lineEndX - 0.05} y={yCenter + 0.88} textAnchor="end" className="ceiling-value cathedral-value">
          {fmtFeet(lowHeight)}
        </text>
      </g>
    );
  }

  const arrowSize = 0.5;
  const lineTopY = inset;
  const lineBottomY = entity.height - inset - 0.8;
  return (
    <g className="ceiling-overlay" pointerEvents="none">
      <line x1={xCenter} y1={lineBottomY} x2={xCenter} y2={lineTopY} stroke={LINEAR_MARKER_COLOR} strokeWidth={0.18} />
      <polygon points={`${xCenter - arrowSize},${lineTopY + 0.8} ${xCenter + arrowSize},${lineTopY + 0.8} ${xCenter},${lineTopY}`} fill={LINEAR_MARKER_COLOR} />
      <text
        x={xCenter - 0.62}
        y={lineTopY + 0.85}
        textAnchor="middle"
        className="ceiling-value cathedral-value"
        transform={`rotate(-90 ${xCenter - 0.62} ${lineTopY + 0.85})`}
      >
        {fmtFeet(highHeight)}
      </text>
      <text
        x={xCenter - 0.62}
        y={yCenter}
        textAnchor="middle"
        className="ceiling-caption cathedral-caption"
        transform={`rotate(-90 ${xCenter - 0.62} ${yCenter})`}
      >
        SLOPED
      </text>
      <text
        x={xCenter - 0.62}
        y={lineBottomY - 0.1}
        textAnchor="middle"
        className="ceiling-value cathedral-value"
        transform={`rotate(-90 ${xCenter - 0.62} ${lineBottomY - 0.1})`}
      >
        {fmtFeet(lowHeight)}
      </text>
    </g>
  );
}

interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RectWithId extends RectBounds {
  id: string;
}

type RectEdge = "top" | "right" | "bottom" | "left";

interface EdgeSnap {
  rectId: string;
  edge: RectEdge;
  x: number;
  y: number;
  distance: number;
}

type GuideSegment =
  | { orientation: "h"; x1: number; x2: number; y: number; side: "top" | "bottom" }
  | { orientation: "v"; x: number; y1: number; y2: number; side: "left" | "right" };

interface RectangleGuideGroup {
  guides: GuideSegment[];
}

type ResizeHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

interface ViewportSize {
  width: number;
  height: number;
}

interface RectangleModalState {
  mode: "create" | "edit";
  anchor: Point;
  entityId?: string;
  initialValues: RectangleModalInitialValues;
}

interface TextModalState {
  mode: "create" | "edit";
  anchor: Point;
  entityId?: string;
  initialValues: TextModalInitialValues;
}

interface WindowModalState {
  entityId: string;
  initialWidthFt: number;
  initialHeightFt: number;
}

interface DoorModalState {
  entityId: string;
  initialHeightFt: number;
  initialMirrored: boolean;
}

interface UtilityLabelModalState {
  entityId: string;
  initialText: string;
  initialColor: string;
}

interface LongPressState {
  timer: ReturnType<typeof setTimeout> | null;
  pointerId: number | null;
  entityId: string | null;
  startScreen: Point;
  fired: boolean;
}

const DEFAULT_RECTANGLE_MODAL_VALUES: RectangleModalInitialValues = {
  widthFt: 12,
  heightFt: 12,
  color: "WHITE",
  unconditioned: false,
  ceilingType: "standard",
  standardHeightFt: 8,
  lowHeightFt: 8,
  highHeightFt: 12,
};

const DEFAULT_TEXT_MODAL_VALUES: TextModalInitialValues = {
  text: "",
  color: "WHITE",
  size: "medium",
};

function getTextColor(color: string): string {
  switch (color.toLowerCase()) {
    case "blue":
      return "#1117ff";
    case "red":
      return "#e00000";
    case "yellow":
      return "#ffed00";
    case "white":
    default:
      return "#ffffff";
  }
}

function getTextSize(entity: MapEntity): "small" | "medium" | "large" {
  const size = String(entity.metadata.textSize ?? "medium").toLowerCase();
  if (size === "small" || size === "large") {
    return size;
  }
  return "medium";
}

function getTextScale(size: "small" | "medium" | "large"): number {
  if (size === "small") {
    return 0.82;
  }
  if (size === "large") {
    return 1.28;
  }
  return 1;
}

let textMeasureContext: CanvasRenderingContext2D | null = null;

function getTextMeasureContext(): CanvasRenderingContext2D | null {
  if (textMeasureContext) {
    return textMeasureContext;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  textMeasureContext = canvas.getContext("2d");
  return textMeasureContext;
}

function getTextBounds(label: string, size: "small" | "medium" | "large") {
  const safeLabel = (label || "TEXT").toUpperCase();
  const scale = getTextScale(size);
  const fontSize = 0.95 * scale;
  const letterSpacingPx = fontSize * 0.02;
  const measure = getTextMeasureContext();

  let textWidth = safeLabel.length * fontSize * 0.58;
  let boxLeft = 0;
  let boxRight = textWidth;
  let ascent = fontSize * 0.78;
  let descent = fontSize * 0.24;

  if (measure) {
    measure.font = `900 ${fontSize}px sans-serif`;
    const metrics = measure.measureText(safeLabel);
    textWidth = metrics.width;
    boxLeft = -(metrics.actualBoundingBoxLeft || 0);
    boxRight = metrics.actualBoundingBoxRight || textWidth;
    ascent = metrics.actualBoundingBoxAscent || ascent;
    descent = metrics.actualBoundingBoxDescent || descent;
  }

  textWidth += Math.max(0, safeLabel.length - 1) * letterSpacingPx;
  boxRight += Math.max(0, safeLabel.length - 1) * letterSpacingPx;

  const contentX = Math.min(boxLeft, 0);
  const contentY = -ascent;
  const contentWidth = Math.max(0.35, boxRight - contentX);
  const contentHeight = Math.max(0.35, ascent + descent);
  const pad = Math.max(0.04, fontSize * 0.08);

  return {
    safeLabel,
    contentX,
    contentY,
    contentWidth,
    contentHeight,
    selectionX: contentX - pad,
    selectionY: contentY - pad,
    selectionWidth: contentWidth + pad * 2,
    selectionHeight: contentHeight + pad * 2,
    fontSize,
  };
}

function PerimeterGuides({ guides }: { guides: GuideSegment[] }) {
  const hOffset = 4.5;
  const vOffset = 4.5;
  const staggerStep = 1.8;
  const minLabelSeparation = 2.4;
  const markerStrokeWidth = 0.21;
  const markerColor = LINEAR_MARKER_COLOR;

  type PositionedGuide = {
    segment: GuideSegment;
    labelX: number;
    labelY: number;
    lineAxis: number;
  };

  const positionedGuides: PositionedGuide[] = [];
  const placedAnchors: Array<{ x: number; y: number }> = [];

  const sortedGuides = [...guides].sort((a, b) => {
    const aLen = a.orientation === "h" ? a.x2 - a.x1 : a.y2 - a.y1;
    const bLen = b.orientation === "h" ? b.x2 - b.x1 : b.y2 - b.y1;
    if (aLen !== bLen) {
      return bLen - aLen;
    }
    if (a.orientation !== b.orientation) {
      return a.orientation === "h" ? -1 : 1;
    }
    return 0;
  });

  for (const segment of sortedGuides) {
    let shiftLevel = 0;
    while (shiftLevel < 7) {
      if (segment.orientation === "h") {
        const midX = (segment.x1 + segment.x2) / 2;
        const outward = segment.side === "top" ? -1 : 1;
        const lineY = segment.y + outward * (hOffset + shiftLevel * staggerStep);
        const labelY = lineY + 0.95;
        const labelX = midX;

        const conflicts = placedAnchors.some((anchor) => {
          const dx = anchor.x - labelX;
          const dy = anchor.y - labelY;
          return Math.hypot(dx, dy) < minLabelSeparation;
        });

        if (!conflicts) {
          positionedGuides.push({ segment, labelX, labelY, lineAxis: lineY });
          placedAnchors.push({ x: labelX, y: labelY });
          break;
        }
      } else {
        const midY = (segment.y1 + segment.y2) / 2;
        const outward = segment.side === "left" ? -1 : 1;
        const lineX = segment.x + outward * (vOffset + shiftLevel * staggerStep);
        const labelX = lineX + outward * 0.56;
        const labelY = midY;

        const conflicts = placedAnchors.some((anchor) => {
          const dx = anchor.x - labelX;
          const dy = anchor.y - labelY;
          return Math.hypot(dx, dy) < minLabelSeparation;
        });

        if (!conflicts) {
          positionedGuides.push({ segment, labelX, labelY, lineAxis: lineX });
          placedAnchors.push({ x: labelX, y: labelY });
          break;
        }
      }

      shiftLevel += 1;
    }
  }

  return (
    <g className="rect-guides" pointerEvents="none">
      {positionedGuides.map(({ segment, labelX, labelY, lineAxis }, index) => {
        if (segment.orientation === "h") {
          return (
            <g key={`gh-${index}-${segment.y}-${segment.x1}-${segment.x2}`}>
              <line x1={segment.x1} y1={lineAxis} x2={segment.x2} y2={lineAxis} stroke={markerColor} strokeWidth={markerStrokeWidth} />
              <text x={labelX} y={labelY} className="dim-label" textAnchor="middle" dominantBaseline="middle">
                {fmtFeet(segment.x2 - segment.x1)}
              </text>
            </g>
          );
        }

        return (
          <g key={`gv-${index}-${segment.x}-${segment.y1}-${segment.y2}`}>
            <line x1={lineAxis} y1={segment.y1} x2={lineAxis} y2={segment.y2} stroke={markerColor} strokeWidth={markerStrokeWidth} />
            <text
              x={labelX}
              y={labelY}
              className="dim-label"
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(90 ${labelX} ${labelY})`}
            >
              {fmtFeet(segment.y2 - segment.y1)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DraftRectangleGuides({ rect }: { rect: RectBounds }) {
  const x1 = rect.x;
  const y1 = rect.y;
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const hOffset = 2.8;
  const vOffset = 2.8;
  const markerStrokeWidth = 0.21;
  const markerColor = "#96677a";

  return (
    <g className="rect-guides" pointerEvents="none">
      <line x1={x1} y1={y2 + hOffset} x2={x2} y2={y2 + hOffset} stroke={markerColor} strokeWidth={markerStrokeWidth} />
      <text x={midX} y={y2 + hOffset + 0.8} className="dim-label" textAnchor="middle">
        {fmtFeet(rect.width)}
      </text>

      <line x1={x1 - vOffset} y1={y1} x2={x1 - vOffset} y2={y2} stroke={markerColor} strokeWidth={markerStrokeWidth} />
      <text
        x={x1 - vOffset - 0.56}
        y={midY}
        className="dim-label"
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(90 ${x1 - vOffset - 0.56} ${midY})`}
      >
        {fmtFeet(rect.height)}
      </text>
    </g>
  );
}

function normalizeRectToGrid(rect: RectBounds): RectBounds {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  return { x, y, width, height };
}

function mergePerimeterGuides(guides: GuideSegment[]): GuideSegment[] {
  const merged: GuideSegment[] = [];

  const horizontalBuckets = new Map<string, Array<{ start: number; end: number }>>();
  const verticalBuckets = new Map<string, Array<{ start: number; end: number }>>();

  for (const guide of guides) {
    if (guide.orientation === "h") {
      const key = `h:${guide.y}:${guide.side}`;
      const bucket = horizontalBuckets.get(key) ?? [];
      bucket.push({ start: guide.x1, end: guide.x2 });
      horizontalBuckets.set(key, bucket);
    } else {
      const key = `v:${guide.x}:${guide.side}`;
      const bucket = verticalBuckets.get(key) ?? [];
      bucket.push({ start: guide.y1, end: guide.y2 });
      verticalBuckets.set(key, bucket);
    }
  }

  for (const [key, ranges] of horizontalBuckets) {
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    let current = { ...ranges[0] };
    for (let i = 1; i < ranges.length; i += 1) {
      const next = ranges[i];
      if (next.start <= current.end) {
        current.end = Math.max(current.end, next.end);
      } else {
        const [, yRaw, sideRaw] = key.split(":");
        merged.push({
          orientation: "h",
          y: Number(yRaw),
          side: sideRaw as "top" | "bottom",
          x1: current.start,
          x2: current.end,
        });
        current = { ...next };
      }
    }

    const [, yRaw, sideRaw] = key.split(":");
    merged.push({
      orientation: "h",
      y: Number(yRaw),
      side: sideRaw as "top" | "bottom",
      x1: current.start,
      x2: current.end,
    });
  }

  for (const [key, ranges] of verticalBuckets) {
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    let current = { ...ranges[0] };
    for (let i = 1; i < ranges.length; i += 1) {
      const next = ranges[i];
      if (next.start <= current.end) {
        current.end = Math.max(current.end, next.end);
      } else {
        const [, xRaw, sideRaw] = key.split(":");
        merged.push({
          orientation: "v",
          x: Number(xRaw),
          side: sideRaw as "left" | "right",
          y1: current.start,
          y2: current.end,
        });
        current = { ...next };
      }
    }

    const [, xRaw, sideRaw] = key.split(":");
    merged.push({
      orientation: "v",
      x: Number(xRaw),
      side: sideRaw as "left" | "right",
      y1: current.start,
      y2: current.end,
    });
  }

  return merged;
}

function buildMergedPerimeterGuides(component: RectWithId[]): GuideSegment[] {
  const cellSet = new Set<string>();
  for (const rect of component) {
    const startX = Math.round(rect.x);
    const startY = Math.round(rect.y);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    for (let x = startX; x < startX + width; x += 1) {
      for (let y = startY; y < startY + height; y += 1) {
        cellSet.add(`${x},${y}`);
      }
    }
  }

  const edgeCount = new Map<string, number>();
  for (const key of cellSet) {
    const [xRaw, yRaw] = key.split(",");
    const x = Number(xRaw);
    const y = Number(yRaw);

    const edges = [
      `h:${x}:${y}`,
      `h:${x}:${y + 1}`,
      `v:${x}:${y}`,
      `v:${x + 1}:${y}`,
    ];
    for (const edgeKey of edges) {
      edgeCount.set(edgeKey, (edgeCount.get(edgeKey) ?? 0) + 1);
    }
  }

  const exteriorHorizontal = new Map<number, number[]>();
  const exteriorVertical = new Map<number, number[]>();

  for (const [edgeKey, count] of edgeCount) {
    if (count !== 1) {
      continue;
    }
    const [orientation, aRaw, bRaw] = edgeKey.split(":");
    const a = Number(aRaw);
    const b = Number(bRaw);
    if (orientation === "h") {
      const list = exteriorHorizontal.get(b) ?? [];
      list.push(a);
      exteriorHorizontal.set(b, list);
    } else {
      const list = exteriorVertical.get(a) ?? [];
      list.push(b);
      exteriorVertical.set(a, list);
    }
  }

  const guides: GuideSegment[] = [];

  for (const [y, xs] of exteriorHorizontal) {
    xs.sort((a, b) => a - b);
    let runStart = xs[0];
    let previous = xs[0];
    for (let i = 1; i < xs.length; i += 1) {
      const current = xs[i];
      if (current === previous + 1) {
        previous = current;
        continue;
      }

      const sampleX = runStart;
      const hasAbove = cellSet.has(`${sampleX},${y - 1}`);
      const hasBelow = cellSet.has(`${sampleX},${y}`);
      if (hasBelow !== hasAbove) {
        guides.push({
          orientation: "h",
          x1: runStart,
          x2: previous + 1,
          y,
          side: hasBelow ? "top" : "bottom",
        });
      }

      runStart = current;
      previous = current;
    }

    const sampleX = runStart;
    const hasAbove = cellSet.has(`${sampleX},${y - 1}`);
    const hasBelow = cellSet.has(`${sampleX},${y}`);
    if (hasBelow !== hasAbove) {
      guides.push({
        orientation: "h",
        x1: runStart,
        x2: previous + 1,
        y,
        side: hasBelow ? "top" : "bottom",
      });
    }
  }

  for (const [x, ys] of exteriorVertical) {
    ys.sort((a, b) => a - b);
    let runStart = ys[0];
    let previous = ys[0];
    for (let i = 1; i < ys.length; i += 1) {
      const current = ys[i];
      if (current === previous + 1) {
        previous = current;
        continue;
      }

      const sampleY = runStart;
      const hasLeft = cellSet.has(`${x - 1},${sampleY}`);
      const hasRight = cellSet.has(`${x},${sampleY}`);
      if (hasLeft !== hasRight) {
        guides.push({
          orientation: "v",
          x,
          y1: runStart,
          y2: previous + 1,
          side: hasRight ? "left" : "right",
        });
      }

      runStart = current;
      previous = current;
    }

    const sampleY = runStart;
    const hasLeft = cellSet.has(`${x - 1},${sampleY}`);
    const hasRight = cellSet.has(`${x},${sampleY}`);
    if (hasLeft !== hasRight) {
      guides.push({
        orientation: "v",
        x,
        y1: runStart,
        y2: previous + 1,
        side: hasRight ? "left" : "right",
      });
    }
  }

  const outwardGuides = guides.filter((guide) => {
    if (guide.orientation === "h") {
      const sampleX = (guide.x1 + guide.x2) / 2;
      const sampleY = guide.side === "top" ? guide.y - 0.25 : guide.y + 0.25;
      const cellX = Math.floor(sampleX);
      const cellY = Math.floor(sampleY);
      return !cellSet.has(`${cellX},${cellY}`);
    }

    const sampleX = guide.side === "left" ? guide.x - 0.25 : guide.x + 0.25;
    const sampleY = (guide.y1 + guide.y2) / 2;
    const cellX = Math.floor(sampleX);
    const cellY = Math.floor(sampleY);
    return !cellSet.has(`${cellX},${cellY}`);
  });

  return mergePerimeterGuides(outwardGuides);
}

function buildRectangleGuideGroups(rectangles: RectWithId[]): RectangleGuideGroup[] {
  if (rectangles.length === 0) {
    return [];
  }

  const normalized = rectangles.map((rect) => ({
    ...rect,
    ...normalizeRectToGrid(rect),
  }));

  return [{ guides: buildMergedPerimeterGuides(normalized) }];
}

function rectBoundsFromEntity(entity: MapEntity): RectBounds {
  const x1 = Math.min(entity.x, entity.x + entity.width);
  const y1 = Math.min(entity.y, entity.y + entity.height);
  return {
    x: x1,
    y: y1,
    width: Math.abs(entity.width),
    height: Math.abs(entity.height),
  };
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nearestRectangleEdge(point: Point, rectangles: MapEntity[]): EdgeSnap | null {
  let best: EdgeSnap | null = null;

  for (const rectEntity of rectangles) {
    const rect = rectBoundsFromEntity(rectEntity);
    const x1 = rect.x;
    const y1 = rect.y;
    const x2 = rect.x + rect.width;
    const y2 = rect.y + rect.height;

    const candidates: EdgeSnap[] = [
      {
        rectId: rectEntity.id,
        edge: "top",
        x: clampValue(point.x, x1, x2),
        y: y1,
        distance: Math.hypot(point.x - clampValue(point.x, x1, x2), point.y - y1),
      },
      {
        rectId: rectEntity.id,
        edge: "bottom",
        x: clampValue(point.x, x1, x2),
        y: y2,
        distance: Math.hypot(point.x - clampValue(point.x, x1, x2), point.y - y2),
      },
      {
        rectId: rectEntity.id,
        edge: "left",
        x: x1,
        y: clampValue(point.y, y1, y2),
        distance: Math.hypot(point.x - x1, point.y - clampValue(point.y, y1, y2)),
      },
      {
        rectId: rectEntity.id,
        edge: "right",
        x: x2,
        y: clampValue(point.y, y1, y2),
        distance: Math.hypot(point.x - x2, point.y - clampValue(point.y, y1, y2)),
      },
    ];

    for (const candidate of candidates) {
      if (!best || candidate.distance < best.distance) {
        best = candidate;
      }
    }
  }

  return best;
}

function edgeRotation(edge: RectEdge): number {
  if (edge === "top") {
    return 0;
  }
  if (edge === "right") {
    return 90;
  }
  if (edge === "bottom") {
    return 180;
  }
  return 270;
}

function getHostRectForEntity(entity: MapEntity, rectangles: MapEntity[]): RectBounds | null {
  const hostRectId = entity.metadata.hostRectId as string | undefined;
  if (!hostRectId) {
    return null;
  }
  const host = rectangles.find((rect) => rect.id === hostRectId);
  return host ? rectBoundsFromEntity(host) : null;
}

function snapWindowCenterAxis(axis: number, width: number): number {
  const wholeWidth = Math.max(1, Math.round(Math.abs(width)));
  if (wholeWidth % 2 === 0) {
    return Math.round(axis);
  }
  return Math.round(axis - 0.5) + 0.5;
}

function lockWindowCenterToHostEdge(world: Point, entity: MapEntity, rectangles: MapEntity[]): Point {
  const edge = (entity.metadata.edge as RectEdge | undefined) ?? "top";
  const hostRect = getHostRectForEntity(entity, rectangles);
  if (!hostRect) {
    return {
      x: snapWindowCenterAxis(world.x, entity.width),
      y: snapWindowCenterAxis(world.y, entity.width),
    };
  }

  const x1 = hostRect.x;
  const y1 = hostRect.y;
  const x2 = hostRect.x + hostRect.width;
  const y2 = hostRect.y + hostRect.height;
  const half = Math.max(0.5, Math.round(Math.abs(entity.width)) / 2);

  if (edge === "top") {
    const axis = clampValue(snapWindowCenterAxis(world.x, entity.width), x1 + half, x2 - half);
    return { x: axis, y: Math.round(y1) };
  }
  if (edge === "bottom") {
    const axis = clampValue(snapWindowCenterAxis(world.x, entity.width), x1 + half, x2 - half);
    return { x: axis, y: Math.round(y2) };
  }
  if (edge === "left") {
    const axis = clampValue(snapWindowCenterAxis(world.y, entity.width), y1 + half, y2 - half);
    return { x: Math.round(x1), y: axis };
  }
  const axis = clampValue(snapWindowCenterAxis(world.y, entity.width), y1 + half, y2 - half);
  return { x: Math.round(x2), y: axis };
}

function lockWindowPointToHostEdge(world: Point, entity: MapEntity, rectangles: MapEntity[]): Point {
  const edge = (entity.metadata.edge as RectEdge | undefined) ?? "top";
  const hostRect = getHostRectForEntity(entity, rectangles);
  if (!hostRect) {
    return { x: Math.round(world.x), y: Math.round(world.y) };
  }

  const x1 = hostRect.x;
  const y1 = hostRect.y;
  const x2 = hostRect.x + hostRect.width;
  const y2 = hostRect.y + hostRect.height;

  if (edge === "top") {
    return { x: Math.round(clampValue(world.x, x1, x2)), y: Math.round(y1) };
  }
  if (edge === "bottom") {
    return { x: Math.round(clampValue(world.x, x1, x2)), y: Math.round(y2) };
  }
  if (edge === "left") {
    return { x: Math.round(x1), y: Math.round(clampValue(world.y, y1, y2)) };
  }
  return { x: Math.round(x2), y: Math.round(clampValue(world.y, y1, y2)) };
}

function applyRectResize(rect: RectBounds, world: Point, handle: ResizeHandle): RectBounds {
  let x1 = rect.x;
  let y1 = rect.y;
  let x2 = rect.x + rect.width;
  let y2 = rect.y + rect.height;

  if (handle === "nw" || handle === "w" || handle === "sw") {
    x1 = Math.min(Math.round(world.x), x2 - 1);
  }
  if (handle === "ne" || handle === "e" || handle === "se") {
    x2 = Math.max(Math.round(world.x), x1 + 1);
  }
  if (handle === "nw" || handle === "n" || handle === "ne") {
    y1 = Math.min(Math.round(world.y), y2 - 1);
  }
  if (handle === "sw" || handle === "s" || handle === "se") {
    y2 = Math.max(Math.round(world.y), y1 + 1);
  }

  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

export function Workspace() {
  const { state, dispatch } = useEditor();
  const floor = getFloor(state);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const initializedViewRef = useRef(false);
  const [hoverWorld, setHoverWorld] = useState<Point | null>(null);
  const [draftEntity, setDraftEntity] = useState<MapEntity | null>(null);
  const [rectangleModalState, setRectangleModalState] = useState<RectangleModalState | null>(null);
  const [textModalState, setTextModalState] = useState<TextModalState | null>(null);
  const [doorModalState, setDoorModalState] = useState<DoorModalState | null>(null);
  const [windowModalState, setWindowModalState] = useState<WindowModalState | null>(null);
  const [utilityLabelModalState, setUtilityLabelModalState] = useState<UtilityLabelModalState | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const touchPointsRef = useRef<Map<number, Point>>(new Map());
  const longPressRef = useRef<LongPressState>({
    timer: null,
    pointerId: null,
    entityId: null,
    startScreen: { x: 0, y: 0 },
    fired: false,
  });
  const pinchGestureRef = useRef<PinchGestureState>({
    active: false,
    startDistance: 0,
    startZoom: 0,
    anchorWorld: { x: 0, y: 0 },
  });
  const interactionRef = useRef<InteractionState>({
    type: "none",
    pointerId: null,
    startScreen: { x: 0, y: 0 },
    startWorld: { x: 0, y: 0 },
  });

  const pointById = useMemo(() => new Map(floor.wallPoints.map((point) => [point.id, point])), [floor.wallPoints]);
  const rectangleEntities = useMemo(
    () => floor.entities.filter((entity) => entity.type === "rectangle"),
    [floor.entities],
  );
  const selectedRectangleEntity = useMemo(() => {
    const selection = state.selection;
    if (selection.kind !== "entity") {
      return null;
    }
    const candidate = floor.entities.find((entity) => entity.id === selection.id);
    if (!candidate || candidate.type !== "rectangle") {
      return null;
    }
    return candidate;
  }, [floor.entities, state.selection]);

  const selectedWindowEdge = useMemo(() => {
    const selection = state.selection;
    if (selection.kind !== "entity") {
      return null;
    }
    const candidate = floor.entities.find((entity) => entity.id === selection.id);
    if (!candidate || candidate.type !== "window") {
      return null;
    }
    return (candidate.metadata.edge as RectEdge | undefined) ?? "top";
  }, [floor.entities, state.selection]);

  const selectedSkylightEntity = useMemo(() => {
    const selection = state.selection;
    if (selection.kind !== "entity") {
      return null;
    }
    const candidate = floor.entities.find((entity) => entity.id === selection.id);
    if (!candidate || candidate.type !== "skylight") {
      return null;
    }
    return candidate;
  }, [floor.entities, state.selection]);

  const rectangleGuideGroups = useMemo(() => {
    const rectangles: RectWithId[] = floor.entities
      .filter((entity) => entity.type === "rectangle")
      .map((entity) => {
        const rect = rectBoundsFromEntity(entity);
        return {
          id: entity.id,
          ...rect,
        };
      });

    return buildRectangleGuideGroups(rectangles);
  }, [floor.entities]);

  const worldViewport = useMemo(() => {
    const width = viewportSize.width || svgRef.current?.clientWidth || 1200;
    const height = viewportSize.height || svgRef.current?.clientHeight || 800;
    const topLeft = screenToWorld({ x: 0, y: 0 }, state.camera);
    const bottomRight = screenToWorld({ x: width, y: height }, state.camera);
    return {
      minX: Math.floor(topLeft.x) - 2,
      maxX: Math.ceil(bottomRight.x) + 2,
      minY: Math.floor(topLeft.y) - 2,
      maxY: Math.ceil(bottomRight.y) + 2,
    };
  }, [state.camera, viewportSize.height, viewportSize.width]);

  const verticalGridLines = useMemo(() => {
    const lines: number[] = [];
    for (let x = worldViewport.minX; x <= worldViewport.maxX; x += 1) {
      lines.push(x);
    }
    return lines;
  }, [worldViewport.maxX, worldViewport.minX]);

  const horizontalGridLines = useMemo(() => {
    const lines: number[] = [];
    for (let y = worldViewport.minY; y <= worldViewport.maxY; y += 1) {
      lines.push(y);
    }
    return lines;
  }, [worldViewport.maxY, worldViewport.minY]);

  useEffect(() => {
    if (initializedViewRef.current) {
      return;
    }
    const workspace = svgRef.current;
    if (!workspace) {
      return;
    }

    const targetCellsWide = 75;
    const nextZoom = clamp(workspace.clientWidth / targetCellsWide, MIN_ZOOM, MAX_ZOOM);
    dispatch({ type: "SET_CAMERA", camera: { zoom: nextZoom } });
    initializedViewRef.current = true;
  }, [dispatch]);

  useEffect(() => {
    const workspace = svgRef.current;
    if (!workspace) {
      return;
    }

    const updateSize = () => {
      setViewportSize({ width: workspace.clientWidth, height: workspace.clientHeight });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        Boolean(target?.isContentEditable) ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select";

      if (isEditable) {
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        dispatch({ type: "DELETE_SELECTION" });
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          dispatch({ type: "REDO" });
        } else {
          dispatch({ type: "UNDO" });
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "REDO" });
      }
      if (event.key === "Escape") {
        dispatch({ type: "CLEAR_WALL_DRAFT" });
        dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
        setDraftEntity(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  const getEventWorld = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    const screen = {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
    return snapPointToGrid(screenToWorld(screen, state.camera));
  };

  const getTouchScreenPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  const clearLongPress = () => {
    if (longPressRef.current.timer) {
      clearTimeout(longPressRef.current.timer);
    }
    longPressRef.current = {
      timer: null,
      pointerId: null,
      entityId: null,
      startScreen: { x: 0, y: 0 },
      fired: false,
    };
  };

  const getRectangleModalInitialValues = (entity: MapEntity): RectangleModalInitialValues => ({
    widthFt: Math.max(1, Math.round(Math.abs(entity.width))),
    heightFt: Math.max(1, Math.round(Math.abs(entity.height))),
    color: String(entity.metadata.color ?? "WHITE").toUpperCase(),
    unconditioned: Boolean(entity.metadata.unconditioned),
    ceilingType: (entity.metadata.ceilingType ?? "standard") as
      | "standard"
      | "cathedral"
      | "cathedral-horizontal"
      | "sloped"
      | "sloped-horizontal"
      | "none",
    standardHeightFt: Number(entity.metadata.standardHeightFt ?? 8),
    lowHeightFt: Number(entity.metadata.lowHeightFt ?? 8),
    highHeightFt: Number(entity.metadata.highHeightFt ?? 12),
  });

  const getDefaultWindowSize = () => {
    const widthFt = Math.max(1, Math.round(Number(state.project.metadata.windowDefaultWidthFt ?? 3)));
    const heightFt = Math.max(1, Math.round(Number(state.project.metadata.windowDefaultHeightFt ?? 4)));
    return { widthFt, heightFt };
  };

  const openCreateRectangleModal = (anchor: Point) => {
    setRectangleModalState({
      mode: "create",
      anchor: { x: Math.round(anchor.x), y: Math.round(anchor.y) },
      initialValues: DEFAULT_RECTANGLE_MODAL_VALUES,
    });
  };

  const openCreateTextModal = (anchor: Point) => {
    setTextModalState({
      mode: "create",
      anchor: { x: Math.round(anchor.x), y: Math.round(anchor.y) },
      initialValues: DEFAULT_TEXT_MODAL_VALUES,
    });
  };

  const openEditTextModal = (entity: MapEntity) => {
    if (entity.type !== "text") {
      return;
    }

    setTextModalState({
      mode: "edit",
      anchor: { x: Math.round(entity.x), y: Math.round(entity.y) },
      entityId: entity.id,
      initialValues: {
        text: (entity.label || "").toUpperCase(),
        color: String(entity.metadata.color ?? "WHITE").toUpperCase(),
        size: getTextSize(entity),
      },
    });
  };

  const openWindowSizeModal = (entity: MapEntity) => {
    if (entity.type !== "window") {
      return;
    }
    setWindowModalState({
      entityId: entity.id,
      initialWidthFt: Math.max(1, Math.round(Math.abs(entity.width))),
      initialHeightFt: Math.max(1, Math.round(Math.abs(entity.height))),
    });
  };

  const openDoorModal = (entity: MapEntity) => {
    if (entity.type !== "door") {
      return;
    }
    setDoorModalState({
      entityId: entity.id,
      initialHeightFt: Math.max(1, Math.round(Math.abs(entity.height))),
      initialMirrored: Boolean(entity.metadata.mirrored),
    });
  };

  const openUtilityLabelModal = (entity: MapEntity) => {
    if (!isUtilityEntityType(entity.type)) {
      return;
    }
    setUtilityLabelModalState({
      entityId: entity.id,
      initialText: entity.label ?? "",
      initialColor: String(entity.metadata.color ?? "WHITE").toUpperCase(),
    });
  };

  const tryPlaceDoorOrWindow = (type: "door" | "window", world: Point): MapEntity | null => {
    const snap = nearestRectangleEdge(world, rectangleEntities);
    if (!snap || snap.distance > 0.9) {
      return null;
    }

    const entity = createEntityFromTool(type, Math.round(snap.x), Math.round(snap.y));
    if (type === "door") {
      entity.width = 3;
      entity.height = 7;
      entity.label = "";
    } else {
      const defaults = getDefaultWindowSize();
      entity.width = defaults.widthFt;
      entity.height = defaults.heightFt;
      entity.label = "";
    }

    entity.rotation = edgeRotation(snap.edge);
    entity.metadata.hostRectId = snap.rectId;
    entity.metadata.edge = snap.edge;
    entity.metadata.flipped = false;
    entity.metadata.mirrored = false;

    if (type === "window") {
      const lockedCenter = lockWindowCenterToHostEdge({ x: snap.x, y: snap.y }, entity, rectangleEntities);
      entity.x = lockedCenter.x;
      entity.y = lockedCenter.y;
    }

    return entity;
  };

  const openEditRectangleModal = (entity: MapEntity) => {
    setRectangleModalState({
      mode: "edit",
      anchor: { x: entity.x, y: entity.y },
      entityId: entity.id,
      initialValues: getRectangleModalInitialValues(entity),
    });
  };

  const startPinchGestureIfReady = () => {
    if (touchPointsRef.current.size !== 2) {
      return;
    }
    const points = [...touchPointsRef.current.values()];
    const a = points[0];
    const b = points[1];
    const startDistance = Math.hypot(b.x - a.x, b.y - a.y);
    if (startDistance <= 0) {
      return;
    }
    const midpointScreen = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinchGestureRef.current = {
      active: true,
      startDistance,
      startZoom: state.camera.zoom,
      anchorWorld: screenToWorld(midpointScreen, state.camera),
    };
  };

  const maybeApplyPinchGesture = (): boolean => {
    if (touchPointsRef.current.size !== 2 || !pinchGestureRef.current.active) {
      return false;
    }

    const points = [...touchPointsRef.current.values()];
    const a = points[0];
    const b = points[1];
    const currentDistance = Math.hypot(b.x - a.x, b.y - a.y);
    if (currentDistance <= 0) {
      return true;
    }

    const midpointScreen = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const scale = currentDistance / pinchGestureRef.current.startDistance;
    const nextZoom = clamp(pinchGestureRef.current.startZoom * scale, MIN_ZOOM, MAX_ZOOM);
    const nextCameraX = midpointScreen.x - pinchGestureRef.current.anchorWorld.x * nextZoom;
    const nextCameraY = midpointScreen.y - pinchGestureRef.current.anchorWorld.y * nextZoom;

    dispatch({
      type: "SET_CAMERA",
      camera: {
        x: nextCameraX,
        y: nextCameraY,
        zoom: nextZoom,
      },
    });
    return true;
  };

  const beginPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    interactionRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startWorld: getEventWorld(event),
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleBackgroundDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (event.pointerType === "touch") {
      const point = getTouchScreenPoint(event);
      touchPointsRef.current.set(event.pointerId, point);
      svgRef.current?.setPointerCapture(event.pointerId);
      startPinchGestureIfReady();
      if (touchPointsRef.current.size >= 2) {
        return;
      }
    }

    if (event.button === 1 || event.button === 2 || event.altKey) {
      event.preventDefault();
      beginPan(event);
      return;
    }

    const world = getEventWorld(event);
    setHoverWorld(world);

    if (state.activeTool === "rectangle") {
      const nextEntity = createEntityFromTool("rectangle", Math.round(world.x), Math.round(world.y));
      nextEntity.width = 1;
      nextEntity.height = 1;
      interactionRef.current = {
        type: "draw-rect",
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: { x: Math.round(world.x), y: Math.round(world.y) },
        entitySnapshot: nextEntity,
        sourceRectangleId: undefined,
        dragStarted: false,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (state.activeTool === "text") {
      openCreateTextModal(world);
      return;
    }

    if (state.activeTool === "select") {
      dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
      beginPan(event);
      return;
    }

    if (state.activeTool === "wall") {
      const draftId = state.wallDraftPointId;
      const draftPoint = draftId ? pointById.get(draftId) : undefined;

      const nearExisting = floor.wallPoints.find((point) => distance(point, world) <= 0.75);
      const targetPoint = nearExisting ?? createWallPoint(world.x, world.y);

      if (!nearExisting) {
        dispatch({ type: "ADD_WALL_POINT", point: targetPoint });
      }

      if (!draftPoint) {
        dispatch({ type: "START_WALL_DRAFT", pointId: targetPoint.id });
        dispatch({ type: "SET_SELECTION", selection: { kind: "wallPoint", id: targetPoint.id } });
        return;
      }

      const constrained = constrainOrthogonal(draftPoint, targetPoint);
      let nextPoint = targetPoint;
      if (targetPoint.id !== draftPoint.id) {
        if (!nearExisting) {
          nextPoint = { ...targetPoint, ...snapPointToGrid(constrained) };
          dispatch({ type: "MOVE_WALL_POINT", pointId: targetPoint.id, x: nextPoint.x, y: nextPoint.y });
        }

        if (nearExisting) {
          dispatch({ type: "MOVE_WALL_POINT", pointId: nearExisting.id, x: constrained.x, y: constrained.y });
        }

        const segment = createWallSegment(draftPoint.id, nextPoint.id);
        dispatch({ type: "ADD_WALL_SEGMENT", segment });
        dispatch({ type: "SET_SELECTION", selection: { kind: "wallSegment", id: segment.id } });
        dispatch({ type: "START_WALL_DRAFT", pointId: nextPoint.id });
      }
      return;
    }

    const tool = getToolDefinition(state.activeTool);
    if (!tool?.entityType) {
      return;
    }

    if (tool.entityType === "door" || tool.entityType === "window") {
      const placed = tryPlaceDoorOrWindow(tool.entityType, world);
      if (!placed) {
        return;
      }
      dispatch({ type: "UPSERT_ENTITY", entity: placed });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: placed.id } });
      return;
    }

    if (tool.entityType === "skylight") {
      const nextEntity = createEntityFromTool("skylight", Math.round(world.x), Math.round(world.y));
      interactionRef.current = {
        type: "draw-rect",
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: { x: Math.round(world.x), y: Math.round(world.y) },
        entitySnapshot: nextEntity,
        sourceRectangleId: undefined,
        dragStarted: false,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (tool.entityType === "line") {
      const nextEntity = createEntityFromTool(tool.entityType, world.x, world.y);
      setDraftEntity(nextEntity);
      interactionRef.current = {
        type: "draw-line",
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: world,
        entitySnapshot: nextEntity,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (isUtilityEntityType(tool.entityType)) {
      return;
    }

    const entity = createEntityFromTool(tool.entityType, world.x, world.y);

    dispatch({ type: "UPSERT_ENTITY", entity });
    dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (longPressRef.current.pointerId === event.pointerId) {
      const dx = event.clientX - longPressRef.current.startScreen.x;
      const dy = event.clientY - longPressRef.current.startScreen.y;
      if (Math.hypot(dx, dy) > 14) {
        clearLongPress();
      }
    }

    if (event.pointerType === "touch" && touchPointsRef.current.has(event.pointerId)) {
      touchPointsRef.current.set(event.pointerId, getTouchScreenPoint(event));
      if (maybeApplyPinchGesture()) {
        return;
      }
    }

    const world = getEventWorld(event);
    setHoverWorld(world);
    const interaction = interactionRef.current;

    if (interaction.type === "none") {
      return;
    }

    if (interaction.type === "pan") {
      dispatch({ type: "PAN_CAMERA", dx: event.movementX, dy: event.movementY });
      return;
    }

    if (interaction.type === "drag-entity" && interaction.targetId && interaction.entitySnapshot) {
      interaction.latestWorld = world;

      if (interaction.tapAction === "flip-door" && interaction.entitySnapshot.type === "door") {
        const movedX = event.clientX - interaction.startScreen.x;
        const movedY = event.clientY - interaction.startScreen.y;
        if (!interaction.dragStarted) {
          if (Math.hypot(movedX, movedY) <= 8) {
            return;
          }
          interaction.dragStarted = true;
        }
      }

      const dx = world.x - interaction.startWorld.x;
      const dy = world.y - interaction.startWorld.y;

      if (interaction.entitySnapshot.type === "door") {
        const next = lockWindowPointToHostEdge(
          {
            x: interaction.entitySnapshot.x + dx,
            y: interaction.entitySnapshot.y + dy,
          },
          interaction.entitySnapshot,
          rectangleEntities,
        );
        dispatch({
          type: "SET_PREVIEW_ENTITY",
          entity: {
            ...interaction.entitySnapshot,
            x: next.x,
            y: next.y,
          },
        });
        return;
      }

      if (interaction.entitySnapshot.type === "window") {
        const next = lockWindowCenterToHostEdge(
          {
            x: interaction.entitySnapshot.x + dx,
            y: interaction.entitySnapshot.y + dy,
          },
          interaction.entitySnapshot,
          rectangleEntities,
        );
        dispatch({
          type: "SET_PREVIEW_ENTITY",
          entity: {
            ...interaction.entitySnapshot,
            x: next.x,
            y: next.y,
          },
        });
        return;
      }

      const snapped = snapPointToGrid({
        x: interaction.entitySnapshot.x + dx,
        y: interaction.entitySnapshot.y + dy,
      });
      dispatch({
        type: "SET_PREVIEW_ENTITY",
        entity: {
          ...interaction.entitySnapshot,
          x: snapped.x,
          y: snapped.y,
        },
      });
      return;
    }

    if (interaction.type === "drag-wall-point" && interaction.targetId && interaction.pointSnapshot) {
      const next = snapPointToGrid(world);
      dispatch({ type: "MOVE_WALL_POINT", pointId: interaction.targetId, x: next.x, y: next.y });
      return;
    }

    if (interaction.type === "resize-rect" && interaction.targetId && interaction.entitySnapshot && interaction.resizeHandle) {
      const sourceRect =
        interaction.entitySnapshot.type === "skylight"
          ? {
              x: interaction.entitySnapshot.x - interaction.entitySnapshot.width / 2,
              y: interaction.entitySnapshot.y - interaction.entitySnapshot.height / 2,
              width: interaction.entitySnapshot.width,
              height: interaction.entitySnapshot.height,
            }
          : rectBoundsFromEntity(interaction.entitySnapshot);
      const nextRect = applyRectResize(sourceRect, world, interaction.resizeHandle);
      const updated: MapEntity =
        interaction.entitySnapshot.type === "skylight"
          ? {
              ...interaction.entitySnapshot,
              x: nextRect.x + nextRect.width / 2,
              y: nextRect.y + nextRect.height / 2,
              width: nextRect.width,
              height: nextRect.height,
            }
          : {
              ...interaction.entitySnapshot,
              x: nextRect.x,
              y: nextRect.y,
              width: nextRect.width,
              height: nextRect.height,
            };
      dispatch({ type: "UPSERT_ENTITY", entity: updated });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
      dispatch({ type: "SET_PREVIEW_ENTITY", entity: updated });
      return;
    }

    if (interaction.type === "resize-window" && interaction.targetId && interaction.entitySnapshot) {
      const snapshot = interaction.entitySnapshot;
      if (snapshot.type !== "window") {
        return;
      }

      const edge = (snapshot.metadata.edge as RectEdge | undefined) ?? "top";
      const hostRect = getHostRectForEntity(snapshot, rectangleEntities);
      if (!hostRect) {
        return;
      }
      const locked = lockWindowPointToHostEdge(world, snapshot, rectangleEntities);
      const horizontalEdge = edge === "top" || edge === "bottom";

      const currentStart = horizontalEdge ? snapshot.x - snapshot.width / 2 : snapshot.y - snapshot.width / 2;
      const currentEnd = horizontalEdge ? snapshot.x + snapshot.width / 2 : snapshot.y + snapshot.width / 2;
      const handle = interaction.windowHandle ?? "end";
      const fixedAxis = handle === "start" ? currentEnd : currentStart;
      const axisMin = horizontalEdge ? hostRect.x : hostRect.y;
      const axisMax = horizontalEdge ? hostRect.x + hostRect.width : hostRect.y + hostRect.height;
      const rawDragged = horizontalEdge ? locked.x : locked.y;
      const minDragged = handle === "start" ? axisMin : fixedAxis + 1;
      const maxDragged = handle === "start" ? fixedAxis - 1 : axisMax;
      const draggedAxis =
        minDragged <= maxDragged ? clampValue(rawDragged, minDragged, maxDragged) : rawDragged;
      const nextLength = Math.max(1, Math.round(Math.abs(draggedAxis - fixedAxis)));
      const centerAxis = (draggedAxis + fixedAxis) / 2;
      const nextX = horizontalEdge ? centerAxis : snapshot.x;
      const nextY = horizontalEdge ? snapshot.y : centerAxis;

      const updated: MapEntity = {
        ...snapshot,
        x: nextX,
        y: nextY,
        width: nextLength,
      };
      dispatch({ type: "UPSERT_ENTITY", entity: updated });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
      dispatch({ type: "SET_PREVIEW_ENTITY", entity: updated });
      return;
    }

    if (interaction.type === "resize-skylight" && interaction.targetId && interaction.entitySnapshot) {
      const snapshot = interaction.entitySnapshot;
      if (snapshot.type !== "skylight") {
        return;
      }

      const dx = world.x - interaction.startWorld.x;
      const dy = world.y - interaction.startWorld.y;
      const updated: MapEntity = {
        ...snapshot,
        width: Math.max(1, Math.round(Math.abs(snapshot.width + dx))),
        height: Math.max(1, Math.round(Math.abs(snapshot.height + dy))),
      };
      dispatch({ type: "UPSERT_ENTITY", entity: updated });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
      dispatch({ type: "SET_PREVIEW_ENTITY", entity: updated });
      return;
    }

    if (interaction.type === "draw-rect" && interaction.entitySnapshot) {
      const dx = event.clientX - interaction.startScreen.x;
      const dy = event.clientY - interaction.startScreen.y;
      const hasMoved = interaction.dragStarted || Math.hypot(dx, dy) > 8;

      if (!hasMoved) {
        return;
      }

      if (!interaction.dragStarted) {
        interactionRef.current = { ...interaction, dragStarted: true };
      }

      const start = interaction.startWorld;
      const end = snapPointToGrid(world);
      const minX = Math.round(Math.min(start.x, end.x));
      const minY = Math.round(Math.min(start.y, end.y));
      const maxX = Math.round(Math.max(start.x, end.x));
      const maxY = Math.round(Math.max(start.y, end.y));
      const nextDraft = {
        ...interaction.entitySnapshot,
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      };
      setDraftEntity(nextDraft);
      dispatch({ type: "SET_PREVIEW_ENTITY", entity: nextDraft });
      return;
    }

    if (interaction.type === "draw-line" && draftEntity) {
      const start = interaction.startWorld;
      const end = snapPointToGrid(world);

      const constrained = constrainOrthogonal(start, end);
      const nextDraft = { ...draftEntity, width: constrained.x - start.x, height: constrained.y - start.y };
      setDraftEntity(nextDraft);
    }
  };

  const finishInteraction = () => {
    interactionRef.current = {
      type: "none",
      pointerId: null,
      startScreen: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
    };
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (longPressRef.current.pointerId === event.pointerId) {
      clearLongPress();
    }

    if (event.pointerType === "touch") {
      touchPointsRef.current.delete(event.pointerId);
      if (touchPointsRef.current.size < 2) {
        pinchGestureRef.current.active = false;
      }
    }

    const interaction = interactionRef.current;

    if (
      interaction.type === "drag-entity" &&
      interaction.tapAction === "flip-door" &&
      interaction.targetId &&
      interaction.entitySnapshot?.type === "door" &&
      !interaction.dragStarted
    ) {
      const entity = interaction.entitySnapshot;
      const flipped = Boolean(entity.metadata.flipped);
      const updated: MapEntity = {
        ...entity,
        rotation: edgeRotation((entity.metadata.edge as RectEdge | undefined) ?? "top"),
        metadata: {
          ...entity.metadata,
          flipped: !flipped,
        },
      };
      dispatch({ type: "UPSERT_ENTITY", entity: updated });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
      dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
    } else if (interaction.type === "drag-entity" && interaction.targetId && interaction.entitySnapshot) {
      const snapshot = interaction.entitySnapshot;
      const referenceWorld = interaction.latestWorld ?? getEventWorld(event);
      const dx = referenceWorld.x - interaction.startWorld.x;
      const dy = referenceWorld.y - interaction.startWorld.y;

      if (snapshot.type === "door") {
        const next = lockWindowPointToHostEdge(
          {
            x: snapshot.x + dx,
            y: snapshot.y + dy,
          },
          snapshot,
          rectangleEntities,
        );
        dispatch({ type: "MOVE_ENTITY", entityId: interaction.targetId, x: next.x, y: next.y });
      } else if (snapshot.type === "window") {
        const next = lockWindowCenterToHostEdge(
          {
            x: snapshot.x + dx,
            y: snapshot.y + dy,
          },
          snapshot,
          rectangleEntities,
        );
        dispatch({ type: "MOVE_ENTITY", entityId: interaction.targetId, x: next.x, y: next.y });
      } else {
        const snapped = snapPointToGrid({
          x: snapshot.x + dx,
          y: snapshot.y + dy,
        });
        dispatch({
          type: "MOVE_ENTITY",
          entityId: interaction.targetId,
          x: snapped.x,
          y: snapped.y,
        });
      }

      dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
    }

    if (interaction.type === "draw-rect" && interaction.entitySnapshot) {
      if (interaction.dragStarted && draftEntity) {
        const snapped = {
          ...draftEntity,
          x: Math.round(draftEntity.x),
          y: Math.round(draftEntity.y),
          width: Math.max(1, Math.round(Math.abs(draftEntity.width))),
          height: Math.max(1, Math.round(Math.abs(draftEntity.height))),
        };
        dispatch({ type: "UPSERT_ENTITY", entity: snapped });
        dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
        dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
        setDraftEntity(null);
      } else {
        dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
        setDraftEntity(null);
        if (interaction.entitySnapshot.type === "skylight") {
          dispatch({ type: "UPSERT_ENTITY", entity: interaction.entitySnapshot });
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: interaction.entitySnapshot.id } });
        } else if (interaction.sourceRectangleId) {
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: interaction.sourceRectangleId } });
        } else {
          openCreateRectangleModal(interaction.startWorld);
        }
      }
    }

    if (interaction.type === "draw-line" && draftEntity) {
      const normalized = {
        ...draftEntity,
        x: Math.round(draftEntity.x),
        y: Math.round(draftEntity.y),
        width: Math.max(1, Math.round(Math.abs(draftEntity.width))),
        height: Math.max(1, Math.round(Math.abs(draftEntity.height))),
      };
      const snapped = {
        ...normalized,
      };
      dispatch({ type: "UPSERT_ENTITY", entity: snapped });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: snapped.id } });
      setDraftEntity(null);
    }

    if (
      interaction.type === "resize-rect" ||
      interaction.type === "resize-window" ||
      interaction.type === "resize-skylight"
    ) {
      dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
    }

    if (interaction.pointerId !== null) {
      svgRef.current?.releasePointerCapture(interaction.pointerId);
    }
    finishInteraction();

    if (event.button === 2) {
      dispatch({ type: "CLEAR_WALL_DRAFT" });
    }
  };

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    const pivot = {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    dispatch({ type: "ZOOM_CAMERA", nextZoom: state.camera.zoom * factor, pivot });
  };

  const handleEntityDown = (event: ReactPointerEvent<SVGGElement>, entity: MapEntity) => {
    event.stopPropagation();
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (isUtilityEntityType(entity.type) && event.button === 2) {
      event.preventDefault();
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
      openUtilityLabelModal(entity);
      return;
    }

    if (
      entity.type === "text" &&
      event.button === 2 &&
      state.selection.kind === "entity" &&
      state.selection.id === entity.id
    ) {
      event.preventDefault();
      openEditTextModal(entity);
      return;
    }

    if (state.activeTool === "text") {
      const world = getEventWorld(event);
      if (entity.type === "text") {
        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });

        if (event.pointerType === "touch") {
          clearLongPress();
          longPressRef.current.pointerId = event.pointerId;
          longPressRef.current.entityId = entity.id;
          longPressRef.current.startScreen = { x: event.clientX, y: event.clientY };
          longPressRef.current.fired = false;
          longPressRef.current.timer = setTimeout(() => {
            longPressRef.current.fired = true;
            finishInteraction();
            openEditTextModal(entity);
          }, 520);
        }

        interactionRef.current = {
          type: "drag-entity",
          pointerId: event.pointerId,
          startScreen: { x: event.clientX, y: event.clientY },
          startWorld: world,
          targetId: entity.id,
          entitySnapshot: entity,
        };
        svgRef.current?.setPointerCapture(event.pointerId);
        return;
      }

      openCreateTextModal(world);
      return;
    }

    if (entity.type === "door" && event.button === 2) {
      event.preventDefault();
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
      openDoorModal(entity);
      return;
    }

    if (entity.type === "window" && event.button === 2) {
      event.preventDefault();
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
      openWindowSizeModal(entity);
      return;
    }

    if (state.activeTool === "rectangle") {
      const isSelectedRectangle =
        entity.type === "rectangle" &&
        state.selection.kind === "entity" &&
        state.selection.id === entity.id;

      if (isSelectedRectangle) {
        const world = getEventWorld(event);
        interactionRef.current = {
          type: "drag-entity",
          pointerId: event.pointerId,
          startScreen: { x: event.clientX, y: event.clientY },
          startWorld: world,
          targetId: entity.id,
          entitySnapshot: entity,
        };
        svgRef.current?.setPointerCapture(event.pointerId);
        return;
      }

      if (entity.type === "rectangle" && event.button === 2) {
        event.preventDefault();
        openEditRectangleModal(entity);
        return;
      }

      const world = getEventWorld(event);
      const nextEntity = createEntityFromTool("rectangle", Math.round(world.x), Math.round(world.y));
      nextEntity.width = 1;
      nextEntity.height = 1;

      if (entity.type === "rectangle" && event.pointerType === "touch") {
        clearLongPress();
        longPressRef.current.pointerId = event.pointerId;
        longPressRef.current.entityId = entity.id;
        longPressRef.current.startScreen = { x: event.clientX, y: event.clientY };
        longPressRef.current.fired = false;
        longPressRef.current.timer = setTimeout(() => {
          longPressRef.current.fired = true;
          setDraftEntity(null);
          dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
          finishInteraction();
          openEditRectangleModal(entity);
        }, 520);
      }

      interactionRef.current = {
        type: "draw-rect",
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: { x: Math.round(world.x), y: Math.round(world.y) },
        entitySnapshot: nextEntity,
        sourceRectangleId: entity.type === "rectangle" ? entity.id : undefined,
        dragStarted: false,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (state.activeTool === "door") {
      const world = getEventWorld(event);
      if (entity.type === "door") {
        const isSelected = state.selection.kind === "entity" && state.selection.id === entity.id;
        if (isSelected) {
          interactionRef.current = {
            type: "drag-entity",
            pointerId: event.pointerId,
            startScreen: { x: event.clientX, y: event.clientY },
            startWorld: world,
            targetId: entity.id,
            entitySnapshot: entity,
            tapAction: "flip-door",
            dragStarted: false,
          };
          svgRef.current?.setPointerCapture(event.pointerId);
          return;
        }

        const flipped = Boolean(entity.metadata.flipped);
        const updated: MapEntity = {
          ...entity,
          rotation: edgeRotation((entity.metadata.edge as RectEdge | undefined) ?? "top"),
          metadata: {
            ...entity.metadata,
            flipped: !flipped,
          },
        };
        dispatch({ type: "UPSERT_ENTITY", entity: updated });
        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
        return;
      }

      const placed = tryPlaceDoorOrWindow("door", world);
      if (!placed) {
        return;
      }
      dispatch({ type: "UPSERT_ENTITY", entity: placed });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: placed.id } });
      return;
    }

    if (state.activeTool === "window") {
      const world = getEventWorld(event);
      if (entity.type === "window") {
        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
        if (event.pointerType === "touch") {
          clearLongPress();
          longPressRef.current.pointerId = event.pointerId;
          longPressRef.current.entityId = entity.id;
          longPressRef.current.startScreen = { x: event.clientX, y: event.clientY };
          longPressRef.current.fired = false;
          longPressRef.current.timer = setTimeout(() => {
            longPressRef.current.fired = true;
            finishInteraction();
            openWindowSizeModal(entity);
          }, 520);
        }

        interactionRef.current = {
          type: "drag-entity",
          pointerId: event.pointerId,
          startScreen: { x: event.clientX, y: event.clientY },
          startWorld: world,
          targetId: entity.id,
          entitySnapshot: entity,
        };
        svgRef.current?.setPointerCapture(event.pointerId);
        return;
      }

      const placed = tryPlaceDoorOrWindow("window", world);
      if (!placed) {
        return;
      }
      dispatch({ type: "UPSERT_ENTITY", entity: placed });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: placed.id } });
      return;
    }

    if (state.activeTool === "skylight") {
      const world = getEventWorld(event);
      if (entity.type === "skylight") {
        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
        interactionRef.current = {
          type: "drag-entity",
          pointerId: event.pointerId,
          startScreen: { x: event.clientX, y: event.clientY },
          startWorld: world,
          targetId: entity.id,
          entitySnapshot: entity,
        };
        svgRef.current?.setPointerCapture(event.pointerId);
        return;
      }

      const nextEntity = createEntityFromTool("skylight", Math.round(world.x), Math.round(world.y));
      interactionRef.current = {
        type: "draw-rect",
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: { x: Math.round(world.x), y: Math.round(world.y) },
        entitySnapshot: nextEntity,
        sourceRectangleId: undefined,
        dragStarted: false,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (entity.type === "rectangle" && event.button === 2) {
      event.preventDefault();
      openEditRectangleModal(entity);
      return;
    }

    dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });

    if (entity.type === "rectangle" && event.pointerType === "touch") {
      clearLongPress();
      longPressRef.current.pointerId = event.pointerId;
      longPressRef.current.entityId = entity.id;
      longPressRef.current.startScreen = { x: event.clientX, y: event.clientY };
      longPressRef.current.fired = false;
      longPressRef.current.timer = setTimeout(() => {
        longPressRef.current.fired = true;
        setDraftEntity(null);
        dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
        finishInteraction();
        openEditRectangleModal(entity);
      }, 520);
    }

    if (entity.type === "window" && event.pointerType === "touch") {
      clearLongPress();
      longPressRef.current.pointerId = event.pointerId;
      longPressRef.current.entityId = entity.id;
      longPressRef.current.startScreen = { x: event.clientX, y: event.clientY };
      longPressRef.current.fired = false;
      longPressRef.current.timer = setTimeout(() => {
        longPressRef.current.fired = true;
        finishInteraction();
        openWindowSizeModal(entity);
      }, 520);
    }

    if (entity.type === "door" && event.pointerType === "touch") {
      clearLongPress();
      longPressRef.current.pointerId = event.pointerId;
      longPressRef.current.entityId = entity.id;
      longPressRef.current.startScreen = { x: event.clientX, y: event.clientY };
      longPressRef.current.fired = false;
      longPressRef.current.timer = setTimeout(() => {
        longPressRef.current.fired = true;
        finishInteraction();
        openDoorModal(entity);
      }, 520);
    }

    if (isUtilityEntityType(entity.type) && event.pointerType === "touch") {
      clearLongPress();
      longPressRef.current.pointerId = event.pointerId;
      longPressRef.current.entityId = entity.id;
      longPressRef.current.startScreen = { x: event.clientX, y: event.clientY };
      longPressRef.current.fired = false;
      longPressRef.current.timer = setTimeout(() => {
        longPressRef.current.fired = true;
        finishInteraction();
        openUtilityLabelModal(entity);
      }, 520);
    }

    if (
      entity.type === "text" &&
      event.pointerType === "touch" &&
      state.selection.kind === "entity" &&
      state.selection.id === entity.id
    ) {
      clearLongPress();
      longPressRef.current.pointerId = event.pointerId;
      longPressRef.current.entityId = entity.id;
      longPressRef.current.startScreen = { x: event.clientX, y: event.clientY };
      longPressRef.current.fired = false;
      longPressRef.current.timer = setTimeout(() => {
        longPressRef.current.fired = true;
        finishInteraction();
        openEditTextModal(entity);
      }, 520);
    }

    if (state.activeTool !== "select") {
      return;
    }

    const world = getEventWorld(event);

    if (entity.type === "window") {
      interactionRef.current = {
        type: "drag-entity",
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: world,
        targetId: entity.id,
        entitySnapshot: entity,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (entity.type === "skylight") {
      interactionRef.current = {
        type: "drag-entity",
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: world,
        targetId: entity.id,
        entitySnapshot: entity,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    interactionRef.current = {
      type: "drag-entity",
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startWorld: world,
      targetId: entity.id,
      entitySnapshot: entity,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleWallPointDown = (event: ReactPointerEvent<SVGCircleElement>, point: WallPoint) => {
    event.stopPropagation();
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (state.activeTool === "text") {
      const world = getEventWorld(event);
      openCreateTextModal(world);
      return;
    }

    dispatch({ type: "SET_SELECTION", selection: { kind: "wallPoint", id: point.id } });

    if (state.activeTool !== "select" && state.activeTool !== "wall") {
      return;
    }

    const world = getEventWorld(event);
    interactionRef.current = {
      type: "drag-wall-point",
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startWorld: world,
      targetId: point.id,
      pointSnapshot: point,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleWallSegmentClick = (event: ReactPointerEvent<SVGLineElement>, segment: WallSegment) => {
    event.stopPropagation();
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (state.activeTool === "text") {
      const world = getEventWorld(event);
      openCreateTextModal(world);
      return;
    }

    dispatch({ type: "SET_SELECTION", selection: { kind: "wallSegment", id: segment.id } });
  };

  const handleWallDimensionEdit = (segment: WallSegment) => {
    const start = pointById.get(segment.startPointId);
    const end = pointById.get(segment.endPointId);
    if (!start || !end) {
      return;
    }
    const current = distance(start, end).toFixed(1);
    const next = window.prompt("Wall length (ft)", current);
    if (!next) {
      return;
    }
    const numeric = Number(next);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return;
    }
    dispatch({ type: "SET_WALL_SEGMENT_LENGTH", segmentId: segment.id, lengthFt: numeric });
  };

  const startRectangleResize = (
    event: ReactPointerEvent<SVGElement>,
    entity: MapEntity,
    handle: ResizeHandle,
  ) => {
    event.stopPropagation();
    dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
    interactionRef.current = {
      type: "resize-rect",
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startWorld: getEventWorld(event),
      targetId: entity.id,
      entitySnapshot: entity,
      resizeHandle: handle,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const startWindowResize = (
    event: ReactPointerEvent<SVGElement>,
    entity: MapEntity,
    handleHint: "start" | "end",
  ) => {
    event.stopPropagation();
    const startWorld = getEventWorld(event);
    const edge = (entity.metadata.edge as RectEdge | undefined) ?? "top";
    const horizontalEdge = edge === "top" || edge === "bottom";
    const pointerAxis = horizontalEdge ? startWorld.x : startWorld.y;
    const centerAxis = horizontalEdge ? entity.x : entity.y;
    const resolvedHandle = pointerAxis < centerAxis ? "start" : pointerAxis > centerAxis ? "end" : handleHint;

    dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
    interactionRef.current = {
      type: "resize-window",
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startWorld,
      targetId: entity.id,
      entitySnapshot: entity,
      windowHandle: resolvedHandle,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const startSkylightResize = (event: ReactPointerEvent<SVGElement>, entity: MapEntity, handle: ResizeHandle) => {
    event.stopPropagation();
    dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
    interactionRef.current = {
      type: "resize-rect",
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startWorld: getEventWorld(event),
      targetId: entity.id,
      entitySnapshot: entity,
      resizeHandle: handle,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const renderedEntities = floor.entities
    .map((entity, index) => ({ entity, index }))
    .sort((a, b) => {
      const aLayer = a.entity.type === "rectangle" ? 0 : 1;
      const bLayer = b.entity.type === "rectangle" ? 0 : 1;
      if (aLayer !== bLayer) {
        return aLayer - bLayer;
      }
      return a.index - b.index;
    })
    .map((item) => item.entity);

  const previewAdjustedEntities = useMemo(() => {
    if (!state.previewEntity) {
      return renderedEntities;
    }
    return renderedEntities.map((entity) =>
      entity.id === state.previewEntity?.id ? state.previewEntity : entity,
    );
  }, [renderedEntities, state.previewEntity]);

  const renderedNonTextEntities = previewAdjustedEntities.filter((entity) => entity.type !== "text");
  const renderedTextEntities = previewAdjustedEntities.filter((entity) => entity.type === "text");

  return (
    <div className="workspace-wrap">
      <svg
        ref={svgRef}
        className="workspace"
        onPointerDown={handleBackgroundDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={handleWheel}
      >
        <defs>
          <pattern
            id="unconditioned-hatch"
            patternUnits="userSpaceOnUse"
            width={3.2}
            height={3.2}
            patternTransform="rotate(45)"
          >
            <line x1={0} y1={0} x2={0} y2={3.2} stroke="#af8c8c" strokeWidth={0.14} />
          </pattern>
        </defs>

        <rect x="0" y="0" width="100%" height="100%" fill="#b7cec5" />

        <g transform={`translate(${state.camera.x}, ${state.camera.y}) scale(${state.camera.zoom})`}>
          {verticalGridLines.map((x) => (
            <line
              key={`vx-${x}`}
              x1={x}
              y1={worldViewport.minY}
              x2={x}
              y2={worldViewport.maxY}
              stroke="#7d9d95"
              strokeWidth={x % 5 === 0 ? 1 : 1}
              vectorEffect="non-scaling-stroke"
              shapeRendering="crispEdges"
              opacity={0.64}
            />
          ))}
          {horizontalGridLines.map((y) => (
            <line
              key={`hy-${y}`}
              x1={worldViewport.minX}
              y1={y}
              x2={worldViewport.maxX}
              y2={y}
              stroke="#7d9d95"
              strokeWidth={y % 5 === 0 ? 1 : 1}
              vectorEffect="non-scaling-stroke"
              shapeRendering="crispEdges"
              opacity={0.64}
            />
          ))}

          {floor.wallSegments.map((segment) => {
            const start = pointById.get(segment.startPointId);
            const end = pointById.get(segment.endPointId);
            if (!start || !end) {
              return null;
            }
            const len = distance(start, end);
            const mid = midpoint(start, end);
            const selected = state.selection.kind === "wallSegment" && state.selection.id === segment.id;
            return (
              <g key={segment.id}>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={selected ? "#ffec9a" : "#ffffff"}
                  strokeWidth={0.5}
                  onPointerDown={(event) => handleWallSegmentClick(event, segment)}
                />
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="transparent"
                  strokeWidth={1.5}
                  onPointerDown={(event) => handleWallSegmentClick(event, segment)}
                />
                <text
                  x={mid.x}
                  y={mid.y - 0.45}
                  className="dim-label"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    handleWallDimensionEdit(segment);
                  }}
                >
                  {fmtFeet(len)}
                </text>
              </g>
            );
          })}

          {floor.wallPoints.map((point) => {
            const selected = state.selection.kind === "wallPoint" && state.selection.id === point.id;
            return (
              <circle
                key={point.id}
                cx={point.x}
                cy={point.y}
                r={selected ? 0.28 : 0.2}
                fill={selected ? "#ffe59a" : "#d9f6ff"}
                stroke="#2f4f4f"
                strokeWidth={0.05}
                onPointerDown={(event) => handleWallPointDown(event, point)}
              />
            );
          })}

          {renderedNonTextEntities.map((entity) => {
            const selected = state.selection.kind === "entity" && state.selection.id === entity.id;
            const common = {
              transform: `translate(${entity.x} ${entity.y}) rotate(${entity.rotation})`,
            };
            return (
              <g
                key={entity.id}
                {...common}
                onPointerDown={(event) => handleEntityDown(event, entity)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  const next = window.prompt("Label", entity.label);
                  if (next !== null) {
                    dispatch({
                      type: "UPDATE_ENTITY_LABEL",
                      entityId: entity.id,
                      label: entity.type === "text" ? next.toUpperCase() : next,
                    });
                  }
                }}
              >
                {entity.type === "line" ? (
                  <line
                    x1={0}
                    y1={0}
                    x2={entity.width}
                    y2={entity.height}
                    stroke="#ffffff"
                    strokeWidth={0.42}
                    shapeRendering="crispEdges"
                  />
                ) : entity.type === "door" ? (
                  <g>
                    {(() => {
                      const doorRadius = Math.max(1, entity.width);
                      const flipSign = Boolean(entity.metadata.flipped) ? -1 : 1;
                      const mirrorSign = Boolean(entity.metadata.mirrored) ? -1 : 1;
                      const edge = (entity.metadata.edge as RectEdge | undefined) ?? "top";
                      const wedgePath = `M ${-doorRadius / 2} 0 L ${doorRadius / 2} 0 A ${doorRadius} ${doorRadius} 0 0 1 ${-doorRadius / 2} ${doorRadius} Z`;
                      const labelX = mirrorSign * -0.14 * doorRadius;
                      const labelY = flipSign * 0.43 * doorRadius;
                      const desiredGlobalLabelRotation =
                        edge === "left" ? -90 : edge === "right" ? 90 : 0;
                      const labelLocalRotation = desiredGlobalLabelRotation - entity.rotation;
                      return (
                        <>
                          {selected && (
                            <rect
                              x={-doorRadius / 2 - 0.2}
                              y={(flipSign === 1 ? 0 : -doorRadius) - 0.2}
                              width={doorRadius + 0.4}
                              height={doorRadius + 0.4}
                              fill="transparent"
                              stroke="#ffe59a"
                              strokeWidth={0.2}
                              rx={0.14}
                            />
                          )}
                          <g transform={`scale(${mirrorSign} ${flipSign})`}>
                            <path d={wedgePath} fill="#a6a24a" fillOpacity={0.92} />
                            <path d={wedgePath} fill="none" stroke="#ffffff" strokeWidth={0.22} />
                            <line
                              x1={-doorRadius / 2}
                              y1={0}
                              x2={-doorRadius / 2}
                              y2={doorRadius}
                              stroke="#ffffff"
                              strokeWidth={0.22}
                            />
                            <line
                              x1={-doorRadius / 2}
                              y1={0}
                              x2={doorRadius / 2}
                              y2={0}
                              stroke="#ffffff"
                              strokeWidth={0.22}
                            />
                          </g>
                          <text
                            x={labelX}
                            y={labelY}
                            textAnchor="middle"
                            fill="#ffffff"
                            fontSize={0.68}
                            fontWeight={900}
                            dominantBaseline="middle"
                            transform={`rotate(${labelLocalRotation} ${labelX} ${labelY})`}
                          >
                            {`${Math.round(entity.width)} x ${Math.round(entity.height)}`}
                          </text>
                        </>
                      );
                    })()}
                  </g>
                ) : entity.type === "window" ? (
                  <g>
                    {selected && (
                      <rect
                        x={-entity.width / 2 - WINDOW_SELECTION_PADDING}
                        y={-WINDOW_FILL_THICKNESS / 2 - WINDOW_SELECTION_PADDING}
                        width={entity.width + WINDOW_SELECTION_PADDING * 2}
                        height={WINDOW_FILL_THICKNESS + WINDOW_SELECTION_PADDING * 2}
                        fill="transparent"
                        stroke="#ffe59a"
                        strokeWidth={0.2}
                        rx={0.14}
                      />
                    )}
                    <rect
                      x={-entity.width / 2}
                      y={-WINDOW_FILL_THICKNESS / 2}
                      width={entity.width}
                      height={WINDOW_FILL_THICKNESS}
                      fill="#0f87a2"
                      stroke="#ffffff"
                      strokeWidth={0.22}
                    />
                    {selected && (
                      <>
                        <rect
                          x={-entity.width / 2 - WINDOW_ANCHOR_WIDTH / 2}
                          y={-WINDOW_ANCHOR_HEIGHT / 2}
                          width={WINDOW_ANCHOR_WIDTH}
                          height={WINDOW_ANCHOR_HEIGHT}
                          rx={0.04}
                          fill="#ffffff"
                          stroke="#0f87a2"
                          strokeWidth={0.06}
                          onPointerDown={(event) => startWindowResize(event, entity, "start")}
                          style={{
                            cursor:
                              selectedWindowEdge === "left" || selectedWindowEdge === "right"
                                ? "ns-resize"
                                : "ew-resize",
                          }}
                        />
                        <rect
                          x={entity.width / 2 - WINDOW_ANCHOR_WIDTH / 2}
                          y={-WINDOW_ANCHOR_HEIGHT / 2}
                          width={WINDOW_ANCHOR_WIDTH}
                          height={WINDOW_ANCHOR_HEIGHT}
                          rx={0.04}
                          fill="#ffffff"
                          stroke="#0f87a2"
                          strokeWidth={0.06}
                          onPointerDown={(event) => startWindowResize(event, entity, "end")}
                          style={{
                            cursor:
                              selectedWindowEdge === "left" || selectedWindowEdge === "right"
                                ? "ns-resize"
                                : "ew-resize",
                          }}
                        />
                      </>
                    )}
                  </g>
                ) : entity.type === "skylight" ? (
                  <g>
                    {selected && (
                      <rect
                        x={-entity.width / 2 - 0.2}
                        y={-entity.height / 2 - 0.2}
                        width={entity.width + 0.4}
                        height={entity.height + 0.4}
                        fill="transparent"
                        stroke="#ffe59a"
                        strokeWidth={0.2}
                        rx={0.14}
                      />
                    )}
                    <rect
                      x={-entity.width / 2}
                      y={-entity.height / 2}
                      width={entity.width}
                      height={entity.height}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={0.22}
                    />
                    <rect
                      x={-entity.width / 2 + 0.25}
                      y={-entity.height / 2 + 0.25}
                      width={Math.max(0.2, entity.width - 0.5)}
                      height={Math.max(0.2, entity.height - 0.5)}
                      fill="#0f87a2"
                    />
                  </g>
                ) : isUtilityEntityType(entity.type) ? (
                  <g>
                    {selected && (
                      <rect
                        x={-entity.width / 2 - 0.2}
                        y={-entity.height / 2 - 0.2}
                        width={entity.width + 0.4}
                        height={entity.height + 0.4}
                        fill="transparent"
                        stroke="#ffe59a"
                        strokeWidth={0.2}
                        rx={0.14}
                      />
                    )}
                    <image
                      href={getUtilityIconByEntityType(entity.type)}
                      x={-entity.width / 2}
                      y={-entity.height / 2}
                      width={Math.max(entity.width, 0.4)}
                      height={Math.max(entity.height, 0.4)}
                      preserveAspectRatio="xMidYMid meet"
                    />
                    {entity.label && (
                      <text
                        x={0}
                        y={entity.height / 2 + 0.72}
                        textAnchor="middle"
                        className="map-text-label"
                        fill={getTextColor(String(entity.metadata.color ?? "WHITE"))}
                        fontSize={0.74}
                        style={{ fontSize: "0.74px" }}
                      >
                        {entity.label.toUpperCase()}
                      </text>
                    )}
                  </g>
                ) : entity.type === "rectangle" ? (
                  <g>
                    <rect
                      x={0}
                      y={0}
                      width={Math.max(entity.width, 0.4)}
                      height={Math.max(entity.height, 0.4)}
                      rx={0.1}
                      fill={getRectangleFillColor(entity.metadata.color ?? "White")}
                      stroke={selected ? "#ffe59a" : "#ffffff"}
                      strokeWidth={selected ? 0.28 : 0.22}
                      shapeRendering="crispEdges"
                    />
                    {Boolean(entity.metadata.unconditioned) && (
                      <rect
                        x={0}
                        y={0}
                        width={Math.max(entity.width, 0.4)}
                        height={Math.max(entity.height, 0.4)}
                        rx={0.1}
                        fill="url(#unconditioned-hatch)"
                        pointerEvents="none"
                      />
                    )}
                  </g>
                ) : (
                  <rect
                    x={-entity.width / 2}
                    y={-entity.height / 2}
                    width={Math.max(entity.width, 0.4)}
                    height={Math.max(entity.height, 0.4)}
                    rx={0.1}
                    fill="#3f757c"
                    stroke={selected ? "#ffe59a" : "#ffffff"}
                    strokeWidth={selected ? 0.28 : 0.22}
                    shapeRendering="crispEdges"
                  />
                )}

                {entity.type === "rectangle" && <RectangleCeilingOverlay entity={entity} />}

                {entity.label && entity.type !== "text" && entity.type !== "rectangle" && !isUtilityEntityType(entity.type) && (
                  <text
                    x={0}
                    y={entity.height / 2 + 0.6}
                    textAnchor="middle"
                    className="object-label"
                  >
                    {entity.label}
                  </text>
                )}

                {entity.type === "window" && (
                  <text
                    x={0}
                    y={-WINDOW_LABEL_OFFSET}
                    textAnchor="middle"
                    fill="#0f87a2"
                    fontSize={0.72}
                    fontWeight={900}
                    transform={
                      ((entity.metadata.edge as RectEdge | undefined) ?? "top") === "bottom"
                        ? `rotate(180 0 ${-WINDOW_LABEL_OFFSET})`
                        : undefined
                    }
                  >
                    {`${fmtFeet(entity.width)} x ${fmtFeet(entity.height)}`}
                  </text>
                )}

                {entity.type === "skylight" && (
                  <text
                    x={entity.width / 2 + 0.55}
                    y={0.22}
                    fill="#0f87a2"
                    fontSize={0.72}
                    fontWeight={900}
                  >
                    {`${fmtFeet(entity.width)} x ${fmtFeet(entity.height)}`}
                  </text>
                )}
              </g>
            );
          })}

          {rectangleGuideGroups.map((group, index) => (
            <PerimeterGuides key={`rg-perimeter-${index}`} guides={group.guides} />
          ))}

          {draftEntity && (
            <g transform={`translate(${draftEntity.x} ${draftEntity.y})`}>
              {draftEntity.type === "line" ? (
                <line
                  x1={0}
                  y1={0}
                  x2={draftEntity.width}
                  y2={draftEntity.height}
                  stroke="#ffffff"
                  strokeWidth={0.42}
                  shapeRendering="crispEdges"
                />
              ) : (
                <rect
                  x={0}
                  y={0}
                  width={Math.max(draftEntity.width, 0.2)}
                  height={Math.max(draftEntity.height, 0.2)}
                  fill="rgba(255, 255, 255, 0.08)"
                  stroke="#ffffff"
                  strokeWidth={0.24}
                  shapeRendering="crispEdges"
                />
              )}
            </g>
          )}

          {draftEntity?.type === "rectangle" && (
            <DraftRectangleGuides
              rect={{
                x: draftEntity.x,
                y: draftEntity.y,
                width: Math.abs(draftEntity.width),
                height: Math.abs(draftEntity.height),
              }}
            />
          )}

          {selectedRectangleEntity && (() => {
            const rect = rectBoundsFromEntity(selectedRectangleEntity);
            const x1 = rect.x;
            const y1 = rect.y;
            const x2 = rect.x + rect.width;
            const y2 = rect.y + rect.height;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const anchors: Array<{ x: number; y: number; handle: ResizeHandle; cursor: string }> = [
              { x: x1, y: y1, handle: "nw", cursor: "nwse-resize" },
              { x: x2, y: y1, handle: "ne", cursor: "nesw-resize" },
              { x: x1, y: y2, handle: "sw", cursor: "nesw-resize" },
              { x: x2, y: y2, handle: "se", cursor: "nwse-resize" },
            ];

            return (
              <g className="rect-resize-controls">
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y1}
                  stroke="transparent"
                  strokeWidth={1.1}
                  style={{ cursor: "ns-resize" }}
                  onPointerDown={(event) => startRectangleResize(event, selectedRectangleEntity, "n")}
                />
                <line
                  x1={x1}
                  y1={y2}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={1.1}
                  style={{ cursor: "ns-resize" }}
                  onPointerDown={(event) => startRectangleResize(event, selectedRectangleEntity, "s")}
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x1}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={1.1}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(event) => startRectangleResize(event, selectedRectangleEntity, "w")}
                />
                <line
                  x1={x2}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={1.1}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(event) => startRectangleResize(event, selectedRectangleEntity, "e")}
                />

                <circle cx={midX} cy={y1} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={midX} cy={y2} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={x1} cy={midY} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={x2} cy={midY} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />

                {anchors.map((anchor) => (
                  <circle
                    key={`${anchor.handle}-${anchor.x}-${anchor.y}`}
                    cx={anchor.x}
                    cy={anchor.y}
                    r={0.26}
                    fill="#ffffff"
                    stroke="#4f6862"
                    strokeWidth={0.06}
                    style={{ cursor: anchor.cursor }}
                    onPointerDown={(event) => startRectangleResize(event, selectedRectangleEntity, anchor.handle)}
                  />
                ))}
              </g>
            );
          })()}

          {selectedSkylightEntity && (() => {
            const x1 = selectedSkylightEntity.x - selectedSkylightEntity.width / 2;
            const y1 = selectedSkylightEntity.y - selectedSkylightEntity.height / 2;
            const x2 = selectedSkylightEntity.x + selectedSkylightEntity.width / 2;
            const y2 = selectedSkylightEntity.y + selectedSkylightEntity.height / 2;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const anchors: Array<{ x: number; y: number; handle: ResizeHandle; cursor: string }> = [
              { x: x1, y: y1, handle: "nw", cursor: "nwse-resize" },
              { x: x2, y: y1, handle: "ne", cursor: "nesw-resize" },
              { x: x1, y: y2, handle: "sw", cursor: "nesw-resize" },
              { x: x2, y: y2, handle: "se", cursor: "nwse-resize" },
            ];

            return (
              <g className="rect-resize-controls">
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y1}
                  stroke="transparent"
                  strokeWidth={1.1}
                  style={{ cursor: "ns-resize" }}
                  onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, "n")}
                />
                <line
                  x1={x1}
                  y1={y2}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={1.1}
                  style={{ cursor: "ns-resize" }}
                  onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, "s")}
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x1}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={1.1}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, "w")}
                />
                <line
                  x1={x2}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={1.1}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, "e")}
                />

                <circle cx={midX} cy={y1} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={midX} cy={y2} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={x1} cy={midY} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={x2} cy={midY} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />

                {anchors.map((anchor) => (
                  <circle
                    key={`sk-${anchor.handle}-${anchor.x}-${anchor.y}`}
                    cx={anchor.x}
                    cy={anchor.y}
                    r={0.26}
                    fill="#ffffff"
                    stroke="#4f6862"
                    strokeWidth={0.06}
                    style={{ cursor: anchor.cursor }}
                    onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, anchor.handle)}
                  />
                ))}
              </g>
            );
          })()}

          {state.activeTool === "wall" && state.wallDraftPointId && hoverWorld && pointById.get(state.wallDraftPointId) && (
            <line
              x1={pointById.get(state.wallDraftPointId)?.x}
              y1={pointById.get(state.wallDraftPointId)?.y}
              x2={constrainOrthogonal(pointById.get(state.wallDraftPointId) as WallPoint, hoverWorld).x}
              y2={constrainOrthogonal(pointById.get(state.wallDraftPointId) as WallPoint, hoverWorld).y}
              stroke="#7ef4ff"
              strokeDasharray="0.3 0.2"
              strokeWidth={0.1}
            />
          )}

          {renderedTextEntities.map((entity) => {
            const selected = state.selection.kind === "entity" && state.selection.id === entity.id;
            const bounds = getTextBounds(entity.label, getTextSize(entity));
            return (
              <g
                key={entity.id}
                transform={`translate(${entity.x} ${entity.y}) rotate(${entity.rotation})`}
                onPointerDown={(event) => handleEntityDown(event, entity)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  const next = window.prompt("Label", entity.label);
                  if (next !== null) {
                    dispatch({
                      type: "UPDATE_ENTITY_LABEL",
                      entityId: entity.id,
                      label: next.toUpperCase(),
                    });
                  }
                }}
              >
                {selected && (
                  <rect
                    x={bounds.selectionX}
                    y={bounds.selectionY}
                    width={bounds.selectionWidth}
                    height={bounds.selectionHeight}
                    fill="transparent"
                    stroke="#ffe59a"
                    strokeWidth={0.16}
                    rx={0.1}
                  />
                )}
                <rect
                  x={bounds.contentX}
                  y={bounds.contentY}
                  width={bounds.contentWidth}
                  height={bounds.contentHeight}
                  fill="transparent"
                />
                <text
                  x={0}
                  y={0}
                  className="map-text-label"
                  fill={getTextColor(String(entity.metadata.color ?? "WHITE"))}
                  fontSize={bounds.fontSize}
                  style={{ fontSize: `${bounds.fontSize}px` }}
                >
                  {bounds.safeLabel}
                </text>
              </g>
            );
          })}

        </g>
      </svg>

      <RectangleModal
        isOpen={rectangleModalState !== null}
        initialValues={rectangleModalState?.initialValues ?? DEFAULT_RECTANGLE_MODAL_VALUES}
        onCancel={() => setRectangleModalState(null)}
        onSubmit={(payload: RectangleModalSubmit) => {
          if (!rectangleModalState) {
            return;
          }

          const metadata = {
            color: payload.color,
            unconditioned: payload.unconditioned,
            ceilingType: payload.ceilingType,
            standardHeightFt: payload.standardHeightFt,
            lowHeightFt: payload.lowHeightFt,
            highHeightFt: payload.highHeightFt,
          };

          if (rectangleModalState.mode === "edit" && rectangleModalState.entityId) {
            const existing = floor.entities.find((entity) => entity.id === rectangleModalState.entityId);
            if (!existing || existing.type !== "rectangle") {
              setRectangleModalState(null);
              return;
            }

            const updated: MapEntity = {
              ...existing,
              width: Math.max(1, Math.round(payload.widthFt)),
              height: Math.max(1, Math.round(payload.heightFt)),
              metadata: {
                ...existing.metadata,
                ...metadata,
              },
            };
            dispatch({ type: "UPSERT_ENTITY", entity: updated });
            dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
            setRectangleModalState(null);
            return;
          }

          const rectangle = createEntityFromTool("rectangle", rectangleModalState.anchor.x, rectangleModalState.anchor.y);
          rectangle.width = Math.max(1, Math.round(payload.widthFt));
          rectangle.height = Math.max(1, Math.round(payload.heightFt));
          rectangle.metadata = {
            ...rectangle.metadata,
            ...metadata,
          };

          dispatch({ type: "UPSERT_ENTITY", entity: rectangle });
          dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
          setRectangleModalState(null);
        }}
      />

      <TextModal
        isOpen={textModalState !== null}
        initialValues={textModalState?.initialValues ?? DEFAULT_TEXT_MODAL_VALUES}
        onCancel={() => setTextModalState(null)}
        onSubmit={(payload: TextModalSubmit) => {
          if (!textModalState) {
            return;
          }

          if (textModalState.mode === "edit" && textModalState.entityId) {
            const existing = floor.entities.find((entity) => entity.id === textModalState.entityId);
            if (!existing || existing.type !== "text") {
              setTextModalState(null);
              return;
            }

            const updated: MapEntity = {
              ...existing,
              label: payload.text.toUpperCase(),
              metadata: {
                ...existing.metadata,
                color: payload.color,
                textSize: payload.size,
              },
            };

            dispatch({ type: "UPSERT_ENTITY", entity: updated });
            dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
            setTextModalState(null);
            return;
          }

          const textEntity = createEntityFromTool("text", textModalState.anchor.x, textModalState.anchor.y);
          textEntity.label = payload.text.toUpperCase();
          textEntity.metadata = {
            ...textEntity.metadata,
            color: payload.color,
            textSize: payload.size,
          };

          dispatch({ type: "UPSERT_ENTITY", entity: textEntity });
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: textEntity.id } });
          setTextModalState(null);
        }}
      />

      <DoorModal
        isOpen={doorModalState !== null}
        initialHeightFt={doorModalState?.initialHeightFt ?? 7}
        initialMirrored={doorModalState?.initialMirrored ?? false}
        onCancel={() => setDoorModalState(null)}
        onSubmit={(payload: DoorModalSubmit) => {
          if (!doorModalState) {
            return;
          }

          const existing = floor.entities.find((entity) => entity.id === doorModalState.entityId);
          if (!existing || existing.type !== "door") {
            setDoorModalState(null);
            return;
          }

          const updated: MapEntity = {
            ...existing,
            height: Math.max(1, Math.round(payload.heightFt)),
            metadata: {
              ...existing.metadata,
              mirrored: payload.mirrored,
            },
          };
          dispatch({ type: "UPSERT_ENTITY", entity: updated });
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
          setDoorModalState(null);
        }}
      />

      <WindowModal
        isOpen={windowModalState !== null}
        initialWidthFt={windowModalState?.initialWidthFt ?? 3}
        initialHeightFt={windowModalState?.initialHeightFt ?? 4}
        onCancel={() => setWindowModalState(null)}
        onSubmit={(payload: WindowModalSubmit) => {
          if (!windowModalState) {
            return;
          }

          const existing = floor.entities.find((entity) => entity.id === windowModalState.entityId);
          if (!existing || existing.type !== "window") {
            setWindowModalState(null);
            return;
          }

          const updated: MapEntity = {
            ...existing,
            width: Math.max(1, Math.round(payload.widthFt)),
            height: Math.max(1, Math.round(payload.heightFt)),
          };
          dispatch({ type: "UPSERT_ENTITY", entity: updated });
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
          setWindowModalState(null);
        }}
      />

      <UtilityLabelModal
        isOpen={utilityLabelModalState !== null}
        initialValues={{
          text: utilityLabelModalState?.initialText ?? "",
          color: utilityLabelModalState?.initialColor ?? "WHITE",
        }}
        onCancel={() => setUtilityLabelModalState(null)}
        onSubmit={(payload: UtilityLabelSubmit) => {
          if (!utilityLabelModalState) {
            return;
          }

          const existing = floor.entities.find((entity) => entity.id === utilityLabelModalState.entityId);
          if (!existing || !isUtilityEntityType(existing.type)) {
            setUtilityLabelModalState(null);
            return;
          }

          const updated: MapEntity = {
            ...existing,
            label: payload.text.toUpperCase(),
            metadata: {
              ...existing.metadata,
              color: payload.color,
            },
          };
          dispatch({ type: "UPSERT_ENTITY", entity: updated });
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
          setUtilityLabelModalState(null);
        }}
      />

    </div>
  );
}

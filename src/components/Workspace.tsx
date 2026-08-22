import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, WheelEvent as ReactWheelEvent } from "react";
import { RectangleModal } from "./RectangleModal";
import type { RectangleModalInitialValues, RectangleModalSubmit } from "./RectangleModal";
import { TextModal } from "./TextModal";
import type { TextModalInitialValues, TextModalSubmit } from "./TextModal";
import { DoorModal } from "./DoorModal";
import type { DoorModalSubmit } from "./DoorModal";
import { WindowModal } from "./WindowModal";
import type { WindowModalSubmit } from "./WindowModal";
import { SlidingGlassDoorModal } from "./SlidingGlassDoorModal";
import type { SlidingGlassDoorModalSubmit } from "./SlidingGlassDoorModal";
import { UtilityLabelModal } from "./UtilityLabelModal";
import type { UtilityLabelSubmit } from "./UtilityLabelModal";
import { BumpOutModal } from "./BumpOutModal";
import type { BumpOutModalSubmit } from "./BumpOutModal";
import resizeIcon from "../../assets/svgs/resize-icon.svg";
import moveIcon from "../../assets/svgs/move-icon.svg";
import editIcon from "../../assets/svgs/edit-icon.svg";
import lockIcon from "../../assets/svgs/lock-icon.svg";
import doorToolIcon from "../../assets/building-icons/door.png";
import doubleDoorToolIcon from "../../assets/building-icons/double-door.png";
import slidingGlassToolIcon from "../../assets/building-icons/sliding-glass.png";
import windowToolIcon from "../../assets/building-icons/window.png";
import skylightToolIcon from "../../assets/building-icons/skylight.png";
import { useEditor } from "../state/EditorContext";
import { createEntityFromTool, createWallPoint, createWallSegment } from "../state/editorReducer";
import { getToolDefinition } from "../tools/toolDefinitions";
import { getUtilityIconByEntityType, isUtilityEntityType, isUtilityToolId } from "../assets/utilityIcons";
import { inferFloorPresetFromName, isAtticPreset, sortFloorsByPresetOrder } from "../constants/floors";
import type { MapEntity, Orientation, Point, ToolId, WallPoint, WallSegment } from "../types";
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
  pointerType?: string;
  startScreen: Point;
  startWorld: Point;
  targetId?: string;
  sourceRectangleId?: string;
  windowHandle?: "start" | "end";
  tapAction?: "flip-door" | "deselect-empty" | "select-entity";
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
const WINDOW_ANCHOR_WIDTH = 0.48;
const WINDOW_ANCHOR_HEIGHT = 1.16;
const WINDOW_HANDLE_HIT_SLOP = 0.76;
const WINDOW_LABEL_OFFSET = 1.02;
const LINEAR_MARKER_COLOR = "#edf5ff";
const RESIZE_HINT_COLOR = "#7de8ff";
const OPENING_SIZE_LABEL_COLOR = "#1c3358";
const ORIENTATION_ORDER: Orientation[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const OPENING_SIZE_LABEL_FONT_SIZE = 0.92;
const OPENING_LABEL_UNDER_SELECTED_PADDING = 0.24;
const WINDOW_BOTTOM_LABEL_EXTRA_PADDING = 0.12;
const RECTANGLE_LABEL_DEFAULT_FONT_SIZE = 1.05;
const RECTANGLE_LABEL_MIN_FONT_SIZE = 0.52;
const DOOR_FILL_COLOR = "#ffaa00";
const OPENING_ACCENT_COLOR = "#00dbff";
const SINGLE_DOOR_DEFAULT_WIDTH = 3;
const DOUBLE_DOOR_DEFAULT_WIDTH = 6;
const DOOR_DEFAULT_HEIGHT = 7;
const SLIDING_DOOR_DEFAULT_WIDTH = 6;
const SLIDING_DOOR_DEFAULT_HEIGHT = 7;
const SINGLE_DOOR_VISUAL_WIDTH = 3;
const DOUBLE_DOOR_VISUAL_WIDTH = 6;
const EDGE_MATCH_EPSILON = 0.001;
const RECT_DRAW_START_EDGE_SNAP_THRESHOLD = 3;
const RECT_EDGE_SNAP_THRESHOLD = 3;
const OPENING_PLACEMENT_SNAP_THRESHOLD = 3;
const OPENING_PREVIEW_SNAP_THRESHOLD = 3;
const OPENING_PLACEMENT_PREVIEW_ID = "__opening-placement-preview__";
const BUMPOUT_ASPECT_RATIO = 0.62;
const BUMPOUT_EDGE_SNAP_THRESHOLD = 2.8;

type BumpOutFlats = 3 | 4 | 5 | 6;

function isBumpOutRectangle(entity: MapEntity): boolean {
  return entity.type === "rectangle" && entity.metadata.shapeType === "bumpout";
}

function getBumpOutFlats(entity: MapEntity): BumpOutFlats {
  const value = Number(entity.metadata.bumpOutFlats ?? 5);
  if (value === 3 || value === 4 || value === 5 || value === 6) {
    return value;
  }
  if (value === 7 || value === 9) {
    return 6;
  }
  return 5;
}

function bumpOutPolygonPoints(
  width: number,
  height: number,
  flats: BumpOutFlats,
  options?: { cornerInset?: number; rise?: number; crownWidth?: number },
): Point[] {
  const w = Math.max(1, width);
  const d = Math.max(1, height);
  const rise = clampValue(
    Math.round(options?.rise ?? d),
    1,
    d,
  );

  // 3 and 5 use an explicit top segment parallel to the connected edge.
  if (flats === 3 || flats === 5) {
    const sideSegments = (flats - 1) / 2;
    const defaultCrown = flats === 3 ? Math.round(w * 0.56) : Math.round(w * 0.34);
    const crownFromInset = Number.isFinite(options?.cornerInset) ? w - Math.round((options?.cornerInset ?? 0) * 2) : NaN;
    const crownRaw = Number.isFinite(crownFromInset) ? crownFromInset : Math.round(options?.crownWidth ?? defaultCrown);
    const maxCrown = Math.max(1, w - sideSegments * 2);
    const crownWidth = clampValue(crownRaw, 1, maxCrown);
    const sideSpan = (w - crownWidth) / 2;
    const topY = d - rise;
    const sideProfiles =
      flats === 3
        ? [{ x: 1, y: 1 }]
        : [
            { x: 0.06, y: 0.58 },
            { x: 1, y: 1 },
          ];

    const rightSide: Point[] = [];
    for (let index = 1; index <= sideSegments; index += 1) {
      const profile = sideProfiles[index - 1] ?? { x: index / sideSegments, y: index / sideSegments };
      rightSide.push({
        x: w - sideSpan * profile.x,
        y: d - rise * profile.y,
      });
    }

    const leftCrown: Point = { x: (w - crownWidth) / 2, y: topY };
    const mirroredLeft = rightSide
      .slice(0, -1)
      .reverse()
      .map((point) => ({ x: w - point.x, y: point.y }));

    return [
      { x: 0, y: d },
      { x: w, y: d },
      ...rightSide,
      leftCrown,
      ...mirroredLeft,
    ];
  }

  // 4 and 6 keep a symmetric crown apex and never flatten into an open shape.
  if (flats === 4 || flats === 6) {
    const sideSegments = flats / 2;
    const sideProfiles =
      flats === 4
        ? [
            { x: 0.22, y: 0.66 },
            { x: 1, y: 1 },
          ]
        : [
            { x: 0.08, y: 0.5 },
            { x: 0.35, y: 0.84 },
            { x: 1, y: 1 },
          ];
    const rightSide: Point[] = [];
    for (let index = 1; index <= sideSegments; index += 1) {
      const profile = sideProfiles[index - 1] ?? { x: index / sideSegments, y: index / sideSegments };
      rightSide.push({
        x: w - (w / 2) * profile.x,
        y: d - rise * profile.y,
      });
    }

    const mirroredLeft = rightSide
      .slice(0, -1)
      .reverse()
      .map((point) => ({ x: w - point.x, y: point.y }));

    return [
      { x: 0, y: d },
      { x: w, y: d },
      ...rightSide,
      ...mirroredLeft,
    ];
  }

  const radius = (w * w) / (8 * d) + d / 2;
  const centerX = w / 2;
  const centerY = radius;
  const leftAngle = Math.atan2(d - centerY, -w / 2);
  const rightAngle = Math.atan2(d - centerY, w / 2) + Math.PI * 2;
  const step = (rightAngle - leftAngle) / flats;

  const arcInterior: Point[] = [];
  for (let index = 1; index < flats; index += 1) {
    const angle = leftAngle + step * index;
    arcInterior.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  }

  return [
    { x: 0, y: d },
    { x: w, y: d },
    ...arcInterior.reverse(),
  ];
}

function getBumpOutRenderPoints(entity: MapEntity): Point[] {
  const flats = getBumpOutFlats(entity);
  const hostEdge = (entity.metadata.hostEdge as RectEdge | undefined) ?? "top";
  const cornerInset = Number(entity.metadata.bumpOutCornerInset);
  const rise = Number(entity.metadata.bumpOutRise);
  const crownWidth = Number(entity.metadata.bumpOutCrownWidth);
  const styleOptions = {
    cornerInset: Number.isFinite(cornerInset) ? cornerInset : undefined,
    rise: Number.isFinite(rise) ? rise : undefined,
    crownWidth: Number.isFinite(crownWidth) ? crownWidth : undefined,
  };

  if (hostEdge === "left" || hostEdge === "right") {
    const template = bumpOutPolygonPoints(Math.max(1, entity.height), Math.max(1, entity.width), flats, styleOptions);
    return template.map((point) =>
      hostEdge === "left"
        ? { x: point.y, y: point.x }
        : { x: Math.max(1, entity.width) - point.y, y: point.x },
    );
  }

  const points = bumpOutPolygonPoints(Math.max(1, entity.width), Math.max(1, entity.height), flats, styleOptions);
  if (hostEdge === "bottom") {
    return points.map((point) => ({ x: point.x, y: Math.max(1, entity.height) - point.y }));
  }
  return points;
}

function bumpOutPath(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function nearestPointOnSegment(point: Point, start: Point, end: Point): { point: Point; t: number; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= Number.EPSILON) {
    return { point: { ...start }, t: 0, distance: Math.hypot(point.x - start.x, point.y - start.y) };
  }

  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq;
  const t = clampValue(rawT, 0, 1);
  const projected = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };
  return {
    point: projected,
    t,
    distance: Math.hypot(point.x - projected.x, point.y - projected.y),
  };
}

function classifySegmentEdge(start: Point, end: Point): RectEdge {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dy >= 0 ? "bottom" : "top";
  }
  return dx >= 0 ? "right" : "left";
}

function getBumpOutWorldPoints(entity: MapEntity): Point[] {
  return getBumpOutRenderPoints(entity).map((point) => ({ x: entity.x + point.x, y: entity.y + point.y }));
}

function polygonBounds(points: Point[]): RectBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function cross2d(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegmentInclusive(point: Point, start: Point, end: Point, epsilon = 1e-6): boolean {
  const cross = Math.abs(cross2d(start, end, point));
  if (cross > epsilon) {
    return false;
  }
  const minX = Math.min(start.x, end.x) - epsilon;
  const maxX = Math.max(start.x, end.x) + epsilon;
  const minY = Math.min(start.y, end.y) - epsilon;
  const maxY = Math.max(start.y, end.y) + epsilon;
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function segmentsIntersectInclusive(a1: Point, a2: Point, b1: Point, b2: Point, epsilon = 1e-6): boolean {
  const d1 = cross2d(a1, a2, b1);
  const d2 = cross2d(a1, a2, b2);
  const d3 = cross2d(b1, b2, a1);
  const d4 = cross2d(b1, b2, a2);

  const properIntersect =
    ((d1 > epsilon && d2 < -epsilon) || (d1 < -epsilon && d2 > epsilon)) &&
    ((d3 > epsilon && d4 < -epsilon) || (d3 < -epsilon && d4 > epsilon));
  if (properIntersect) {
    return true;
  }

  return (
    pointOnSegmentInclusive(b1, a1, a2, epsilon) ||
    pointOnSegmentInclusive(b2, a1, a2, epsilon) ||
    pointOnSegmentInclusive(a1, b1, b2, epsilon) ||
    pointOnSegmentInclusive(a2, b1, b2, epsilon)
  );
}

function pointInPolygonInclusive(point: Point, polygon: Point[], epsilon = 1e-6): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (pointOnSegmentInclusive(point, start, end, epsilon)) {
      return true;
    }
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function bumpOutPolygonsIntersect(a: Point[], b: Point[]): boolean {
  if (a.length < 3 || b.length < 3) {
    return false;
  }

  const boundsA = polygonBounds(a);
  const boundsB = polygonBounds(b);
  const overlapsBounds =
    boundsA.x <= boundsB.x + boundsB.width &&
    boundsA.x + boundsA.width >= boundsB.x &&
    boundsA.y <= boundsB.y + boundsB.height &&
    boundsA.y + boundsA.height >= boundsB.y;
  if (!overlapsBounds) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsIntersectInclusive(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return pointInPolygonInclusive(a[0], b) || pointInPolygonInclusive(b[0], a);
}

function doesBumpOutIntersectAny(
  candidate: MapEntity,
  rectangles: MapEntity[],
  ignoreId?: string,
): boolean {
  if (!isBumpOutRectangle(candidate)) {
    return false;
  }

  const candidatePoints = getBumpOutWorldPoints(candidate);
  for (const other of rectangles) {
    if (!isBumpOutRectangle(other) || other.id === ignoreId || other.id === candidate.id) {
      continue;
    }
    if (bumpOutPolygonsIntersect(candidatePoints, getBumpOutWorldPoints(other))) {
      return true;
    }
  }
  return false;
}

function getHostBumpOutSegment(
  entity: MapEntity,
  rectangles: MapEntity[],
): { start: Point; end: Point; index: number; length: number } | null {
  const hostRectId = entity.metadata.hostRectId as string | undefined;
  const segmentIndexRaw = Number(entity.metadata.bumpOutSegmentIndex);
  if (!hostRectId || !Number.isFinite(segmentIndexRaw)) {
    return null;
  }

  const host = rectangles.find((item) => item.id === hostRectId && isBumpOutRectangle(item));
  if (!host) {
    return null;
  }

  const points = getBumpOutWorldPoints(host);
  if (points.length < 2) {
    return null;
  }

  const segmentIndex = Math.max(0, Math.min(points.length - 1, Math.round(segmentIndexRaw)));
  const start = points[segmentIndex];
  const end = points[(segmentIndex + 1) % points.length];
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  return { start, end, index: segmentIndex, length };
}

function nearestWindowHostEdge(point: Point, rectangles: MapEntity[]): EdgeSnap | null {
  let best: EdgeSnap | null = null;

  for (const rectEntity of rectangles) {
    if (!isBumpOutRectangle(rectEntity)) {
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
      continue;
    }

    const worldPoints = getBumpOutWorldPoints(rectEntity);
    for (let index = 0; index < worldPoints.length; index += 1) {
      if (index === 0) {
        continue;
      }
      const start = worldPoints[index];
      const end = worldPoints[(index + 1) % worldPoints.length];
      const projected = nearestPointOnSegment(point, start, end);
      const angleDeg = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
      const candidate: EdgeSnap = {
        rectId: rectEntity.id,
        edge: classifySegmentEdge(start, end),
        x: projected.point.x,
        y: projected.point.y,
        distance: projected.distance,
        segmentIndex: index,
        segmentAngleDeg: angleDeg,
      };
      if (!best || candidate.distance < best.distance) {
        best = candidate;
      }
    }
  }

  return best;
}

function getConnectedLongEdgeHandleForHostEdge(hostEdge: RectEdge): ResizeHandle {
  if (hostEdge === "top") {
    return "s";
  }
  if (hostEdge === "bottom") {
    return "n";
  }
  if (hostEdge === "left") {
    return "e";
  }
  return "w";
}

function isBumpOutResizeHandleAllowed(entity: MapEntity, handle: ResizeHandle): boolean {
  if (!isBumpOutRectangle(entity)) {
    return true;
  }
  const hostEdge = (entity.metadata.hostEdge as RectEdge | undefined) ?? "top";
  const connectedHandle = getConnectedLongEdgeHandleForHostEdge(hostEdge);
  return !handle.includes(connectedHandle);
}

function clampBumpOutRectToHost(
  hostRect: RectBounds,
  hostEdge: RectEdge,
  rect: RectBounds,
): RectBounds {
  if (hostEdge === "top") {
    const width = Math.min(rect.width, hostRect.width);
    const x = clampValue(rect.x, hostRect.x, hostRect.x + hostRect.width - width);
    return { x, y: hostRect.y - rect.height, width, height: rect.height };
  }
  if (hostEdge === "bottom") {
    const width = Math.min(rect.width, hostRect.width);
    const x = clampValue(rect.x, hostRect.x, hostRect.x + hostRect.width - width);
    return { x, y: hostRect.y + hostRect.height, width, height: rect.height };
  }
  if (hostEdge === "left") {
    const height = Math.min(rect.height, hostRect.height);
    const y = clampValue(rect.y, hostRect.y, hostRect.y + hostRect.height - height);
    return { x: hostRect.x - rect.width, y, width: rect.width, height };
  }
  const height = Math.min(rect.height, hostRect.height);
  const y = clampValue(rect.y, hostRect.y, hostRect.y + hostRect.height - height);
  return { x: hostRect.x + hostRect.width, y, width: rect.width, height };
}

function getBumpOutStyleSizeLimits(flats: BumpOutFlats): { minLong: number; minDepth: number } {
  if (flats === 3) {
    return { minLong: 3, minDepth: 2 };
  }
  if (flats === 4) {
    return { minLong: 4, minDepth: 2 };
  }
  if (flats === 5) {
    return { minLong: 5, minDepth: 2 };
  }
  return { minLong: 6, minDepth: 3 };
}

function createBumpOutFromEdge(
  snap: EdgeSnap,
  hostRect: RectBounds,
  flats: BumpOutFlats,
  longEdgeFt: number,
): MapEntity {
  const width = Math.max(3, Math.round(longEdgeFt));
  const height = Math.max(2, Math.round(width * BUMPOUT_ASPECT_RATIO));
  let x = Math.round(snap.x - width / 2);
  let y = Math.round(snap.y - height / 2);
  if (snap.edge === "top") {
    y = hostRect.y - height;
  } else if (snap.edge === "bottom") {
    y = hostRect.y + hostRect.height;
  } else if (snap.edge === "left") {
    x = hostRect.x - height;
  } else {
    x = hostRect.x + hostRect.width;
  }

  const tentativeRect: RectBounds = {
    x,
    y,
    width: snap.edge === "left" || snap.edge === "right" ? height : width,
    height: snap.edge === "left" || snap.edge === "right" ? width : height,
  };
  const clamped = clampBumpOutRectToHost(hostRect, snap.edge, tentativeRect);

  const entity = createEntityFromTool("rectangle", clamped.x, clamped.y);
  entity.width = clamped.width;
  entity.height = clamped.height;
  const maxInset = Math.max(1, Math.floor(entity.width / 2) - 1);
  const cornerInset = clampValue(Math.round(entity.width * 0.22), 1, maxInset);
  const crownWidthDefault = flats === 3 ? Math.round(entity.width * 0.56) : flats === 5 ? Math.round(entity.width * 0.34) : undefined;
  entity.metadata = {
    ...entity.metadata,
    shapeType: "bumpout",
    bumpOutFlats: flats,
    hostRectId: snap.rectId,
    hostEdge: snap.edge,
    bumpOutCornerInset: cornerInset,
    bumpOutRise: entity.height,
    bumpOutCrownWidth: crownWidthDefault,
  };
  return entity;
}

type DoorKind = "single" | "double" | "sliding";

type DoorToolType = "single" | "double" | "sliding";

function getDoorToolTypeFromMetadata(metadata: Record<string, string | number | boolean | null>): DoorToolType {
  const value = String(metadata.doorDefaultType ?? "single").toLowerCase();
  if (value === "double" || value === "sliding") {
    return value;
  }
  return "single";
}

function isLockableTool(toolId: ToolId): boolean {
  return toolId !== "select" && !isUtilityToolId(toolId);
}

function renderWorkspaceToolIcon(toolId: ToolId, doorType: DoorToolType): ReactElement {
  if (toolId === "select") {
    return (
      <svg className="workspace-tool-lock-main-icon" viewBox="0 0 24 24" aria-hidden="true">
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
      <svg className="workspace-tool-lock-main-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.2" y="6" width="17.6" height="12" fill="rgba(0,0,0,0.08)" stroke="currentColor" strokeWidth="2.4" />
      </svg>
    );
  }

  if (toolId === "bumpout") {
    return (
      <svg className="workspace-tool-lock-main-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 20 L21 20 L21 14 L19 10 L16 8 L8 8 L5 10 L3 14 Z"
          fill="rgba(0,0,0,0.08)"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
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
        className="tool-icon-image tool-icon-building tool-icon-door tool-icon-building-mask workspace-tool-lock-main-icon"
        style={{ "--building-icon": `url(${iconSource})` } as CSSProperties}
        aria-hidden="true"
      />
    );
  }

  if (toolId === "window") {
    return (
      <span
        className="tool-icon-image tool-icon-building tool-icon-window tool-icon-building-mask workspace-tool-lock-main-icon"
        style={{ "--building-icon": `url(${windowToolIcon})` } as CSSProperties}
        aria-hidden="true"
      />
    );
  }

  if (toolId === "skylight") {
    return (
      <span
        className="tool-icon-image tool-icon-building tool-icon-skylight tool-icon-building-mask workspace-tool-lock-main-icon"
        style={{ "--building-icon": `url(${skylightToolIcon})` } as CSSProperties}
        aria-hidden="true"
      />
    );
  }

  if (toolId === "text") {
    return <span className="workspace-tool-lock-text-icon">T</span>;
  }

  const toolDef = getToolDefinition(toolId);
  return <span className="workspace-tool-lock-fallback-icon">{toolDef?.icon ?? "*"}</span>;
}

function getDoorKind(entity: MapEntity): DoorKind {
  if (entity.type !== "door") {
    return "single";
  }
  const value = String(entity.metadata.doorKind ?? "single").toLowerCase();
  if (value === "double" || value === "sliding") {
    return value;
  }
  return "single";
}

function isSlidingDoor(entity: MapEntity): boolean {
  return entity.type === "door" && getDoorKind(entity) === "sliding";
}

function getDoorVisualWidth(entity: MapEntity): number {
  const kind = getDoorKind(entity);
  if (kind === "double") {
    return DOUBLE_DOOR_VISUAL_WIDTH;
  }
  if (kind === "sliding") {
    return Math.max(1, entity.width);
  }
  return SINGLE_DOOR_VISUAL_WIDTH;
}

function pushLabelFurtherFromOpening(offset: number, padding: number): number {
  if (offset >= 0) {
    return offset + padding;
  }
  return offset - padding;
}

function getRectangleFillColor(color: string): string {
  switch (color.toLowerCase()) {
    case "blue":
      return "rgba(56, 142, 255, 0.5)";
    case "green":
      return "rgba(42, 181, 106, 0.5)";
    case "red":
      return "rgba(217, 74, 67, 0.5)";
    case "yellow":
      return "rgba(242, 202, 69, 0.5)";
    case "white":
      return "rgba(255, 255, 255, 0.5)";
    default:
      return "rgba(56, 142, 255, 0.5)";
  }
}

function RectangleCeilingOverlay({ entity, anchor }: { entity: MapEntity; anchor?: Point }) {
  if (entity.type !== "rectangle") {
    return null;
  }

  if (Boolean(entity.metadata.unconditioned)) {
    return null;
  }

  const ceilingType = entity.metadata.ceilingType ?? "standard";
  if (ceilingType === "none") {
    return null;
  }

  const standardHeight = Number(entity.metadata.standardHeightFt ?? 8);
  const lowHeight = Number(entity.metadata.lowHeightFt ?? 8);
  const highHeight = Number(entity.metadata.highHeightFt ?? 12);

  const xCenter = anchor?.x ?? entity.width / 2;
  const yCenter = anchor?.y ?? entity.height / 2;
  const inset = 1.2;
  const isCathedralVertical = ceilingType === "cathedral";
  const isCathedralHorizontal = ceilingType === "cathedral-horizontal";
  const isSlopedHorizontal = ceilingType === "sloped-horizontal";

  if (ceilingType === "standard") {
    const heightValueY = yCenter + 0.28;
    const heightTitleY = heightValueY - 0.86;
    const boxWidth = Math.max(3.4, Math.min(entity.width - 1, 5.2));
    const boxHeight = 1.86;
    const boxX = xCenter - boxWidth / 2;
    const boxY = heightTitleY - 0.72;
    return (
      <g className="ceiling-overlay" pointerEvents="none">
        <rect
          x={boxX}
          y={boxY}
          width={boxWidth}
          height={boxHeight}
          rx={0.2}
          className="ceiling-height-box"
        />
        <text x={xCenter} y={heightTitleY} textAnchor="middle" className="ceiling-caption">
          HEIGHT
        </text>
        <text x={xCenter} y={heightValueY} textAnchor="middle" className="ceiling-label">
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
  segmentIndex?: number;
  segmentAngleDeg?: number;
}

type GuideSegment =
  | { orientation: "h"; x1: number; x2: number; y: number; side: "top" | "bottom" }
  | { orientation: "v"; x: number; y1: number; y2: number; side: "left" | "right" };

interface RectangleGuideGroup {
  guides: GuideSegment[];
}

interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ConnectedEdgeSegment {
  orientation: "h" | "v";
  x1?: number;
  x2?: number;
  y?: number;
  x?: number;
  y1?: number;
  y2?: number;
}

interface EdgeRange {
  start: number;
  end: number;
}

interface ConnectedEdgeRanges {
  top: EdgeRange[];
  right: EdgeRange[];
  bottom: EdgeRange[];
  left: EdgeRange[];
}

interface ConnectedEdgeRenderRanges {
  carveById: Map<string, ConnectedEdgeRanges>;
  dashById: Map<string, ConnectedEdgeRanges>;
}

type ResizeHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

type PushDirection = "north" | "south" | "east" | "west";

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
  kind: "single" | "double";
  initialWidthFt: number;
  initialHeightFt: number;
  initialMirrored: boolean;
}

interface SlidingDoorModalState {
  entityId: string;
  initialWidthFt: number;
  initialHeightFt: number;
}

interface UtilityLabelModalState {
  entityId: string;
  initialText: string;
  initialColor: string;
}

interface BumpOutModalState {
  initialFlats: BumpOutFlats;
  initialLongEdgeFt: number;
}

type ResizeHintZone =
  | "rect-n"
  | "rect-s"
  | "rect-e"
  | "rect-w"
  | "rect-nw"
  | "rect-ne"
  | "rect-sw"
  | "rect-se"
  | "window-start"
  | "window-end";

interface ResizeHintState {
  entityId: string;
  zone: ResizeHintZone;
}

interface LongPressState {
  timer: ReturnType<typeof setTimeout> | null;
  pointerId: number | null;
  entityId: string | null;
  startScreen: Point;
  fired: boolean;
}

const DEFAULT_RECTANGLE_MODAL_VALUES: RectangleModalInitialValues = {
  label: "",
  widthFt: 12,
  heightFt: 12,
  color: "BLUE",
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
    case "green":
      return "#00ff6a";
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
  const capSize = 0.46;

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
              <line x1={segment.x1} y1={lineAxis - capSize} x2={segment.x1} y2={lineAxis + capSize} stroke={markerColor} strokeWidth={markerStrokeWidth} />
              <line x1={segment.x2} y1={lineAxis - capSize} x2={segment.x2} y2={lineAxis + capSize} stroke={markerColor} strokeWidth={markerStrokeWidth} />
              <text x={labelX} y={labelY} className="dim-label" textAnchor="middle" dominantBaseline="middle">
                {fmtFeet(segment.x2 - segment.x1)}
              </text>
            </g>
          );
        }

        return (
          <g key={`gv-${index}-${segment.x}-${segment.y1}-${segment.y2}`}>
            <line x1={lineAxis} y1={segment.y1} x2={lineAxis} y2={segment.y2} stroke={markerColor} strokeWidth={markerStrokeWidth} />
            <line x1={lineAxis - capSize} y1={segment.y1} x2={lineAxis + capSize} y2={segment.y1} stroke={markerColor} strokeWidth={markerStrokeWidth} />
            <line x1={lineAxis - capSize} y1={segment.y2} x2={lineAxis + capSize} y2={segment.y2} stroke={markerColor} strokeWidth={markerStrokeWidth} />
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
  const markerColor = LINEAR_MARKER_COLOR;
  const capSize = 0.42;

  return (
    <g className="rect-guides" pointerEvents="none">
      <line x1={x1} y1={y2 + hOffset} x2={x2} y2={y2 + hOffset} stroke={markerColor} strokeWidth={markerStrokeWidth} />
      <line x1={x1} y1={y2 + hOffset - capSize} x2={x1} y2={y2 + hOffset + capSize} stroke={markerColor} strokeWidth={markerStrokeWidth} />
      <line x1={x2} y1={y2 + hOffset - capSize} x2={x2} y2={y2 + hOffset + capSize} stroke={markerColor} strokeWidth={markerStrokeWidth} />
      <text x={midX} y={y2 + hOffset + 0.8} className="dim-label" textAnchor="middle">
        {fmtFeet(rect.width)}
      </text>

      <line x1={x1 - vOffset} y1={y1} x2={x1 - vOffset} y2={y2} stroke={markerColor} strokeWidth={markerStrokeWidth} />
      <line x1={x1 - vOffset - capSize} y1={y1} x2={x1 - vOffset + capSize} y2={y1} stroke={markerColor} strokeWidth={markerStrokeWidth} />
      <line x1={x1 - vOffset - capSize} y1={y2} x2={x1 - vOffset + capSize} y2={y2} stroke={markerColor} strokeWidth={markerStrokeWidth} />
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

function RectangleDragSizeCue({ rect }: { rect: RectBounds }) {
  const width = Math.max(1, Math.round(Math.abs(rect.width)));
  const height = Math.max(1, Math.round(Math.abs(rect.height)));
  const centerX = rect.x + width / 2;
  const centerY = rect.y + height / 2;
  const minSide = Math.max(1, Math.min(width, height));
  const fontSize = clampValue(minSide * 0.42, 0.95, 5.4);

  return (
    <g pointerEvents="none" className="rect-drag-size-cue">
      <text
        x={centerX}
        y={centerY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={LINEAR_MARKER_COLOR}
        fontSize={fontSize}
        fontWeight={900}
        style={{ fontSize: `${fontSize}px` }}
      >
        {`${fmtFeet(width)} x ${fmtFeet(height)}`}
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

function rangesOverlapStrict(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.min(endA, endB) > Math.max(startA, startB);
}

function areRectanglesEdgeConnected(a: RectBounds, b: RectBounds): boolean {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;

  const verticalTouch =
    (nearlyEqualEdge(aRight, b.x) || nearlyEqualEdge(bRight, a.x)) &&
    rangesOverlapStrict(a.y, aBottom, b.y, bBottom);
  if (verticalTouch) {
    return true;
  }

  const horizontalTouch =
    (nearlyEqualEdge(aBottom, b.y) || nearlyEqualEdge(bBottom, a.y)) &&
    rangesOverlapStrict(a.x, aRight, b.x, bRight);
  return horizontalTouch;
}

function isRectangleConnectedToAny(
  rect: RectBounds,
  rectangles: MapEntity[],
  excludeRectId?: string,
): boolean {
  for (const rectangle of rectangles) {
    if (rectangle.type !== "rectangle" || rectangle.id === excludeRectId) {
      continue;
    }
    if (areRectanglesEdgeConnected(rect, rectBoundsFromEntity(rectangle))) {
      return true;
    }
  }
  return false;
}

function snapRectTranslationToNearbyEdges(
  rect: RectBounds,
  rectangles: MapEntity[],
  threshold: number,
  excludeRectId?: string,
): RectBounds {
  const xCandidates: number[] = [];
  const yCandidates: number[] = [];

  for (const rectangle of rectangles) {
    if (rectangle.id === excludeRectId || rectangle.type !== "rectangle") {
      continue;
    }
    const other = rectBoundsFromEntity(rectangle);
    xCandidates.push(other.x, other.x + other.width);
    yCandidates.push(other.y, other.y + other.height);
  }

  let bestDx = 0;
  let bestDxDistance = Number.POSITIVE_INFINITY;
  for (const ownX of [rect.x, rect.x + rect.width]) {
    for (const targetX of xCandidates) {
      const dx = targetX - ownX;
      const distance = Math.abs(dx);
      if (distance <= threshold && distance < bestDxDistance) {
        bestDx = dx;
        bestDxDistance = distance;
      }
    }
  }

  let bestDy = 0;
  let bestDyDistance = Number.POSITIVE_INFINITY;
  for (const ownY of [rect.y, rect.y + rect.height]) {
    for (const targetY of yCandidates) {
      const dy = targetY - ownY;
      const distance = Math.abs(dy);
      if (distance <= threshold && distance < bestDyDistance) {
        bestDy = dy;
        bestDyDistance = distance;
      }
    }
  }

  return {
    x: rect.x + bestDx,
    y: rect.y + bestDy,
    width: rect.width,
    height: rect.height,
  };
}

function snapRectResizeToNearbyEdges(
  rect: RectBounds,
  handle: ResizeHandle,
  rectangles: MapEntity[],
  threshold: number,
  excludeRectId?: string,
): RectBounds {
  const xCandidates: number[] = [];
  const yCandidates: number[] = [];

  for (const rectangle of rectangles) {
    if (rectangle.id === excludeRectId || rectangle.type !== "rectangle") {
      continue;
    }
    const other = rectBoundsFromEntity(rectangle);
    xCandidates.push(other.x, other.x + other.width);
    yCandidates.push(other.y, other.y + other.height);
  }

  const bestSnap = (value: number, candidates: number[]): number => {
    let bestValue = value;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const distance = Math.abs(candidate - value);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestValue = candidate;
      }
    }
    return bestValue;
  };

  let x1 = rect.x;
  let y1 = rect.y;
  let x2 = rect.x + rect.width;
  let y2 = rect.y + rect.height;

  const moveWest = handle === "w" || handle === "nw" || handle === "sw";
  const moveEast = handle === "e" || handle === "ne" || handle === "se";
  const moveNorth = handle === "n" || handle === "nw" || handle === "ne";
  const moveSouth = handle === "s" || handle === "sw" || handle === "se";

  if (moveWest && !moveEast) {
    x1 = bestSnap(x1, xCandidates);
  }
  if (moveEast && !moveWest) {
    x2 = bestSnap(x2, xCandidates);
  }
  if (moveNorth && !moveSouth) {
    y1 = bestSnap(y1, yCandidates);
  }
  if (moveSouth && !moveNorth) {
    y2 = bestSnap(y2, yCandidates);
  }

  if (x2 < x1 + 1) {
    if (moveWest && !moveEast) {
      x1 = x2 - 1;
    } else {
      x2 = x1 + 1;
    }
  }
  if (y2 < y1 + 1) {
    if (moveNorth && !moveSouth) {
      y1 = y2 - 1;
    } else {
      y2 = y1 + 1;
    }
  }

  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

function quantizeEdgeCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function nearlyEqualEdge(a: number, b: number): boolean {
  return Math.abs(a - b) <= EDGE_MATCH_EPSILON;
}

function rectBoundsForConnectedEdgeMath(entity: MapEntity): RectBounds {
  const rect = rectBoundsFromEntity(entity);
  return {
    x: quantizeEdgeCoord(rect.x),
    y: quantizeEdgeCoord(rect.y),
    width: quantizeEdgeCoord(rect.width),
    height: quantizeEdgeCoord(rect.height),
  };
}

function isUnconditionedRectangle(entity: MapEntity): boolean {
  return entity.type === "rectangle" && Boolean(entity.metadata.unconditioned);
}

function containsPoint(rect: RectBounds, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function getCellsOutsideDuplicateConditionedBaseline(
  rect: RectBounds,
  baseline: Array<{ x: number; y: number; width: number; height: number }>,
): RectBounds[] {
  const minX = Math.floor(rect.x);
  const minY = Math.floor(rect.y);
  const maxX = Math.ceil(rect.x + rect.width);
  const maxY = Math.ceil(rect.y + rect.height);
  const cells: RectBounds[] = [];

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const centerX = x + 0.5;
      const centerY = y + 0.5;
      if (!containsPoint(rect, centerX, centerY)) {
        continue;
      }

      const coveredByBaseline = baseline.some((baselineRect) => containsPoint(baselineRect, centerX, centerY));
      if (!coveredByBaseline) {
        cells.push({ x, y, width: 1, height: 1 });
      }
    }
  }

  return cells;
}

interface OverflowOutlineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface OverflowOutlinePoint {
  x: number;
  y: number;
}

interface DuplicateOverflowRegion {
  cells: RectBounds[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  outline: OverflowOutlineSegment[];
}

function buildOverflowOutlineLoops(outline: OverflowOutlineSegment[]): OverflowOutlinePoint[][] {
  if (outline.length === 0) {
    return [];
  }

  const keyFor = (x: number, y: number) => `${x},${y}`;
  const parsePoint = (key: string): OverflowOutlinePoint => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  };
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const adjacency = new Map<string, Set<string>>();
  const unusedEdges = new Set<string>();

  for (const segment of outline) {
    const a = keyFor(segment.x1, segment.y1);
    const b = keyFor(segment.x2, segment.y2);
    if (!adjacency.has(a)) {
      adjacency.set(a, new Set());
    }
    if (!adjacency.has(b)) {
      adjacency.set(b, new Set());
    }
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
    unusedEdges.add(edgeKey(a, b));
  }

  const loops: OverflowOutlinePoint[][] = [];

  while (unusedEdges.size > 0) {
    const firstEdge = unusedEdges.values().next().value as string;
    const [startKey, nextKey] = firstEdge.split("|");
    unusedEdges.delete(firstEdge);

    const loopKeys = [startKey, nextKey];
    let previousKey = startKey;
    let currentKey = nextKey;

    while (currentKey !== startKey) {
      const neighbors = [...(adjacency.get(currentKey) ?? [])];
      const candidate = neighbors.find((neighbor) => {
        if (neighbor === previousKey) {
          return false;
        }
        return unusedEdges.has(edgeKey(currentKey, neighbor));
      });

      if (!candidate) {
        break;
      }

      unusedEdges.delete(edgeKey(currentKey, candidate));
      loopKeys.push(candidate);
      previousKey = currentKey;
      currentKey = candidate;
    }

    const points = loopKeys.map(parsePoint);
    loops.push(points);
  }

  return loops;
}

function buildDuplicateOverflowRegions(cells: RectBounds[]): DuplicateOverflowRegion[] {
  if (cells.length === 0) {
    return [];
  }

  const keyFor = (x: number, y: number) => `${x},${y}`;
  const byKey = new Map(cells.map((cell) => [keyFor(cell.x, cell.y), cell]));
  const visited = new Set<string>();
  const regions: DuplicateOverflowRegion[] = [];

  for (const cell of cells) {
    const startKey = keyFor(cell.x, cell.y);
    if (visited.has(startKey)) {
      continue;
    }

    const queue: RectBounds[] = [cell];
    const component: RectBounds[] = [];
    visited.add(startKey);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      component.push(current);

      const neighbors = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ];

      for (const neighbor of neighbors) {
        const key = keyFor(neighbor.x, neighbor.y);
        if (visited.has(key)) {
          continue;
        }
        const next = byKey.get(key);
        if (!next) {
          continue;
        }
        visited.add(key);
        queue.push(next);
      }
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const part of component) {
      minX = Math.min(minX, part.x);
      minY = Math.min(minY, part.y);
      maxX = Math.max(maxX, part.x + part.width);
      maxY = Math.max(maxY, part.y + part.height);
    }

    const componentSet = new Set(component.map((part) => keyFor(part.x, part.y)));
    const outline: OverflowOutlineSegment[] = [];
    for (const part of component) {
      const x = part.x;
      const y = part.y;

      if (!componentSet.has(keyFor(x, y - 1))) {
        outline.push({ x1: x, y1: y, x2: x + 1, y2: y });
      }
      if (!componentSet.has(keyFor(x + 1, y))) {
        outline.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
      }
      if (!componentSet.has(keyFor(x, y + 1))) {
        outline.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 });
      }
      if (!componentSet.has(keyFor(x - 1, y))) {
        outline.push({ x1: x, y1: y, x2: x, y2: y + 1 });
      }
    }

    regions.push({
      cells: component,
      minX,
      minY,
      maxX,
      maxY,
      outline,
    });
  }

  return regions;
}

function getRectangleCeilingSignature(entity: MapEntity): string {
  const ceilingType = String(entity.metadata.ceilingType ?? "standard");
  const standardHeight = Number(entity.metadata.standardHeightFt ?? 8);
  const lowHeight = Number(entity.metadata.lowHeightFt ?? 8);
  const highHeight = Number(entity.metadata.highHeightFt ?? 12);
  return `${ceilingType}|${standardHeight}|${lowHeight}|${highHeight}`;
}

function getSharedEdgeSegmentsBetweenRects(a: RectBounds, b: RectBounds): ConnectedEdgeSegment[] {
  const segments: ConnectedEdgeSegment[] = [];
  const aRight = quantizeEdgeCoord(a.x + a.width);
  const bRight = quantizeEdgeCoord(b.x + b.width);
  const aBottom = quantizeEdgeCoord(a.y + a.height);
  const bBottom = quantizeEdgeCoord(b.y + b.height);

  if (nearlyEqualEdge(aRight, b.x) || nearlyEqualEdge(bRight, a.x)) {
    const y1 = Math.max(a.y, b.y);
    const y2 = Math.min(aBottom, bBottom);
    if (y2 - y1 > EDGE_MATCH_EPSILON) {
      const x = nearlyEqualEdge(aRight, b.x) ? quantizeEdgeCoord((aRight + b.x) / 2) : quantizeEdgeCoord((bRight + a.x) / 2);
      segments.push({ orientation: "v", x, y1, y2 });
    }
  }

  if (nearlyEqualEdge(aBottom, b.y) || nearlyEqualEdge(bBottom, a.y)) {
    const x1 = Math.max(a.x, b.x);
    const x2 = Math.min(aRight, bRight);
    if (x2 - x1 > EDGE_MATCH_EPSILON) {
      const y = nearlyEqualEdge(aBottom, b.y) ? quantizeEdgeCoord((aBottom + b.y) / 2) : quantizeEdgeCoord((bBottom + a.y) / 2);
      segments.push({ orientation: "h", x1, x2, y });
    }
  }

  return segments;
}

function mergeEdgeRanges(ranges: EdgeRange[]): EdgeRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges]
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.length === 0) {
    return [];
  }

  const merged: EdgeRange[] = [{ ...sorted[0] }];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function getAlignedDashOffset(start: number): number {
  const dashCycle = 0.8; // Matches strokeDasharray="0.5 0.3"
  const normalizedStart = ((start % dashCycle) + dashCycle) % dashCycle;
  return -normalizedStart;
}

function buildConditionedConnectedEdgeRanges(rectangles: MapEntity[]): ConnectedEdgeRenderRanges {
  const conditioned = rectangles.filter((entity) => !isUnconditionedRectangle(entity));
  const boundsById = new Map(conditioned.map((entity) => [entity.id, rectBoundsForConnectedEdgeMath(entity)]));
  const carveById = new Map<string, ConnectedEdgeRanges>(
    conditioned.map((entity) => [
      entity.id,
      { top: [], right: [], bottom: [], left: [] },
    ]),
  );
  const dashById = new Map<string, ConnectedEdgeRanges>(
    conditioned.map((entity) => [
      entity.id,
      { top: [], right: [], bottom: [], left: [] },
    ]),
  );

  const addSegmentToRanges = (rect: RectBounds, ranges: ConnectedEdgeRanges, segment: ConnectedEdgeSegment) => {
    if (segment.orientation === "h") {
      const y = segment.y as number;
      const start = segment.x1 as number;
      const end = segment.x2 as number;
      if (nearlyEqualEdge(y, rect.y)) {
        ranges.top.push({ start, end });
      }
      if (nearlyEqualEdge(y, rect.y + rect.height)) {
        ranges.bottom.push({ start, end });
      }
      return;
    }

    const x = segment.x as number;
    const start = segment.y1 as number;
    const end = segment.y2 as number;
    if (nearlyEqualEdge(x, rect.x)) {
      ranges.left.push({ start, end });
    }
    if (nearlyEqualEdge(x, rect.x + rect.width)) {
      ranges.right.push({ start, end });
    }
  };

  for (let i = 0; i < conditioned.length; i += 1) {
    const a = conditioned[i];
    const aRect = boundsById.get(a.id);
    if (!aRect) {
      continue;
    }
    for (let j = i + 1; j < conditioned.length; j += 1) {
      const b = conditioned[j];
      const bRect = boundsById.get(b.id);
      if (!bRect) {
        continue;
      }

      const shared = getSharedEdgeSegmentsBetweenRects(aRect, bRect);
      if (shared.length === 0) {
        continue;
      }

      const aCarveRanges = carveById.get(a.id);
      const bCarveRanges = carveById.get(b.id);
      const aDashRanges = dashById.get(a.id);
      const bDashRanges = dashById.get(b.id);
      if (!aCarveRanges || !bCarveRanges || !aDashRanges || !bDashRanges) {
        continue;
      }

      const ownerIsA = a.id < b.id;
      const ownerRect = ownerIsA ? aRect : bRect;
      const ownerDashRanges = ownerIsA ? aDashRanges : bDashRanges;

      for (const segment of shared) {
        addSegmentToRanges(aRect, aCarveRanges, segment);
        addSegmentToRanges(bRect, bCarveRanges, segment);
        addSegmentToRanges(ownerRect, ownerDashRanges, segment);
      }
    }
  }

  for (const [id, ranges] of carveById) {
    carveById.set(id, {
      top: mergeEdgeRanges(ranges.top),
      right: mergeEdgeRanges(ranges.right),
      bottom: mergeEdgeRanges(ranges.bottom),
      left: mergeEdgeRanges(ranges.left),
    });
  }

  for (const [id, ranges] of dashById) {
    dashById.set(id, {
      top: mergeEdgeRanges(ranges.top),
      right: mergeEdgeRanges(ranges.right),
      bottom: mergeEdgeRanges(ranges.bottom),
      left: mergeEdgeRanges(ranges.left),
    });
  }

  return { carveById, dashById };
}

function buildSharedCeilingOverlayPlacement(rectangles: MapEntity[]): {
  visibleIds: Set<string>;
  anchorById: Map<string, Point>;
} {
  const visibleIds = new Set<string>();
  const anchorById = new Map<string, Point>();

  const conditioned = rectangles.filter((entity) => !isUnconditionedRectangle(entity));
  const adjacency = new Map<string, Set<string>>();

  for (const entity of conditioned) {
    adjacency.set(entity.id, new Set());
  }

  for (let i = 0; i < conditioned.length; i += 1) {
    const aEntity = conditioned[i];
    const aRect = rectBoundsFromEntity(aEntity);
    for (let j = i + 1; j < conditioned.length; j += 1) {
      const bEntity = conditioned[j];
      if (getRectangleCeilingSignature(aEntity) !== getRectangleCeilingSignature(bEntity)) {
        continue;
      }
      const bRect = rectBoundsFromEntity(bEntity);
      const shared = getSharedEdgeSegmentsBetweenRects(aRect, bRect);
      if (shared.length === 0) {
        continue;
      }
      adjacency.get(aEntity.id)?.add(bEntity.id);
      adjacency.get(bEntity.id)?.add(aEntity.id);
    }
  }

  const visited = new Set<string>();
  for (const entity of conditioned) {
    if (visited.has(entity.id)) {
      continue;
    }
    const queue = [entity.id];
    const component: string[] = [];
    visited.add(entity.id);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (component.length === 0) {
      continue;
    }

    const componentEntities = component
      .map((id) => conditioned.find((entity) => entity.id === id))
      .filter((entity): entity is MapEntity => Boolean(entity));

    if (componentEntities.length === 0) {
      continue;
    }

    const host = componentEntities.reduce((best, current) => {
      const bestArea = Math.abs(best.width) * Math.abs(best.height);
      const currentArea = Math.abs(current.width) * Math.abs(current.height);
      return currentArea > bestArea ? current : best;
    }, componentEntities[0]);

    visibleIds.add(host.id);
  }

  for (const entity of rectangles) {
    if (!isUnconditionedRectangle(entity)) {
      continue;
    }
    visibleIds.add(entity.id);
  }

  for (const id of [...visibleIds]) {
    if (!rectangles.some((entity) => entity.id === id)) {
      visibleIds.delete(id);
      anchorById.delete(id);
    }
  }

  return { visibleIds, anchorById };
}

function expandBounds(bounds: WorldBounds | null, candidate: WorldBounds): WorldBounds {
  if (!bounds) {
    return candidate;
  }
  return {
    minX: Math.min(bounds.minX, candidate.minX),
    minY: Math.min(bounds.minY, candidate.minY),
    maxX: Math.max(bounds.maxX, candidate.maxX),
    maxY: Math.max(bounds.maxY, candidate.maxY),
  };
}

function getEntityWorldBounds(entity: MapEntity): WorldBounds | null {
  if (entity.type === "rectangle") {
    const rect = rectBoundsFromEntity(entity);
    return {
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.width,
      maxY: rect.y + rect.height,
    };
  }

  if (entity.type === "line") {
    return {
      minX: Math.min(entity.x, entity.x + entity.width),
      minY: Math.min(entity.y, entity.y + entity.height),
      maxX: Math.max(entity.x, entity.x + entity.width),
      maxY: Math.max(entity.y, entity.y + entity.height),
    };
  }

  if (entity.type === "window" || entity.type === "door") {
    const half = Math.max(0.5, Math.abs(entity.width) / 2);
    return {
      minX: entity.x - half,
      minY: entity.y - half,
      maxX: entity.x + half,
      maxY: entity.y + half,
    };
  }

  if (entity.type === "skylight" || isUtilityEntityType(entity.type)) {
    const halfWidth = Math.max(0.5, Math.abs(entity.width) / 2);
    const halfHeight = Math.max(0.5, Math.abs(entity.height) / 2);
    return {
      minX: entity.x - halfWidth,
      minY: entity.y - halfHeight,
      maxX: entity.x + halfWidth,
      maxY: entity.y + halfHeight,
    };
  }

  return {
    minX: entity.x,
    minY: entity.y,
    maxX: entity.x,
    maxY: entity.y,
  };
}

function getGuideWorldBounds(groups: RectangleGuideGroup[]): WorldBounds | null {
  let bounds: WorldBounds | null = null;
  const hOffset = 4.5;
  const vOffset = 4.5;
  const staggerStep = 1.8;
  const estimatedMaxShift = 2;
  const markerReach = hOffset + estimatedMaxShift * staggerStep;
  const edgeLabelPad = 1.1;

  for (const group of groups) {
    for (const guide of group.guides) {
      if (guide.orientation === "h") {
        const guideY = guide.side === "top" ? guide.y - markerReach : guide.y + markerReach;
        bounds = expandBounds(bounds, {
          minX: Math.min(guide.x1, guide.x2) - edgeLabelPad,
          maxX: Math.max(guide.x1, guide.x2) + edgeLabelPad,
          minY: guideY - edgeLabelPad,
          maxY: guideY + edgeLabelPad,
        });
      } else {
        const guideX = guide.side === "left" ? guide.x - (vOffset + estimatedMaxShift * staggerStep) : guide.x + (vOffset + estimatedMaxShift * staggerStep);
        bounds = expandBounds(bounds, {
          minX: guideX - edgeLabelPad,
          maxX: guideX + edgeLabelPad,
          minY: Math.min(guide.y1, guide.y2) - edgeLabelPad,
          maxY: Math.max(guide.y1, guide.y2) + edgeLabelPad,
        });
      }
    }
  }

  return bounds;
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

function snapRectangleStartToNearbyEdge(point: Point, rectangles: MapEntity[]): Point {
  const nearest = nearestRectangleEdge(point, rectangles);
  if (!nearest || nearest.distance > RECT_DRAW_START_EDGE_SNAP_THRESHOLD) {
    return point;
  }
  return {
    x: Math.round(nearest.x),
    y: Math.round(nearest.y),
  };
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
  const bumpOutSegment = getHostBumpOutSegment(entity, rectangles);
  if (bumpOutSegment && bumpOutSegment.length > Number.EPSILON) {
    const dx = bumpOutSegment.end.x - bumpOutSegment.start.x;
    const dy = bumpOutSegment.end.y - bumpOutSegment.start.y;
    const rawT =
      ((world.x - bumpOutSegment.start.x) * dx +
        (world.y - bumpOutSegment.start.y) * dy) /
      (bumpOutSegment.length * bumpOutSegment.length);
    const half = Math.max(0.5, Math.round(Math.abs(entity.width)) / 2);
    const tPad = half / bumpOutSegment.length;
    const t = tPad <= 0.5 ? clampValue(rawT, tPad, 1 - tPad) : 0.5;
    return {
      x: bumpOutSegment.start.x + dx * t,
      y: bumpOutSegment.start.y + dy * t,
    };
  }

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
  const bumpOutSegment = getHostBumpOutSegment(entity, rectangles);
  if (bumpOutSegment && bumpOutSegment.length > Number.EPSILON) {
    const projected = nearestPointOnSegment(world, bumpOutSegment.start, bumpOutSegment.end);
    return {
      x: projected.point.x,
      y: projected.point.y,
    };
  }

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

function lockSkylightCenterToHostRect(world: Point, entity: MapEntity, rectangles: MapEntity[]): Point {
  const hostRect = getHostRectForEntity(entity, rectangles);
  if (!hostRect) {
    return {
      x: Math.round(world.x),
      y: Math.round(world.y),
    };
  }

  const halfWidth = Math.abs(entity.width) / 2;
  const halfHeight = Math.abs(entity.height) / 2;
  const minX = hostRect.x + halfWidth;
  const maxX = hostRect.x + hostRect.width - halfWidth;
  const minY = hostRect.y + halfHeight;
  const maxY = hostRect.y + hostRect.height - halfHeight;

  return {
    x: minX <= maxX ? clampValue(Math.round(world.x), minX, maxX) : Math.round(hostRect.x + hostRect.width / 2),
    y: minY <= maxY ? clampValue(Math.round(world.y), minY, maxY) : Math.round(hostRect.y + hostRect.height / 2),
  };
}

interface OpeningSpan {
  start: number;
  end: number;
}

function getOpeningSpansForEdge(
  entities: MapEntity[],
  hostRectId: string,
  edge: RectEdge,
  excludeEntityId?: string,
): OpeningSpan[] {
  const horizontal = edge === "top" || edge === "bottom";

  return entities
    .filter((entity) => {
      if (entity.id === excludeEntityId) {
        return false;
      }
      if (entity.type !== "door" && entity.type !== "window") {
        return false;
      }
      return entity.metadata.hostRectId === hostRectId && entity.metadata.edge === edge;
    })
    .map((entity) => {
      const axis = horizontal ? entity.x : entity.y;
      const half = Math.abs(entity.width) / 2;
      return {
        start: axis - half,
        end: axis + half,
      };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function resolveAxisWithoutOverlap(
  desiredAxis: number,
  axisMin: number,
  axisMax: number,
  halfWidth: number,
  blockers: OpeningSpan[],
): number | null {
  if (axisMin > axisMax) {
    return null;
  }

  const forbidden = blockers
    .map((block) => ({
      start: Math.max(axisMin, block.start - halfWidth),
      end: Math.min(axisMax, block.end + halfWidth),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of forbidden) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start >= previous.end) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }

  const allowed: Array<{ start: number; end: number }> = [];
  let cursor = axisMin;
  for (const range of merged) {
    if (range.start >= cursor) {
      allowed.push({ start: cursor, end: range.start });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor <= axisMax) {
    allowed.push({ start: cursor, end: axisMax });
  }

  if (allowed.length === 0) {
    return null;
  }

  let bestAxis = allowed[0].start;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const range of allowed) {
    if (range.end < range.start) {
      continue;
    }
    const candidate = clampValue(desiredAxis, range.start, range.end);
    const distanceFromDesired = Math.abs(candidate - desiredAxis);
    if (distanceFromDesired < bestDistance) {
      bestDistance = distanceFromDesired;
      bestAxis = candidate;
    }
  }

  return bestAxis;
}

function resolveOpeningPositionWithoutOverlap(
  entity: MapEntity,
  desiredPosition: Point,
  entities: MapEntity[],
  rectangles: MapEntity[],
  excludeEntityId?: string,
): Point | null {
  const bumpOutSegment = getHostBumpOutSegment(entity, rectangles);
  if (bumpOutSegment && bumpOutSegment.length > Number.EPSILON) {
    const dx = bumpOutSegment.end.x - bumpOutSegment.start.x;
    const dy = bumpOutSegment.end.y - bumpOutSegment.start.y;
    const length = bumpOutSegment.length;
    const halfWidth = Math.abs(entity.width) / 2;
    const axisMin = halfWidth;
    const axisMax = length - halfWidth;
    const desiredAxis =
      ((desiredPosition.x - bumpOutSegment.start.x) * dx +
        (desiredPosition.y - bumpOutSegment.start.y) * dy) /
      length;

    const hostRectId = entity.metadata.hostRectId as string | undefined;
    const segmentIndex = Number(entity.metadata.bumpOutSegmentIndex);
    const blockers = entities
      .filter((candidate) => {
        if (candidate.id === excludeEntityId) {
          return false;
        }
        if (candidate.type !== "door" && candidate.type !== "window") {
          return false;
        }
        if (candidate.metadata.hostRectId !== hostRectId) {
          return false;
        }
        return Number(candidate.metadata.bumpOutSegmentIndex) === segmentIndex;
      })
      .map((candidate) => {
        const axis =
          ((candidate.x - bumpOutSegment.start.x) * dx +
            (candidate.y - bumpOutSegment.start.y) * dy) /
          length;
        const half = Math.abs(candidate.width) / 2;
        return {
          start: axis - half,
          end: axis + half,
        };
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const resolvedAxis = resolveAxisWithoutOverlap(desiredAxis, axisMin, axisMax, halfWidth, blockers);
    if (resolvedAxis === null) {
      return null;
    }

    const t = resolvedAxis / length;
    return {
      x: bumpOutSegment.start.x + dx * t,
      y: bumpOutSegment.start.y + dy * t,
    };
  }

  const edge = entity.metadata.edge as RectEdge | undefined;
  const hostRectId = entity.metadata.hostRectId as string | undefined;
  if (!edge || !hostRectId) {
    return desiredPosition;
  }

  const hostRect = getHostRectForEntity(entity, rectangles);
  if (!hostRect) {
    return desiredPosition;
  }

  const horizontal = edge === "top" || edge === "bottom";
  const halfWidth = Math.abs(entity.width) / 2;
  const axisMin = (horizontal ? hostRect.x : hostRect.y) + halfWidth;
  const axisMax = (horizontal ? hostRect.x + hostRect.width : hostRect.y + hostRect.height) - halfWidth;
  const desiredAxis = horizontal ? desiredPosition.x : desiredPosition.y;

  const blockers = getOpeningSpansForEdge(entities, hostRectId, edge, excludeEntityId);
  const resolvedAxis = resolveAxisWithoutOverlap(desiredAxis, axisMin, axisMax, halfWidth, blockers);
  if (resolvedAxis === null) {
    return null;
  }

  if (horizontal) {
    return {
      x: resolvedAxis,
      y: edge === "top" ? hostRect.y : hostRect.y + hostRect.height,
    };
  }

  return {
    x: edge === "left" ? hostRect.x : hostRect.x + hostRect.width,
    y: resolvedAxis,
  };
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

function resizeBumpOutWithHostLock(
  entity: MapEntity,
  sourceRect: RectBounds,
  hostRect: RectBounds,
  hostEdge: RectEdge,
  handle: ResizeHandle,
  world: Point,
): RectBounds {
  const connectedHandle = getConnectedLongEdgeHandleForHostEdge(hostEdge);
  if (handle.includes(connectedHandle)) {
    return sourceRect;
  }
  const flats = getBumpOutFlats(entity);
  const sizeLimits = getBumpOutStyleSizeLimits(flats);
  const tentative = applyRectResize(sourceRect, world, handle);
  const horizontal = hostEdge === "top" || hostEdge === "bottom";

  if (horizontal) {
    const hostMinX = hostRect.x;
    const hostMaxX = hostRect.x + hostRect.width;
    const minLong = Math.max(1, Math.min(sizeLimits.minLong, Math.floor(hostMaxX - hostMinX)));
    const x1 = clampValue(tentative.x, hostMinX, hostMaxX - minLong);
    const x2 = clampValue(tentative.x + tentative.width, x1 + minLong, hostMaxX);
    const width = Math.max(minLong, Math.round(x2 - x1));
    const baseY = hostEdge === "top" ? hostRect.y : hostRect.y + hostRect.height;
    const depth = hostEdge === "top"
      ? Math.max(sizeLimits.minDepth, Math.round(baseY - tentative.y))
      : Math.max(sizeLimits.minDepth, Math.round(tentative.y + tentative.height - baseY));
    return {
      x: Math.round(x1),
      y: hostEdge === "top" ? Math.round(baseY - depth) : Math.round(baseY),
      width,
      height: depth,
    };
  }

  const hostMinY = hostRect.y;
  const hostMaxY = hostRect.y + hostRect.height;
  const minLong = Math.max(1, Math.min(sizeLimits.minLong, Math.floor(hostMaxY - hostMinY)));
  const y1 = clampValue(tentative.y, hostMinY, hostMaxY - minLong);
  const y2 = clampValue(tentative.y + tentative.height, y1 + minLong, hostMaxY);
  const height = Math.max(minLong, Math.round(y2 - y1));
  const baseX = hostEdge === "left" ? hostRect.x : hostRect.x + hostRect.width;
  const depth = hostEdge === "left"
    ? Math.max(sizeLimits.minDepth, Math.round(baseX - tentative.x))
    : Math.max(sizeLimits.minDepth, Math.round(tentative.x + tentative.width - baseX));
  return {
    x: hostEdge === "left" ? Math.round(baseX - depth) : Math.round(baseX),
    y: Math.round(y1),
    width: depth,
    height,
  };
}

function updateBumpOutMetadataOnResize(
  entity: MapEntity,
  sourceRect: RectBounds,
  nextRect: RectBounds,
  handle: ResizeHandle,
): MapEntity["metadata"] {
  const flats = getBumpOutFlats(entity);
  if (flats !== 3 && flats !== 4 && flats !== 5 && flats !== 6) {
    return entity.metadata;
  }

  const hostEdge = (entity.metadata.hostEdge as RectEdge | undefined) ?? "top";
  const horizontal = hostEdge === "top" || hostEdge === "bottom";
  const sourceLong = horizontal ? sourceRect.width : sourceRect.height;
  const nextLong = horizontal ? nextRect.width : nextRect.height;
  const nextDepth = horizontal ? nextRect.height : nextRect.width;

  const rawRise = Number(entity.metadata.bumpOutRise);
  const rawCrown = Number(entity.metadata.bumpOutCrownWidth);
  const defaultCrown = flats === 3 ? Math.round(sourceLong * 0.56) : flats === 5 ? Math.round(sourceLong * 0.34) : 0;
  let crownWidth = Number.isFinite(rawCrown) ? Math.round(rawCrown) : defaultCrown;
  let rise = Number.isFinite(rawRise) ? Math.round(rawRise) : nextDepth;

  const affectsLongStart = horizontal ? handle.includes("w") : handle.includes("n");
  const affectsLongEnd = horizontal ? handle.includes("e") : handle.includes("s");
  const affectsLong = affectsLongStart || affectsLongEnd;
  const affectsDepth =
    (horizontal && (hostEdge === "top" ? handle.includes("n") : handle.includes("s"))) ||
    (!horizontal && (hostEdge === "left" ? handle.includes("w") : handle.includes("e")));

  if (affectsDepth) {
    rise = nextDepth;
  }

  if (affectsLong && (flats === 3 || flats === 5)) {
    const deltaLong = nextLong - sourceLong;
    crownWidth += deltaLong;
  }

  const sideSegments = flats === 3 || flats === 5 ? (flats - 1) / 2 : 0;
  const maxCrown = Math.max(1, nextLong - sideSegments * 2);
  crownWidth = clampValue(crownWidth, 1, maxCrown);
  const maxInset = Math.max(1, Math.floor(nextLong / 2) - 1);
  const inset = clampValue(Math.round((nextLong - crownWidth) / 2), 1, maxInset);
  rise = clampValue(rise, 1, nextDepth);

  return {
    ...entity.metadata,
    bumpOutCornerInset: inset,
    bumpOutRise: rise,
    bumpOutCrownWidth: flats === 3 || flats === 5 ? crownWidth : undefined,
  };
}

function findRectangleContainingPoint(point: Point, rectangles: MapEntity[]): MapEntity | null {
  for (let index = rectangles.length - 1; index >= 0; index -= 1) {
    const rectangle = rectangles[index];
    const bounds = rectBoundsFromEntity(rectangle);
    if (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    ) {
      return rectangle;
    }
  }
  return null;
}

function isSkylightInsideRectangle(skylight: MapEntity, rectangle: MapEntity): boolean {
  if (skylight.type !== "skylight") {
    return false;
  }
  const bounds = rectBoundsFromEntity(rectangle);
  const halfWidth = Math.abs(skylight.width) / 2;
  const halfHeight = Math.abs(skylight.height) / 2;
  const left = skylight.x - halfWidth;
  const right = skylight.x + halfWidth;
  const top = skylight.y - halfHeight;
  const bottom = skylight.y + halfHeight;

  return (
    left >= bounds.x &&
    right <= bounds.x + bounds.width &&
    top >= bounds.y &&
    bottom <= bounds.y + bounds.height
  );
}

function clampRectResizeToAttachedOpenings(
  sourceRect: RectBounds,
  nextRect: RectBounds,
  rectId: string,
  handle: ResizeHandle,
  entities: MapEntity[],
): RectBounds {
  const attached = entities.filter(
    (entity) =>
      (entity.type === "door" || entity.type === "window") &&
      entity.metadata.hostRectId === rectId,
  );
  if (attached.length === 0) {
    return nextRect;
  }

  const moveWest = handle === "w" || handle === "nw" || handle === "sw";
  const moveEast = handle === "e" || handle === "ne" || handle === "se";
  const moveNorth = handle === "n" || handle === "nw" || handle === "ne";
  const moveSouth = handle === "s" || handle === "sw" || handle === "se";

  const sourceX1 = sourceRect.x;
  const sourceY1 = sourceRect.y;
  const sourceX2 = sourceRect.x + sourceRect.width;
  const sourceY2 = sourceRect.y + sourceRect.height;

  const nextX1 = nextRect.x;
  const nextY1 = nextRect.y;
  const nextX2 = nextRect.x + nextRect.width;
  const nextY2 = nextRect.y + nextRect.height;

  const shrinkWest = moveWest && nextX1 > sourceX1;
  const shrinkEast = moveEast && nextX2 < sourceX2;
  const shrinkNorth = moveNorth && nextY1 > sourceY1;
  const shrinkSouth = moveSouth && nextY2 < sourceY2;

  const westLimits: number[] = [];
  const eastLimits: number[] = [];
  const northLimits: number[] = [];
  const southLimits: number[] = [];

  for (const entity of attached) {
    const edge = (entity.metadata.edge as RectEdge | undefined) ?? "top";
    const half = Math.abs(entity.width) / 2;

    if ((shrinkWest || shrinkEast) && (edge === "top" || edge === "bottom")) {
      westLimits.push(entity.x - half);
      eastLimits.push(entity.x + half);
    }

    if ((shrinkNorth || shrinkSouth) && (edge === "left" || edge === "right")) {
      northLimits.push(entity.y - half);
      southLimits.push(entity.y + half);
    }
  }

  let x1 = nextRect.x;
  let y1 = nextRect.y;
  let x2 = nextRect.x + nextRect.width;
  let y2 = nextRect.y + nextRect.height;

  if (shrinkWest && westLimits.length > 0) {
    x1 = Math.min(x1, Math.min(...westLimits));
  }
  if (shrinkEast && eastLimits.length > 0) {
    x2 = Math.max(x2, Math.max(...eastLimits));
  }
  if (shrinkNorth && northLimits.length > 0) {
    y1 = Math.min(y1, Math.min(...northLimits));
  }
  if (shrinkSouth && southLimits.length > 0) {
    y2 = Math.max(y2, Math.max(...southLimits));
  }

  if (x2 < x1 + 1) {
    if (moveWest && !moveEast) {
      x1 = x2 - 1;
    } else {
      x2 = x1 + 1;
    }
  }
  if (y2 < y1 + 1) {
    if (moveNorth && !moveSouth) {
      y1 = y2 - 1;
    } else {
      y2 = y1 + 1;
    }
  }

  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.min(endA, endB) > Math.max(startA, startB);
}

function isConnectedOnPushFace(source: RectBounds, target: RectBounds, direction: PushDirection): boolean {
  if (direction === "east") {
    return (
      target.x === source.x + source.width &&
      rangesOverlap(source.y, source.y + source.height, target.y, target.y + target.height)
    );
  }
  if (direction === "west") {
    return (
      target.x + target.width === source.x &&
      rangesOverlap(source.y, source.y + source.height, target.y, target.y + target.height)
    );
  }
  if (direction === "south") {
    return (
      target.y === source.y + source.height &&
      rangesOverlap(source.x, source.x + source.width, target.x, target.x + target.width)
    );
  }
  return (
    target.y + target.height === source.y &&
    rangesOverlap(source.x, source.x + source.width, target.x, target.x + target.width)
  );
}

function getConnectedPushForRectangleResize(
  sourceEntity: MapEntity,
  nextRect: RectBounds,
  handle: ResizeHandle,
  entities: MapEntity[],
): Array<{ id: string; x: number; y: number }> {
  if (sourceEntity.type !== "rectangle") {
    return [];
  }

  const sourceRect = rectBoundsFromEntity(sourceEntity);

  let direction: PushDirection | null = null;
  let edgeDelta = 0;

  if (handle === "e") {
    edgeDelta = nextRect.x + nextRect.width - (sourceRect.x + sourceRect.width);
    if (edgeDelta !== 0) {
      direction = "east";
    }
  } else if (handle === "w") {
    edgeDelta = nextRect.x - sourceRect.x;
    if (edgeDelta !== 0) {
      direction = "west";
    }
  } else if (handle === "s") {
    edgeDelta = nextRect.y + nextRect.height - (sourceRect.y + sourceRect.height);
    if (edgeDelta !== 0) {
      direction = "south";
    }
  } else if (handle === "n") {
    edgeDelta = nextRect.y - sourceRect.y;
    if (edgeDelta !== 0) {
      direction = "north";
    }
  }

  if (!direction || edgeDelta === 0) {
    return [];
  }

  const rectangles = entities.filter((entity) => entity.type === "rectangle" && entity.id !== sourceEntity.id);
  const rectById = new Map(
    rectangles.map((entity) => [
      entity.id,
      {
        entity,
        rect: rectBoundsFromEntity(entity),
      },
    ]),
  );

  const queue: string[] = [];
  const moved = new Set<string>();

  for (const { entity, rect } of rectById.values()) {
    if (isConnectedOnPushFace(sourceRect, rect, direction)) {
      queue.push(entity.id);
      moved.add(entity.id);
    }
  }

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) {
      continue;
    }
    const current = rectById.get(currentId);
    if (!current) {
      continue;
    }

    for (const { entity, rect } of rectById.values()) {
      if (moved.has(entity.id)) {
        continue;
      }
      if (isConnectedOnPushFace(current.rect, rect, direction)) {
        moved.add(entity.id);
        queue.push(entity.id);
      }
    }
  }

  return [...moved]
    .map((id) => rectById.get(id)?.entity)
    .filter((entity): entity is MapEntity => Boolean(entity))
    .map((entity) => ({
      id: entity.id,
      x: direction === "east" || direction === "west" ? entity.x + edgeDelta : entity.x,
      y: direction === "north" || direction === "south" ? entity.y + edgeDelta : entity.y,
    }));
}

function getDragThresholdPx(pointerType: string | undefined): number {
  if (pointerType === "touch") {
    return 12;
  }
  if (pointerType === "pen") {
    return 3;
  }
  return 2;
}

export function Workspace() {

    const cycleOrientation = () => {
      const currentIndex = ORIENTATION_ORDER.indexOf(state.project.orientation);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % ORIENTATION_ORDER.length : 0;
      dispatch({ type: "SET_ORIENTATION", orientation: ORIENTATION_ORDER[nextIndex] });
    };
  const { state, dispatch } = useEditor();
  const floor = getFloor(state);
  const isActiveFloorAttic = isAtticPreset(floor.floorPreset ?? inferFloorPresetFromName(floor.name));
  const lockedToolId = typeof state.project.metadata.lockedToolId === "string" ? (state.project.metadata.lockedToolId as ToolId) : null;
  const toolLockEnabled = Boolean(state.project.metadata.toolLockEnabled) && lockedToolId !== null;
  const activeToolIsLockable = isLockableTool(state.activeTool);
  const activeToolIsLocked = toolLockEnabled && lockedToolId === state.activeTool;
  const defaultDoorToolType = getDoorToolTypeFromMetadata(state.project.metadata);
  const bumpOutFlatsFromMetadata = Number(state.project.metadata.bumpOutFlats ?? 5);
  const defaultBumpOutFlats: BumpOutFlats =
    bumpOutFlatsFromMetadata === 3 || bumpOutFlatsFromMetadata === 4 || bumpOutFlatsFromMetadata === 5 || bumpOutFlatsFromMetadata === 6
      ? bumpOutFlatsFromMetadata
      : bumpOutFlatsFromMetadata === 7 || bumpOutFlatsFromMetadata === 9
        ? 6
        : 5;
  const defaultBumpOutLongEdgeFt = Math.max(3, Math.round(Number(state.project.metadata.bumpOutLongEdgeFt ?? 10)));

  const maybeAutoReturnToSelect = (toolId: ToolId) => {
    const selectedLockedTool = typeof state.project.metadata.lockedToolId === "string" ? state.project.metadata.lockedToolId : null;
    const lockIsEnabled = Boolean(state.project.metadata.toolLockEnabled);
    const keepTool = lockIsEnabled && selectedLockedTool === toolId;
    if (!keepTool) {
      dispatch({ type: "SET_TOOL", tool: "select" });
    }
  };

  const svgRef = useRef<SVGSVGElement | null>(null);
  const initializedViewRef = useRef(false);
  const previousActiveToolRef = useRef<ToolId>(state.activeTool);
  const [hoverWorld, setHoverWorld] = useState<Point | null>(null);
  const [draftEntity, setDraftEntity] = useState<MapEntity | null>(null);
  const [rectangleModalState, setRectangleModalState] = useState<RectangleModalState | null>(null);
  const [textModalState, setTextModalState] = useState<TextModalState | null>(null);
  const [doorModalState, setDoorModalState] = useState<DoorModalState | null>(null);
  const [slidingDoorModalState, setSlidingDoorModalState] = useState<SlidingDoorModalState | null>(null);
  const [windowModalState, setWindowModalState] = useState<WindowModalState | null>(null);
  const [utilityLabelModalState, setUtilityLabelModalState] = useState<UtilityLabelModalState | null>(null);
  const [bumpOutModalState, setBumpOutModalState] = useState<BumpOutModalState | null>(null);
  const [bumpOutConfig, setBumpOutConfig] = useState<{ flats: BumpOutFlats; longEdgeFt: number }>({
    flats: defaultBumpOutFlats,
    longEdgeFt: defaultBumpOutLongEdgeFt,
  });
  const [cameraPanelCollapsed, setCameraPanelCollapsed] = useState(false);
  const [resizeHint, setResizeHint] = useState<ResizeHintState | null>(null);
  const [hoveredSelectedEntityId, setHoveredSelectedEntityId] = useState<string | null>(null);
  const [openingPlacementPreview, setOpeningPlacementPreview] = useState<MapEntity | null>(null);
  const [pointerScreen, setPointerScreen] = useState<Point | null>(null);
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
  const bumpOutHostRectangles = useMemo(
    () => rectangleEntities.filter((entity) => !isBumpOutRectangle(entity)),
    [rectangleEntities],
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

  useEffect(() => {
    setBumpOutConfig({
      flats: defaultBumpOutFlats,
      longEdgeFt: defaultBumpOutLongEdgeFt,
    });
  }, [defaultBumpOutFlats, defaultBumpOutLongEdgeFt]);

  const selectedOpeningEdge = useMemo(() => {
    const selection = state.selection;
    if (selection.kind !== "entity") {
      return null;
    }
    const candidate = floor.entities.find((entity) => entity.id === selection.id);
    if (!candidate) {
      return null;
    }
    const supportsWindowHandles = candidate.type === "window" || isSlidingDoor(candidate);
    if (!supportsWindowHandles) {
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

  const conditionedConnectedEdgeRanges = useMemo(
    () => buildConditionedConnectedEdgeRanges(rectangleEntities),
    [rectangleEntities],
  );

  const sharedCeilingOverlayPlacement = useMemo(
    () => buildSharedCeilingOverlayPlacement(rectangleEntities),
    [rectangleEntities],
  );

  const selectedEditableEntity = useMemo(() => {
    const selection = state.selection;
    if (selection.kind !== "entity") {
      return null;
    }
    const candidate = floor.entities.find((entity) => entity.id === selection.id);
    const editable =
      candidate &&
      (candidate.type === "rectangle" ||
        candidate.type === "text" ||
        candidate.type === "window" ||
        candidate.type === "door" ||
        isUtilityEntityType(candidate.type));
    if (!editable || !candidate) {
      return null;
    }
    return candidate;
  }, [floor.entities, state.selection]);

  const frameTargetBounds = useMemo(() => {
    let bounds: WorldBounds | null = null;

    for (const entity of floor.entities) {
      const entityBounds = getEntityWorldBounds(entity);
      if (entityBounds) {
        bounds = expandBounds(bounds, entityBounds);
      }
    }

    for (const point of floor.wallPoints) {
      bounds = expandBounds(bounds, {
        minX: point.x - 0.6,
        minY: point.y - 0.6,
        maxX: point.x + 0.6,
        maxY: point.y + 0.6,
      });
    }

    for (const segment of floor.wallSegments) {
      const start = pointById.get(segment.startPointId);
      const end = pointById.get(segment.endPointId);
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

    const markerBounds = getGuideWorldBounds(rectangleGuideGroups);
    if (markerBounds) {
      bounds = expandBounds(bounds, markerBounds);
    }

    return bounds;
  }, [floor.entities, floor.wallPoints, floor.wallSegments, pointById, rectangleGuideGroups]);

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

    const targetCellsWide = 80;
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

  useEffect(() => {
    if (state.activeTool !== "door" && state.activeTool !== "window" && state.activeTool !== "bumpout") {
      setOpeningPlacementPreview(null);
    }
  }, [state.activeTool]);

  useEffect(() => {
    const previous = previousActiveToolRef.current;
    if (state.activeTool === "bumpout" && previous !== "bumpout") {
      setBumpOutModalState({
        initialFlats: bumpOutConfig.flats,
        initialLongEdgeFt: bumpOutConfig.longEdgeFt,
      });
    }
    previousActiveToolRef.current = state.activeTool;
  }, [bumpOutConfig.flats, bumpOutConfig.longEdgeFt, state.activeTool]);

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
    label: entity.label ?? "",
    widthFt: Math.max(1, Math.round(Math.abs(entity.width))),
    heightFt: Math.max(1, Math.round(Math.abs(entity.height))),
    color: String(entity.metadata.color ?? "BLUE").toUpperCase(),
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

  const getDefaultDoorKind = (): DoorKind => {
    const value = String(state.project.metadata.doorDefaultType ?? "single").toLowerCase();
    if (value === "double" || value === "sliding") {
      return value;
    }
    return "single";
  };

  const openCreateRectangleModal = (anchor: Point) => {
    setRectangleModalState({
      mode: "create",
      anchor: { x: Math.round(anchor.x), y: Math.round(anchor.y) },
      initialValues: DEFAULT_RECTANGLE_MODAL_VALUES,
    });
  };

  const startRectangleCanvasLongPress = (pointerId: number, anchor: Point, startScreen: Point) => {
    clearLongPress();
    longPressRef.current.pointerId = pointerId;
    longPressRef.current.entityId = null;
    longPressRef.current.startScreen = startScreen;
    longPressRef.current.fired = false;
    longPressRef.current.timer = setTimeout(() => {
      longPressRef.current.fired = true;
      setDraftEntity(null);
      dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
      finishInteraction();
      openCreateRectangleModal(anchor);
      clearLongPress();
    }, 520);
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

  const openSlidingDoorModal = (entity: MapEntity) => {
    if (!isSlidingDoor(entity)) {
      return;
    }
    setSlidingDoorModalState({
      entityId: entity.id,
      initialWidthFt: Math.max(1, Math.round(Math.abs(entity.width))),
      initialHeightFt: Math.max(1, Math.round(Math.abs(entity.height))),
    });
  };

  const openDoorModal = (entity: MapEntity) => {
    if (entity.type !== "door") {
      return;
    }
    const kind = getDoorKind(entity);
    if (kind === "sliding") {
      openSlidingDoorModal(entity);
      return;
    }
    setDoorModalState({
      entityId: entity.id,
      kind,
      initialWidthFt: Math.max(1, Math.round(Math.abs(entity.width))),
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

  const openEntityEditModal = (entity: MapEntity) => {
    if (entity.type === "rectangle") {
      openEditRectangleModal(entity);
      return;
    }
    if (entity.type === "text") {
      openEditTextModal(entity);
      return;
    }
    if (entity.type === "window") {
      openWindowSizeModal(entity);
      return;
    }
    if (entity.type === "door") {
      openDoorModal(entity);
      return;
    }
    if (isUtilityEntityType(entity.type)) {
      openUtilityLabelModal(entity);
    }
  };

  const tryPlaceDoorOrWindow = (
    type: "door" | "window",
    world: Point,
    requestedDoorKind?: DoorKind,
    maxSnapDistance = OPENING_PLACEMENT_SNAP_THRESHOLD,
  ): MapEntity | null => {
    const snap = type === "window" ? nearestWindowHostEdge(world, rectangleEntities) : nearestRectangleEdge(world, rectangleEntities);
    if (!snap || snap.distance > maxSnapDistance) {
      return null;
    }

    const entity = createEntityFromTool(type, Math.round(snap.x), Math.round(snap.y));
    if (type === "door") {
      const kind = requestedDoorKind ?? "single";
      entity.metadata.doorKind = kind;
      entity.width =
        kind === "double"
          ? DOUBLE_DOOR_DEFAULT_WIDTH
          : kind === "sliding"
            ? SLIDING_DOOR_DEFAULT_WIDTH
            : SINGLE_DOOR_DEFAULT_WIDTH;
      entity.height = kind === "sliding" ? SLIDING_DOOR_DEFAULT_HEIGHT : DOOR_DEFAULT_HEIGHT;
      entity.label = "";
    } else {
      const defaults = getDefaultWindowSize();
      entity.width = defaults.widthFt;
      entity.height = defaults.heightFt;
      entity.label = "";
    }

    const isBumpOutHost = rectangleEntities.some((item) => item.id === snap.rectId && isBumpOutRectangle(item));
    entity.rotation =
      type === "window" && isBumpOutHost && typeof snap.segmentAngleDeg === "number"
        ? snap.segmentAngleDeg
        : edgeRotation(snap.edge);
    entity.metadata.hostRectId = snap.rectId;
    entity.metadata.edge = snap.edge;
    if (type === "window" && isBumpOutHost && typeof snap.segmentIndex === "number") {
      entity.metadata.bumpOutSegmentIndex = snap.segmentIndex;
    }
    entity.metadata.flipped = false;
    entity.metadata.mirrored = false;

    const doorKind = entity.type === "door" ? getDoorKind(entity) : null;
    const lockedPosition =
      type === "window" || doorKind === "sliding"
        ? lockWindowCenterToHostEdge({ x: snap.x, y: snap.y }, entity, rectangleEntities)
        : lockWindowPointToHostEdge({ x: snap.x, y: snap.y }, entity, rectangleEntities);

    const resolvedPosition = resolveOpeningPositionWithoutOverlap(
      entity,
      lockedPosition,
      floor.entities,
      rectangleEntities,
      entity.id,
    );
    if (!resolvedPosition) {
      return null;
    }

    entity.x = resolvedPosition.x;
    entity.y = resolvedPosition.y;

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
    if (!pinchGestureRef.current.active) {
      clearLongPress();
      setDraftEntity(null);
      dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
      if (interactionRef.current.pointerId !== null) {
        svgRef.current?.releasePointerCapture(interactionRef.current.pointerId);
      }
      interactionRef.current = {
        type: "none",
        pointerId: null,
        startScreen: { x: 0, y: 0 },
        startWorld: { x: 0, y: 0 },
      };
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

  const registerTouchPointer = (event: {
    pointerType: string;
    pointerId: number;
    clientX: number;
    clientY: number;
  }): boolean => {
    if (event.pointerType !== "touch") {
      return false;
    }
    touchPointsRef.current.set(event.pointerId, getTouchScreenPoint(event));
    svgRef.current?.setPointerCapture(event.pointerId);
    startPinchGestureIfReady();
    return touchPointsRef.current.size >= 2;
  };

  const beginPan = (
    event: ReactPointerEvent<SVGSVGElement>,
    options?: { tapAction?: InteractionState["tapAction"] },
  ) => {
    interactionRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startScreen: { x: event.clientX, y: event.clientY },
      startWorld: getEventWorld(event),
      dragStarted: false,
      tapAction: options?.tapAction,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleBackgroundDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    setOpeningPlacementPreview(null);

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (registerTouchPointer(event)) {
      return;
    }

    if (event.button === 1 || event.button === 2 || event.altKey) {
      event.preventDefault();
      beginPan(event);
      return;
    }

    const world = getEventWorld(event);
    setHoverWorld(world);

    if (state.activeTool === "rectangle") {
      const containingRectangle = findRectangleContainingPoint(world, rectangleEntities);
      if (containingRectangle) {
        return;
      }

      const baseStart = snapPointToGrid(world);
      const snappedStart = snapRectangleStartToNearbyEdge(baseStart, rectangleEntities);
      const nextEntity = createEntityFromTool("rectangle", snappedStart.x, snappedStart.y);
      nextEntity.width = 1;
      nextEntity.height = 1;

      startRectangleCanvasLongPress(
        event.pointerId,
        snappedStart,
        { x: event.clientX, y: event.clientY },
      );

      interactionRef.current = {
        type: "draw-rect",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: snappedStart,
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

    if (state.activeTool === "bumpout") {
      const snap = nearestRectangleEdge(world, bumpOutHostRectangles);
      if (!snap || snap.distance > BUMPOUT_EDGE_SNAP_THRESHOLD) {
        return;
      }
      const hostRect = bumpOutHostRectangles.find((candidate) => candidate.id === snap.rectId);
      if (!hostRect) {
        return;
      }
      const placed = createBumpOutFromEdge(
        snap,
        rectBoundsFromEntity(hostRect),
        bumpOutConfig.flats,
        bumpOutConfig.longEdgeFt,
      );
      if (doesBumpOutIntersectAny(placed, rectangleEntities)) {
        return;
      }
      dispatch({ type: "UPSERT_ENTITY", entity: placed });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: placed.id } });
      maybeAutoReturnToSelect("bumpout");
      return;
    }

    if (state.activeTool === "select") {
      if (event.pointerType === "touch") {
        beginPan(event, { tapAction: "deselect-empty" });
      } else {
        dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
        beginPan(event);
      }
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
      const placed =
        tool.entityType === "door"
          ? tryPlaceDoorOrWindow("door", world, getDefaultDoorKind())
          : tryPlaceDoorOrWindow("window", world);
      if (!placed) {
        return;
      }
      dispatch({ type: "UPSERT_ENTITY", entity: placed });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: placed.id } });
      maybeAutoReturnToSelect(tool.entityType);
      return;
    }

    if (tool.entityType === "skylight") {
      const hostRectangle = findRectangleContainingPoint(world, rectangleEntities);
      if (!hostRectangle) {
        return;
      }
      const nextEntity = createEntityFromTool("skylight", Math.round(world.x), Math.round(world.y));
      nextEntity.metadata = {
        ...nextEntity.metadata,
        hostRectId: hostRectangle.id,
      };
      interactionRef.current = {
        type: "draw-rect",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
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
        pointerType: event.pointerType,
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
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      setPointerScreen({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    const interaction = interactionRef.current;

    if ((state.activeTool === "door" || state.activeTool === "window" || state.activeTool === "bumpout") && interaction.type === "none") {
      const previewCandidate =
        state.activeTool === "door"
          ? tryPlaceDoorOrWindow("door", world, getDefaultDoorKind(), OPENING_PREVIEW_SNAP_THRESHOLD)
          : state.activeTool === "window"
            ? tryPlaceDoorOrWindow("window", world, undefined, OPENING_PREVIEW_SNAP_THRESHOLD)
            : (() => {
                const snap = nearestRectangleEdge(world, bumpOutHostRectangles);
                if (!snap || snap.distance > BUMPOUT_EDGE_SNAP_THRESHOLD) {
                  return null;
                }
                const hostRect = bumpOutHostRectangles.find((candidate) => candidate.id === snap.rectId);
                if (!hostRect) {
                  return null;
                }
                return createBumpOutFromEdge(
                  snap,
                  rectBoundsFromEntity(hostRect),
                  bumpOutConfig.flats,
                  bumpOutConfig.longEdgeFt,
                );
              })();

      const previewCandidateValidated =
        previewCandidate && isBumpOutRectangle(previewCandidate) && doesBumpOutIntersectAny(previewCandidate, rectangleEntities)
          ? null
          : previewCandidate;

      if (!previewCandidateValidated) {
        setOpeningPlacementPreview((current) => (current ? null : current));
      } else {
        const nextPreview: MapEntity = {
          ...previewCandidateValidated,
          id: OPENING_PLACEMENT_PREVIEW_ID,
        };
        setOpeningPlacementPreview((current) => {
          if (
            current &&
            current.type === nextPreview.type &&
            current.x === nextPreview.x &&
            current.y === nextPreview.y &&
            current.width === nextPreview.width &&
            current.height === nextPreview.height &&
            current.rotation === nextPreview.rotation &&
            current.metadata.hostRectId === nextPreview.metadata.hostRectId &&
            current.metadata.edge === nextPreview.metadata.edge &&
            current.metadata.doorKind === nextPreview.metadata.doorKind &&
            current.metadata.shapeType === nextPreview.metadata.shapeType &&
            current.metadata.bumpOutFlats === nextPreview.metadata.bumpOutFlats
          ) {
            return current;
          }
          return nextPreview;
        });
      }
    } else {
      setOpeningPlacementPreview((current) => (current ? null : current));
    }

    if (interaction.type === "none") {
      return;
    }

    if (interaction.type === "pan") {
      if (!interaction.dragStarted) {
        const movedX = event.clientX - interaction.startScreen.x;
        const movedY = event.clientY - interaction.startScreen.y;
        if (Math.hypot(movedX, movedY) <= getDragThresholdPx(interaction.pointerType)) {
          return;
        }
        interactionRef.current = { ...interaction, dragStarted: true };
      }
      dispatch({ type: "PAN_CAMERA", dx: event.movementX, dy: event.movementY });
      return;
    }

    if (interaction.type === "drag-entity" && interaction.targetId && interaction.entitySnapshot) {
      interaction.latestWorld = world;

      if (!interaction.dragStarted) {
        const movedX = event.clientX - interaction.startScreen.x;
        const movedY = event.clientY - interaction.startScreen.y;
        if (Math.hypot(movedX, movedY) <= getDragThresholdPx(interaction.pointerType)) {
          return;
        }
        interactionRef.current = { ...interaction, dragStarted: true };
      }

      const dx = world.x - interaction.startWorld.x;
      const dy = world.y - interaction.startWorld.y;

      if (interaction.entitySnapshot.type === "door") {
        const locked = isSlidingDoor(interaction.entitySnapshot)
          ? lockWindowCenterToHostEdge(
              {
                x: interaction.entitySnapshot.x + dx,
                y: interaction.entitySnapshot.y + dy,
              },
              interaction.entitySnapshot,
              rectangleEntities,
            )
          : lockWindowPointToHostEdge(
              {
                x: interaction.entitySnapshot.x + dx,
                y: interaction.entitySnapshot.y + dy,
              },
              interaction.entitySnapshot,
              rectangleEntities,
            );
        const next =
          resolveOpeningPositionWithoutOverlap(
            interaction.entitySnapshot,
            locked,
            floor.entities,
            rectangleEntities,
            interaction.entitySnapshot.id,
          ) ?? { x: interaction.entitySnapshot.x, y: interaction.entitySnapshot.y };
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
        const locked = lockWindowCenterToHostEdge(
          {
            x: interaction.entitySnapshot.x + dx,
            y: interaction.entitySnapshot.y + dy,
          },
          interaction.entitySnapshot,
          rectangleEntities,
        );
        const next =
          resolveOpeningPositionWithoutOverlap(
            interaction.entitySnapshot,
            locked,
            floor.entities,
            rectangleEntities,
            interaction.entitySnapshot.id,
          ) ?? { x: interaction.entitySnapshot.x, y: interaction.entitySnapshot.y };
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

      if (interaction.entitySnapshot.type === "skylight") {
        const locked = lockSkylightCenterToHostRect(
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
            x: locked.x,
            y: locked.y,
          },
        });
        return;
      }

      if (interaction.entitySnapshot.type === "rectangle") {
        if (isBumpOutRectangle(interaction.entitySnapshot)) {
          const hostRect = getHostRectForEntity(interaction.entitySnapshot, rectangleEntities);
          const hostEdge = (interaction.entitySnapshot.metadata.hostEdge as RectEdge | undefined) ?? "top";
          if (!hostRect) {
            return;
          }
          const nextRect = clampBumpOutRectToHost(
            hostRect,
            hostEdge,
            {
              x: Math.round(interaction.entitySnapshot.x + dx),
              y: Math.round(interaction.entitySnapshot.y + dy),
              width: Math.max(1, Math.round(interaction.entitySnapshot.width)),
              height: Math.max(1, Math.round(interaction.entitySnapshot.height)),
            },
          );
          const movedBumpOut: MapEntity = {
            ...interaction.entitySnapshot,
            x: nextRect.x,
            y: nextRect.y,
          };
          if (doesBumpOutIntersectAny(movedBumpOut, rectangleEntities, interaction.entitySnapshot.id)) {
            return;
          }
          dispatch({
            type: "SET_PREVIEW_ENTITY",
            entity: movedBumpOut,
          });
          return;
        }

        const snappedPoint = snapPointToGrid({
          x: interaction.entitySnapshot.x + dx,
          y: interaction.entitySnapshot.y + dy,
        });
        const sourceRect = rectBoundsFromEntity(interaction.entitySnapshot);
        const snapEnabled = !isRectangleConnectedToAny(
          sourceRect,
          rectangleEntities,
          interaction.entitySnapshot.id,
        );
        const movedRect = snapEnabled
          ? snapRectTranslationToNearbyEdges(
              {
                x: snappedPoint.x,
                y: snappedPoint.y,
                width: sourceRect.width,
                height: sourceRect.height,
              },
              rectangleEntities,
              RECT_EDGE_SNAP_THRESHOLD,
              interaction.entitySnapshot.id,
            )
          : {
              x: snappedPoint.x,
              y: snappedPoint.y,
              width: sourceRect.width,
              height: sourceRect.height,
            };

        dispatch({
          type: "SET_PREVIEW_ENTITY",
          entity: {
            ...interaction.entitySnapshot,
            x: movedRect.x,
            y: movedRect.y,
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
      if (!interaction.dragStarted) {
        const movedX = event.clientX - interaction.startScreen.x;
        const movedY = event.clientY - interaction.startScreen.y;
        if (Math.hypot(movedX, movedY) <= getDragThresholdPx(interaction.pointerType)) {
          return;
        }
        interactionRef.current = { ...interaction, dragStarted: true };
      }
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
      let resizedRect = applyRectResize(sourceRect, world, interaction.resizeHandle);
      const isBumpOutResize =
        interaction.entitySnapshot.type === "rectangle" && isBumpOutRectangle(interaction.entitySnapshot);
      if (isBumpOutResize) {
        const hostRect = getHostRectForEntity(interaction.entitySnapshot, rectangleEntities);
        const hostEdge = (interaction.entitySnapshot.metadata.hostEdge as RectEdge | undefined) ?? "top";
        if (!hostRect) {
          return;
        }
        resizedRect = resizeBumpOutWithHostLock(
          interaction.entitySnapshot,
          sourceRect,
          hostRect,
          hostEdge,
          interaction.resizeHandle,
          world,
        );
      }
      const snapEnabled =
        interaction.entitySnapshot.type === "rectangle" &&
        !isRectangleConnectedToAny(sourceRect, rectangleEntities, interaction.entitySnapshot.id);
      const nextRect =
        isBumpOutResize
          ? resizedRect
          : interaction.entitySnapshot.type === "rectangle"
          ? clampRectResizeToAttachedOpenings(
              sourceRect,
              snapEnabled
                ? snapRectResizeToNearbyEdges(
                    resizedRect,
                    interaction.resizeHandle,
                    rectangleEntities,
                    RECT_EDGE_SNAP_THRESHOLD,
                    interaction.entitySnapshot.id,
                  )
                : resizedRect,
              interaction.entitySnapshot.id,
              interaction.resizeHandle,
              floor.entities,
            )
          : resizedRect;
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
      if (isBumpOutResize) {
        updated.metadata = updateBumpOutMetadataOnResize(
          interaction.entitySnapshot,
          sourceRect,
          nextRect,
          interaction.resizeHandle,
        );
        if (doesBumpOutIntersectAny(updated, rectangleEntities, interaction.entitySnapshot.id)) {
          return;
        }
      }
      dispatch({ type: "SET_PREVIEW_ENTITY", entity: updated });
      return;
    }

    if (interaction.type === "resize-window" && interaction.targetId && interaction.entitySnapshot) {
      const snapshot = interaction.entitySnapshot;
      const isWindowLike = snapshot.type === "window" || isSlidingDoor(snapshot);
      if (!isWindowLike) {
        return;
      }

      const bumpOutSegment = getHostBumpOutSegment(snapshot, rectangleEntities);
      if (bumpOutSegment && bumpOutSegment.length > Number.EPSILON) {
        const dx = bumpOutSegment.end.x - bumpOutSegment.start.x;
        const dy = bumpOutSegment.end.y - bumpOutSegment.start.y;
        const length = bumpOutSegment.length;
        const currentCenterAxis =
          ((snapshot.x - bumpOutSegment.start.x) * dx +
            (snapshot.y - bumpOutSegment.start.y) * dy) /
          length;
        const currentStart = currentCenterAxis - snapshot.width / 2;
        const currentEnd = currentCenterAxis + snapshot.width / 2;
        const handle = interaction.windowHandle ?? "end";
        const fixedAxis = handle === "start" ? currentEnd : currentStart;
        const rawDragged =
          ((world.x - bumpOutSegment.start.x) * dx +
            (world.y - bumpOutSegment.start.y) * dy) /
          length;
        let minDragged = handle === "start" ? 0 : fixedAxis + 1;
        let maxDragged = handle === "start" ? fixedAxis - 1 : length;

        const hostRectId = snapshot.metadata.hostRectId as string | undefined;
        const segmentIndex = Number(snapshot.metadata.bumpOutSegmentIndex);
        const blockers = floor.entities
          .filter((entity) => {
            if (entity.id === snapshot.id) {
              return false;
            }
            if (entity.type !== "door" && entity.type !== "window") {
              return false;
            }
            if (entity.metadata.hostRectId !== hostRectId) {
              return false;
            }
            return Number(entity.metadata.bumpOutSegmentIndex) === segmentIndex;
          })
          .map((entity) => {
            const axis =
              ((entity.x - bumpOutSegment.start.x) * dx +
                (entity.y - bumpOutSegment.start.y) * dy) /
              length;
            const half = Math.abs(entity.width) / 2;
            return { start: axis - half, end: axis + half };
          });

        if (handle === "start") {
          for (const block of blockers) {
            if (block.end <= fixedAxis && block.start < fixedAxis) {
              minDragged = Math.max(minDragged, block.end);
            }
          }
        } else {
          for (const block of blockers) {
            if (block.start >= fixedAxis && block.end > fixedAxis) {
              maxDragged = Math.min(maxDragged, block.start);
            }
          }
        }

        const draggedAxis =
          minDragged <= maxDragged ? clampValue(rawDragged, minDragged, maxDragged) : rawDragged;
        const nextLength = Math.max(1, Math.round(Math.abs(draggedAxis - fixedAxis)));
        const centerAxis = (draggedAxis + fixedAxis) / 2;
        const updated: MapEntity = {
          ...snapshot,
          x: bumpOutSegment.start.x + (dx * centerAxis) / length,
          y: bumpOutSegment.start.y + (dy * centerAxis) / length,
          width: nextLength,
        };

        const resolvedPosition = resolveOpeningPositionWithoutOverlap(
          updated,
          { x: updated.x, y: updated.y },
          floor.entities,
          rectangleEntities,
          updated.id,
        );
        if (!resolvedPosition) {
          return;
        }

        updated.x = resolvedPosition.x;
        updated.y = resolvedPosition.y;

        dispatch({ type: "SET_PREVIEW_ENTITY", entity: updated });
        return;
      }

      const edge = (snapshot.metadata.edge as RectEdge | undefined) ?? "top";
      const hostRectId = snapshot.metadata.hostRectId as string | undefined;
      const hostRect = getHostRectForEntity(snapshot, rectangleEntities);
      if (!hostRect || !hostRectId) {
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
      let minDragged = handle === "start" ? axisMin : fixedAxis + 1;
      let maxDragged = handle === "start" ? fixedAxis - 1 : axisMax;

      const blockers = getOpeningSpansForEdge(floor.entities, hostRectId, edge, snapshot.id);
      if (handle === "start") {
        for (const block of blockers) {
          if (block.end <= fixedAxis && block.start < fixedAxis) {
            minDragged = Math.max(minDragged, block.end);
          }
        }
      } else {
        for (const block of blockers) {
          if (block.start >= fixedAxis && block.end > fixedAxis) {
            maxDragged = Math.min(maxDragged, block.start);
          }
        }
      }

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

      const resolvedPosition = resolveOpeningPositionWithoutOverlap(
        updated,
        { x: updated.x, y: updated.y },
        floor.entities,
        rectangleEntities,
        updated.id,
      );
      if (!resolvedPosition) {
        return;
      }

      updated.x = resolvedPosition.x;
      updated.y = resolvedPosition.y;

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
      dispatch({ type: "SET_PREVIEW_ENTITY", entity: updated });
      return;
    }

    if (interaction.type === "draw-rect" && interaction.entitySnapshot) {
      const dx = event.clientX - interaction.startScreen.x;
      const dy = event.clientY - interaction.startScreen.y;
      const hasMoved =
        interaction.dragStarted || Math.hypot(dx, dy) > getDragThresholdPx(interaction.pointerType);

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

      if (interaction.entitySnapshot.type === "skylight") {
        const hostRectId = interaction.entitySnapshot.metadata.hostRectId as string | undefined;
        const hostRect = hostRectId
          ? rectangleEntities.find((rectangle) => rectangle.id === hostRectId)
          : null;
        if (!hostRect) {
          return;
        }

        const host = rectBoundsFromEntity(hostRect);
        const clampedEndX = clampValue(end.x, host.x, host.x + host.width);
        const clampedEndY = clampValue(end.y, host.y, host.y + host.height);
        const drawMinX = Math.round(Math.min(start.x, clampedEndX));
        const drawMinY = Math.round(Math.min(start.y, clampedEndY));
        const drawMaxX = Math.round(Math.max(start.x, clampedEndX));
        const drawMaxY = Math.round(Math.max(start.y, clampedEndY));
        const width = Math.max(1, drawMaxX - drawMinX);
        const height = Math.max(1, drawMaxY - drawMinY);
        const nextDraft = {
          ...interaction.entitySnapshot,
          x: drawMinX,
          y: drawMinY,
          width,
          height,
        };
        setDraftEntity(nextDraft);
        dispatch({ type: "SET_PREVIEW_ENTITY", entity: nextDraft });
        return;
      }

      const nextDraft = {
        ...interaction.entitySnapshot,
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      };
      const moveWest = end.x < start.x;
      const moveEast = end.x > start.x;
      const moveNorth = end.y < start.y;
      const moveSouth = end.y > start.y;

      let drawHandle: ResizeHandle = "se";
      if (moveNorth && moveWest) {
        drawHandle = "nw";
      } else if (moveNorth && moveEast) {
        drawHandle = "ne";
      } else if (moveSouth && moveWest) {
        drawHandle = "sw";
      } else if (moveSouth && moveEast) {
        drawHandle = "se";
      } else if (moveWest) {
        drawHandle = "w";
      } else if (moveEast) {
        drawHandle = "e";
      } else if (moveNorth) {
        drawHandle = "n";
      } else if (moveSouth) {
        drawHandle = "s";
      }

      const snappedDraftRect = snapRectResizeToNearbyEdges(
        {
          x: nextDraft.x,
          y: nextDraft.y,
          width: Math.max(1, Math.abs(nextDraft.width)),
          height: Math.max(1, Math.abs(nextDraft.height)),
        },
        drawHandle,
        rectangleEntities,
        RECT_EDGE_SNAP_THRESHOLD,
      );
      const snappedDraft = {
        ...nextDraft,
        x: snappedDraftRect.x,
        y: snappedDraftRect.y,
        width: snappedDraftRect.width,
        height: snappedDraftRect.height,
      };
      setDraftEntity(snappedDraft);
      dispatch({ type: "SET_PREVIEW_ENTITY", entity: snappedDraft });
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
    setResizeHint(null);
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
      interaction.type === "pan" &&
      interaction.tapAction === "deselect-empty" &&
      !interaction.dragStarted
    ) {
      dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
    }

    if (
      interaction.type === "pan" &&
      interaction.tapAction === "select-entity" &&
      interaction.targetId &&
      !interaction.dragStarted
    ) {
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: interaction.targetId } });
    }

    if (
      interaction.type === "drag-entity" &&
      interaction.tapAction === "flip-door" &&
      interaction.targetId &&
      interaction.entitySnapshot?.type === "door" &&
      !isSlidingDoor(interaction.entitySnapshot) &&
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
      if (!interaction.dragStarted) {
        dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
      } else {
      const snapshot = interaction.entitySnapshot;
      const referenceWorld = interaction.latestWorld ?? getEventWorld(event);
      const dx = referenceWorld.x - interaction.startWorld.x;
      const dy = referenceWorld.y - interaction.startWorld.y;

      if (snapshot.type === "door") {
        const locked = isSlidingDoor(snapshot)
          ? lockWindowCenterToHostEdge(
              {
                x: snapshot.x + dx,
                y: snapshot.y + dy,
              },
              snapshot,
              rectangleEntities,
            )
          : lockWindowPointToHostEdge(
              {
                x: snapshot.x + dx,
                y: snapshot.y + dy,
              },
              snapshot,
              rectangleEntities,
            );
        const next =
          resolveOpeningPositionWithoutOverlap(
            snapshot,
            locked,
            floor.entities,
            rectangleEntities,
            snapshot.id,
          ) ?? { x: snapshot.x, y: snapshot.y };
        dispatch({ type: "MOVE_ENTITY", entityId: interaction.targetId, x: next.x, y: next.y });
      } else if (snapshot.type === "window") {
        const locked = lockWindowCenterToHostEdge(
          {
            x: snapshot.x + dx,
            y: snapshot.y + dy,
          },
          snapshot,
          rectangleEntities,
        );
        const next =
          resolveOpeningPositionWithoutOverlap(
            snapshot,
            locked,
            floor.entities,
            rectangleEntities,
            snapshot.id,
          ) ?? { x: snapshot.x, y: snapshot.y };
        dispatch({ type: "MOVE_ENTITY", entityId: interaction.targetId, x: next.x, y: next.y });
      } else if (snapshot.type === "skylight") {
        const locked = lockSkylightCenterToHostRect(
          {
            x: snapshot.x + dx,
            y: snapshot.y + dy,
          },
          snapshot,
          rectangleEntities,
        );
        dispatch({ type: "MOVE_ENTITY", entityId: interaction.targetId, x: locked.x, y: locked.y });
      } else if (snapshot.type === "rectangle" && state.previewEntity?.id === snapshot.id) {
        dispatch({
          type: "MOVE_ENTITY",
          entityId: interaction.targetId,
          x: state.previewEntity.x,
          y: state.previewEntity.y,
        });
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
    }

    if (interaction.type === "draw-rect" && interaction.entitySnapshot) {
      if (interaction.dragStarted && draftEntity) {
        const snappedBase =
          interaction.entitySnapshot.type === "skylight"
            ? {
                ...draftEntity,
                width: Math.max(1, Math.round(Math.abs(draftEntity.width))),
                height: Math.max(1, Math.round(Math.abs(draftEntity.height))),
              }
            : {
                ...draftEntity,
                x: Math.round(draftEntity.x),
                y: Math.round(draftEntity.y),
                width: Math.max(1, Math.round(Math.abs(draftEntity.width))),
                height: Math.max(1, Math.round(Math.abs(draftEntity.height))),
              };

        const snapped =
          interaction.entitySnapshot.type === "skylight"
            ? {
                ...snappedBase,
                x: snappedBase.x + snappedBase.width / 2,
                y: snappedBase.y + snappedBase.height / 2,
              }
            : snappedBase;

        if (interaction.entitySnapshot.type === "skylight") {
          const hostRectId = snapped.metadata.hostRectId as string | undefined;
          const hostRect = hostRectId
            ? rectangleEntities.find((rectangle) => rectangle.id === hostRectId)
            : null;
          if (!hostRect || !isSkylightInsideRectangle(snapped, hostRect)) {
            dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
            setDraftEntity(null);
            return;
          }
        }

        dispatch({ type: "UPSERT_ENTITY", entity: snapped });
        if (interaction.entitySnapshot.type === "skylight") {
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: snapped.id } });
          maybeAutoReturnToSelect("skylight");
        } else {
          dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
        }
        if (interaction.entitySnapshot.type === "rectangle") {
          maybeAutoReturnToSelect("rectangle");
        }
        dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
        setDraftEntity(null);
      } else {
        dispatch({ type: "CLEAR_PREVIEW_ENTITY" });
        setDraftEntity(null);
        if (interaction.entitySnapshot.type === "skylight") {
          const hostRectId = interaction.entitySnapshot.metadata.hostRectId as string | undefined;
          const hostRect = hostRectId
            ? rectangleEntities.find((rectangle) => rectangle.id === hostRectId)
            : null;
          if (hostRect && isSkylightInsideRectangle(interaction.entitySnapshot, hostRect)) {
            dispatch({ type: "UPSERT_ENTITY", entity: interaction.entitySnapshot });
            dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: interaction.entitySnapshot.id } });
            maybeAutoReturnToSelect("skylight");
          }
        } else if (interaction.sourceRectangleId) {
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: interaction.sourceRectangleId } });
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
      maybeAutoReturnToSelect("line");
    }

    if (
      (interaction.type === "resize-rect" ||
        interaction.type === "resize-window" ||
        interaction.type === "resize-skylight") &&
      interaction.targetId &&
      interaction.entitySnapshot &&
      state.previewEntity &&
      state.previewEntity.id === interaction.targetId
    ) {
      const nextEntity = state.previewEntity;
      const snapshot = interaction.entitySnapshot;
      const changed =
        nextEntity.x !== snapshot.x ||
        nextEntity.y !== snapshot.y ||
        nextEntity.width !== snapshot.width ||
        nextEntity.height !== snapshot.height;
      if (changed) {
        if (
          interaction.type === "resize-rect" &&
          interaction.resizeHandle &&
          snapshot.type === "rectangle" &&
          nextEntity.type === "rectangle" &&
          !isBumpOutRectangle(snapshot)
        ) {
          const pushedRectangles = getConnectedPushForRectangleResize(
            snapshot,
            rectBoundsFromEntity(nextEntity),
            interaction.resizeHandle,
            floor.entities,
          );

          if (pushedRectangles.length > 0) {
            dispatch({
              type: "APPLY_RECT_RESIZE_WITH_PUSH",
              entity: nextEntity,
              pushedRectangles,
            });
          } else {
            dispatch({ type: "UPSERT_ENTITY", entity: nextEntity });
          }
        } else {
          dispatch({ type: "UPSERT_ENTITY", entity: nextEntity });
        }
        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: nextEntity.id } });
      }
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

  const centerFrameWorkspace = () => {
    const workspace = svgRef.current;
    if (!workspace || !frameTargetBounds) {
      return;
    }

    const padding = 4;
    const width = Math.max(1, frameTargetBounds.maxX - frameTargetBounds.minX + padding * 2);
    const height = Math.max(1, frameTargetBounds.maxY - frameTargetBounds.minY + padding * 2);
    const viewportWidth = workspace.clientWidth;
    const viewportHeight = workspace.clientHeight;
    const nextZoom = clamp(Math.min(viewportWidth / width, viewportHeight / height), MIN_ZOOM, MAX_ZOOM);

    const centerX = (frameTargetBounds.minX + frameTargetBounds.maxX) / 2;
    const centerY = (frameTargetBounds.minY + frameTargetBounds.maxY) / 2;

    dispatch({
      type: "SET_CAMERA",
      camera: {
        zoom: nextZoom,
        x: viewportWidth / 2 - centerX * nextZoom,
        y: viewportHeight / 2 - centerY * nextZoom,
      },
    });
  };

  const handleZoomSliderChange = (value: number) => {
    const workspace = svgRef.current;
    if (!workspace) {
      return;
    }
    dispatch({
      type: "ZOOM_CAMERA",
      nextZoom: value,
      pivot: {
        x: workspace.clientWidth / 2,
        y: workspace.clientHeight / 2,
      },
    });
  };

  const handleEntityDown = (event: ReactPointerEvent<SVGGElement>, entity: MapEntity) => {
    setOpeningPlacementPreview(null);

    event.stopPropagation();
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (registerTouchPointer(event)) {
      return;
    }

    if (state.activeTool === "text") {
      const world = getEventWorld(event);
      if (entity.type === "text") {
        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });

        interactionRef.current = {
          type: "drag-entity",
          pointerId: event.pointerId,
          pointerType: event.pointerType,
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

    if (state.activeTool === "bumpout") {
      const world = getEventWorld(event);
      const snap = nearestRectangleEdge(world, bumpOutHostRectangles);
      if (!snap || snap.distance > BUMPOUT_EDGE_SNAP_THRESHOLD) {
        return;
      }
      const hostRect = bumpOutHostRectangles.find((candidate) => candidate.id === snap.rectId);
      if (!hostRect) {
        return;
      }
      const placed = createBumpOutFromEdge(
        snap,
        rectBoundsFromEntity(hostRect),
        bumpOutConfig.flats,
        bumpOutConfig.longEdgeFt,
      );
      dispatch({ type: "UPSERT_ENTITY", entity: placed });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: placed.id } });
      maybeAutoReturnToSelect("bumpout");
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
          pointerType: event.pointerType,
          startScreen: { x: event.clientX, y: event.clientY },
          startWorld: world,
          targetId: entity.id,
          entitySnapshot: entity,
        };
        svgRef.current?.setPointerCapture(event.pointerId);
        return;
      }

      if (entity.type === "rectangle") {
        const world = getEventWorld(event);
        const bounds = rectBoundsFromEntity(entity);
        const distanceToNearestEdge = Math.min(
          Math.abs(world.x - bounds.x),
          Math.abs(bounds.x + bounds.width - world.x),
          Math.abs(world.y - bounds.y),
          Math.abs(bounds.y + bounds.height - world.y),
        );

        if (distanceToNearestEdge <= RECT_DRAW_START_EDGE_SNAP_THRESHOLD) {
          const baseStart = snapPointToGrid(world);
          const snappedStart = snapRectangleStartToNearbyEdge(baseStart, rectangleEntities);
          const nextEntity = createEntityFromTool("rectangle", snappedStart.x, snappedStart.y);
          nextEntity.width = 1;
          nextEntity.height = 1;

          startRectangleCanvasLongPress(
            event.pointerId,
            snappedStart,
            { x: event.clientX, y: event.clientY },
          );

          interactionRef.current = {
            type: "draw-rect",
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            startScreen: { x: event.clientX, y: event.clientY },
            startWorld: snappedStart,
            entitySnapshot: nextEntity,
            sourceRectangleId: entity.id,
            dragStarted: false,
          };
          svgRef.current?.setPointerCapture(event.pointerId);
          return;
        }

        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
        return;
      }
      return;
    }

    if (state.activeTool === "door") {
      const world = getEventWorld(event);
      if (entity.type === "door") {
        const isSelected = state.selection.kind === "entity" && state.selection.id === entity.id;
        if (isSelected) {
          const canFlipWithTap = !isSlidingDoor(entity);
          interactionRef.current = {
            type: "drag-entity",
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            startScreen: { x: event.clientX, y: event.clientY },
            startWorld: world,
            targetId: entity.id,
            entitySnapshot: entity,
            tapAction: canFlipWithTap ? "flip-door" : undefined,
            dragStarted: false,
          };
          svgRef.current?.setPointerCapture(event.pointerId);
          return;
        }

        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
        return;
      }

      const placed = tryPlaceDoorOrWindow("door", world, getDefaultDoorKind());
      if (!placed) {
        return;
      }
      dispatch({ type: "UPSERT_ENTITY", entity: placed });
      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: placed.id } });
      maybeAutoReturnToSelect("door");
      return;
    }

    if (state.activeTool === "window") {
      const world = getEventWorld(event);
      if (entity.type === "window") {
        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });

        interactionRef.current = {
          type: "drag-entity",
          pointerId: event.pointerId,
          pointerType: event.pointerType,
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
      maybeAutoReturnToSelect("window");
      return;
    }

    if (state.activeTool === "skylight") {
      const world = getEventWorld(event);
      if (entity.type === "skylight") {
        dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
        interactionRef.current = {
          type: "drag-entity",
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          startScreen: { x: event.clientX, y: event.clientY },
          startWorld: world,
          targetId: entity.id,
          entitySnapshot: entity,
        };
        svgRef.current?.setPointerCapture(event.pointerId);
        return;
      }

      const hostRectangle = findRectangleContainingPoint(world, rectangleEntities);
      if (!hostRectangle) {
        return;
      }

      const nextEntity = createEntityFromTool("skylight", Math.round(world.x), Math.round(world.y));
      nextEntity.metadata = {
        ...nextEntity.metadata,
        hostRectId: hostRectangle.id,
      };
      interactionRef.current = {
        type: "draw-rect",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: { x: Math.round(world.x), y: Math.round(world.y) },
        entitySnapshot: nextEntity,
        sourceRectangleId: undefined,
        dragStarted: false,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    const wasSelected =
      state.selection.kind === "entity" &&
      state.selection.id === entity.id;

    if (state.activeTool === "select" && entity.type === "door") {
      const world = getEventWorld(event);
      if (wasSelected) {
        const canFlipWithTap = !isSlidingDoor(entity);
        interactionRef.current = {
          type: "drag-entity",
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          startScreen: { x: event.clientX, y: event.clientY },
          startWorld: world,
          targetId: entity.id,
          entitySnapshot: entity,
          tapAction: canFlipWithTap ? "flip-door" : undefined,
          dragStarted: false,
        };
        svgRef.current?.setPointerCapture(event.pointerId);
        return;
      }

      interactionRef.current = {
        type: "pan",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: world,
        dragStarted: false,
        tapAction: "select-entity",
        targetId: entity.id,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (state.activeTool === "select" && !wasSelected) {
      const world = getEventWorld(event);
      interactionRef.current = {
        type: "pan",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld: world,
        dragStarted: false,
        tapAction: "select-entity",
        targetId: entity.id,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });

    if (state.activeTool !== "select") {
      return;
    }

    const world = getEventWorld(event);

    if (entity.type === "window") {
      interactionRef.current = {
        type: "drag-entity",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
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
        pointerType: event.pointerType,
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
      pointerType: event.pointerType,
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

    if (registerTouchPointer(event)) {
      return;
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
      pointerType: event.pointerType,
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

    if (registerTouchPointer(event)) {
      return;
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

  const setResizeHintZone = (entityId: string, zone: ResizeHintZone) => {
    setResizeHint({ entityId, zone });
  };

  const clearResizeHintZone = (entityId: string, zone: ResizeHintZone) => {
    setResizeHint((current) =>
      current && current.entityId === entityId && current.zone === zone ? null : current,
    );
  };

  const startRectangleResize = (
    event: ReactPointerEvent<SVGElement>,
    entity: MapEntity,
    handle: ResizeHandle,
  ) => {
    if (!isBumpOutResizeHandleAllowed(entity, handle)) {
      return;
    }

    event.stopPropagation();
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (registerTouchPointer(event)) {
      return;
    }

    setResizeHintZone(entity.id, `rect-${handle}` as ResizeHintZone);

    dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
    interactionRef.current = {
      type: "resize-rect",
      pointerId: event.pointerId,
      pointerType: event.pointerType,
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
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (registerTouchPointer(event)) {
      return;
    }

    const startWorld = getEventWorld(event);
    const bumpOutSegment = getHostBumpOutSegment(entity, rectangleEntities);
    if (bumpOutSegment && bumpOutSegment.length > Number.EPSILON) {
      const dx = bumpOutSegment.end.x - bumpOutSegment.start.x;
      const dy = bumpOutSegment.end.y - bumpOutSegment.start.y;
      const pointerAxis =
        ((startWorld.x - bumpOutSegment.start.x) * dx +
          (startWorld.y - bumpOutSegment.start.y) * dy) /
        bumpOutSegment.length;
      const centerAxis =
        ((entity.x - bumpOutSegment.start.x) * dx +
          (entity.y - bumpOutSegment.start.y) * dy) /
        bumpOutSegment.length;
      const resolvedHandle = pointerAxis < centerAxis ? "start" : pointerAxis > centerAxis ? "end" : handleHint;

      setResizeHintZone(entity.id, `window-${resolvedHandle}` as ResizeHintZone);

      dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
      interactionRef.current = {
        type: "resize-window",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld,
        targetId: entity.id,
        entitySnapshot: entity,
        windowHandle: resolvedHandle,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    const edge = (entity.metadata.edge as RectEdge | undefined) ?? "top";
    const horizontalEdge = edge === "top" || edge === "bottom";
    const pointerAxis = horizontalEdge ? startWorld.x : startWorld.y;
    const centerAxis = horizontalEdge ? entity.x : entity.y;
    const resolvedHandle = pointerAxis < centerAxis ? "start" : pointerAxis > centerAxis ? "end" : handleHint;

    setResizeHintZone(entity.id, `window-${resolvedHandle}` as ResizeHintZone);

    dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
    interactionRef.current = {
      type: "resize-window",
      pointerId: event.pointerId,
      pointerType: event.pointerType,
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
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.preventDefault();
    }

    if (registerTouchPointer(event)) {
      return;
    }

    dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: entity.id } });
    interactionRef.current = {
      type: "resize-rect",
      pointerId: event.pointerId,
      pointerType: event.pointerType,
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

  const displayEntities = useMemo(() => {
    if (!openingPlacementPreview) {
      return previewAdjustedEntities;
    }
    return [...previewAdjustedEntities, openingPlacementPreview];
  }, [openingPlacementPreview, previewAdjustedEntities]);

  const renderedNonTextEntities = displayEntities.filter((entity) => entity.type !== "text");
  const renderedTextEntities = displayEntities.filter((entity) => entity.type === "text");
  const duplicateConditionedBaseline = useMemo(() => {
    const orderedFloors = sortFloorsByPresetOrder(state.project.floors);
    const activeIndex = orderedFloors.findIndex((candidate) => candidate.id === floor.id);
    if (activeIndex <= 0) {
      return null;
    }

    const supportingFloor = orderedFloors[activeIndex - 1];
    if (!supportingFloor) {
      return null;
    }

    return supportingFloor.entities
      .filter((entity) => entity.type === "rectangle" && !Boolean(entity.metadata.unconditioned))
      .map((entity) => rectBoundsFromEntity(entity));
  }, [floor.id, state.project.floors]);
  const hideLinearMarkers =
    interactionRef.current.type === "draw-rect" ||
    (interactionRef.current.type === "resize-rect" && interactionRef.current.entitySnapshot?.type === "rectangle") ||
    (interactionRef.current.type === "drag-entity" && interactionRef.current.entitySnapshot?.type === "rectangle");

  const resizeCueRectangleEntity =
    state.previewEntity?.type === "rectangle" ? state.previewEntity : selectedRectangleEntity;

  const hideCameraControls =
    interactionRef.current.type === "draw-rect" && interactionRef.current.entitySnapshot?.type === "rectangle";
  const showCameraTools = !cameraPanelCollapsed && !hideCameraControls;
  const activeResizeInteraction =
    interactionRef.current.type === "resize-rect" ||
    interactionRef.current.type === "resize-window" ||
    interactionRef.current.type === "resize-skylight";
  const activeResizeZone: ResizeHintState | null = (() => {
    if (resizeHint) {
      return resizeHint;
    }

    const interaction = interactionRef.current;
    if ((interaction.type === "resize-rect" || interaction.type === "resize-skylight") && interaction.targetId && interaction.resizeHandle) {
      return { entityId: interaction.targetId, zone: `rect-${interaction.resizeHandle}` as ResizeHintZone };
    }

    if (interaction.type === "resize-window" && interaction.targetId && interaction.windowHandle) {
      return { entityId: interaction.targetId, zone: `window-${interaction.windowHandle}` as ResizeHintZone };
    }

    return null;
  })();

  const resizeCursorAngle = (() => {
    const target = activeResizeZone;
    if (!target) {
      return 0;
    }

    switch (target.zone) {
      case "rect-n":
      case "rect-s":
        return 90;
      case "rect-ne":
      case "rect-sw":
        return -45;
      case "rect-nw":
      case "rect-se":
        return 45;
      case "window-start":
      case "window-end": {
        const entity = floor.entities.find((candidate) => candidate.id === target.entityId);
        if (!entity) {
          return 0;
        }
        const edge = (entity.metadata.edge as RectEdge | undefined) ?? "top";
        return edge === "left" || edge === "right" ? 90 : 0;
      }
      case "rect-e":
      case "rect-w":
      default:
        return 0;
    }
  })();
  const showResizeCursorOverlay = Boolean(resizeHint) || activeResizeInteraction;
  const resizeCursorWorld = interactionRef.current.latestWorld ?? hoverWorld;
  const resizeCursorScreen = resizeCursorWorld
    ? {
        x: state.camera.x + resizeCursorWorld.x * state.camera.zoom,
        y: state.camera.y + resizeCursorWorld.y * state.camera.zoom,
      }
    : null;
  const draggingEntity = interactionRef.current.type === "drag-entity";
  const hoveringSelectedEntity =
    state.selection.kind === "entity" &&
    hoveredSelectedEntityId !== null &&
    hoveredSelectedEntityId === state.selection.id;
  const showMoveCursorOverlay = !showResizeCursorOverlay && (draggingEntity || hoveringSelectedEntity);
  const moveCursorWorld = interactionRef.current.latestWorld ?? hoverWorld;
  const moveCursorScreen = pointerScreen ??
    (moveCursorWorld
      ? {
          x: state.camera.x + moveCursorWorld.x * state.camera.zoom,
          y: state.camera.y + moveCursorWorld.y * state.camera.zoom,
        }
      : null);
  const showCustomCursorOverlay =
    (showResizeCursorOverlay && resizeCursorScreen) ||
    (showMoveCursorOverlay && moveCursorScreen);
  const showSelectedEditIcon = Boolean(selectedEditableEntity);

  return (
    <div className="workspace-wrap">
      {activeToolIsLockable && (
        <button
          type="button"
          className={`workspace-edit-btn workspace-tool-lock-btn ${activeToolIsLocked ? "is-locked" : ""}`}
          aria-label={`${activeToolIsLocked ? "Unlock" : "Lock"} ${state.activeTool} tool`}
          title={activeToolIsLocked ? "Unlock tool" : "Lock tool"}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dispatch({ type: "SET_TOOL_LOCK", enabled: !activeToolIsLocked, toolId: state.activeTool });
          }}
        >
          {renderWorkspaceToolIcon(state.activeTool, defaultDoorToolType)}
          {activeToolIsLocked && <img src={lockIcon} alt="" className="workspace-tool-lock-overlay" />}
        </button>
      )}
      <svg
        ref={svgRef}
        className={`workspace ${showCustomCursorOverlay ? "workspace-custom-cursor-active" : ""}`}
        onPointerDown={handleBackgroundDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(event) => {
          const target = event.target as Element | null;
          const isEmptyGridTarget = target === event.currentTarget || target?.tagName.toLowerCase() === "rect";
          if (isEmptyGridTarget && state.activeTool !== "select") {
            dispatch({ type: "SET_TOOL", tool: "select" });
          }
        }}
        onPointerLeave={() => {
          setResizeHint((current) => (current ? null : current));
          setHoveredSelectedEntityId(null);
          setOpeningPlacementPreview(null);
          setPointerScreen(null);
        }}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={handleWheel}
      >
        <defs>
          <pattern
            id="duplicate-conditioned-hatch"
            patternUnits="userSpaceOnUse"
            width={2.2}
            height={2.2}
            patternTransform="rotate(45)"
          >
            <line x1={0} y1={0} x2={0} y2={2.2} stroke="#a07a16" strokeWidth={0.13} />
          </pattern>

          <linearGradient id="workspace-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6baef6" />
            <stop offset="55%" stopColor="#4f93e7" />
            <stop offset="100%" stopColor="#3a7fd5" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="100%" height="100%" fill="url(#workspace-bg)" />

        <g transform={`translate(${state.camera.x}, ${state.camera.y}) scale(${state.camera.zoom})`}>
          {verticalGridLines.map((x) => (
            <line
              key={`vx-${x}`}
              x1={x}
              y1={worldViewport.minY}
              x2={x}
              y2={worldViewport.maxY}
              stroke="#a8c8ee"
              strokeWidth={x % 5 === 0 ? 1 : 1}
              vectorEffect="non-scaling-stroke"
              shapeRendering="crispEdges"
              opacity={x % 5 === 0 ? 0.38 : 0.24}
            />
          ))}
          {horizontalGridLines.map((y) => (
            <line
              key={`hy-${y}`}
              x1={worldViewport.minX}
              y1={y}
              x2={worldViewport.maxX}
              y2={y}
              stroke="#a8c8ee"
              strokeWidth={y % 5 === 0 ? 1 : 1}
              vectorEffect="non-scaling-stroke"
              shapeRendering="crispEdges"
              opacity={y % 5 === 0 ? 0.38 : 0.24}
            />
          ))}

          {!hideLinearMarkers &&
            rectangleGuideGroups.map((group, index) => (
              <PerimeterGuides key={`rg-perimeter-${index}`} guides={group.guides} />
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
              <g key={point.id}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={0.48}
                  fill="transparent"
                  onPointerDown={(event) => handleWallPointDown(event, point)}
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={selected ? 0.28 : 0.2}
                  fill={selected ? "#ffe59a" : "#d9f6ff"}
                  stroke="#2f4f4f"
                  strokeWidth={0.05}
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {renderedNonTextEntities.map((entity) => {
            const isOpeningPreviewEntity = entity.id === OPENING_PLACEMENT_PREVIEW_ID;
            const selected = state.selection.kind === "entity" && state.selection.id === entity.id;
            const isActiveWindowResize =
              interactionRef.current.type === "resize-window" && interactionRef.current.targetId === entity.id;
            const showWindowStartHint =
              selected &&
              (
                (resizeHint?.entityId === entity.id && resizeHint.zone === "window-start") ||
                (isActiveWindowResize && interactionRef.current.windowHandle === "start")
              );
            const showWindowEndHint =
              selected &&
              (
                (resizeHint?.entityId === entity.id && resizeHint.zone === "window-end") ||
                (isActiveWindowResize && interactionRef.current.windowHandle === "end")
              );
            const common = {
              transform: `translate(${entity.x} ${entity.y}) rotate(${entity.rotation})`,
            };
            return (
              <g
                key={entity.id}
                {...common}
                opacity={isOpeningPreviewEntity ? 0.45 : 1}
                pointerEvents={isOpeningPreviewEntity ? "none" : undefined}
                onPointerDown={(event) => handleEntityDown(event, entity)}
                onPointerEnter={() => {
                  if (state.selection.kind === "entity" && state.selection.id === entity.id) {
                    setHoveredSelectedEntityId(entity.id);
                  }
                }}
                onPointerLeave={() => {
                  if (state.selection.kind === "entity" && state.selection.id === entity.id) {
                    setHoveredSelectedEntityId((current) => (current === entity.id ? null : current));
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
                      const doorVisualWidth = Math.max(1, getDoorVisualWidth(entity));
                      const doorKind = getDoorKind(entity);
                      const flipSign = Boolean(entity.metadata.flipped) ? -1 : 1;
                      const mirrorSign = Boolean(entity.metadata.mirrored) ? -1 : 1;
                      const edge = (entity.metadata.edge as RectEdge | undefined) ?? "top";
                      const wedgePath = `M ${-doorVisualWidth / 2} 0 L ${doorVisualWidth / 2} 0 A ${doorVisualWidth} ${doorVisualWidth} 0 0 1 ${-doorVisualWidth / 2} ${doorVisualWidth} Z`;
                      const labelY = flipSign === 1 ? -WINDOW_LABEL_OFFSET : WINDOW_LABEL_OFFSET;
                      const isBottomOrientedOpening = edge === "bottom";
                      const renderedLabelY =
                        selected && isBottomOrientedOpening
                          ? pushLabelFurtherFromOpening(labelY, OPENING_LABEL_UNDER_SELECTED_PADDING)
                          : labelY;
                      const halfLeaf = doorVisualWidth / 2;
                      const leftLeafPath = `M ${-doorVisualWidth / 2} 0 L 0 0 A ${halfLeaf} ${halfLeaf} 0 0 1 ${-doorVisualWidth / 2} ${halfLeaf} Z`;
                      const rightLeafPath = `M ${doorVisualWidth / 2} 0 L 0 0 A ${halfLeaf} ${halfLeaf} 0 0 0 ${doorVisualWidth / 2} ${halfLeaf} Z`;

                      if (doorKind === "sliding") {
                        const slidingTypeLabelY = -renderedLabelY;
                        return (
                          <>
                            {selected && (
                              <rect
                                x={-doorVisualWidth / 2 - WINDOW_SELECTION_PADDING}
                                y={-WINDOW_FILL_THICKNESS / 2 - WINDOW_SELECTION_PADDING}
                                width={doorVisualWidth + WINDOW_SELECTION_PADDING * 2}
                                height={WINDOW_FILL_THICKNESS + WINDOW_SELECTION_PADDING * 2}
                                fill="transparent"
                                stroke="#ffe59a"
                                strokeWidth={0.2}
                                rx={0.14}
                              />
                            )}
                            <rect
                              x={-doorVisualWidth / 2}
                              y={-WINDOW_FILL_THICKNESS / 2}
                              width={doorVisualWidth}
                              height={WINDOW_FILL_THICKNESS}
                              fill={OPENING_ACCENT_COLOR}
                              stroke="#ffffff"
                              strokeWidth={0.22}
                            />
                            <line
                              x1={0}
                              y1={-WINDOW_FILL_THICKNESS / 2}
                              x2={0}
                              y2={WINDOW_FILL_THICKNESS / 2}
                              stroke="#ffffff"
                              strokeWidth={0.14}
                            />
                            {selected && (
                              <>
                                <rect
                                  x={-doorVisualWidth / 2 - WINDOW_ANCHOR_WIDTH / 2 - WINDOW_HANDLE_HIT_SLOP}
                                  y={-WINDOW_ANCHOR_HEIGHT / 2 - WINDOW_HANDLE_HIT_SLOP}
                                  width={WINDOW_ANCHOR_WIDTH + WINDOW_HANDLE_HIT_SLOP * 2}
                                  height={WINDOW_ANCHOR_HEIGHT + WINDOW_HANDLE_HIT_SLOP * 2}
                                  fill="transparent"
                                  onPointerEnter={() => setResizeHintZone(entity.id, "window-start")}
                                  onPointerLeave={() => clearResizeHintZone(entity.id, "window-start")}
                                  onPointerDown={(event) => startWindowResize(event, entity, "start")}
                                />
                                {showWindowStartHint && (
                                  <rect
                                    x={-doorVisualWidth / 2 - WINDOW_ANCHOR_WIDTH / 2 - 0.12}
                                    y={-WINDOW_ANCHOR_HEIGHT / 2 - 0.12}
                                    width={WINDOW_ANCHOR_WIDTH + 0.24}
                                    height={WINDOW_ANCHOR_HEIGHT + 0.24}
                                    rx={0.12}
                                    fill="rgba(255, 229, 154, 0.26)"
                                    stroke="#ffe59a"
                                    strokeWidth={0.08}
                                    pointerEvents="none"
                                  />
                                )}
                                <rect
                                  x={-doorVisualWidth / 2 - WINDOW_ANCHOR_WIDTH / 2}
                                  y={-WINDOW_ANCHOR_HEIGHT / 2}
                                  width={WINDOW_ANCHOR_WIDTH}
                                  height={WINDOW_ANCHOR_HEIGHT}
                                  rx={0.04}
                                  fill="#ffffff"
                                  stroke="#ffe59a"
                                  strokeWidth={0.06}
                                  pointerEvents="none"
                                />
                                <rect
                                  x={doorVisualWidth / 2 - WINDOW_ANCHOR_WIDTH / 2 - WINDOW_HANDLE_HIT_SLOP}
                                  y={-WINDOW_ANCHOR_HEIGHT / 2 - WINDOW_HANDLE_HIT_SLOP}
                                  width={WINDOW_ANCHOR_WIDTH + WINDOW_HANDLE_HIT_SLOP * 2}
                                  height={WINDOW_ANCHOR_HEIGHT + WINDOW_HANDLE_HIT_SLOP * 2}
                                  fill="transparent"
                                  onPointerEnter={() => setResizeHintZone(entity.id, "window-end")}
                                  onPointerLeave={() => clearResizeHintZone(entity.id, "window-end")}
                                  onPointerDown={(event) => startWindowResize(event, entity, "end")}
                                />
                                {showWindowEndHint && (
                                  <rect
                                    x={doorVisualWidth / 2 - WINDOW_ANCHOR_WIDTH / 2 - 0.12}
                                    y={-WINDOW_ANCHOR_HEIGHT / 2 - 0.12}
                                    width={WINDOW_ANCHOR_WIDTH + 0.24}
                                    height={WINDOW_ANCHOR_HEIGHT + 0.24}
                                    rx={0.12}
                                    fill="rgba(255, 229, 154, 0.26)"
                                    stroke="#ffe59a"
                                    strokeWidth={0.08}
                                    pointerEvents="none"
                                  />
                                )}
                                <rect
                                  x={doorVisualWidth / 2 - WINDOW_ANCHOR_WIDTH / 2}
                                  y={-WINDOW_ANCHOR_HEIGHT / 2}
                                  width={WINDOW_ANCHOR_WIDTH}
                                  height={WINDOW_ANCHOR_HEIGHT}
                                  rx={0.04}
                                  fill="#ffffff"
                                  stroke="#ffe59a"
                                  strokeWidth={0.06}
                                  pointerEvents="none"
                                />
                              </>
                            )}
                            <text
                              x={0}
                              y={renderedLabelY}
                              textAnchor="middle"
                              fill={OPENING_SIZE_LABEL_COLOR}
                              fontSize={OPENING_SIZE_LABEL_FONT_SIZE}
                              fontWeight={900}
                              transform={edge === "bottom" ? `rotate(180 0 ${renderedLabelY})` : undefined}
                            >
                              {`${fmtFeet(entity.width)} x ${fmtFeet(entity.height)}`}
                            </text>
                            <text
                              x={0}
                              y={slidingTypeLabelY}
                              textAnchor="middle"
                              fill={OPENING_SIZE_LABEL_COLOR}
                              fontSize={OPENING_SIZE_LABEL_FONT_SIZE * 0.78}
                              fontWeight={900}
                              transform={edge === "bottom" ? `rotate(180 0 ${slidingTypeLabelY})` : undefined}
                            >
                              SLIDING DOOR
                            </text>
                          </>
                        );
                      }

                      return (
                        <>
                          {selected && (
                            <rect
                              x={-doorVisualWidth / 2 - 0.2}
                              y={(flipSign === 1 ? 0 : -doorVisualWidth) - 0.2}
                              width={doorVisualWidth + 0.4}
                              height={doorVisualWidth + 0.4}
                              fill="transparent"
                              stroke="#ffe59a"
                              strokeWidth={0.2}
                              rx={0.14}
                            />
                          )}
                          <g transform={`scale(${mirrorSign} ${flipSign})`}>
                            {doorKind === "double" ? (
                              <>
                                <path d={leftLeafPath} fill={DOOR_FILL_COLOR} fillOpacity={0.92} />
                                <path d={leftLeafPath} fill="none" stroke="#ffffff" strokeWidth={0.22} />
                                <path d={rightLeafPath} fill={DOOR_FILL_COLOR} fillOpacity={0.92} />
                                <path d={rightLeafPath} fill="none" stroke="#ffffff" strokeWidth={0.22} />
                                <line
                                  x1={-doorVisualWidth / 2}
                                  y1={0}
                                  x2={-doorVisualWidth / 2}
                                  y2={halfLeaf}
                                  stroke="#ffffff"
                                  strokeWidth={0.22}
                                />
                                <line
                                  x1={doorVisualWidth / 2}
                                  y1={0}
                                  x2={doorVisualWidth / 2}
                                  y2={halfLeaf}
                                  stroke="#ffffff"
                                  strokeWidth={0.22}
                                />
                                <line
                                  x1={-doorVisualWidth / 2}
                                  y1={0}
                                  x2={doorVisualWidth / 2}
                                  y2={0}
                                  stroke="#ffffff"
                                  strokeWidth={0.22}
                                />
                              </>
                            ) : (
                              <>
                                <path d={wedgePath} fill={DOOR_FILL_COLOR} fillOpacity={0.92} />
                                <path d={wedgePath} fill="none" stroke="#ffffff" strokeWidth={0.22} />
                                <line
                                  x1={-doorVisualWidth / 2}
                                  y1={0}
                                  x2={-doorVisualWidth / 2}
                                  y2={doorVisualWidth}
                                  stroke="#ffffff"
                                  strokeWidth={0.22}
                                />
                                <line
                                  x1={-doorVisualWidth / 2}
                                  y1={0}
                                  x2={doorVisualWidth / 2}
                                  y2={0}
                                  stroke="#ffffff"
                                  strokeWidth={0.22}
                                />
                              </>
                            )}
                          </g>
                          <text
                            x={0}
                            y={renderedLabelY}
                            textAnchor="middle"
                            fill={OPENING_SIZE_LABEL_COLOR}
                            fontSize={OPENING_SIZE_LABEL_FONT_SIZE}
                            fontWeight={900}
                            transform={edge === "bottom" ? `rotate(180 0 ${renderedLabelY})` : undefined}
                          >
                            {`${fmtFeet(entity.width)} x ${fmtFeet(entity.height)}`}
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
                      fill={OPENING_ACCENT_COLOR}
                      stroke="#ffffff"
                      strokeWidth={0.22}
                    />
                    {selected && (
                      <>
                        <rect
                          x={-entity.width / 2 - WINDOW_ANCHOR_WIDTH / 2 - WINDOW_HANDLE_HIT_SLOP}
                          y={-WINDOW_ANCHOR_HEIGHT / 2 - WINDOW_HANDLE_HIT_SLOP}
                          width={WINDOW_ANCHOR_WIDTH + WINDOW_HANDLE_HIT_SLOP * 2}
                          height={WINDOW_ANCHOR_HEIGHT + WINDOW_HANDLE_HIT_SLOP * 2}
                          fill="transparent"
                          onPointerEnter={() => setResizeHintZone(entity.id, "window-start")}
                          onPointerLeave={() => clearResizeHintZone(entity.id, "window-start")}
                          onPointerDown={(event) => startWindowResize(event, entity, "start")}
                        />
                        {showWindowStartHint && (
                          <rect
                            x={-entity.width / 2 - WINDOW_ANCHOR_WIDTH / 2 - 0.12}
                            y={-WINDOW_ANCHOR_HEIGHT / 2 - 0.12}
                            width={WINDOW_ANCHOR_WIDTH + 0.24}
                            height={WINDOW_ANCHOR_HEIGHT + 0.24}
                            rx={0.12}
                            fill="rgba(255, 229, 154, 0.26)"
                            stroke="#ffe59a"
                            strokeWidth={0.08}
                            pointerEvents="none"
                          />
                        )}
                        <rect
                          x={-entity.width / 2 - WINDOW_ANCHOR_WIDTH / 2}
                          y={-WINDOW_ANCHOR_HEIGHT / 2}
                          width={WINDOW_ANCHOR_WIDTH}
                          height={WINDOW_ANCHOR_HEIGHT}
                          rx={0.04}
                          fill="#ffffff"
                          stroke="#ffe59a"
                          strokeWidth={0.06}
                          onPointerDown={(event) => startWindowResize(event, entity, "start")}
                          style={{
                            cursor:
                              selectedOpeningEdge === "left" || selectedOpeningEdge === "right"
                                ? "ns-resize"
                                : "ew-resize",
                          }}
                          pointerEvents="none"
                        />
                        <rect
                          x={entity.width / 2 - WINDOW_ANCHOR_WIDTH / 2 - WINDOW_HANDLE_HIT_SLOP}
                          y={-WINDOW_ANCHOR_HEIGHT / 2 - WINDOW_HANDLE_HIT_SLOP}
                          width={WINDOW_ANCHOR_WIDTH + WINDOW_HANDLE_HIT_SLOP * 2}
                          height={WINDOW_ANCHOR_HEIGHT + WINDOW_HANDLE_HIT_SLOP * 2}
                          fill="transparent"
                          onPointerEnter={() => setResizeHintZone(entity.id, "window-end")}
                          onPointerLeave={() => clearResizeHintZone(entity.id, "window-end")}
                          onPointerDown={(event) => startWindowResize(event, entity, "end")}
                        />
                        {showWindowEndHint && (
                          <rect
                            x={entity.width / 2 - WINDOW_ANCHOR_WIDTH / 2 - 0.12}
                            y={-WINDOW_ANCHOR_HEIGHT / 2 - 0.12}
                            width={WINDOW_ANCHOR_WIDTH + 0.24}
                            height={WINDOW_ANCHOR_HEIGHT + 0.24}
                            rx={0.12}
                            fill="rgba(255, 229, 154, 0.26)"
                            stroke="#ffe59a"
                            strokeWidth={0.08}
                            pointerEvents="none"
                          />
                        )}
                        <rect
                          x={entity.width / 2 - WINDOW_ANCHOR_WIDTH / 2}
                          y={-WINDOW_ANCHOR_HEIGHT / 2}
                          width={WINDOW_ANCHOR_WIDTH}
                          height={WINDOW_ANCHOR_HEIGHT}
                          rx={0.04}
                          fill="#ffffff"
                          stroke="#ffe59a"
                          strokeWidth={0.06}
                          onPointerDown={(event) => startWindowResize(event, entity, "end")}
                          style={{
                            cursor:
                              selectedOpeningEdge === "left" || selectedOpeningEdge === "right"
                                ? "ns-resize"
                                : "ew-resize",
                          }}
                          pointerEvents="none"
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
                      fill={OPENING_ACCENT_COLOR}
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
                ) : entity.type === "rectangle" && isBumpOutRectangle(entity) ? (
                  <g>
                    {(() => {
                      const width = Math.max(entity.width, 0.4);
                      const height = Math.max(entity.height, 0.4);
                      const points = getBumpOutRenderPoints(entity);
                      const path = bumpOutPath(points);
                      const hostEdge = (entity.metadata.hostEdge as RectEdge | undefined) ?? "top";
                      const isUnconditioned = Boolean(entity.metadata.unconditioned);
                      const strokeColor = selected ? "#ffe59a" : "#ffffff";
                      const strokeWidth = selected ? 0.28 : 0.22;
                      const hostCutStrokeWidth = strokeWidth + 0.08;
                      const strokeMaskId = `bumpout-stroke-mask-${entity.id}`;

                      let hostDashLine: ReactElement;
                      if (hostEdge === "top") {
                        hostDashLine = <line x1={0} y1={height} x2={width} y2={height} shapeRendering="crispEdges" />;
                      } else if (hostEdge === "bottom") {
                        hostDashLine = <line x1={0} y1={0} x2={width} y2={0} shapeRendering="crispEdges" />;
                      } else if (hostEdge === "left") {
                        hostDashLine = <line x1={width} y1={0} x2={width} y2={height} shapeRendering="crispEdges" />;
                      } else {
                        hostDashLine = <line x1={0} y1={0} x2={0} y2={height} shapeRendering="crispEdges" />;
                      }

                      return (
                        <>
                          {isUnconditioned && (
                            <g pointerEvents="none">
                              <line x1={0} y1={0} x2={width} y2={height} stroke="#c53d3d" strokeWidth={0.24} />
                              <line x1={width} y1={0} x2={0} y2={height} stroke="#c53d3d" strokeWidth={0.24} />
                            </g>
                          )}
                          <path
                            d={`${path} Z`}
                            fill={getRectangleFillColor(entity.metadata.color ?? "Blue")}
                            stroke="none"
                            shapeRendering="crispEdges"
                          />
                          <mask id={strokeMaskId} maskUnits="userSpaceOnUse" x={-1} y={-1} width={width + 2} height={height + 2}>
                            <rect x={-1} y={-1} width={width + 2} height={height + 2} fill="#ffffff" />
                            <g
                              pointerEvents="none"
                              stroke="#000000"
                              strokeWidth={hostCutStrokeWidth}
                              shapeRendering="crispEdges"
                            >
                              {hostDashLine}
                            </g>
                          </mask>
                          <path
                            d={`${path} Z`}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={strokeWidth}
                            strokeLinejoin="round"
                            shapeRendering="crispEdges"
                            mask={`url(#${strokeMaskId})`}
                          />
                          <g
                            pointerEvents="none"
                            stroke={strokeColor}
                            strokeWidth={strokeWidth}
                            strokeDasharray="0.5 0.3"
                            strokeDashoffset={hostEdge === "top" || hostEdge === "bottom" ? getAlignedDashOffset(entity.x) : getAlignedDashOffset(entity.y)}
                            strokeLinecap="butt"
                            opacity={1}
                            shapeRendering="crispEdges"
                          >
                            {hostDashLine}
                          </g>
                        </>
                      );
                    })()}
                  </g>
                ) : entity.type === "rectangle" ? (
                  <g>
                    {(() => {
                      const width = Math.max(entity.width, 0.4);
                      const height = Math.max(entity.height, 0.4);
                      const isUnconditioned = Boolean(entity.metadata.unconditioned);
                      const duplicateOverflowCells =
                        duplicateConditionedBaseline && !isUnconditioned
                          ? getCellsOutsideDuplicateConditionedBaseline(
                              { x: entity.x, y: entity.y, width, height },
                              duplicateConditionedBaseline,
                            )
                          : [];
                      const duplicateOverflowRegions = buildDuplicateOverflowRegions(duplicateOverflowCells);
                      const strokeColor = selected ? "#ffe59a" : "#ffffff";
                      const strokeWidth = selected ? 0.28 : 0.22;
                      const strokeMaskId = `rect-stroke-mask-${entity.id}`;
                      const cutStrokeWidth = strokeWidth + 0.08;
                      const connectedRanges = conditionedConnectedEdgeRanges.carveById.get(entity.id) ?? {
                        top: [],
                        right: [],
                        bottom: [],
                        left: [],
                      };
                      const dashRanges = conditionedConnectedEdgeRanges.dashById.get(entity.id) ?? {
                        top: [],
                        right: [],
                        bottom: [],
                        left: [],
                      };

                      const renderHorizontalRangeLines = (
                        y: number,
                        ranges: EdgeRange[],
                        keyPrefix: string,
                        options?: { dashed?: boolean; stroke?: string; strokeWidth?: number; shapeRendering?: "crispEdges" | "geometricPrecision" },
                      ) => {
                        const edgeStart = entity.x;
                        const edgeEnd = entity.x + width;
                        const segments: ReactElement[] = [];

                        for (const range of ranges) {
                          const start = Math.max(edgeStart, range.start);
                          const end = Math.min(edgeEnd, range.end);
                          if (end <= start) {
                            continue;
                          }
                          segments.push(
                            <line
                              key={`${keyPrefix}-${start}-${end}`}
                              x1={start - entity.x}
                              y1={y}
                              x2={end - entity.x}
                              y2={y}
                              stroke={options?.stroke ?? strokeColor}
                              strokeWidth={options?.strokeWidth ?? strokeWidth}
                              strokeDasharray={options?.dashed ? "0.5 0.3" : undefined}
                              strokeDashoffset={options?.dashed ? getAlignedDashOffset(start) : undefined}
                              strokeLinecap="butt"
                              shapeRendering={options?.shapeRendering ?? "geometricPrecision"}
                            />,
                          );
                        }

                        return segments;
                      };

                      const renderVerticalRangeLines = (
                        x: number,
                        ranges: EdgeRange[],
                        keyPrefix: string,
                        options?: { dashed?: boolean; stroke?: string; strokeWidth?: number; shapeRendering?: "crispEdges" | "geometricPrecision" },
                      ) => {
                        const edgeStart = entity.y;
                        const edgeEnd = entity.y + height;
                        const segments: ReactElement[] = [];

                        for (const range of ranges) {
                          const start = Math.max(edgeStart, range.start);
                          const end = Math.min(edgeEnd, range.end);
                          if (end <= start) {
                            continue;
                          }
                          segments.push(
                            <line
                              key={`${keyPrefix}-${start}-${end}`}
                              x1={x}
                              y1={start - entity.y}
                              x2={x}
                              y2={end - entity.y}
                              stroke={options?.stroke ?? strokeColor}
                              strokeWidth={options?.strokeWidth ?? strokeWidth}
                              strokeDasharray={options?.dashed ? "0.5 0.3" : undefined}
                              strokeDashoffset={options?.dashed ? getAlignedDashOffset(start) : undefined}
                              strokeLinecap="butt"
                              shapeRendering={options?.shapeRendering ?? "geometricPrecision"}
                            />,
                          );
                        }

                        return segments;
                      };

                      return (
                        <>
                          {isUnconditioned && (
                            <g pointerEvents="none">
                              <line x1={0} y1={0} x2={width} y2={height} stroke="#c53d3d" strokeWidth={0.24} />
                              <line x1={width} y1={0} x2={0} y2={height} stroke="#c53d3d" strokeWidth={0.24} />
                            </g>
                          )}
                          <rect
                            x={0}
                            y={0}
                            width={width}
                            height={height}
                            rx={0.1}
                            fill={getRectangleFillColor(entity.metadata.color ?? "Blue")}
                            shapeRendering="crispEdges"
                          />
                          {duplicateOverflowRegions.length > 0 && (
                            <g pointerEvents="none">
                              {duplicateOverflowRegions.map((region, regionIndex) => {
                                const labelCenterX = (region.minX + region.maxX) / 2 - entity.x;
                                const labelCenterY = (region.minY + region.maxY) / 2 - entity.y;
                                const regionAreaFt2 = region.cells.length;
                                const outlineLoops = buildOverflowOutlineLoops(region.outline);
                                const labelFontSize = clampValue(
                                  Math.min(region.maxX - region.minX, region.maxY - region.minY) * 0.22,
                                  0.34,
                                  0.62,
                                );

                                return (
                                  <g key={`${entity.id}-dup-overflow-region-${regionIndex}`}>
                                    {region.cells.map((cell) => (
                                      <g key={`${entity.id}-dup-overflow-${cell.x}-${cell.y}`}>
                                        <rect
                                          x={cell.x - entity.x}
                                          y={cell.y - entity.y}
                                          width={cell.width}
                                          height={cell.height}
                                          fill="rgba(242, 202, 69, 0.72)"
                                        />
                                        <rect
                                          x={cell.x - entity.x}
                                          y={cell.y - entity.y}
                                          width={cell.width}
                                          height={cell.height}
                                          fill="url(#duplicate-conditioned-hatch)"
                                        />
                                      </g>
                                    ))}

                                    {outlineLoops.map((loop, loopIndex) => {
                                      const pathData = loop
                                        .map((point, pointIndex) => {
                                          const x = point.x - entity.x;
                                          const y = point.y - entity.y;
                                          return `${pointIndex === 0 ? "M" : "L"} ${x} ${y}`;
                                        })
                                        .join(" ");

                                      return (
                                        <path
                                          key={`${entity.id}-dup-overflow-outline-${regionIndex}-${loopIndex}`}
                                          d={`${pathData} Z`}
                                          fill="none"
                                          stroke="#b58518"
                                          strokeWidth={0.08}
                                          strokeLinejoin="round"
                                          strokeLinecap="round"
                                          vectorEffect="non-scaling-stroke"
                                        />
                                      );
                                    })}

                                    <text
                                      x={labelCenterX}
                                      y={labelCenterY - labelFontSize * 0.36}
                                      textAnchor="middle"
                                      fill="#6d4f09"
                                      fontSize={labelFontSize}
                                      fontWeight={900}
                                      stroke="rgba(255, 252, 237, 0.72)"
                                      strokeWidth={0.028}
                                      paintOrder="stroke"
                                    >
                                      over unconditoned space
                                    </text>
                                    <text
                                      x={labelCenterX}
                                      y={labelCenterY + labelFontSize * 0.8}
                                      textAnchor="middle"
                                      fill="#6d4f09"
                                      fontSize={labelFontSize}
                                      fontWeight={900}
                                      stroke="rgba(255, 252, 237, 0.72)"
                                      strokeWidth={0.028}
                                      paintOrder="stroke"
                                    >
                                      {`${regionAreaFt2} FT²`}
                                    </text>
                                  </g>
                                );
                              })}
                            </g>
                          )}
                          {!isUnconditioned && (
                            <mask id={strokeMaskId} maskUnits="userSpaceOnUse" x={-1} y={-1} width={width + 2} height={height + 2}>
                              <rect x={-1} y={-1} width={width + 2} height={height + 2} fill="#ffffff" />
                              {renderHorizontalRangeLines(0, connectedRanges.top, `${entity.id}-cut-top`, {
                                stroke: "#000000",
                                strokeWidth: cutStrokeWidth,
                                shapeRendering: "crispEdges",
                              })}
                              {renderHorizontalRangeLines(height, connectedRanges.bottom, `${entity.id}-cut-bottom`, {
                                stroke: "#000000",
                                strokeWidth: cutStrokeWidth,
                                shapeRendering: "crispEdges",
                              })}
                              {renderVerticalRangeLines(0, connectedRanges.left, `${entity.id}-cut-left`, {
                                stroke: "#000000",
                                strokeWidth: cutStrokeWidth,
                                shapeRendering: "crispEdges",
                              })}
                              {renderVerticalRangeLines(width, connectedRanges.right, `${entity.id}-cut-right`, {
                                stroke: "#000000",
                                strokeWidth: cutStrokeWidth,
                                shapeRendering: "crispEdges",
                              })}
                            </mask>
                          )}
                          <rect
                            x={0}
                            y={0}
                            width={width}
                            height={height}
                            rx={0.1}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={strokeWidth}
                            shapeRendering="crispEdges"
                            mask={!isUnconditioned ? `url(#${strokeMaskId})` : undefined}
                          />
                          {!isUnconditioned && (
                            <g pointerEvents="none">
                              {renderHorizontalRangeLines(0, dashRanges.top, `${entity.id}-dash-top`, { dashed: true })}
                              {renderHorizontalRangeLines(height, dashRanges.bottom, `${entity.id}-dash-bottom`, { dashed: true })}
                              {renderVerticalRangeLines(0, dashRanges.left, `${entity.id}-dash-left`, { dashed: true })}
                              {renderVerticalRangeLines(width, dashRanges.right, `${entity.id}-dash-right`, { dashed: true })}
                            </g>
                          )}
                        </>
                      );
                    })()}
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

                {entity.type === "rectangle" && sharedCeilingOverlayPlacement.visibleIds.has(entity.id) && (
                  <RectangleCeilingOverlay entity={entity} anchor={sharedCeilingOverlayPlacement.anchorById.get(entity.id)} />
                )}

                {entity.type === "rectangle" && (entity.label ?? "").trim().length > 0 && (() => {
                  const width = Math.max(entity.width, 0.4);
                  const height = Math.max(entity.height, 0.4);
                  const label = (entity.label ?? "").trim().toUpperCase();
                  const ceilingType = String(entity.metadata.ceilingType ?? "standard");
                  const hasStandardCeilingBox =
                    ceilingType === "standard" && sharedCeilingOverlayPlacement.visibleIds.has(entity.id);
                  const overlayAnchorY = sharedCeilingOverlayPlacement.anchorById.get(entity.id)?.y ?? height / 2;
                  const standardBoxTopY = overlayAnchorY - 1.3;
                  const y = hasStandardCeilingBox
                    ? Math.max(0.82, standardBoxTopY - 0.44)
                    : Math.max(0.82, height * 0.42);

                  // Keep a consistent default label size and only scale down when it would overflow this rectangle.
                  const horizontalPadding = 0.6;
                  const availableWidth = Math.max(0.2, width - horizontalPadding);
                  const estimatedLabelWidthAtDefault =
                    label.length * RECTANGLE_LABEL_DEFAULT_FONT_SIZE * 0.62;
                  const scaleDown =
                    estimatedLabelWidthAtDefault > availableWidth
                      ? availableWidth / estimatedLabelWidthAtDefault
                      : 1;
                  const fontSize = Math.max(
                    RECTANGLE_LABEL_MIN_FONT_SIZE,
                    RECTANGLE_LABEL_DEFAULT_FONT_SIZE * scaleDown,
                  );

                  return (
                    <text
                      x={width / 2}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#ffffff"
                      fontSize={fontSize}
                      fontWeight={900}
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {label}
                    </text>
                  );
                })()}

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
                  (() => {
                    const windowEdge = (entity.metadata.edge as RectEdge | undefined) ?? "top";
                    const isBottomOrientedOpening = windowEdge === "bottom";
                    const baseWindowLabelY = -WINDOW_LABEL_OFFSET;
                    const windowLabelY =
                      selected && isBottomOrientedOpening
                        ? pushLabelFurtherFromOpening(
                            baseWindowLabelY,
                            OPENING_LABEL_UNDER_SELECTED_PADDING + WINDOW_BOTTOM_LABEL_EXTRA_PADDING,
                          )
                        : baseWindowLabelY;
                    return (
                  <text
                    x={0}
                    y={windowLabelY}
                    textAnchor="middle"
                    fill={OPENING_SIZE_LABEL_COLOR}
                    fontSize={OPENING_SIZE_LABEL_FONT_SIZE}
                    fontWeight={900}
                    transform={
                      windowEdge === "bottom"
                        ? `rotate(180 0 ${windowLabelY})`
                        : undefined
                    }
                  >
                    {`${fmtFeet(entity.width)} x ${fmtFeet(entity.height)}`}
                  </text>
                    );
                  })()
                )}

                {entity.type === "skylight" && (
                  <text
                    x={0}
                    y={entity.height / 2 + 0.88 + (selected ? OPENING_LABEL_UNDER_SELECTED_PADDING : 0)}
                    textAnchor="middle"
                    fill={OPENING_SIZE_LABEL_COLOR}
                    fontSize={OPENING_SIZE_LABEL_FONT_SIZE}
                    fontWeight={900}
                  >
                    {`${fmtFeet(entity.width)} x ${fmtFeet(entity.height)}`}
                  </text>
                )}
              </g>
            );
          })}

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

          {!hideLinearMarkers && draftEntity?.type === "rectangle" && (
            <DraftRectangleGuides
              rect={{
                x: draftEntity.x,
                y: draftEntity.y,
                width: Math.abs(draftEntity.width),
                height: Math.abs(draftEntity.height),
              }}
            />
          )}

          {draftEntity?.type === "rectangle" &&
            interactionRef.current.type === "draw-rect" &&
            interactionRef.current.dragStarted && (
              <RectangleDragSizeCue
                rect={{
                  x: draftEntity.x,
                  y: draftEntity.y,
                  width: Math.abs(draftEntity.width),
                  height: Math.abs(draftEntity.height),
                }}
              />
            )}

          {draftEntity?.type === "skylight" &&
            interactionRef.current.type === "draw-rect" &&
            interactionRef.current.dragStarted && (
              <RectangleDragSizeCue
                rect={{
                  x: draftEntity.x,
                  y: draftEntity.y,
                  width: Math.abs(draftEntity.width),
                  height: Math.abs(draftEntity.height),
                }}
              />
            )}

          {interactionRef.current.type === "resize-rect" &&
            interactionRef.current.entitySnapshot?.type === "rectangle" &&
            resizeCueRectangleEntity && <RectangleDragSizeCue rect={rectBoundsFromEntity(resizeCueRectangleEntity)} />}

          {selectedRectangleEntity && (() => {
            const rect = rectBoundsFromEntity(selectedRectangleEntity);
            const x1 = rect.x;
            const y1 = rect.y;
            const x2 = rect.x + rect.width;
            const y2 = rect.y + rect.height;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const activeRectZone =
              resizeHint?.entityId === selectedRectangleEntity.id ? resizeHint.zone : null;
            const isActiveRectResize =
              interactionRef.current.type === "resize-rect" && interactionRef.current.targetId === selectedRectangleEntity.id;
            const activeRectResizeZone = isActiveRectResize
              ? (`rect-${interactionRef.current.resizeHandle}` as ResizeHintZone)
              : null;
            const showRectZoneHint = (zone: ResizeHintZone) =>
              activeRectZone === zone || activeRectResizeZone === zone;
            const canUseHandle = (handle: ResizeHandle) =>
              isBumpOutResizeHandleAllowed(selectedRectangleEntity, handle);
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
                  strokeWidth={2}
                  style={{ cursor: canUseHandle("n") ? "ns-resize" : "default" }}
                  onPointerEnter={() => canUseHandle("n") && setResizeHintZone(selectedRectangleEntity.id, "rect-n")}
                  onPointerLeave={() => canUseHandle("n") && clearResizeHintZone(selectedRectangleEntity.id, "rect-n")}
                  onPointerDown={(event) => canUseHandle("n") && startRectangleResize(event, selectedRectangleEntity, "n")}
                />
                <line
                  x1={x1}
                  y1={y2}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={2}
                  style={{ cursor: canUseHandle("s") ? "ns-resize" : "default" }}
                  onPointerEnter={() => canUseHandle("s") && setResizeHintZone(selectedRectangleEntity.id, "rect-s")}
                  onPointerLeave={() => canUseHandle("s") && clearResizeHintZone(selectedRectangleEntity.id, "rect-s")}
                  onPointerDown={(event) => canUseHandle("s") && startRectangleResize(event, selectedRectangleEntity, "s")}
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x1}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={2}
                  style={{ cursor: canUseHandle("w") ? "ew-resize" : "default" }}
                  onPointerEnter={() => canUseHandle("w") && setResizeHintZone(selectedRectangleEntity.id, "rect-w")}
                  onPointerLeave={() => canUseHandle("w") && clearResizeHintZone(selectedRectangleEntity.id, "rect-w")}
                  onPointerDown={(event) => canUseHandle("w") && startRectangleResize(event, selectedRectangleEntity, "w")}
                />
                <line
                  x1={x2}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={2}
                  style={{ cursor: canUseHandle("e") ? "ew-resize" : "default" }}
                  onPointerEnter={() => canUseHandle("e") && setResizeHintZone(selectedRectangleEntity.id, "rect-e")}
                  onPointerLeave={() => canUseHandle("e") && clearResizeHintZone(selectedRectangleEntity.id, "rect-e")}
                  onPointerDown={(event) => canUseHandle("e") && startRectangleResize(event, selectedRectangleEntity, "e")}
                />

                {showRectZoneHint("rect-n") && (
                  <line x1={x1} y1={y1} x2={x2} y2={y1} stroke={RESIZE_HINT_COLOR} strokeWidth={0.14} pointerEvents="none" />
                )}
                {showRectZoneHint("rect-s") && (
                  <line x1={x1} y1={y2} x2={x2} y2={y2} stroke={RESIZE_HINT_COLOR} strokeWidth={0.14} pointerEvents="none" />
                )}
                {showRectZoneHint("rect-w") && (
                  <line x1={x1} y1={y1} x2={x1} y2={y2} stroke={RESIZE_HINT_COLOR} strokeWidth={0.14} pointerEvents="none" />
                )}
                {showRectZoneHint("rect-e") && (
                  <line x1={x2} y1={y1} x2={x2} y2={y2} stroke={RESIZE_HINT_COLOR} strokeWidth={0.14} pointerEvents="none" />
                )}

                <circle cx={midX} cy={y1} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={midX} cy={y2} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={x1} cy={midY} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={x2} cy={midY} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />

                {anchors.map((anchor) => (
                  <g key={`${anchor.handle}-${anchor.x}-${anchor.y}`}>
                    <circle
                      cx={anchor.x}
                      cy={anchor.y}
                      r={1}
                      fill="transparent"
                      style={{ cursor: canUseHandle(anchor.handle) ? anchor.cursor : "default" }}
                      onPointerEnter={() =>
                        canUseHandle(anchor.handle) &&
                        setResizeHintZone(selectedRectangleEntity.id, `rect-${anchor.handle}` as ResizeHintZone)
                      }
                      onPointerLeave={() =>
                        canUseHandle(anchor.handle) &&
                        clearResizeHintZone(selectedRectangleEntity.id, `rect-${anchor.handle}` as ResizeHintZone)
                      }
                      onPointerDown={(event) => canUseHandle(anchor.handle) && startRectangleResize(event, selectedRectangleEntity, anchor.handle)}
                    />
                    {showRectZoneHint(`rect-${anchor.handle}` as ResizeHintZone) && (
                      <circle
                        cx={anchor.x}
                        cy={anchor.y}
                        r={0.44}
                        fill="rgba(125, 232, 255, 0.24)"
                        stroke={RESIZE_HINT_COLOR}
                        strokeWidth={0.08}
                        pointerEvents="none"
                      />
                    )}
                    <circle
                      cx={anchor.x}
                      cy={anchor.y}
                      r={0.3}
                      fill="#ffffff"
                      stroke="#4f6862"
                      strokeWidth={0.06}
                      pointerEvents="none"
                    />
                  </g>
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
                  strokeWidth={2}
                  style={{ cursor: "ns-resize" }}
                  onPointerEnter={() => setResizeHintZone(selectedSkylightEntity.id, "rect-n")}
                  onPointerLeave={() => clearResizeHintZone(selectedSkylightEntity.id, "rect-n")}
                  onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, "n")}
                />
                <line
                  x1={x1}
                  y1={y2}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={2}
                  style={{ cursor: "ns-resize" }}
                  onPointerEnter={() => setResizeHintZone(selectedSkylightEntity.id, "rect-s")}
                  onPointerLeave={() => clearResizeHintZone(selectedSkylightEntity.id, "rect-s")}
                  onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, "s")}
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x1}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={2}
                  style={{ cursor: "ew-resize" }}
                  onPointerEnter={() => setResizeHintZone(selectedSkylightEntity.id, "rect-w")}
                  onPointerLeave={() => clearResizeHintZone(selectedSkylightEntity.id, "rect-w")}
                  onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, "w")}
                />
                <line
                  x1={x2}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={2}
                  style={{ cursor: "ew-resize" }}
                  onPointerEnter={() => setResizeHintZone(selectedSkylightEntity.id, "rect-e")}
                  onPointerLeave={() => clearResizeHintZone(selectedSkylightEntity.id, "rect-e")}
                  onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, "e")}
                />

                <circle cx={midX} cy={y1} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={midX} cy={y2} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={x1} cy={midY} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />
                <circle cx={x2} cy={midY} r={0.16} fill="#ffffff" stroke="#4f6862" strokeWidth={0.05} pointerEvents="none" />

                {anchors.map((anchor) => (
                  <g key={`sk-${anchor.handle}-${anchor.x}-${anchor.y}`}>
                    <circle
                      cx={anchor.x}
                      cy={anchor.y}
                      r={1}
                      fill="transparent"
                      style={{ cursor: anchor.cursor }}
                      onPointerEnter={() => setResizeHintZone(selectedSkylightEntity.id, `rect-${anchor.handle}` as ResizeHintZone)}
                      onPointerLeave={() => clearResizeHintZone(selectedSkylightEntity.id, `rect-${anchor.handle}` as ResizeHintZone)}
                      onPointerDown={(event) => startSkylightResize(event, selectedSkylightEntity, anchor.handle)}
                    />
                    <circle
                      cx={anchor.x}
                      cy={anchor.y}
                      r={0.26}
                      fill="#ffffff"
                      stroke="#4f6862"
                      strokeWidth={0.06}
                      pointerEvents="none"
                    />
                  </g>
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
                onPointerEnter={() => {
                  if (state.selection.kind === "entity" && state.selection.id === entity.id) {
                    setHoveredSelectedEntityId(entity.id);
                  }
                }}
                onPointerLeave={() => {
                  if (state.selection.kind === "entity" && state.selection.id === entity.id) {
                    setHoveredSelectedEntityId((current) => (current === entity.id ? null : current));
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

        {showResizeCursorOverlay && resizeCursorScreen && (
          <g transform={`translate(${resizeCursorScreen.x} ${resizeCursorScreen.y}) rotate(${resizeCursorAngle})`} pointerEvents="none">
            <image href={resizeIcon} x={-10} y={-10} width={20} height={20} preserveAspectRatio="xMidYMid meet" />
          </g>
        )}

        {showMoveCursorOverlay && moveCursorScreen && (
          <g transform={`translate(${moveCursorScreen.x} ${moveCursorScreen.y})`} pointerEvents="none">
            <image href={moveIcon} x={-10} y={-10} width={20} height={20} preserveAspectRatio="xMidYMid meet" />
          </g>
        )}

      </svg>

      {showSelectedEditIcon && selectedEditableEntity && (
        <button
          type="button"
          className="workspace-edit-btn"
          aria-label="Edit selected object"
          title="Edit"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openEntityEditModal(selectedEditableEntity);
          }}
        >
          <img src={editIcon} alt="" className="workspace-edit-btn-icon" />
        </button>
      )}

      <button
        type="button"
        className="header-orientation-btn workspace-orientation-btn"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          cycleOrientation();
        }}
        aria-label="Cycle orientation"
        title={`Orientation: ${state.project.orientation}`}
      >
        {state.project.orientation}
      </button>

      <div className={`workspace-camera-controls ${showCameraTools ? "" : "is-collapsed"}`} aria-label="Workspace camera controls">
        {showCameraTools && (
          <>
            <div className="workspace-zoom-slider-wrap">
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={state.camera.zoom}
                onChange={(event) => handleZoomSliderChange(Number(event.target.value))}
                className="workspace-zoom-slider"
                aria-label="Zoom"
              />
            </div>

            <button
              type="button"
              className="workspace-frame-btn"
              onClick={centerFrameWorkspace}
              title="Frame workspace"
              aria-label="Frame workspace"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M8 8l8 8M16 8l-8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}

        <button
          type="button"
          className="workspace-eye-btn"
          onClick={() => setCameraPanelCollapsed((current) => !current)}
          title={showCameraTools ? "Hide zoom tools" : "Show zoom tools"}
          aria-label={showCameraTools ? "Hide zoom tools" : "Show zoom tools"}
        >
          {showCameraTools ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <line x1="5" y1="19" x2="19" y2="5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

      <RectangleModal
        isOpen={rectangleModalState !== null}
        isAtticFloor={isActiveFloorAttic}
        initialValues={rectangleModalState?.initialValues ?? DEFAULT_RECTANGLE_MODAL_VALUES}
        onCancel={() => setRectangleModalState(null)}
        onSubmit={(payload: RectangleModalSubmit) => {
          if (!rectangleModalState) {
            return;
          }

          const metadata = {
            color: payload.color,
            unconditioned: isActiveFloorAttic ? false : payload.unconditioned,
            ceilingType: isActiveFloorAttic ? "standard" : payload.ceilingType,
            standardHeightFt: isActiveFloorAttic ? 8 : payload.standardHeightFt,
            lowHeightFt: isActiveFloorAttic ? 8 : payload.lowHeightFt,
            highHeightFt: isActiveFloorAttic ? 12 : payload.highHeightFt,
          };

          if (rectangleModalState.mode === "edit" && rectangleModalState.entityId) {
            const existing = floor.entities.find((entity) => entity.id === rectangleModalState.entityId);
            if (!existing || existing.type !== "rectangle") {
              setRectangleModalState(null);
              return;
            }

            const updated: MapEntity = {
              ...existing,
              label: payload.label.trim().toUpperCase(),
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
          rectangle.label = payload.label.trim().toUpperCase();
          rectangle.width = Math.max(1, Math.round(payload.widthFt));
          rectangle.height = Math.max(1, Math.round(payload.heightFt));
          rectangle.metadata = {
            ...rectangle.metadata,
            ...metadata,
          };

          dispatch({ type: "UPSERT_ENTITY", entity: rectangle });
          dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
          maybeAutoReturnToSelect("rectangle");
          setRectangleModalState(null);
        }}
      />

      <BumpOutModal
        isOpen={bumpOutModalState !== null}
        initialFlats={bumpOutModalState?.initialFlats ?? bumpOutConfig.flats}
        initialLongEdgeFt={bumpOutModalState?.initialLongEdgeFt ?? bumpOutConfig.longEdgeFt}
        onCancel={() => {
          setBumpOutModalState(null);
          maybeAutoReturnToSelect("bumpout");
        }}
        onSubmit={(payload: BumpOutModalSubmit) => {
          setBumpOutConfig({ flats: payload.flats, longEdgeFt: Math.max(3, Math.round(payload.longEdgeFt)) });
          setBumpOutModalState(null);
        }}
      />

      <TextModal
        isOpen={textModalState !== null}
        mode={textModalState?.mode ?? "create"}
        initialValues={textModalState?.initialValues ?? DEFAULT_TEXT_MODAL_VALUES}
        onCancel={() => {
          const wasCreate = textModalState?.mode === "create";
          setTextModalState(null);
          if (wasCreate) {
            maybeAutoReturnToSelect("text");
          }
        }}
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
          maybeAutoReturnToSelect("text");
        }}
      />

      <DoorModal
        isOpen={doorModalState !== null}
        title={doorModalState?.kind === "double" ? "DOUBLE DOOR" : "DOOR"}
        initialWidthFt={doorModalState?.initialWidthFt ?? SINGLE_DOOR_DEFAULT_WIDTH}
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
            width: Math.max(1, Math.round(payload.widthFt)),
            height: Math.max(1, Math.round(payload.heightFt)),
            metadata: {
              ...existing.metadata,
              mirrored: payload.mirrored,
            },
          };

          const resolvedPosition = resolveOpeningPositionWithoutOverlap(
            updated,
            { x: updated.x, y: updated.y },
            floor.entities,
            rectangleEntities,
            updated.id,
          );
          if (!resolvedPosition) {
            return;
          }

          updated.x = resolvedPosition.x;
          updated.y = resolvedPosition.y;

          dispatch({ type: "UPSERT_ENTITY", entity: updated });
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
          setDoorModalState(null);
        }}
      />

      <SlidingGlassDoorModal
        isOpen={slidingDoorModalState !== null}
        initialWidthFt={slidingDoorModalState?.initialWidthFt ?? SLIDING_DOOR_DEFAULT_WIDTH}
        initialHeightFt={slidingDoorModalState?.initialHeightFt ?? SLIDING_DOOR_DEFAULT_HEIGHT}
        onCancel={() => setSlidingDoorModalState(null)}
        onSubmit={(payload: SlidingGlassDoorModalSubmit) => {
          if (!slidingDoorModalState) {
            return;
          }

          const existing = floor.entities.find((entity) => entity.id === slidingDoorModalState.entityId);
          if (!existing || !isSlidingDoor(existing)) {
            setSlidingDoorModalState(null);
            return;
          }

          const updated: MapEntity = {
            ...existing,
            width: Math.max(1, Math.round(payload.widthFt)),
            height: Math.max(1, Math.round(payload.heightFt)),
          };

          const resolvedPosition = resolveOpeningPositionWithoutOverlap(
            updated,
            { x: updated.x, y: updated.y },
            floor.entities,
            rectangleEntities,
            updated.id,
          );
          if (!resolvedPosition) {
            return;
          }

          updated.x = resolvedPosition.x;
          updated.y = resolvedPosition.y;

          dispatch({ type: "UPSERT_ENTITY", entity: updated });
          dispatch({ type: "SET_SELECTION", selection: { kind: "entity", id: updated.id } });
          setSlidingDoorModalState(null);
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

          const resolvedPosition = resolveOpeningPositionWithoutOverlap(
            updated,
            { x: updated.x, y: updated.y },
            floor.entities,
            rectangleEntities,
            updated.id,
          );
          if (!resolvedPosition) {
            return;
          }

          updated.x = resolvedPosition.x;
          updated.y = resolvedPosition.y;

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

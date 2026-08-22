import type { FloorData, MapEntity, Project, WallPoint } from "../types";
import { inferFloorPresetFromName, isAtticPreset, sortFloorsByPresetOrder } from "../constants/floors";

interface FloorMetrics {
  wallLoopAreaFt2: number;
  rectangleAreaFt2: number;
  rectangleCeilingAreaFt2: number;
  rectangleVolumeFt3: number;
  rectangleWeightedHeightSum: number;
  wallLengthFt: number;
  totalEntities: number;
}

export interface ProjectMetrics {
  conditionedAreaFt2: number;
  averageCeilingHeightFt: number;
  volumeFt3: number;
  totalAtticAreaFt2: number;
  activeFloor: FloorMetrics;
}

function polygonArea(points: WallPoint[]): number {
  if (points.length < 3) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    sum += curr.x * next.y - next.x * curr.y;
  }
  return Math.abs(sum) / 2;
}

function inferSingleLoopArea(floor: FloorData): number {
  if (floor.wallSegments.length < 3) {
    return 0;
  }

  const adjacency = new Map<string, string[]>();
  for (const segment of floor.wallSegments) {
    adjacency.set(segment.startPointId, [...(adjacency.get(segment.startPointId) ?? []), segment.endPointId]);
    adjacency.set(segment.endPointId, [...(adjacency.get(segment.endPointId) ?? []), segment.startPointId]);
  }

  const pointById = new Map(floor.wallPoints.map((point) => [point.id, point]));
  if ([...adjacency.values()].some((neighbors) => neighbors.length !== 2)) {
    return 0;
  }

  const start = floor.wallSegments[0]?.startPointId;
  if (!start) {
    return 0;
  }

  const ordered: WallPoint[] = [];
  const visited = new Set<string>();
  let prev = "";
  let curr = start;

  while (!visited.has(curr)) {
    visited.add(curr);
    const point = pointById.get(curr);
    if (!point) {
      return 0;
    }
    ordered.push(point);

    const neighbors = adjacency.get(curr) ?? [];
    const next = neighbors[0] === prev ? neighbors[1] : neighbors[0];
    prev = curr;
    curr = next;
  }

  if (curr !== start || visited.size !== adjacency.size) {
    return 0;
  }

  return polygonArea(ordered);
}

function rectBounds(entity: MapEntity) {
  const x1 = Math.round(Math.min(entity.x, entity.x + entity.width));
  const y1 = Math.round(Math.min(entity.y, entity.y + entity.height));
  const x2 = Math.round(Math.max(entity.x, entity.x + entity.width));
  const y2 = Math.round(Math.max(entity.y, entity.y + entity.height));
  return {
    x1,
    y1,
    x2: Math.max(x1 + 1, x2),
    y2: Math.max(y1 + 1, y2),
  };
}

type BumpOutFlats = 3 | 4 | 5 | 6;
type RectEdge = "top" | "right" | "bottom" | "left";

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
): Array<{ x: number; y: number }> {
  const w = Math.max(1, width);
  const d = Math.max(1, height);
  const rise = Math.max(1, Math.min(d, Math.round(options?.rise ?? d)));

  if (flats === 3 || flats === 5) {
    const sideSegments = (flats - 1) / 2;
    const defaultCrown = flats === 3 ? Math.round(w * 0.56) : Math.round(w * 0.34);
    const crownFromInset = Number.isFinite(options?.cornerInset) ? w - Math.round((options?.cornerInset ?? 0) * 2) : NaN;
    const crownRaw = Number.isFinite(crownFromInset) ? crownFromInset : Math.round(options?.crownWidth ?? defaultCrown);
    const maxCrown = Math.max(1, w - sideSegments * 2);
    const crownWidth = Math.max(1, Math.min(maxCrown, crownRaw));
    const sideSpan = (w - crownWidth) / 2;
    const topY = d - rise;
    const sideProfiles =
      flats === 3
        ? [{ x: 1, y: 1 }]
        : [
            { x: 0.06, y: 0.58 },
            { x: 1, y: 1 },
          ];

    const rightSide: Array<{ x: number; y: number }> = [];
    for (let index = 1; index <= sideSegments; index += 1) {
      const profile = sideProfiles[index - 1] ?? { x: index / sideSegments, y: index / sideSegments };
      rightSide.push({
        x: w - sideSpan * profile.x,
        y: d - rise * profile.y,
      });
    }

    const leftCrown = { x: (w - crownWidth) / 2, y: topY };
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
    const rightSide: Array<{ x: number; y: number }> = [];
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

  const arcInterior: Array<{ x: number; y: number }> = [];
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

function bumpOutWorldPolygon(entity: MapEntity): Array<{ x: number; y: number }> {
  const hostEdge = (entity.metadata.hostEdge as RectEdge | undefined) ?? "top";
  const flats = getBumpOutFlats(entity);
  const width = Math.max(1, entity.width);
  const height = Math.max(1, entity.height);

  const cornerInset = Number(entity.metadata.bumpOutCornerInset);
  const rise = Number(entity.metadata.bumpOutRise);
  const crownWidth = Number(entity.metadata.bumpOutCrownWidth);
  const styleOptions = {
    cornerInset: Number.isFinite(cornerInset) ? cornerInset : undefined,
    rise: Number.isFinite(rise) ? rise : undefined,
    crownWidth: Number.isFinite(crownWidth) ? crownWidth : undefined,
  };

  let points = bumpOutPolygonPoints(width, height, flats, styleOptions);
  if (hostEdge === "bottom") {
    points = points.map((point) => ({ x: point.x, y: height - point.y }));
  } else if (hostEdge === "left") {
    const template = bumpOutPolygonPoints(Math.max(1, entity.height), Math.max(1, entity.width), flats, styleOptions);
    points = template.map((point) => ({ x: point.y, y: point.x }));
  } else if (hostEdge === "right") {
    const template = bumpOutPolygonPoints(Math.max(1, entity.height), Math.max(1, entity.width), flats, styleOptions);
    points = template.map((point) => ({ x: width - point.y, y: point.x }));
  }

  return points.map((point) => ({ x: entity.x + point.x, y: entity.y + point.y }));
}

function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
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

function conditionedRectangleCells(floor: FloorData): Set<string> {
  const cells = new Set<string>();
  const rectangles = floor.entities.filter((entity) => entity.type === "rectangle");

  for (const rect of rectangles) {
    if (Boolean(rect.metadata.unconditioned)) {
      continue;
    }

    const { x1, y1, x2, y2 } = rectBounds(rect);
    const bumpOutPolygon = isBumpOutRectangle(rect) ? bumpOutWorldPolygon(rect) : null;
    for (let x = x1; x < x2; x += 1) {
      for (let y = y1; y < y2; y += 1) {
        if (bumpOutPolygon && !pointInPolygon({ x: x + 0.5, y: y + 0.5 }, bumpOutPolygon)) {
          continue;
        }
        cells.add(`${x},${y}`);
      }
    }
  }

  return cells;
}

function ceilingAverageHeight(entity: MapEntity): number {
  const ceilingType = entity.metadata.ceilingType ?? "standard";
  if (ceilingType === "none") {
    return 0;
  }

  const standardHeightFt = Number(entity.metadata.standardHeightFt ?? 8);
  const lowHeightFt = Number(entity.metadata.lowHeightFt ?? 8);
  const highHeightFt = Number(entity.metadata.highHeightFt ?? 12);
  if (ceilingType === "standard") {
    return Math.max(1, standardHeightFt);
  }
  return (Math.max(1, lowHeightFt) + Math.max(1, highHeightFt)) / 2;
}

function computeFloorMetrics(floor: FloorData, previewEntity: MapEntity | null = null): FloorMetrics {
  const rectangles = floor.entities.filter((entity) => entity.type === "rectangle");
  if (previewEntity?.type === "rectangle") {
    rectangles.push(previewEntity);
  }

  const coveredCells = new Set<string>();
  const cellCeilingHeights = new Map<string, number>();

  for (const rect of rectangles) {
    if (Boolean(rect.metadata.unconditioned)) {
      continue;
    }

    const { x1, y1, x2, y2 } = rectBounds(rect);
    const bumpOutPolygon = isBumpOutRectangle(rect) ? bumpOutWorldPolygon(rect) : null;
    const averageHeightFt = ceilingAverageHeight(rect);
    const hasCeiling = (rect.metadata.ceilingType ?? "standard") !== "none";

    for (let x = x1; x < x2; x += 1) {
      for (let y = y1; y < y2; y += 1) {
        if (bumpOutPolygon && !pointInPolygon({ x: x + 0.5, y: y + 0.5 }, bumpOutPolygon)) {
          continue;
        }
        const key = `${x},${y}`;
        coveredCells.add(key);
        if (hasCeiling) {
          // Newer rectangles overwrite overlapped cells, matching visual stacking intent.
          cellCeilingHeights.set(key, averageHeightFt);
        }
      }
    }
  }

  let ceilingVolumeFt3 = 0;
  for (const height of cellCeilingHeights.values()) {
    ceilingVolumeFt3 += height;
  }

  const wallLengthFt = floor.wallSegments.reduce((sum, segment) => {
    const start = floor.wallPoints.find((point) => point.id === segment.startPointId);
    const end = floor.wallPoints.find((point) => point.id === segment.endPointId);
    if (!start || !end) {
      return sum;
    }
    return sum + Math.hypot(end.x - start.x, end.y - start.y);
  }, 0);

  return {
    wallLoopAreaFt2: inferSingleLoopArea(floor),
    rectangleAreaFt2: coveredCells.size,
    rectangleCeilingAreaFt2: cellCeilingHeights.size,
    rectangleVolumeFt3: ceilingVolumeFt3,
    rectangleWeightedHeightSum: ceilingVolumeFt3,
    wallLengthFt,
    totalEntities: floor.entities.length,
  };
}

export function calculateProjectMetrics(project: Project, previewEntity: MapEntity | null = null): ProjectMetrics {
  const activeFloor = project.floors.find((floor) => floor.id === project.activeFloorId) ?? project.floors[0];
  const emptyActive: FloorMetrics = {
    wallLoopAreaFt2: 0,
    rectangleAreaFt2: 0,
    rectangleCeilingAreaFt2: 0,
    rectangleVolumeFt3: 0,
    rectangleWeightedHeightSum: 0,
    wallLengthFt: 0,
    totalEntities: 0,
  };

  const active = activeFloor ? computeFloorMetrics(activeFloor, previewEntity) : emptyActive;

  let conditionedAreaFt2 = 0;
  let conditionedVolumeFt3 = 0;
  let totalAtticAreaFt2 = 0;

  const orderedFloors = sortFloorsByPresetOrder(project.floors);
  for (let index = 0; index < orderedFloors.length; index += 1) {
    const floor = orderedFloors[index];
    const preset = floor.floorPreset ?? inferFloorPresetFromName(floor.name);
    if (!isAtticPreset(preset)) {
      continue;
    }

    const atticCells = conditionedRectangleCells(floor);
    if (atticCells.size === 0) {
      continue;
    }

    const supportingFloor = index > 0 ? orderedFloors[index - 1] : null;
    if (!supportingFloor) {
      continue;
    }
    const supportingCells = conditionedRectangleCells(supportingFloor);
    if (supportingCells.size === 0) {
      continue;
    }

    for (const cell of atticCells) {
      if (supportingCells.has(cell)) {
        totalAtticAreaFt2 += 1;
      }
    }
  }

  for (const floor of project.floors) {
    if (Boolean(floor.unconditioned)) {
      continue;
    }

    const metrics = computeFloorMetrics(floor);
    const floorAreaFt2 = metrics.wallLoopAreaFt2 > 0 ? metrics.wallLoopAreaFt2 : metrics.rectangleAreaFt2;
    conditionedAreaFt2 += floorAreaFt2;

    const hasRectangleFootprint = metrics.rectangleAreaFt2 > 0;
    const hasRectangleMetrics = metrics.rectangleCeilingAreaFt2 > 0;
    const floorVolumeFt3 = metrics.wallLoopAreaFt2 > 0
      ? floorAreaFt2 * project.averageCeilingHeightFt
      : hasRectangleMetrics
        ? metrics.rectangleVolumeFt3
        : hasRectangleFootprint
          ? 0
          : 0;
    conditionedVolumeFt3 += floorVolumeFt3;
  }

  const averageCeilingHeightFt = conditionedAreaFt2 > 0 ? conditionedVolumeFt3 / conditionedAreaFt2 : 0;
  const volumeFt3 = conditionedVolumeFt3;

  return {
    conditionedAreaFt2,
    averageCeilingHeightFt,
    volumeFt3,
    totalAtticAreaFt2,
    activeFloor: active,
  };
}

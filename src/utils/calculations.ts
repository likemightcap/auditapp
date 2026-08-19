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

function conditionedRectangleCells(floor: FloorData): Set<string> {
  const cells = new Set<string>();
  const rectangles = floor.entities.filter((entity) => entity.type === "rectangle");

  for (const rect of rectangles) {
    if (Boolean(rect.metadata.unconditioned)) {
      continue;
    }

    const { x1, y1, x2, y2 } = rectBounds(rect);
    for (let x = x1; x < x2; x += 1) {
      for (let y = y1; y < y2; y += 1) {
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
    const averageHeightFt = ceilingAverageHeight(rect);
    const hasCeiling = (rect.metadata.ceilingType ?? "standard") !== "none";

    for (let x = x1; x < x2; x += 1) {
      for (let y = y1; y < y2; y += 1) {
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

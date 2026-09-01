import type { FloorData, FloorPreset, MapEntity, Orientation, Project, WallPoint } from "../types";
import { inferFloorPresetFromName, isAtticPreset, isBasementPreset, sortFloorsByPresetOrder } from "../constants/floors";

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

interface RectangleDetails {
  id: string;
  name: string;
  label: string;
  shape: "rectangle" | "bumpout";
  areaFt2: number;
  conditioned: boolean;
}

interface FloorDetails {
  floorId: string;
  floorName: string;
  floorPreset: FloorPreset;
  totalAreaFt2: number;
  conditionedAreaFt2: number;
  rectangles: RectangleDetails[];
}

interface OpeningDetails {
  id: string;
  floorId: string;
  floorName: string;
  kind: "window" | "door";
  facing: Orientation;
  side: Orientation;
  widthFt: number;
  heightFt: number;
  areaFt2: number;
  sizeLabel: string;
}

interface SideOpeningDetails {
  side: Orientation;
  openings: OpeningDetails[];
  windowCount: number;
  doorCount: number;
  totalCount: number;
  totalWindowAreaFt2: number;
  totalDoorAreaFt2: number;
  totalAreaFt2: number;
}

interface OverhangAreaDetails {
  floorId: string;
  floorName: string;
  side: Orientation;
  areaFt2: number;
}

interface OverhangSideTotals {
  side: Orientation;
  areaCount: number;
  totalAreaFt2: number;
}

interface OverUnconditionedAreaDetails {
  floorId: string;
  floorName: string;
  areaFt2: number;
}

export interface ProjectDetailsReport {
  totals: {
    totalSqFt: number;
    averageCeilingHeightFt: number;
    totalVolumeFt3: number;
    frontDoorOrientation: Orientation;
    totalAtticSqFt: number;
    totalBasementSqFt: number;
    totalCrawlspaceSqFt: number;
    totalSlabSqFt: number;
    totalWindowCount: number;
    totalDoorCount: number;
    totalWindowAreaFt2: number;
    totalDoorAreaFt2: number;
  };
  floorBreakdown: FloorDetails[];
  openingsBySide: SideOpeningDetails[];
  overhangs: {
    totalAreaCount: number;
    totalAreaFt2: number;
    bySide: OverhangSideTotals[];
    areas: OverhangAreaDetails[];
  };
  overUnconditionedAreas: {
    totalAreaCount: number;
    totalAreaFt2: number;
    areas: OverUnconditionedAreaDetails[];
  };
}

const ORIENTATION_ORDER: Orientation[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

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
const BUMPOUT_ANGLE_BIAS_MIN = -1.2;
const BUMPOUT_ANGLE_BIAS_MAX = 1.2;

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

function getBumpOutAngleBias(entity: MapEntity): number {
  const value = Number(entity.metadata.bumpOutAngleBias ?? 0);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(BUMPOUT_ANGLE_BIAS_MIN, Math.min(BUMPOUT_ANGLE_BIAS_MAX, value));
}

function bumpOutPolygonPoints(
  width: number,
  height: number,
  flats: BumpOutFlats,
  options?: { cornerInset?: number; rise?: number; crownWidth?: number; angleBias?: number },
): Array<{ x: number; y: number }> {
  const w = Math.max(1, width);
  const d = Math.max(1, height);
  const angleBias = Math.max(
    BUMPOUT_ANGLE_BIAS_MIN,
    Math.min(BUMPOUT_ANGLE_BIAS_MAX, Number(options?.angleBias ?? 0)),
  );
  const rise = Math.max(1, Math.min(d, Math.round(options?.rise ?? d)));

  if (flats === 3 || flats === 5) {
    const sideSegments = (flats - 1) / 2;
    const defaultCrown = flats === 3 ? Math.round(w * 0.56) : Math.round(w * 0.34);
    const crownFromInset = Number.isFinite(options?.cornerInset) ? w - Math.round((options?.cornerInset ?? 0) * 2) : NaN;
    const crownRaw = Number.isFinite(crownFromInset) ? crownFromInset : Math.round(options?.crownWidth ?? defaultCrown);
    const maxCrown = Math.max(1, w - sideSegments * 2);
    const crownBiasDelta = Math.round(angleBias * w * 0.26);
    const crownMin = Math.max(1, Math.round(w * (flats === 3 ? 0.18 : 0.12)));
    const crownWidth = Math.max(crownMin, Math.min(maxCrown, crownRaw + crownBiasDelta));
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
      const adjustedProfileX =
        index === sideSegments
          ? 1
          : Math.max(0.04, Math.min(1, profile.x * (1 - angleBias * 0.35)));
      rightSide.push({
        x: w - sideSpan * adjustedProfileX,
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
      const adjustedProfileX =
        index === sideSegments
          ? 1
          : Math.max(0.03, Math.min(1, profile.x * (1 - angleBias * 0.45)));
      rightSide.push({
        x: w - (w / 2) * adjustedProfileX,
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
  const angleBias = getBumpOutAngleBias(entity);
  const styleOptions = {
    cornerInset: Number.isFinite(cornerInset) ? cornerInset : undefined,
    rise: Number.isFinite(rise) ? rise : undefined,
    crownWidth: Number.isFinite(crownWidth) ? crownWidth : undefined,
    angleBias,
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

function polygonAreaFromPoints(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function rectangleAreaFt2(entity: MapEntity): number {
  if (entity.type !== "rectangle") {
    return 0;
  }
  if (isBumpOutRectangle(entity)) {
    return polygonAreaFromPoints(bumpOutWorldPolygon(entity));
  }
  return Math.abs(entity.width) * Math.abs(entity.height);
}

function facingFromRotation(rotation: number): Orientation {
  const radians = (rotation * Math.PI) / 180;
  const vectorX = Math.sin(radians);
  const vectorY = -Math.cos(radians);
  const degreesFromNorth = ((Math.atan2(vectorX, -vectorY) * 180) / Math.PI + 360) % 360;
  const orientationIndex = Math.round(degreesFromNorth / 45) % ORIENTATION_ORDER.length;
  return ORIENTATION_ORDER[orientationIndex] ?? "N";
}

function circularStepDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, ORIENTATION_ORDER.length - diff);
}

function nearestSideOrientation(facing: Orientation, sideOrientations: Orientation[]): Orientation {
  const facingIndex = ORIENTATION_ORDER.indexOf(facing);
  if (facingIndex < 0 || sideOrientations.length === 0) {
    return sideOrientations[0] ?? "N";
  }

  let bestSide = sideOrientations[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const side of sideOrientations) {
    const sideIndex = ORIENTATION_ORDER.indexOf(side);
    if (sideIndex < 0) {
      continue;
    }
    const distance = circularStepDistance(facingIndex, sideIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSide = side;
    }
  }
  return bestSide;
}

function sideOrientationsFromFront(front: Orientation): Orientation[] {
  const frontIndex = ORIENTATION_ORDER.indexOf(front);
  const safeIndex = frontIndex >= 0 ? frontIndex : ORIENTATION_ORDER.indexOf("S");
  const index = safeIndex >= 0 ? safeIndex : 0;
  return [0, 2, 4, 6].map((offset) => ORIENTATION_ORDER[(index + offset) % ORIENTATION_ORDER.length]);
}

type DuplicateBaselineMode = "outside-baseline" | "inside-baseline";

interface DuplicateBaselineState {
  baseline: Array<{ x: number; y: number; width: number; height: number }>;
  mode: DuplicateBaselineMode;
  unconditionedLabelBaseline: Array<{ x: number; y: number; width: number; height: number }>;
}

interface RegionComponent {
  cells: Array<{ x: number; y: number }>;
  areaFt2: number;
  centroid: { x: number; y: number };
}

function rectContainsPoint(rect: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function getDuplicateBaselineStateForFloor(
  floor: FloorData,
  orderedFloors: FloorData[],
  floorIndex: number,
): DuplicateBaselineState | null {
  const floorPreset = floor.floorPreset ?? inferFloorPresetFromName(floor.name);

  if (floorPreset === "FIRST_FLOOR") {
    const basementFloor =
      orderedFloors.find((candidate) => {
        const preset = candidate.floorPreset ?? inferFloorPresetFromName(candidate.name);
        return isBasementPreset(preset);
      }) ?? null;

    if (!basementFloor) {
      return null;
    }

    const baseline = basementFloor.entities
      .filter((entity) => entity.type === "rectangle")
      .map((entity) => {
        const b = rectBounds(entity);
        return { x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 };
      });

    if (baseline.length === 0) {
      return null;
    }

    return {
      baseline,
      mode: "outside-baseline",
      unconditionedLabelBaseline: [],
    };
  }

  if (floorIndex <= 0) {
    return null;
  }

  const supportingFloor = orderedFloors[floorIndex - 1];
  if (!supportingFloor) {
    return null;
  }

  if (isAtticPreset(floorPreset)) {
    const baseline = supportingFloor.entities
      .filter((entity) => entity.type === "rectangle" && Boolean(entity.metadata.unconditioned))
      .map((entity) => {
        const b = rectBounds(entity);
        return { x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 };
      });

    if (baseline.length === 0) {
      return null;
    }

    return {
      baseline,
      mode: "inside-baseline",
      unconditionedLabelBaseline: baseline,
    };
  }

  const baseline = supportingFloor.entities
    .filter((entity) => entity.type === "rectangle" && !Boolean(entity.metadata.unconditioned))
    .map((entity) => {
      const b = rectBounds(entity);
      return { x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 };
    });
  const unconditionedLabelBaseline = supportingFloor.entities
    .filter((entity) => entity.type === "rectangle" && Boolean(entity.metadata.unconditioned))
    .map((entity) => {
      const b = rectBounds(entity);
      return { x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 };
    });

  if (baseline.length === 0) {
    return null;
  }

  return {
    baseline,
    mode: "outside-baseline",
    unconditionedLabelBaseline,
  };
}

function collectOverflowCellsForFloor(floor: FloorData, baselineState: DuplicateBaselineState): {
  overhangCells: Set<string>;
  overUnconditionedCells: Set<string>;
} {
  const overhangCells = new Set<string>();
  const overUnconditionedCells = new Set<string>();
  const rectangles = floor.entities.filter((entity) => entity.type === "rectangle");

  for (const rect of rectangles) {
    if (Boolean(rect.metadata.unconditioned)) {
      continue;
    }

    const bounds = rectBounds(rect);
    const bumpOutPolygon = isBumpOutRectangle(rect) ? bumpOutWorldPolygon(rect) : null;
    for (let x = bounds.x1; x < bounds.x2; x += 1) {
      for (let y = bounds.y1; y < bounds.y2; y += 1) {
        const center = { x: x + 0.5, y: y + 0.5 };
        if (bumpOutPolygon && !pointInPolygon(center, bumpOutPolygon)) {
          continue;
        }

        const coveredByBaseline = baselineState.baseline.some((base) => rectContainsPoint(base, center));
        const isOverflow =
          (baselineState.mode === "outside-baseline" && !coveredByBaseline) ||
          (baselineState.mode === "inside-baseline" && coveredByBaseline);
        if (!isOverflow) {
          continue;
        }

        const key = `${x},${y}`;
        const overUnconditioned = baselineState.unconditionedLabelBaseline.some((base) => rectContainsPoint(base, center));
        if (overUnconditioned) {
          overUnconditionedCells.add(key);
        } else {
          overhangCells.add(key);
        }
      }
    }
  }

  return { overhangCells, overUnconditionedCells };
}

function buildRegionComponents(cellSet: Set<string>): RegionComponent[] {
  const visited = new Set<string>();
  const components: RegionComponent[] = [];
  const parseKey = (key: string): { x: number; y: number } => {
    const [xRaw, yRaw] = key.split(",");
    return { x: Number(xRaw), y: Number(yRaw) };
  };

  for (const key of cellSet) {
    if (visited.has(key)) {
      continue;
    }

    const queue = [key];
    visited.add(key);
    const cells: Array<{ x: number; y: number }> = [];

    while (queue.length > 0) {
      const current = queue.pop();
      if (!current) {
        continue;
      }
      const point = parseKey(current);
      cells.push(point);

      const neighbors = [
        `${point.x - 1},${point.y}`,
        `${point.x + 1},${point.y}`,
        `${point.x},${point.y - 1}`,
        `${point.x},${point.y + 1}`,
      ];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor) && cellSet.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const areaFt2 = cells.length;
    const centroid = cells.reduce(
      (sum, cell) => ({ x: sum.x + cell.x + 0.5, y: sum.y + cell.y + 0.5 }),
      { x: 0, y: 0 },
    );
    centroid.x /= Math.max(1, cells.length);
    centroid.y /= Math.max(1, cells.length);

    components.push({ cells, areaFt2, centroid });
  }

  return components;
}

function getProjectRectangleCenter(project: Project): { x: number; y: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const floor of project.floors) {
    for (const entity of floor.entities) {
      if (entity.type !== "rectangle") {
        continue;
      }
      if (isBumpOutRectangle(entity)) {
        const polygon = bumpOutWorldPolygon(entity);
        for (const point of polygon) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
        continue;
      }

      const bounds = rectBounds(entity);
      minX = Math.min(minX, bounds.x1);
      minY = Math.min(minY, bounds.y1);
      maxX = Math.max(maxX, bounds.x2);
      maxY = Math.max(maxY, bounds.y2);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

function orientationFromVector(dx: number, dy: number, fallback: Orientation): Orientation {
  if (Math.hypot(dx, dy) <= Number.EPSILON) {
    return fallback;
  }
  const degreesFromNorth = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const index = Math.round(degreesFromNorth / 45) % ORIENTATION_ORDER.length;
  return ORIENTATION_ORDER[index] ?? fallback;
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
  for (const floor of orderedFloors) {
    const preset = floor.floorPreset ?? inferFloorPresetFromName(floor.name);
    if (!isAtticPreset(preset)) {
      continue;
    }

    const atticCells = conditionedRectangleCells(floor);
    if (atticCells.size === 0) {
      continue;
    }

    totalAtticAreaFt2 += atticCells.size;
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

export function calculateProjectDetailsReport(project: Project): ProjectDetailsReport {
  const metrics = calculateProjectMetrics(project);
  const floorBreakdown: FloorDetails[] = [];
  const sideOrientations = sideOrientationsFromFront(project.orientation);
  const sideOrientationSet = new Set(sideOrientations);
  const sideBuckets = new Map<Orientation, OpeningDetails[]>();
  for (const side of sideOrientations) {
    sideBuckets.set(side, []);
  }

  let totalBasementSqFt = 0;
  let totalCrawlspaceSqFt = 0;
  let totalSlabSqFt = 0;
  let totalWindowCount = 0;
  let totalDoorCount = 0;
  let totalWindowAreaFt2 = 0;
  let totalDoorAreaFt2 = 0;

  const overhangAreas: OverhangAreaDetails[] = [];
  const overUnconditionedAreas: OverUnconditionedAreaDetails[] = [];
  const projectCenter = getProjectRectangleCenter(project);

  const orderedFloors = sortFloorsByPresetOrder(project.floors);
  for (let floorIndex = 0; floorIndex < orderedFloors.length; floorIndex += 1) {
    const floor = orderedFloors[floorIndex];
    const floorPreset = floor.floorPreset ?? inferFloorPresetFromName(floor.name);
    const rectangles = floor.entities.filter((entity) => entity.type === "rectangle");
    const floorConditionedAreaFt2 = conditionedRectangleCells(floor).size;

    let unnamedRectangleCount = 0;
    let unnamedBumpOutCount = 0;
    let floorTotalAreaFt2 = 0;

    const rectangleDetails: RectangleDetails[] = rectangles.map((entity) => {
      const areaFt2 = rectangleAreaFt2(entity);
      floorTotalAreaFt2 += areaFt2;

      const normalizedLabel = String(entity.label ?? "").trim();
      const isBumpOut = isBumpOutRectangle(entity);
      let generatedName = normalizedLabel;
      if (!generatedName) {
        if (isBumpOut) {
          unnamedBumpOutCount += 1;
          generatedName = `Bump Out ${unnamedBumpOutCount}`;
        } else {
          unnamedRectangleCount += 1;
          generatedName = `Rectangle ${unnamedRectangleCount}`;
        }
      }

      const upperLabel = normalizedLabel.toUpperCase();
      if (upperLabel === "BASEMENT") {
        totalBasementSqFt += areaFt2;
      }
      if (upperLabel === "CRAWLSPACE") {
        totalCrawlspaceSqFt += areaFt2;
      }
      if (upperLabel === "SLAB") {
        totalSlabSqFt += areaFt2;
      }

      return {
        id: entity.id,
        name: generatedName,
        label: normalizedLabel,
        shape: isBumpOut ? "bumpout" : "rectangle",
        areaFt2,
        conditioned: !Boolean(entity.metadata.unconditioned),
      };
    });

    floorBreakdown.push({
      floorId: floor.id,
      floorName: floor.name,
      floorPreset,
      totalAreaFt2: floorTotalAreaFt2,
      conditionedAreaFt2: floorConditionedAreaFt2,
      rectangles: rectangleDetails,
    });

    const baselineState = getDuplicateBaselineStateForFloor(floor, orderedFloors, floorIndex);
    if (baselineState) {
      const overflowCells = collectOverflowCellsForFloor(floor, baselineState);
      const overhangRegions = buildRegionComponents(overflowCells.overhangCells);
      const overUnconditionedRegions = buildRegionComponents(overflowCells.overUnconditionedCells);

      for (const region of overhangRegions) {
        const center = projectCenter ?? region.centroid;
        const facing = orientationFromVector(region.centroid.x - center.x, region.centroid.y - center.y, project.orientation);
        const side = sideOrientationSet.has(facing) ? facing : nearestSideOrientation(facing, sideOrientations);
        overhangAreas.push({
          floorId: floor.id,
          floorName: floor.name,
          side,
          areaFt2: region.areaFt2,
        });
      }

      for (const region of overUnconditionedRegions) {
        overUnconditionedAreas.push({
          floorId: floor.id,
          floorName: floor.name,
          areaFt2: region.areaFt2,
        });
      }
    }

    const openings = floor.entities.filter((entity) => entity.type === "window" || entity.type === "door");
    for (const opening of openings) {
      const widthFt = Math.abs(opening.width);
      const heightFt = Math.abs(opening.height);
      const areaFt2 = widthFt * heightFt;
      const facing = facingFromRotation(opening.rotation);
      const side = nearestSideOrientation(facing, sideOrientations);
      const details: OpeningDetails = {
        id: opening.id,
        floorId: floor.id,
        floorName: floor.name,
        kind: opening.type === "window" ? "window" : "door",
        facing,
        side,
        widthFt,
        heightFt,
        areaFt2,
        sizeLabel: `${Math.round(widthFt)}' x ${Math.round(heightFt)}'`,
      };
      sideBuckets.set(side, [...(sideBuckets.get(side) ?? []), details]);

      if (opening.type === "window") {
        totalWindowCount += 1;
        totalWindowAreaFt2 += areaFt2;
      } else {
        totalDoorCount += 1;
        totalDoorAreaFt2 += areaFt2;
      }
    }
  }

  const openingsBySide: SideOpeningDetails[] = sideOrientations.map((side) => {
    const openings = sideBuckets.get(side) ?? [];
    const windows = openings.filter((item) => item.kind === "window");
    const doors = openings.filter((item) => item.kind === "door");
    const totalWindowArea = windows.reduce((sum, item) => sum + item.areaFt2, 0);
    const totalDoorArea = doors.reduce((sum, item) => sum + item.areaFt2, 0);

    return {
      side,
      openings,
      windowCount: windows.length,
      doorCount: doors.length,
      totalCount: openings.length,
      totalWindowAreaFt2: totalWindowArea,
      totalDoorAreaFt2: totalDoorArea,
      totalAreaFt2: totalWindowArea + totalDoorArea,
    };
  });

  const overhangBySide: OverhangSideTotals[] = sideOrientations.map((side) => {
    const items = overhangAreas.filter((area) => area.side === side);
    return {
      side,
      areaCount: items.length,
      totalAreaFt2: items.reduce((sum, item) => sum + item.areaFt2, 0),
    };
  });

  const totalOverhangAreaFt2 = overhangAreas.reduce((sum, area) => sum + area.areaFt2, 0);
  const totalOverUnconditionedAreaFt2 = overUnconditionedAreas.reduce((sum, area) => sum + area.areaFt2, 0);

  return {
    totals: {
      totalSqFt: metrics.conditionedAreaFt2,
      averageCeilingHeightFt: metrics.averageCeilingHeightFt,
      totalVolumeFt3: metrics.volumeFt3,
      frontDoorOrientation: project.orientation,
      totalAtticSqFt: metrics.totalAtticAreaFt2,
      totalBasementSqFt,
      totalCrawlspaceSqFt,
      totalSlabSqFt,
      totalWindowCount,
      totalDoorCount,
      totalWindowAreaFt2,
      totalDoorAreaFt2,
    },
    floorBreakdown,
    openingsBySide,
    overhangs: {
      totalAreaCount: overhangAreas.length,
      totalAreaFt2: totalOverhangAreaFt2,
      bySide: overhangBySide,
      areas: overhangAreas,
    },
    overUnconditionedAreas: {
      totalAreaCount: overUnconditionedAreas.length,
      totalAreaFt2: totalOverUnconditionedAreaFt2,
      areas: overUnconditionedAreas,
    },
  };
}

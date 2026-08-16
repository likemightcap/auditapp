import type {
  EditorAction,
  EditorState,
  FloorData,
  MapEntity,
  Orientation,
  Project,
  Selection,
  WallPoint,
  WallSegment,
} from "../types";
import { MAX_ZOOM, MIN_ZOOM, clamp, normalize } from "../utils/geometry";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function createInitialFloor(name = "1st Floor"): FloorData {
  return {
    id: uid("floor"),
    name,
    entities: [],
    wallPoints: [],
    wallSegments: [],
  };
}

export function createInitialProject(): Project {
  return {
    projectId: uid("project"),
    projectName: "New Assessment",
    address: "",
    orientation: "S",
    averageCeilingHeightFt: 9,
    floors: [],
    activeFloorId: "",
    metadata: {
      windowDefaultWidthFt: 3,
      windowDefaultHeightFt: 4,
      doorDefaultType: "single",
      rectangleStickyMode: false,
    },
  };
}

export function createInitialEditorState(): EditorState {
  return {
    project: createInitialProject(),
    activeTool: "select",
    selection: { kind: "none" },
    camera: { x: 80, y: 80, zoom: 10 },
    wallDraftPointId: null,
    previewEntity: null,
    historyPast: [],
    historyFuture: [],
  };
}

function withHistory(state: EditorState, nextProject: Project): EditorState {
  return {
    ...state,
    project: nextProject,
    historyPast: [...state.historyPast, state.project],
    historyFuture: [],
  };
}

function updateActiveFloor(project: Project, updater: (floor: FloorData) => FloorData): Project {
  if (!project.floors.some((floor) => floor.id === project.activeFloorId)) {
    return project;
  }
  return {
    ...project,
    floors: project.floors.map((floor) => (floor.id === project.activeFloorId ? updater(floor) : floor)),
  };
}

function getActiveFloor(project: Project): FloorData | undefined {
  return project.floors.find((floor) => floor.id === project.activeFloorId) ?? project.floors[0];
}

function cleanSelection(selection: Selection, floor?: FloorData): Selection {
  if (!floor) {
    return { kind: "none" };
  }
  if (selection.kind === "entity" && !floor.entities.some((entity) => entity.id === selection.id)) {
    return { kind: "none" };
  }
  if (selection.kind === "wallSegment" && !floor.wallSegments.some((segment) => segment.id === selection.id)) {
    return { kind: "none" };
  }
  if (selection.kind === "wallPoint" && !floor.wallPoints.some((point) => point.id === selection.id)) {
    return { kind: "none" };
  }
  return selection;
}

function removeWallPointIfUnconnected(floor: FloorData, pointId: string): FloorData {
  const stillUsed = floor.wallSegments.some(
    (segment) => segment.startPointId === pointId || segment.endPointId === pointId,
  );
  if (stillUsed) {
    return floor;
  }
  return {
    ...floor,
    wallPoints: floor.wallPoints.filter((point) => point.id !== pointId),
  };
}

function upsertEntity(list: MapEntity[], next: MapEntity): MapEntity[] {
  const index = list.findIndex((entity) => entity.id === next.id);
  if (index === -1) {
    return [...list, next];
  }
  const clone = [...list];
  clone[index] = next;
  return clone;
}

function cloneRectanglesForDuplicate(sourceFloor: FloorData): MapEntity[] {
  return sourceFloor.entities
    .filter((entity) => entity.type === "rectangle")
    .map((entity) => ({
      ...entity,
      id: uid("ent"),
      metadata: { ...entity.metadata },
    }));
}

function normalizeEntityForGrid(entity: MapEntity): MapEntity {
  if (entity.type !== "rectangle" && entity.type !== "line") {
    return entity;
  }

  return {
    ...entity,
    x: Math.round(entity.x),
    y: Math.round(entity.y),
    width: Math.round(entity.width),
    height: Math.round(entity.height),
  };
}

interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type EntityBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function isUtilityType(type: MapEntity["type"]): boolean {
  return (
    type === "condenser" ||
    type === "heater" ||
    type === "dhw" ||
    type === "gas" ||
    type === "electric" ||
    type === "other"
  );
}

function rectBoundsFromRectangle(entity: MapEntity): RectBounds {
  const x1 = Math.min(entity.x, entity.x + entity.width);
  const y1 = Math.min(entity.y, entity.y + entity.height);
  return {
    x: x1,
    y: y1,
    width: Math.abs(entity.width),
    height: Math.abs(entity.height),
  };
}

function boundsForEntity(entity: MapEntity): EntityBounds {
  if (entity.type === "rectangle") {
    const rect = rectBoundsFromRectangle(entity);
    return {
      left: rect.x,
      right: rect.x + rect.width,
      top: rect.y,
      bottom: rect.y + rect.height,
    };
  }

  if (entity.type === "skylight" || isUtilityType(entity.type)) {
    const halfWidth = Math.abs(entity.width) / 2;
    const halfHeight = Math.abs(entity.height) / 2;
    return {
      left: entity.x - halfWidth,
      right: entity.x + halfWidth,
      top: entity.y - halfHeight,
      bottom: entity.y + halfHeight,
    };
  }

  return {
    left: entity.x,
    right: entity.x + Math.abs(entity.width),
    top: entity.y,
    bottom: entity.y + Math.abs(entity.height),
  };
}

function boundsOverlap(a: EntityBounds, b: EntityBounds): boolean {
  const horizontal = Math.min(a.right, b.right) > Math.max(a.left, b.left);
  const vertical = Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  return horizontal && vertical;
}

function pointOnRectangleEdge(point: { x: number; y: number }, rect: RectBounds): boolean {
  const x1 = rect.x;
  const y1 = rect.y;
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;

  const onHorizontalEdge = (point.y === y1 || point.y === y2) && point.x >= x1 && point.x <= x2;
  const onVerticalEdge = (point.x === x1 || point.x === x2) && point.y >= y1 && point.y <= y2;
  return onHorizontalEdge || onVerticalEdge;
}

function pointInsideRect(point: { x: number; y: number }, rect: RectBounds): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function moveAttachedEntitiesWithRectangle(
  entities: MapEntity[],
  rectangleId: string,
  fromRect: MapEntity,
  dx: number,
  dy: number,
): MapEntity[] {
  if (dx === 0 && dy === 0) {
    return entities;
  }

  const previousBounds = rectBoundsFromRectangle(fromRect);

  return entities.map((entity) => {
    if (entity.id === rectangleId) {
      return entity;
    }

    const isHostedOpening =
      (entity.type === "door" || entity.type === "window") &&
      entity.metadata.hostRectId === rectangleId;
    const isHostedSkylight =
      entity.type === "skylight" &&
      (entity.metadata.hostRectId === rectangleId || pointInsideRect({ x: entity.x, y: entity.y }, previousBounds));

    if (!isHostedOpening && !isHostedSkylight) {
      return entity;
    }

    return {
      ...entity,
      x: entity.x + dx,
      y: entity.y + dy,
      metadata:
        entity.type === "skylight" && entity.metadata.hostRectId !== rectangleId
          ? { ...entity.metadata, hostRectId: rectangleId }
          : entity.metadata,
    };
  });
}

function alignOpeningsToRectangleEdges(
  entities: MapEntity[],
  nextRect: MapEntity,
): MapEntity[] {
  const rectId = nextRect.id;
  const next = rectBoundsFromRectangle(nextRect);

  return entities.map((entity) => {
    if ((entity.type !== "door" && entity.type !== "window") || entity.metadata.hostRectId !== rectId) {
      return entity;
    }

    const edge = String(entity.metadata.edge ?? "top") as "top" | "right" | "bottom" | "left";
    const half = Math.abs(entity.width) / 2;

    if (edge === "top" || edge === "bottom") {
      const minX = next.x + half;
      const maxX = next.x + next.width - half;
      return {
        ...entity,
        x: clamp(entity.x, minX, maxX),
        y: edge === "top" ? next.y : next.y + next.height,
      };
    }

    const minY = next.y + half;
    const maxY = next.y + next.height - half;
    return {
      ...entity,
      x: edge === "left" ? next.x : next.x + next.width,
      y: clamp(entity.y, minY, maxY),
    };
  });
}

function clampSkylightInsideRectangle(skylight: MapEntity, rect: RectBounds): MapEntity {
  const halfWidth = Math.abs(skylight.width) / 2;
  const halfHeight = Math.abs(skylight.height) / 2;

  const minX = rect.x + halfWidth;
  const maxX = rect.x + rect.width - halfWidth;
  const minY = rect.y + halfHeight;
  const maxY = rect.y + rect.height - halfHeight;

  const fallbackX = rect.x + rect.width / 2;
  const fallbackY = rect.y + rect.height / 2;

  const resolvedX = minX <= maxX ? clamp(skylight.x, minX, maxX) : fallbackX;
  const resolvedY = minY <= maxY ? clamp(skylight.y, minY, maxY) : fallbackY;

  return {
    ...skylight,
    x: resolvedX,
    y: resolvedY,
  };
}

function alignSkylightsInsideRectangle(
  entities: MapEntity[],
  previousRect: MapEntity,
  nextRect: MapEntity,
): MapEntity[] {
  const previousBounds = rectBoundsFromRectangle(previousRect);
  const nextBounds = rectBoundsFromRectangle(nextRect);
  const rectId = nextRect.id;

  return entities.map((entity) => {
    if (entity.type !== "skylight") {
      return entity;
    }

    const hosted = entity.metadata.hostRectId === rectId;
    const wasInsidePrevious = pointInsideRect({ x: entity.x, y: entity.y }, previousBounds);
    if (!hosted && !wasInsidePrevious) {
      return entity;
    }

    const clamped = clampSkylightInsideRectangle(entity, nextBounds);
    return {
      ...clamped,
      metadata: {
        ...clamped.metadata,
        hostRectId: rectId,
      },
    };
  });
}

function hasInvalidSkylightOverlap(entities: MapEntity[]): boolean {
  const skylights = entities.filter((entity) => entity.type === "skylight");
  for (let index = 0; index < skylights.length; index += 1) {
    const current = boundsForEntity(skylights[index]);
    for (let compare = index + 1; compare < skylights.length; compare += 1) {
      const other = boundsForEntity(skylights[compare]);
      if (boundsOverlap(current, other)) {
        return true;
      }
    }
  }
  return false;
}

function hasInvalidUtilityPlacement(entities: MapEntity[]): boolean {
  const utilities = entities.filter((entity) => isUtilityType(entity.type));
  const rectangles = entities.filter((entity) => entity.type === "rectangle");

  for (const utility of utilities) {
    for (const rectangle of rectangles) {
      if (pointOnRectangleEdge({ x: utility.x, y: utility.y }, rectBoundsFromRectangle(rectangle))) {
        return true;
      }
    }
  }

  for (let index = 0; index < utilities.length; index += 1) {
    const current = boundsForEntity(utilities[index]);
    for (let compare = index + 1; compare < utilities.length; compare += 1) {
      const other = boundsForEntity(utilities[compare]);
      if (boundsOverlap(current, other)) {
        return true;
      }
    }
  }

  return false;
}

function hasInvalidEntityPlacement(entities: MapEntity[]): boolean {
  return hasInvalidSkylightOverlap(entities) || hasInvalidUtilityPlacement(entities);
}

function applyRectangleMoveWithAttachments(
  entities: MapEntity[],
  rectangleId: string,
  x: number,
  y: number,
): MapEntity[] {
  const existing = entities.find((entity) => entity.id === rectangleId);
  if (!existing || existing.type !== "rectangle") {
    return entities;
  }

  const target = normalizeEntityForGrid({
    ...existing,
    x,
    y,
  });

  if (existing.x === target.x && existing.y === target.y) {
    return entities;
  }

  const dx = target.x - existing.x;
  const dy = target.y - existing.y;
  const moved = moveAttachedEntitiesWithRectangle(entities, rectangleId, existing, dx, dy);
  return moved.map((entity) => (entity.id === rectangleId ? target : entity));
}

function applyUpsertEntityWithRectangleEffects(entities: MapEntity[], normalized: MapEntity): MapEntity[] {
  let nextEntities = upsertEntity(entities, normalized);
  if (normalized.type === "rectangle") {
    const previousRectangle = entities.find((entity) => entity.id === normalized.id);
    if (previousRectangle?.type === "rectangle") {
      nextEntities = alignOpeningsToRectangleEdges(nextEntities, normalized);
      nextEntities = alignSkylightsInsideRectangle(nextEntities, previousRectangle, normalized);
    }
  }
  return nextEntities;
}

function setWallSegmentLength(floor: FloorData, segmentId: string, lengthFt: number): FloorData {
  const segment = floor.wallSegments.find((item) => item.id === segmentId);
  if (!segment || lengthFt <= 0) {
    return floor;
  }

  const start = floor.wallPoints.find((point) => point.id === segment.startPointId);
  const end = floor.wallPoints.find((point) => point.id === segment.endPointId);
  if (!start || !end) {
    return floor;
  }

  const direction = normalize(end.x - start.x, end.y - start.y);
  const nextEnd = {
    ...end,
    x: start.x + direction.x * lengthFt,
    y: start.y + direction.y * lengthFt,
  };

  return {
    ...floor,
    wallPoints: floor.wallPoints.map((point) => (point.id === end.id ? nextEnd : point)),
  };
}

function deleteSelectionFromProject(project: Project, selection: Selection): Project {
  if (selection.kind === "none") {
    return project;
  }

  if (selection.kind === "entity") {
    return updateActiveFloor(project, (floor) => ({
      ...floor,
      entities: floor.entities.filter((entity) => entity.id !== selection.id),
    }));
  }

  if (selection.kind === "wallSegment") {
    return updateActiveFloor(project, (floor) => {
      const removed = floor.wallSegments.find((segment) => segment.id === selection.id);
      if (!removed) {
        return floor;
      }

      let nextFloor: FloorData = {
        ...floor,
        wallSegments: floor.wallSegments.filter((segment) => segment.id !== selection.id),
      };
      nextFloor = removeWallPointIfUnconnected(nextFloor, removed.startPointId);
      nextFloor = removeWallPointIfUnconnected(nextFloor, removed.endPointId);
      return nextFloor;
    });
  }

  return updateActiveFloor(project, (floor) => {
    const pointId = selection.id;
    const nextSegments = floor.wallSegments.filter(
      (segment) => segment.startPointId !== pointId && segment.endPointId !== pointId,
    );
    const nextFloor = {
      ...floor,
      wallSegments: nextSegments,
      wallPoints: floor.wallPoints.filter((point) => point.id !== pointId),
    };
    return nextFloor;
  });
}

export function createWallPoint(x: number, y: number): WallPoint {
  return { id: uid("wp"), x, y };
}

export function createWallSegment(startPointId: string, endPointId: string): WallSegment {
  return { id: uid("ws"), startPointId, endPointId, metadata: {} };
}

export function createEntityFromTool(type: MapEntity["type"], x: number, y: number): MapEntity {
  const defaults: Record<MapEntity["type"], { width: number; height: number; label: string }> = {
    text: { width: 5, height: 2, label: "Label" },
    rectangle: { width: 10, height: 8, label: "" },
    line: { width: 12, height: 0, label: "" },
    door: { width: 3, height: 7, label: "" },
    window: { width: 3, height: 4, label: "" },
    skylight: { width: 2, height: 4, label: "" },
    condenser: { width: 2, height: 2, label: "" },
    heater: { width: 2, height: 2, label: "" },
    dhw: { width: 2, height: 2, label: "" },
    gas: { width: 2, height: 2, label: "" },
    electric: { width: 2, height: 2, label: "" },
    other: { width: 2, height: 2, label: "" },
  };

  const preset = defaults[type];
  return {
    id: uid("ent"),
    type,
    x,
    y,
    width: preset.width,
    height: preset.height,
    rotation: 0,
    label: preset.label,
    metadata: {},
  };
}

function setOrientation(project: Project, orientation: Orientation): Project {
  return { ...project, orientation };
}

function applyStickyModeFromCurrent(target: Project, current: Project): Project {
  return {
    ...target,
    metadata: {
      ...target.metadata,
      rectangleStickyMode: Boolean(current.metadata.rectangleStickyMode),
    },
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_TOOL": {
      const shouldClearRectangleSticky =
        action.tool !== "rectangle" &&
        Boolean(state.project.metadata.rectangleStickyMode);
      return {
        ...state,
        project: shouldClearRectangleSticky
          ? {
              ...state.project,
              metadata: {
                ...state.project.metadata,
                rectangleStickyMode: false,
              },
            }
          : state.project,
        activeTool: action.tool,
        selection: action.tool === "select" ? state.selection : { kind: "none" },
        wallDraftPointId: action.tool === "wall" ? state.wallDraftPointId : null,
      };
    }
    case "SET_RECTANGLE_STICKY_MODE":
      return {
        ...state,
        project: {
          ...state.project,
          metadata: {
            ...state.project.metadata,
            rectangleStickyMode: action.enabled,
          },
        },
      };
    case "SET_SELECTION":
      return { ...state, selection: action.selection };
    case "SET_CAMERA":
      return { ...state, camera: { ...state.camera, ...action.camera } };
    case "PAN_CAMERA":
      return { ...state, camera: { ...state.camera, x: state.camera.x + action.dx, y: state.camera.y + action.dy } };
    case "ZOOM_CAMERA": {
      const nextZoom = clamp(action.nextZoom, MIN_ZOOM, MAX_ZOOM);
      const ratio = nextZoom / state.camera.zoom;
      const nextX = action.pivot.x - (action.pivot.x - state.camera.x) * ratio;
      const nextY = action.pivot.y - (action.pivot.y - state.camera.y) * ratio;
      return { ...state, camera: { x: nextX, y: nextY, zoom: nextZoom } };
    }
    case "CLEAR_WALL_DRAFT":
      return { ...state, wallDraftPointId: null };
    case "SET_PREVIEW_ENTITY":
      return { ...state, previewEntity: action.entity };
    case "CLEAR_PREVIEW_ENTITY":
      return { ...state, previewEntity: null };
    case "START_WALL_DRAFT":
      return { ...state, wallDraftPointId: action.pointId };
    case "SET_ORIENTATION":
      return withHistory(state, setOrientation(state.project, action.orientation));
    case "SET_PROJECT_NAME":
      return withHistory(state, { ...state.project, projectName: action.projectName });
    case "SET_ADDRESS":
      return withHistory(state, { ...state.project, address: action.address });
    case "SET_DEFAULT_WINDOW_SIZE": {
      const widthFt = Math.max(1, Math.round(action.widthFt));
      const heightFt = Math.max(1, Math.round(action.heightFt));
      return withHistory(state, {
        ...state.project,
        metadata: {
          ...state.project.metadata,
          windowDefaultWidthFt: widthFt,
          windowDefaultHeightFt: heightFt,
        },
      });
    }
    case "SET_DEFAULT_DOOR_TYPE": {
      return withHistory(state, {
        ...state.project,
        metadata: {
          ...state.project.metadata,
          doorDefaultType: action.doorType,
        },
      });
    }
    case "SET_AVG_CEILING":
      return withHistory(state, { ...state.project, averageCeilingHeightFt: action.value });
    case "ADD_LEVEL": {
      const nextFloor = createInitialFloor(action.floorName);
      nextFloor.unconditioned = action.unconditioned;
      return withHistory(state, {
        ...state.project,
        floors: [...state.project.floors, nextFloor],
        activeFloorId: nextFloor.id,
      });
    }
    case "DELETE_LEVEL": {
      const exists = state.project.floors.some((floor) => floor.id === action.floorId);
      if (!exists) {
        return state;
      }

      const nextFloors = state.project.floors.filter((floor) => floor.id !== action.floorId);
      const nextActiveFloorId =
        state.project.activeFloorId === action.floorId
          ? nextFloors[0]?.id ?? ""
          : state.project.activeFloorId;

      return {
        ...withHistory(state, {
          ...state.project,
          floors: nextFloors,
          activeFloorId: nextActiveFloorId,
        }),
        selection: { kind: "none" },
        wallDraftPointId: null,
        previewEntity: null,
      };
    }
    case "SET_ACTIVE_FLOOR": {
      const floor = state.project.floors.find((item) => item.id === action.floorId);
      if (!floor) {
        return state;
      }
      return {
        ...state,
        project: { ...state.project, activeFloorId: action.floorId },
        selection: { kind: "none" },
        wallDraftPointId: null,
      };
    }
    case "UPDATE_LEVEL":
      return withHistory(state, {
        ...state.project,
        floors: state.project.floors.map((floor) =>
          floor.id === action.floorId
            ? { ...floor, name: action.name, unconditioned: action.unconditioned }
            : floor,
        ),
      });
    case "DUPLICATE_LEVEL_RECTANGLES": {
      const source = state.project.floors.find((floor) => floor.id === action.floorId);
      if (!source) {
        return state;
      }

      const nextFloor = createInitialFloor(action.floorName);
      nextFloor.unconditioned = action.unconditioned;
      nextFloor.entities = cloneRectanglesForDuplicate(source);

      return withHistory(state, {
        ...state.project,
        floors: [...state.project.floors, nextFloor],
        activeFloorId: nextFloor.id,
      });
    }
    case "UPSERT_ENTITY": {
      const normalized = normalizeEntityForGrid(action.entity);
      const activeFloor = getActiveFloor(state.project);
      if (!activeFloor) {
        return state;
      }

      const nextEntities = applyUpsertEntityWithRectangleEffects(activeFloor.entities, normalized);

      if (hasInvalidEntityPlacement(nextEntities)) {
        return state;
      }

      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        entities: floor.id === activeFloor.id ? nextEntities : floor.entities,
      }));
      return withHistory(state, nextProject);
    }
    case "APPLY_RECT_RESIZE_WITH_PUSH": {
      const activeFloor = getActiveFloor(state.project);
      if (!activeFloor) {
        return state;
      }

      const normalized = normalizeEntityForGrid(action.entity);
      if (normalized.type !== "rectangle") {
        return state;
      }

      let nextEntities = activeFloor.entities;
      for (const pushed of action.pushedRectangles) {
        nextEntities = applyRectangleMoveWithAttachments(nextEntities, pushed.id, pushed.x, pushed.y);
      }

      nextEntities = applyUpsertEntityWithRectangleEffects(nextEntities, normalized);

      if (hasInvalidEntityPlacement(nextEntities)) {
        return state;
      }

      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        entities: floor.id === activeFloor.id ? nextEntities : floor.entities,
      }));
      return withHistory(state, nextProject);
    }
    case "REMOVE_ENTITY": {
      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        entities: floor.entities.filter((entity) => entity.id !== action.entityId),
      }));
      return withHistory(state, nextProject);
    }
    case "MOVE_ENTITY": {
      const activeFloor = getActiveFloor(state.project);
      if (!activeFloor) {
        return state;
      }
      const existing = activeFloor.entities.find((entity) => entity.id === action.entityId);
      if (!existing) {
        return state;
      }

      const normalizedTarget = normalizeEntityForGrid({
        ...existing,
        x: action.x,
        y: action.y,
      });

      if (existing.x === normalizedTarget.x && existing.y === normalizedTarget.y) {
        return state;
      }

      const dx = normalizedTarget.x - existing.x;
      const dy = normalizedTarget.y - existing.y;
      const movedEntities =
        existing.type === "rectangle"
          ? moveAttachedEntitiesWithRectangle(activeFloor.entities, existing.id, existing, dx, dy)
          : activeFloor.entities;

      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        entities: movedEntities.map((entity) =>
          entity.id === action.entityId
            ? normalizedTarget
            : entity,
        ),
      }));

      const nextFloor = getActiveFloor(nextProject);
      if (!nextFloor || hasInvalidEntityPlacement(nextFloor.entities)) {
        return state;
      }
      return withHistory(state, nextProject);
    }
    case "ROTATE_ENTITY": {
      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        entities: floor.entities.map((entity) =>
          entity.id === action.entityId ? { ...entity, rotation: action.rotation } : entity,
        ),
      }));
      return withHistory(state, nextProject);
    }
    case "UPDATE_ENTITY_LABEL": {
      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        entities: floor.entities.map((entity) =>
          entity.id === action.entityId ? { ...entity, label: action.label } : entity,
        ),
      }));
      return withHistory(state, nextProject);
    }
    case "ADD_WALL_POINT": {
      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        wallPoints: [...floor.wallPoints, action.point],
      }));
      return withHistory(state, nextProject);
    }
    case "MOVE_WALL_POINT": {
      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        wallPoints: floor.wallPoints.map((point) =>
          point.id === action.pointId ? { ...point, x: action.x, y: action.y } : point,
        ),
      }));
      return withHistory(state, nextProject);
    }
    case "ADD_WALL_SEGMENT": {
      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        wallSegments: [...floor.wallSegments, action.segment],
      }));
      return withHistory(state, nextProject);
    }
    case "REMOVE_WALL_SEGMENT": {
      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        wallSegments: floor.wallSegments.filter((segment) => segment.id !== action.segmentId),
      }));
      return withHistory(state, nextProject);
    }
    case "SET_WALL_SEGMENT_LENGTH": {
      const nextProject = updateActiveFloor(state.project, (floor) =>
        setWallSegmentLength(floor, action.segmentId, action.lengthFt),
      );
      return withHistory(state, nextProject);
    }
    case "DELETE_SELECTION": {
      const nextProject = deleteSelectionFromProject(state.project, state.selection);
      return {
        ...withHistory(state, nextProject),
        selection: { kind: "none" },
      };
    }
    case "UNDO": {
      const previous = state.historyPast[state.historyPast.length - 1];
      if (!previous) {
        return state;
      }
      const projectWithSticky = applyStickyModeFromCurrent(previous, state.project);
      const activeFloor = getActiveFloor(projectWithSticky);
      return {
        ...state,
        project: projectWithSticky,
        historyPast: state.historyPast.slice(0, -1),
        historyFuture: [state.project, ...state.historyFuture],
        selection: cleanSelection(state.selection, activeFloor),
        wallDraftPointId: null,
      };
    }
    case "REDO": {
      const next = state.historyFuture[0];
      if (!next) {
        return state;
      }
      const projectWithSticky = applyStickyModeFromCurrent(next, state.project);
      const activeFloor = getActiveFloor(projectWithSticky);
      return {
        ...state,
        project: projectWithSticky,
        historyPast: [...state.historyPast, state.project],
        historyFuture: state.historyFuture.slice(1),
        selection: cleanSelection(state.selection, activeFloor),
        wallDraftPointId: null,
      };
    }
    case "LOAD_PROJECT":
      return {
        ...state,
        project: action.project,
        historyPast: [],
        historyFuture: [],
        selection: { kind: "none" },
        wallDraftPointId: null,
      };
    case "RESET_PROJECT":
      return createInitialEditorState();
    default:
      return state;
  }
}

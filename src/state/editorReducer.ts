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

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_TOOL":
      return {
        ...state,
        activeTool: action.tool,
        selection: action.tool === "select" ? state.selection : { kind: "none" },
        wallDraftPointId: action.tool === "wall" ? state.wallDraftPointId : null,
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
      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        entities: upsertEntity(floor.entities, normalized),
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

      const nextProject = updateActiveFloor(state.project, (floor) => ({
        ...floor,
        entities: floor.entities.map((entity) =>
          entity.id === action.entityId
            ? normalizedTarget
            : entity,
        ),
      }));
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
      const activeFloor = getActiveFloor(previous);
      return {
        ...state,
        project: previous,
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
      const activeFloor = getActiveFloor(next);
      return {
        ...state,
        project: next,
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

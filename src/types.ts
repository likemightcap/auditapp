export type Orientation = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type FloorPreset =
  | "BASEMENT_CRAWLSPACE"
  | "FIRST_FLOOR"
  | "SECOND_FLOOR"
  | "THIRD_FLOOR"
  | "ATTIC";

export type ToolId =
  | "select"
  | "wall"
  | "text"
  | "rectangle"
  | "line"
  | "door"
  | "window"
  | "skylight"
  | "condenser"
  | "heater"
  | "dhw"
  | "gas"
  | "electric"
  | "other";

export type EntityType = Exclude<ToolId, "select" | "wall">;

export interface Point {
  x: number;
  y: number;
}

export interface WallPoint extends Point {
  id: string;
}

export interface WallSegment {
  id: string;
  startPointId: string;
  endPointId: string;
  label?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface MapEntity {
  id: string;
  type: EntityType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
  metadata: {
    color?: string;
    ceilingType?: "standard" | "cathedral" | "cathedral-horizontal" | "sloped" | "sloped-horizontal" | "none";
    standardHeightFt?: number;
    lowHeightFt?: number;
    highHeightFt?: number;
    [key: string]: string | number | boolean | undefined;
  };
}

export interface FloorData {
  id: string;
  name: string;
  floorPreset?: FloorPreset;
  unconditioned?: boolean;
  duplicateConditionedBaseline?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  entities: MapEntity[];
  wallPoints: WallPoint[];
  wallSegments: WallSegment[];
}

export interface Project {
  projectId: string;
  projectName: string;
  address: string;
  orientation: Orientation;
  averageCeilingHeightFt: number;
  floors: FloorData[];
  activeFloorId: string;
  metadata: Record<string, string | number | boolean>;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export type Selection =
  | { kind: "none" }
  | { kind: "entity"; id: string }
  | { kind: "wallSegment"; id: string }
  | { kind: "wallPoint"; id: string };

export interface EditorState {
  project: Project;
  activeTool: ToolId;
  selection: Selection;
  camera: CameraState;
  wallDraftPointId: string | null;
  previewEntity: MapEntity | null;
  historyPast: Project[];
  historyFuture: Project[];
}

export type EditorAction =
  | { type: "SET_TOOL"; tool: ToolId }
  | { type: "SET_RECTANGLE_STICKY_MODE"; enabled: boolean }
  | { type: "SET_SELECTION"; selection: Selection }
  | { type: "SET_CAMERA"; camera: Partial<CameraState> }
  | { type: "PAN_CAMERA"; dx: number; dy: number }
  | { type: "ZOOM_CAMERA"; nextZoom: number; pivot: Point }
  | { type: "CLEAR_WALL_DRAFT" }
  | { type: "START_WALL_DRAFT"; pointId: string }
  | { type: "SET_ORIENTATION"; orientation: Orientation }
  | { type: "SET_PROJECT_NAME"; projectName: string }
  | { type: "SET_ADDRESS"; address: string }
  | { type: "SET_DEFAULT_WINDOW_SIZE"; widthFt: number; heightFt: number }
  | { type: "SET_DEFAULT_DOOR_TYPE"; doorType: "single" | "double" | "sliding" }
  | { type: "SET_AVG_CEILING"; value: number }
  | {
      type: "ADD_LEVEL";
      floorName: string;
      floorPreset: FloorPreset;
      unconditioned: boolean;
      copyFromFloorId?: string;
    }
  | { type: "DELETE_LEVEL"; floorId: string }
  | { type: "SET_ACTIVE_FLOOR"; floorId: string }
  | { type: "UPDATE_LEVEL"; floorId: string; name: string; floorPreset: FloorPreset; unconditioned: boolean }
  | { type: "DUPLICATE_LEVEL_RECTANGLES"; floorId: string; floorName: string; unconditioned: boolean }
  | { type: "UPSERT_ENTITY"; entity: MapEntity }
  | {
      type: "APPLY_RECT_RESIZE_WITH_PUSH";
      entity: MapEntity;
      pushedRectangles: Array<{ id: string; x: number; y: number }>;
    }
  | { type: "REMOVE_ENTITY"; entityId: string }
  | { type: "MOVE_ENTITY"; entityId: string; x: number; y: number }
  | { type: "ROTATE_ENTITY"; entityId: string; rotation: number }
  | { type: "UPDATE_ENTITY_LABEL"; entityId: string; label: string }
  | { type: "ADD_WALL_POINT"; point: WallPoint }
  | { type: "MOVE_WALL_POINT"; pointId: string; x: number; y: number }
  | { type: "ADD_WALL_SEGMENT"; segment: WallSegment }
  | { type: "REMOVE_WALL_SEGMENT"; segmentId: string }
  | { type: "SET_WALL_SEGMENT_LENGTH"; segmentId: string; lengthFt: number }
  | { type: "SET_PREVIEW_ENTITY"; entity: MapEntity }
  | { type: "CLEAR_PREVIEW_ENTITY" }
  | { type: "DELETE_SELECTION" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "LOAD_PROJECT"; project: Project }
  | { type: "RESET_PROJECT" };

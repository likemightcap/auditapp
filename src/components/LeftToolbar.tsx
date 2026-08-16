import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { calculateProjectMetrics } from "../utils/calculations";
import { useEditor } from "../state/EditorContext";
import { createEntityFromTool } from "../state/editorReducer";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
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
import { screenToWorld, snapPointToGrid } from "../utils/geometry";
import type { ToolId } from "../types";

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

      <button
        className="return-btn"
        type="button"
        onClick={() => window.history.back()}
        title="Return"
        aria-label="Return"
      >
        {collapsed ? "<-" : "Return To Job"}
      </button>

      {typeof document !== "undefined" ? createPortal(windowToolModal, document.body) : windowToolModal}
      {typeof document !== "undefined" ? createPortal(utilityLabelModal, document.body) : utilityLabelModal}

      {utilityGhost && typeof document !== "undefined" ? createPortal(utilityGhost, document.body) : null}
    </aside>
  );
}

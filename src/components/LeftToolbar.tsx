import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { calculateProjectMetrics } from "../utils/calculations";
import { useEditor } from "../state/EditorContext";
import { createEntityFromTool } from "../state/editorReducer";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
import { getUtilityIconByToolId, isUtilityToolId } from "../assets/utilityIcons";
import { WindowModal } from "./WindowModal";
import type { WindowModalSubmit } from "./WindowModal";
import { UtilityLabelModal } from "./UtilityLabelModal";
import type { UtilityLabelInitialValues, UtilityLabelSubmit } from "./UtilityLabelModal";
import { screenToWorld, snapPointToGrid } from "../utils/geometry";
import {
  exportProjectAsJson,
  importProjectFromJson,
  loadProjectFromLocalStorage,
  saveProjectToLocalStorage,
} from "../utils/persistence";
import type { ToolId } from "../types";

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

function ToolIcon({ toolId, fallback }: { toolId: ToolId; fallback: string }) {
  if (isUtilityToolId(toolId)) {
    return <img className="tool-icon-image" src={getUtilityIconByToolId(toolId)} alt="" aria-hidden="true" />;
  }

  if (toolId === "select") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 2 L4 20 L8.6 15.9 L11.6 22 L14.6 20.5 L11.5 14.6 L18 14.3 Z"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (toolId === "rectangle") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.2" y="6" width="17.6" height="12" fill="rgba(255,255,255,0.5)" stroke="#ffffff" strokeWidth="2.8" />
      </svg>
    );
  }

  if (toolId === "door") {
    return (
      <svg className="tool-icon-svg tool-icon-door" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 18 A8 8 0 0 1 16 10 L16 18 Z" fill="#a6a24a" />
        <path d="M8 18 A8 8 0 0 1 16 10" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="square" />
        <line x1="16" y1="10" x2="16" y2="18" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="square" />
        <line x1="8" y1="18" x2="16" y2="18" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="square" />
      </svg>
    );
  }

  if (toolId === "window") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4.4" y="9.4" width="15.2" height="5.2" fill="none" stroke="#ffffff" strokeWidth="2.8" />
        <rect x="6.8" y="11" width="10.4" height="2" fill="#0f87a2" />
      </svg>
    );
  }

  if (toolId === "skylight") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6.2" y="4.4" width="11.6" height="15.2" fill="none" stroke="#ffffff" strokeWidth="2.8" />
        <rect x="8" y="6.2" width="8" height="11.6" fill="#0f87a2" />
      </svg>
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
  onToolPressed,
}: {
  title: string;
  ids: ToolId[];
  onWindowToolConfigRequest?: () => void;
  onToolPressed?: (toolId: ToolId) => void;
}) {
  const { state, dispatch } = useEditor();
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPointerIdRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const longPressFiredRef = useRef(false);

  const clearWindowToolLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = null;
    longPressPointerIdRef.current = null;
  };

  const orderedTools = ids
    .map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));

  return (
    <div className="tool-group">
      <h3>{title}</h3>
      <div className="tool-grid">
        {orderedTools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`tool-btn ${state.activeTool === tool.id ? "active" : ""}`}
            draggable={false}
            onClick={() => {
              if (isUtilityToolId(tool.id)) {
                return;
              }
              if (tool.id === "window" && longPressFiredRef.current) {
                longPressFiredRef.current = false;
                return;
              }
              onToolPressed?.(tool.id);
              dispatch({ type: "SET_TOOL", tool: tool.id });
            }}
            onContextMenu={(event) => {
              if (tool.id !== "window") {
                return;
              }
              event.preventDefault();
              onToolPressed?.("window");
              dispatch({ type: "SET_TOOL", tool: "window" });
              onWindowToolConfigRequest?.();
            }}
            onPointerDown={(event) => {
              if (tool.id !== "window" || event.pointerType !== "touch") {
                return;
              }
              clearWindowToolLongPress();
              longPressFiredRef.current = false;
              longPressPointerIdRef.current = event.pointerId;
              longPressStartRef.current = { x: event.clientX, y: event.clientY };
              longPressTimerRef.current = setTimeout(() => {
                longPressFiredRef.current = true;
                onToolPressed?.("window");
                dispatch({ type: "SET_TOOL", tool: "window" });
                onWindowToolConfigRequest?.();
                clearWindowToolLongPress();
              }, 520);
            }}
            onPointerMove={(event) => {
              if (tool.id !== "window" || longPressPointerIdRef.current !== event.pointerId) {
                return;
              }
              const dx = event.clientX - longPressStartRef.current.x;
              const dy = event.clientY - longPressStartRef.current.y;
              if (Math.hypot(dx, dy) > 8) {
                clearWindowToolLongPress();
              }
            }}
            onPointerUp={(event) => {
              if (tool.id !== "window" || longPressPointerIdRef.current !== event.pointerId) {
                return;
              }
              clearWindowToolLongPress();
            }}
            onPointerCancel={(event) => {
              if (tool.id !== "window" || longPressPointerIdRef.current !== event.pointerId) {
                return;
              }
              clearWindowToolLongPress();
            }}
            onPointerLeave={() => {
              if (tool.id !== "window") {
                return;
              }
              clearWindowToolLongPress();
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
            className="tool-btn"
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

export function LeftToolbar() {
  const { state, dispatch } = useEditor();
  const metrics = calculateProjectMetrics(state.project, state.previewEntity);
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
        current
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
        if (!current) {
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

  return (
    <aside className="left-toolbar">
      <ToolGroup title="TOOLS" ids={["select", "rectangle", "text"]} onToolPressed={maybeClearSelectionForTool} />
      <ToolGroup
        title="BUILDING"
        ids={["door", "window", "skylight"]}
        onWindowToolConfigRequest={() => setWindowToolModalOpen(true)}
        onToolPressed={maybeClearSelectionForTool}
      />
      <UtilityStickerGroup
        ids={["condenser", "heater", "dhw", "gas", "electric", "other"]}
        onStartDrag={startUtilityDrag}
      />

      <section className="details-panel">
        <h3>DETAILS</h3>
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

      <section className="dev-controls">
        <h3>SAVE/LOAD</h3>
        <div className="dev-btns">
          <button type="button" onClick={() => saveProjectToLocalStorage(state.project)}>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              const loaded = loadProjectFromLocalStorage();
              if (loaded) {
                dispatch({ type: "LOAD_PROJECT", project: loaded });
              }
            }}
          >
            Load
          </button>
          <button
            type="button"
            onClick={() => {
              const json = exportProjectAsJson(state.project);
              navigator.clipboard.writeText(json).catch(() => undefined);
              window.alert("Project JSON copied to clipboard.");
            }}
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => {
              const input = window.prompt("Paste project JSON");
              if (!input) {
                return;
              }
              try {
                const project = importProjectFromJson(input);
                dispatch({ type: "LOAD_PROJECT", project });
              } catch {
                window.alert("Invalid JSON payload.");
              }
            }}
          >
            Import JSON
          </button>
        </div>
      </section>

      <button className="return-btn" type="button" onClick={() => window.history.back()}>
        Return
      </button>

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

      {typeof document !== "undefined" ? createPortal(utilityLabelModal, document.body) : utilityLabelModal}

      {utilityGhost && typeof document !== "undefined" ? createPortal(utilityGhost, document.body) : null}
    </aside>
  );
}

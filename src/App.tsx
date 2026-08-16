import { useEffect, useRef, useState } from "react";
import { ConfirmModal } from "./components/ConfirmModal";
import { DuplicateNameModal } from "./components/DuplicateNameModal";
import { FloorTabs } from "./components/FloorTabs";
import { LeftToolbar } from "./components/LeftToolbar";
import { LevelModal } from "./components/LevelModal";
import type { LevelModalSubmit } from "./components/LevelModal";
import { Workspace } from "./components/Workspace";
import { EditorProvider, useEditor } from "./state/EditorContext";

const SIDEBAR_BASE_WIDTH = 280;
const SIDEBAR_COLLAPSED_BASE_WIDTH = 84;
const SIDEBAR_MIN_SCALE = 0.42;
interface LevelModalState {
  mode: "create" | "edit";
  floorId?: string;
  initialName: string;
  initialUnconditioned: boolean;
}

interface DeleteLevelConfirmState {
  floorId: string;
  floorName: string;
}

interface DuplicateLevelState {
  sourceFloorId: string;
  unconditioned: boolean;
  initialName: string;
}

function selectedEntityType(state: ReturnType<typeof useEditor>["state"]): string | null {
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
}

function isEditableTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) {
    return false;
  }
  const tagName = node.tagName.toLowerCase();
  return (
    node.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(node.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function EditorShell() {
  const { dispatch, state } = useEditor();
  const canUndo = state.historyPast.length > 0;
  const canRedo = state.historyFuture.length > 0;
  const canDelete = state.selection.kind !== "none";
  const hasLayout = state.project.floors.length > 0;
  const activeFloor = state.project.floors.find((item) => item.id === state.project.activeFloorId) ?? state.project.floors[0] ?? null;
  const [levelModalState, setLevelModalState] = useState<LevelModalState | null>(null);
  const [deleteLevelConfirmState, setDeleteLevelConfirmState] = useState<DeleteLevelConfirmState | null>(null);
  const [duplicateLevelState, setDuplicateLevelState] = useState<DuplicateLevelState | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const sidebarFrameRef = useRef<HTMLDivElement | null>(null);
  const sidebarScaleTargetRef = useRef<HTMLDivElement | null>(null);
  const [sidebarScale, setSidebarScale] = useState(1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarBaseWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_BASE_WIDTH : SIDEBAR_BASE_WIDTH;

  useEffect(() => {
    const recalculateScale = () => {
      const shell = shellRef.current;
      const frame = sidebarFrameRef.current;
      const target = sidebarScaleTargetRef.current;
      if (!shell || !frame || !target) {
        return;
      }

      const availableHeight = frame.clientHeight;
      const availableWidth = Math.max(sidebarBaseWidth * SIDEBAR_MIN_SCALE, shell.clientWidth * 0.42);
      const naturalHeight = Math.max(1, target.scrollHeight);
      const naturalWidth = Math.max(1, target.scrollWidth);

      const nextScale = Math.max(
        SIDEBAR_MIN_SCALE,
        Math.min(1, availableHeight / naturalHeight, availableWidth / naturalWidth),
      );

      setSidebarScale((previous) => (Math.abs(previous - nextScale) > 0.005 ? nextScale : previous));
    };

    const observer = new ResizeObserver(recalculateScale);
    if (shellRef.current) {
      observer.observe(shellRef.current);
    }
    if (sidebarFrameRef.current) {
      observer.observe(sidebarFrameRef.current);
    }
    if (sidebarScaleTargetRef.current) {
      observer.observe(sidebarScaleTargetRef.current);
    }

    const rafId = window.requestAnimationFrame(recalculateScale);
    window.addEventListener("resize", recalculateScale);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", recalculateScale);
      observer.disconnect();
    };
  }, [sidebarBaseWidth]);

  useEffect(() => {
    const preventGesture = (event: Event) => {
      if (!isEditableTarget(event.target)) {
        event.preventDefault();
      }
    };

    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    document.addEventListener("gestureend", preventGesture, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
    };
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const onSelectStart = (event: Event) => {
      if (!isEditableTarget(event.target)) {
        event.preventDefault();
      }
    };

    shell.addEventListener("selectstart", onSelectStart);
    return () => shell.removeEventListener("selectstart", onSelectStart);
  }, []);

  useEffect(() => {
    const isCoarsePointer = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    const isSmallViewport = window.matchMedia("(max-width: 1366px)").matches;
    if (!isCoarsePointer || !isSmallViewport) {
      return;
    }

    const body = document.body;
    const portraitQuery = window.matchMedia("(orientation: portrait)");

    const applyForcedLandscapeClasses = () => {
      body.classList.add("force-landscape-device");
      body.classList.toggle("force-landscape-portrait", portraitQuery.matches);
    };

    const orientationApi = screen.orientation as (ScreenOrientation & {
      lock?: (orientation: OrientationLockType) => Promise<void>;
    }) | null;

    const attemptLandscapeLock = () => {
      orientationApi?.lock?.("landscape").catch(() => {
        // Some browsers only allow locking under specific contexts/user gestures.
      });
    };

    applyForcedLandscapeClasses();
    attemptLandscapeLock();

    const onResize = () => {
      applyForcedLandscapeClasses();
      attemptLandscapeLock();
    };
    const onVisibilityChange = () => {
      if (!document.hidden) {
        applyForcedLandscapeClasses();
        attemptLandscapeLock();
      }
    };
    const onPointerDown = () => attemptLandscapeLock();

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    portraitQuery.addEventListener("change", onResize);

    return () => {
      body.classList.remove("force-landscape-device", "force-landscape-portrait");
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerdown", onPointerDown);
      portraitQuery.removeEventListener("change", onResize);
    };
  }, []);

  const clearSelectionOnAppPress = (event: React.PointerEvent<HTMLDivElement>) => {
    if (state.selection.kind !== "entity") {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const entityType = selectedEntityType(state);
    const toolButton = target.closest("button.tool-btn") as HTMLButtonElement | null;
    if (toolButton) {
      const label = (toolButton.querySelector(".label")?.textContent ?? "").trim().toLowerCase();
      const selectedTool = state.activeTool.toLowerCase();
      if (selectedTool === "select" || entityType === selectedTool || label === selectedTool) {
        return;
      }
      dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
      return;
    }

    if (target.closest(".modal-backdrop")) {
      return;
    }

    if (target.closest(".header-actions")) {
      return;
    }

    if (target.closest(".stage-header-title")) {
      return;
    }

    dispatch({ type: "SET_SELECTION", selection: { kind: "none" } });
  };

  const openCreateLevelModal = () => {
    const count = state.project.floors.length + 1;
    setLevelModalState({
      mode: "create",
      initialName: `Level ${count}`,
      initialUnconditioned: false,
    });
  };

  const openEditLevelModal = (floorId: string) => {
    const floor = state.project.floors.find((item) => item.id === floorId);
    if (!floor) {
      return;
    }
    setLevelModalState({
      mode: "edit",
      floorId,
      initialName: floor.name,
      initialUnconditioned: Boolean(floor.unconditioned),
    });
  };

  const handleLevelSubmit = (payload: LevelModalSubmit) => {
    if (!levelModalState) {
      return;
    }

    if (levelModalState.mode === "create") {
      dispatch({
        type: "ADD_LEVEL",
        floorName: payload.name,
        unconditioned: payload.unconditioned,
      });
      setLevelModalState(null);
      return;
    }

    if (!levelModalState.floorId) {
      return;
    }

    dispatch({
      type: "UPDATE_LEVEL",
      floorId: levelModalState.floorId,
      name: payload.name,
      unconditioned: payload.unconditioned,
    });
    setLevelModalState(null);
  };

  const handleLevelDuplicate = (payload: LevelModalSubmit) => {
    if (!levelModalState || levelModalState.mode !== "edit" || !levelModalState.floorId) {
      return;
    }

    setDuplicateLevelState({
      sourceFloorId: levelModalState.floorId,
      unconditioned: payload.unconditioned,
      initialName: payload.name ? `${payload.name} Copy` : "Level Copy",
    });
  };

  const confirmDuplicateLevel = (duplicateName: string) => {
    if (!duplicateLevelState) {
      return;
    }

    dispatch({
      type: "DUPLICATE_LEVEL_RECTANGLES",
      floorId: duplicateLevelState.sourceFloorId,
      floorName: duplicateName,
      unconditioned: duplicateLevelState.unconditioned,
    });
    setDuplicateLevelState(null);
    setLevelModalState(null);
  };

  const requestDeleteLevel = () => {
    if (!levelModalState || levelModalState.mode !== "edit" || !levelModalState.floorId) {
      return;
    }

    setDeleteLevelConfirmState({
      floorId: levelModalState.floorId,
      floorName: levelModalState.initialName,
    });
  };

  const confirmDeleteLevel = () => {
    if (!deleteLevelConfirmState) {
      return;
    }

    dispatch({ type: "DELETE_LEVEL", floorId: deleteLevelConfirmState.floorId });
    setDeleteLevelConfirmState(null);
    setLevelModalState(null);
  };

  return (
    <div
      ref={shellRef}
      className="app-shell"
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={clearSelectionOnAppPress}
    >
      <div
        ref={sidebarFrameRef}
        className="sidebar-scale-frame"
        style={{ width: `${sidebarBaseWidth * sidebarScale}px` }}
      >
        <div
          ref={sidebarScaleTargetRef}
          className="sidebar-scale-target"
          style={{ transform: `scale(${sidebarScale})`, width: `${sidebarBaseWidth}px` }}
        >
          <LeftToolbar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((current) => !current)} />
        </div>
      </div>

      <main className="main-stage">
        <header className="stage-header">
          <div className="stage-header-title">
            <h1>HOME LAYOUT</h1>
            {activeFloor && <span className="stage-header-level">{activeFloor.name}</span>}
          </div>
          <div className="header-actions">
            <button type="button" disabled={!canUndo} onClick={() => dispatch({ type: "UNDO" })}>
              Undo
            </button>
            <button type="button" disabled={!canRedo} onClick={() => dispatch({ type: "REDO" })}>
              Redo
            </button>
            <button
              type="button"
              className="danger"
              disabled={!canDelete}
              onClick={() => dispatch({ type: "DELETE_SELECTION" })}
            >
              Delete
            </button>
          </div>
        </header>

        <Workspace />
        {!hasLayout && (
          <div className="layout-lock-overlay">
            <button type="button" className="create-layout-btn" onClick={openCreateLevelModal}>
              CREATE NEW LAYOUT
            </button>
          </div>
        )}
        <FloorTabs onRequestCreate={openCreateLevelModal} onRequestEdit={openEditLevelModal} />
      </main>

      <LevelModal
        isOpen={levelModalState !== null}
        title={levelModalState?.mode === "edit" ? "EDIT LEVEL" : "CREATE LEVEL"}
        initialName={levelModalState?.initialName ?? ""}
        initialUnconditioned={levelModalState?.initialUnconditioned ?? false}
        showDuplicate={levelModalState?.mode === "edit"}
        showDelete={levelModalState?.mode === "edit"}
        onCancel={() => setLevelModalState(null)}
        onSubmit={handleLevelSubmit}
        onDuplicate={handleLevelDuplicate}
        onDelete={requestDeleteLevel}
      />

      <ConfirmModal
        isOpen={deleteLevelConfirmState !== null}
        title="DELETE LEVEL"
        message={`Delete \"${deleteLevelConfirmState?.floorName ?? "this level"}\"?`}
        confirmText="YES, DELETE"
        cancelText="NO"
        onCancel={() => setDeleteLevelConfirmState(null)}
        onConfirm={confirmDeleteLevel}
      />

      <DuplicateNameModal
        isOpen={duplicateLevelState !== null}
        initialName={duplicateLevelState?.initialName ?? ""}
        onCancel={() => setDuplicateLevelState(null)}
        onSubmit={confirmDuplicateLevel}
      />
    </div>
  );
}

export default function App() {
  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  );
}

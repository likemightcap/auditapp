import { FloorTabs } from "./components/FloorTabs";
import { LeftToolbar } from "./components/LeftToolbar";
import { OrientationControl } from "./components/OrientationControl";
import { Workspace } from "./components/Workspace";
import { EditorProvider, useEditor } from "./state/EditorContext";

function EditorShell() {
  const { dispatch, state } = useEditor();
  const canUndo = state.historyPast.length > 0;
  const canRedo = state.historyFuture.length > 0;

  return (
    <div className="app-shell">
      <LeftToolbar />

      <main className="main-stage">
        <header className="stage-header">
          <h1>SITE LAYOUT</h1>
          <div className="header-actions">
            <button type="button" disabled={!canUndo} onClick={() => dispatch({ type: "UNDO" })}>
              Undo
            </button>
            <button type="button" disabled={!canRedo} onClick={() => dispatch({ type: "REDO" })}>
              Redo
            </button>
          </div>
        </header>

        <Workspace />
        <OrientationControl />
        <FloorTabs />
      </main>
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

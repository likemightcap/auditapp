import { useEffect, useRef, useState } from "react";
import { useEditor } from "../state/EditorContext";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

interface FloorTabsProps {
  onRequestCreate: () => void;
  onRequestEdit: (floorId: string) => void;
}

export function FloorTabs({ onRequestCreate, onRequestEdit }: FloorTabsProps) {
  const { state, dispatch } = useEditor();
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPointerIdRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const updateInstalled = () => {
      const standaloneMedia = window.matchMedia("(display-mode: standalone)").matches;
      const navigatorStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
      setIsInstalled(standaloneMedia || navigatorStandalone);
    };

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredInstallPrompt(null);
    };

    updateInstalled();
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = null;
    longPressPointerIdRef.current = null;
  };

  const handleInstall = async () => {
    if (!deferredInstallPrompt) {
      window.alert("To install on this device, use your browser's Add to Home Screen or Install App option.");
      return;
    }

    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredInstallPrompt(null);
      setIsInstalled(true);
    }
  };

  return (
    <div className="floor-tabs" role="tablist" aria-label="Floors">
      <div className="floor-tabs-left">
      {state.project.floors.map((floor) => (
        <button
          key={floor.id}
          type="button"
          role="tab"
          className={`floor-tab ${state.project.activeFloorId === floor.id ? "active" : ""} ${floor.unconditioned ? "unconditioned" : ""}`}
          onClick={() => dispatch({ type: "SET_ACTIVE_FLOOR", floorId: floor.id })}
          onContextMenu={(event) => {
            event.preventDefault();
            onRequestEdit(floor.id);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            clearLongPress();
            longPressPointerIdRef.current = event.pointerId;
            longPressStartRef.current = { x: event.clientX, y: event.clientY };
            longPressTimerRef.current = setTimeout(() => {
              onRequestEdit(floor.id);
              clearLongPress();
            }, 520);
          }}
          onPointerMove={(event) => {
            if (longPressPointerIdRef.current !== event.pointerId) {
              return;
            }
            const dx = event.clientX - longPressStartRef.current.x;
            const dy = event.clientY - longPressStartRef.current.y;
            if (Math.hypot(dx, dy) > 12) {
              clearLongPress();
            }
          }}
          onPointerUp={(event) => {
            if (longPressPointerIdRef.current === event.pointerId) {
              clearLongPress();
            }
          }}
          onPointerCancel={(event) => {
            if (longPressPointerIdRef.current === event.pointerId) {
              clearLongPress();
            }
          }}
        >
          {floor.name}
        </button>
      ))}
      <button
        type="button"
        className="floor-tab add"
        onClick={onRequestCreate}
      >
        + New
      </button>
      </div>

      {!isInstalled && (
        <button type="button" className="floor-tab install" onClick={handleInstall}>
          Download App
        </button>
      )}
    </div>
  );
}

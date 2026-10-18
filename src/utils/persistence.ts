import type { Project } from "../types";
import { capeCodAverageHeight, getCapeCodGeometry, isCapeCodCeiling } from "./capeCodCeiling.ts";

const STORAGE_KEY = "energy-audit-floorplan-project";

export function saveProjectToLocalStorage(project: Project): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function loadProjectFromLocalStorage(): Project | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return importProjectFromJson(raw);
  } catch {
    return null;
  }
}

export function exportProjectAsJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function importProjectFromJson(raw: string): Project {
  const project = JSON.parse(raw) as Project;
  for (const floor of project.floors ?? []) {
    for (const entity of floor.entities ?? []) {
      if (entity.type === "rectangle" && isCapeCodCeiling(entity.metadata?.ceilingType)) {
        capeCodAverageHeight(
          getCapeCodGeometry(entity),
          Number(entity.metadata.lowHeightFt ?? 8),
          Number(entity.metadata.highHeightFt ?? 12),
        );
      }
    }
  }
  return project;
}

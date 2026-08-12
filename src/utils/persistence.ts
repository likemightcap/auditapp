import type { Project } from "../types";

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
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

export function exportProjectAsJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function importProjectFromJson(raw: string): Project {
  return JSON.parse(raw) as Project;
}

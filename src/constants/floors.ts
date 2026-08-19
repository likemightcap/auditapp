import type { FloorData, FloorPreset } from "../types";

export const FLOOR_PRESET_ORDER: FloorPreset[] = [
  "BASEMENT_CRAWLSPACE",
  "FIRST_FLOOR",
  "SECOND_FLOOR",
  "THIRD_FLOOR",
  "ATTIC",
];

export const FLOOR_PRESET_LABELS: Record<FloorPreset, string> = {
  BASEMENT_CRAWLSPACE: "BASEMENT/CRAWLSPACE",
  FIRST_FLOOR: "1ST FLOOR",
  SECOND_FLOOR: "2ND FLOOR",
  THIRD_FLOOR: "3RD FLOOR",
  ATTIC: "ATTIC",
};

export function isBasementPreset(preset: FloorPreset): boolean {
  return preset === "BASEMENT_CRAWLSPACE";
}

export function isAtticPreset(preset: FloorPreset): boolean {
  return preset === "ATTIC";
}

export function inferFloorPresetFromName(name: string): FloorPreset {
  const normalized = name.trim().toUpperCase();
  if (normalized.includes("BASEMENT")) {
    return "BASEMENT_CRAWLSPACE";
  }
  if (normalized.includes("3RD")) {
    return "THIRD_FLOOR";
  }
  if (normalized.includes("2ND")) {
    return "SECOND_FLOOR";
  }
  if (normalized.includes("ATTIC")) {
    return "ATTIC";
  }
  return "FIRST_FLOOR";
}

export function floorPresetRank(preset: FloorPreset): number {
  const index = FLOOR_PRESET_ORDER.indexOf(preset);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function sortFloorsByPresetOrder(floors: FloorData[]): FloorData[] {
  return [...floors].sort((a, b) => {
    const presetA = a.floorPreset ?? inferFloorPresetFromName(a.name);
    const presetB = b.floorPreset ?? inferFloorPresetFromName(b.name);
    const rankDiff = floorPresetRank(presetA) - floorPresetRank(presetB);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.name.localeCompare(b.name);
  });
}

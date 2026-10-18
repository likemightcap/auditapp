import type { MapEntity } from "../types";

export const CAPE_COD_MIN_SECTION_FT = 2;
export const CAPE_COD_MIN_SPAN_FT = CAPE_COD_MIN_SECTION_FT * 3;

export function isCapeCodCeiling(value: unknown): value is "cape-cod" | "cape-cod-horizontal" {
  return value === "cape-cod" || value === "cape-cod-horizontal";
}

export interface CapeCodGeometry {
  horizontal: boolean;
  spanFt: number;
  slopeWidthFt: number;
  centerWidthFt: number;
  centerRatio: number;
}

export function getCapeCodGeometry(
  entity: Pick<MapEntity, "width" | "height" | "metadata">,
): CapeCodGeometry {
  const horizontal = entity.metadata.ceilingType === "cape-cod-horizontal";
  const spanFt = Math.abs(horizontal ? entity.height : entity.width);
  const ratio = entity.metadata.capeCodCenterRatio;
  if (!Number.isFinite(spanFt) || spanFt < CAPE_COD_MIN_SPAN_FT) {
    throw new RangeError("Cape Cod ceilings require at least 6 feet across the three sections.");
  }
  if (ratio !== undefined && (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)) {
    throw new RangeError("Cape Cod center ratio must be between 0 and 1.");
  }
  // Prefer whole-foot slopes near a quarter of the span, with a whole-foot center.
  const defaultCenterWidthFt = Math.max(
    CAPE_COD_MIN_SECTION_FT,
    Math.min(
      Math.floor(spanFt - 2 * CAPE_COD_MIN_SECTION_FT),
      Math.round(spanFt - 2 * Math.round(spanFt / 4)),
    ),
  );
  const centerWidthFt = Math.max(
    CAPE_COD_MIN_SECTION_FT,
    Math.min(spanFt - 2 * CAPE_COD_MIN_SECTION_FT, ratio === undefined ? defaultCenterWidthFt : spanFt * ratio),
  );
  const slopeWidthFt = (spanFt - centerWidthFt) / 2;
  return { horizontal, spanFt, slopeWidthFt, centerWidthFt, centerRatio: centerWidthFt / spanFt };
}

export function moveCapeCodDivider(
  geometry: CapeCodGeometry,
  side: "start" | "end",
  deltaFt: number,
): number {
  if (!Number.isFinite(deltaFt)) {
    throw new RangeError("Cape Cod divider movement must be finite.");
  }
  // Snap movement, rather than the initial divider position, so saved fractional positions never jump on grab.
  const slopeWidthFt = Math.max(
    CAPE_COD_MIN_SECTION_FT,
    Math.min(
      (geometry.spanFt - CAPE_COD_MIN_SECTION_FT) / 2,
      geometry.slopeWidthFt + Math.round(deltaFt) * (side === "start" ? 1 : -1),
    ),
  );
  return (geometry.spanFt - 2 * slopeWidthFt) / geometry.spanFt;
}

export function capeCodAverageHeight(
  geometry: CapeCodGeometry,
  lowFt: number,
  highFt: number,
  startFt = 0,
  endFt = geometry.spanFt,
): number {
  if (!Number.isFinite(lowFt) || !Number.isFinite(highFt) || lowFt < 1 || highFt < lowFt) {
    throw new RangeError("Cape Cod heights require HIGH >= LOW >= 1 foot.");
  }
  if (!Number.isFinite(startFt) || !Number.isFinite(endFt) || startFt < 0 || endFt > geometry.spanFt || endFt <= startFt) {
    throw new RangeError("Cape Cod height interval must lie within its cross-section.");
  }
  const { slopeWidthFt, spanFt } = geometry;
  const slopeIntegral = (start: number, end: number) =>
    lowFt * (end - start) + (highFt - lowFt) * (end * end - start * start) / (2 * slopeWidthFt);
  let volumePerFoot = 0;
  if (startFt < slopeWidthFt) {
    volumePerFoot += slopeIntegral(startFt, Math.min(endFt, slopeWidthFt));
  }
  const centerStart = Math.max(startFt, slopeWidthFt);
  const centerEnd = Math.min(endFt, spanFt - slopeWidthFt);
  if (centerEnd > centerStart) {
    volumePerFoot += (centerEnd - centerStart) * highFt;
  }
  if (endFt > spanFt - slopeWidthFt) {
    volumePerFoot += slopeIntegral(spanFt - endFt, spanFt - Math.max(startFt, spanFt - slopeWidthFt));
  }
  return volumePerFoot / (endFt - startFt);
}

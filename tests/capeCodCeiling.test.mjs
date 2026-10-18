import assert from "node:assert/strict";
import { test } from "node:test";
import { capeCodAverageHeight, getCapeCodGeometry, moveCapeCodDivider } from "../src/utils/capeCodCeiling.ts";
import { calculateProjectDetailsReport, calculateProjectMetrics } from "../src/utils/calculations.ts";
import { exportProjectAsJson, importProjectFromJson } from "../src/utils/persistence.ts";

function rectangle(overrides = {}) {
  return {
    id: "cape",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 18,
    height: 32,
    rotation: 0,
    label: "Cape Cod",
    ...overrides,
    metadata: {
      ceilingType: "cape-cod",
      lowHeightFt: 4,
      highHeightFt: 8,
      ...overrides.metadata,
    },
  };
}

function project(entities) {
  return {
    projectId: "test",
    projectName: "Ceiling tests",
    address: "",
    orientation: "S",
    averageCeilingHeightFt: 8,
    activeFloorId: "floor",
    metadata: {},
    floors: [{
      id: "floor",
      name: "1ST FLOOR",
      floorPreset: "FIRST_FLOOR",
      entities,
      wallPoints: [],
      wallSegments: [],
    }],
  };
}

function approximately(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}

test("whole-foot default and symmetric 1-foot divider movement", () => {
  const geometry = getCapeCodGeometry(rectangle());
  assert.equal(geometry.slopeWidthFt, 5);
  assert.equal(geometry.centerWidthFt, 8);
  assert.equal(moveCapeCodDivider(geometry, "start", 0.1), 8 / 18);
  assert.equal(moveCapeCodDivider(geometry, "start", 1.2), 6 / 18);
  assert.equal(moveCapeCodDivider(geometry, "end", -1.2), 6 / 18);
  assert.equal(moveCapeCodDivider(geometry, "start", -100), 14 / 18);
  assert.equal(moveCapeCodDivider(geometry, "end", -100), 2 / 18);
  assert.throws(() => moveCapeCodDivider(geometry, "start", NaN), /finite/);
});

test("new whole-foot spans start with three whole-foot sections in either orientation", () => {
  for (let span = 6; span <= 100; span++) {
    for (const horizontal of [false, true]) {
      const geometry = getCapeCodGeometry(rectangle({
        width: horizontal ? 32 : span,
        height: horizontal ? span : 32,
        metadata: { ceilingType: horizontal ? "cape-cod-horizontal" : "cape-cod" },
      }));
      assert.ok(Number.isInteger(geometry.centerWidthFt), `Fractional center at span ${span}`);
      assert.ok(Number.isInteger(geometry.slopeWidthFt), `Fractional slope at span ${span}`);
      assert.ok(geometry.centerWidthFt >= 2 && geometry.slopeWidthFt >= 2);
      assert.ok(Math.abs(geometry.centerWidthFt - span / 2) <= 1);
      assert.equal(geometry.centerWidthFt + 2 * geometry.slopeWidthFt, span);
    }
  }
});

test("fractional spans still start with a whole-foot center", () => {
  for (const span of [6.25, 6.5, 7.75, 18.5, 19.25]) {
    const geometry = getCapeCodGeometry(rectangle({ width: span }));
    assert.ok(Number.isInteger(geometry.centerWidthFt));
    assert.ok(geometry.centerWidthFt >= 2 && geometry.slopeWidthFt >= 2);
    approximately(geometry.centerWidthFt + 2 * geometry.slopeWidthFt, span);
  }
});

test("saved fractional divider positions are preserved", () => {
  const entity = rectangle({ metadata: { capeCodCenterRatio: 0.5 } });
  const loaded = importProjectFromJson(exportProjectAsJson(project([entity])));
  const geometry = getCapeCodGeometry(loaded.floors[0].entities[0]);
  assert.equal(geometry.slopeWidthFt, 4.5);
  assert.equal(geometry.centerWidthFt, 9);
  assert.equal(moveCapeCodDivider(geometry, "start", 0.1), 0.5);
});

test("all three sections respect 2-foot limits, including resizing and orientation changes", () => {
  for (const span of [6, 7, 8, 9, 18, 32]) {
    for (const ratio of [0, 0.1, 0.5, 0.9, 1]) {
      const geometry = getCapeCodGeometry(rectangle({ width: span, metadata: { capeCodCenterRatio: ratio } }));
      assert.ok(geometry.slopeWidthFt >= 2);
      assert.ok(geometry.centerWidthFt >= 2);
      approximately(2 * geometry.slopeWidthFt + geometry.centerWidthFt, span);
    }
  }
  const horizontal = getCapeCodGeometry(rectangle({ metadata: { ceilingType: "cape-cod-horizontal" } }));
  assert.equal(horizontal.spanFt, 32);
  assert.equal(horizontal.centerWidthFt, 16);
  assert.throws(() => getCapeCodGeometry(rectangle({ width: 5 })), /at least 6 feet/);
  assert.throws(() => getCapeCodGeometry(rectangle({ metadata: { capeCodCenterRatio: NaN } })), /ratio/);
});

test("reference geometry totals 576 square feet and 4096 cubic feet in both orientations", () => {
  for (const horizontal of [false, true]) {
    const entity = rectangle({
      width: horizontal ? 32 : 18,
      height: horizontal ? 18 : 32,
      metadata: {
        ceilingType: horizontal ? "cape-cod-horizontal" : "cape-cod",
        capeCodCenterRatio: 10 / 18,
      },
    });
    const metrics = calculateProjectMetrics(project([entity]));
    assert.equal(metrics.conditionedAreaFt2, 576);
    approximately(metrics.volumeFt3, 4096);
    approximately(metrics.averageCeilingHeightFt, 4096 / 576);
    const report = calculateProjectDetailsReport(project([entity]));
    approximately(report.totals.totalVolumeFt3, 4096);
    assert.equal(report.totals.totalSqFt, 576);
  }
});

test("fractional dividers integrate exactly, including cells crossing a divider", () => {
  for (const span of [7, 9, 13, 18]) {
    const entity = rectangle({ width: span, metadata: { capeCodCenterRatio: 0.5 } });
    const geometry = getCapeCodGeometry(entity);
    const expected = 32 * (geometry.centerWidthFt * 8 + 2 * geometry.slopeWidthFt * 6);
    approximately(calculateProjectMetrics(project([entity])).volumeFt3, expected);
  }
  const geometry = getCapeCodGeometry(rectangle({ metadata: { capeCodCenterRatio: 0.5 } }));
  approximately(capeCodAverageHeight(geometry, 4, 8, 4, 5), 8 - 1 / 9);
});

test("wider center increases volume, equal heights give a flat ceiling, exclusions are preserved", () => {
  const narrow = rectangle({ metadata: { capeCodCenterRatio: 0.25 } });
  const wide = rectangle({ metadata: { capeCodCenterRatio: 0.75 } });
  assert.ok(calculateProjectMetrics(project([wide])).volumeFt3 > calculateProjectMetrics(project([narrow])).volumeFt3);
  const flat = rectangle({ metadata: { lowHeightFt: 8, highHeightFt: 8 } });
  approximately(calculateProjectMetrics(project([flat])).volumeFt3, 576 * 8);
  const excluded = rectangle({ metadata: { unconditioned: true } });
  assert.equal(calculateProjectMetrics(project([excluded])).volumeFt3, 0);
  assert.equal(calculateProjectMetrics(project([excluded])).conditionedAreaFt2, 0);
  assert.throws(() => capeCodAverageHeight(getCapeCodGeometry(flat), 9, 8), /HIGH/);
  assert.throws(() => capeCodAverageHeight(getCapeCodGeometry(flat), 4, 8, NaN, 2), /interval/);
});

test("overlaps use the actual Cape Cod height under the newer rectangle", () => {
  const cape = rectangle({ metadata: { capeCodCenterRatio: 10 / 18 } });
  const cover = rectangle({
    id: "cover",
    width: 4,
    metadata: { ceilingType: "standard", standardHeightFt: 10 },
  });
  const metrics = calculateProjectMetrics(project([cape, cover]));
  assert.equal(metrics.conditionedAreaFt2, 576);
  approximately(metrics.volumeFt3, 4096 - 128 * 6 + 128 * 10);
  approximately(calculateProjectMetrics(project([cover, cape])).volumeFt3, 4096);
  const preview = rectangle({ metadata: { capeCodCenterRatio: 0.5 } });
  const withPreview = calculateProjectMetrics(project([cape, cover]), preview);
  const committed = calculateProjectMetrics(project([preview, cover]));
  approximately(withPreview.volumeFt3, committed.volumeFt3);
});

test("preview changes volume without adding area, and save/load retains the geometry", () => {
  const initial = rectangle();
  const preview = rectangle({ metadata: { capeCodCenterRatio: 10 / 18 } });
  const original = project([initial]);
  const metrics = calculateProjectMetrics(original, preview);
  assert.equal(metrics.conditionedAreaFt2, 576);
  approximately(metrics.volumeFt3, 4096);
  assert.equal(original.floors[0].entities[0].metadata.capeCodCenterRatio, undefined);
  const saved = importProjectFromJson(exportProjectAsJson(project([preview])));
  assert.deepEqual(saved.floors[0].entities[0], preview);
  approximately(calculateProjectMetrics(saved).volumeFt3, 4096);
});

test("existing standard, cathedral, sloped and no-ceiling metrics remain unchanged", () => {
  for (const ceilingType of ["standard", "cathedral", "cathedral-horizontal", "sloped", "sloped-horizontal", "none"]) {
    const entity = rectangle({ metadata: { ceilingType, standardHeightFt: 9 } });
    const metrics = calculateProjectMetrics(project([entity]));
    assert.equal(metrics.conditionedAreaFt2, 576);
    assert.equal(metrics.volumeFt3, 576 * (ceilingType === "none" ? 0 : ceilingType === "standard" ? 9 : 6));
  }
});

test("invalid imported Cape Cod geometry is rejected before it reaches the canvas", () => {
  for (const entity of [
    rectangle({ width: 5 }),
    rectangle({ metadata: { highHeightFt: 3 } }),
    rectangle({ metadata: { capeCodCenterRatio: 2 } }),
  ]) {
    assert.throws(() => importProjectFromJson(exportProjectAsJson(project([entity]))), RangeError);
  }
});

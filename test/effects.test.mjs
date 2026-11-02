import test from "node:test";
import assert from "node:assert/strict";

import { createEffectSystem, effectForStep } from "../src/ui/effects.js";

test("特效选择：彩虹优先走引力，特殊元素走星爆", () => {
  assert.deepEqual(
    effectForStep({ rainbowsTriggered: 1, cleared: [[2, 3]], chain: 1 }),
    { kind: "gravity", pos: [2, 3] },
  );
  assert.deepEqual(
    effectForStep({ spawned: [{ at: [1, 4], kind: "bomb" }], chain: 1 }),
    { kind: "star", pos: [1, 4] },
  );
  assert.deepEqual(
    effectForStep({ clearedTiles: [{ pos: [5, 6], kind: "rainbow" }], chain: 1 }),
    { kind: "star", pos: [5, 6] },
  );
});

test("特效选择：冰层破/减层走霜裂，4 连锁补星爆", () => {
  assert.deepEqual(effectForStep({ iceBroken: [[0, 1]] }), { kind: "frost", pos: [0, 1] });
  assert.deepEqual(effectForStep({ iceReduced: [[2, 2]] }), { kind: "frost", pos: [2, 2] });
  assert.deepEqual(effectForStep({ chain: 4, cleared: [[3, 3]] }), { kind: "star", pos: [3, 3] });
  assert.equal(effectForStep({ chain: 2 }), null);
  assert.equal(effectForStep(null), null);
});

test("特效系统：触发后可绘制、更新后按生命周期清理，减少动态效果时关闭", () => {
  const effects = createEffectSystem();
  effects.trigger("star", { x: 100, y: 80, color: "#45c58b", cell: 32, now: 0 });
  assert.ok(effects.count() > 0);
  effects.update(900);
  assert.equal(effects.count(), 0);

  effects.trigger("frost", { x: 10, y: 20, cell: 24, now: 100 });
  assert.ok(effects.count() > 0);
  effects.setReducedMotion(true);
  assert.equal(effects.count(), 0);
  effects.trigger("star", { x: 10, y: 20, cell: 24, now: 200 });
  assert.equal(effects.count(), 0);
});

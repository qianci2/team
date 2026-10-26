import test from "node:test";
import assert from "node:assert/strict";

import {
  BOMB_BONUS,
  CHAIN_FACTOR_MAX,
  CHAIN_LIMIT,
  RAINBOW_BONUS,
  S_MAX,
  TOTAL_MAX,
  chainFactor,
  scoreEvent,
  starsPreview,
} from "../src/lib/score.js";

test("连锁系数按 1 + 0.5 × (n − 1) 计算，上限 4.5", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 8].map((chain) => chainFactor(chain)),
    [1, 1.5, 2, 2.5, 3, 4.5],
  );
  assert.equal(CHAIN_LIMIT, 8);
  assert.equal(CHAIN_FACTOR_MAX, 4.5);
  assert.equal(chainFactor(99), 4.5);
  assert.equal(chainFactor(0), 1);
  assert.equal(chainFactor(Number.NaN), 1);
});

test("单批得分 = 消除数 × 10 × 连锁系数 + 特殊奖励", () => {
  const plain = scoreEvent({ chain: 1, clearedCount: 3, bombsTriggered: 0, rainbowsTriggered: 0 });
  assert.deepEqual(plain, {
    base: 30,
    chainFactor: 1,
    specialBonus: 0,
    stepTotal: 30,
    runTotal: 30,
  });

  const combo = scoreEvent({ chain: 2, clearedCount: 10, bombsTriggered: 1, rainbowsTriggered: 0 }, 30);
  assert.equal(combo.base, 100);
  assert.equal(combo.specialBonus, BOMB_BONUS);
  assert.equal(combo.stepTotal, 250);
  assert.equal(combo.runTotal, 280);

  const rainbow = scoreEvent({ chain: 1, clearedCount: 1, bombsTriggered: 0, rainbowsTriggered: 1 });
  assert.equal(rainbow.specialBonus, RAINBOW_BONUS);
  assert.equal(rainbow.stepTotal, 310);
});

test("单步上限 3480 与总积分硬上限 2140200", () => {
  assert.equal(S_MAX, 3480);
  assert.equal(TOTAL_MAX, 615 * S_MAX);
  assert.equal(TOTAL_MAX, 2140200);

  const cap = scoreEvent({
    chain: 8,
    clearedCount: 64,
    bombsTriggered: 6,
    rainbowsTriggered: 0,
  });
  assert.equal(cap.chainFactor, 4.5);
  assert.equal(cap.base, 640);
  assert.equal(cap.specialBonus, 600);
  assert.equal(cap.stepTotal, S_MAX);
});

test("星级预告在阈值与阈值 ±1 处切换", () => {
  const keep = { keep2: 6, keep3: 11 };
  assert.equal(starsPreview(12, keep), 3);
  assert.equal(starsPreview(11, keep), 3);
  assert.equal(starsPreview(10, keep), 2);
  assert.equal(starsPreview(6, keep), 2);
  assert.equal(starsPreview(5, keep), 1);
  assert.equal(starsPreview(0, keep), 1);
});

test("星级阈值非法时按 1★ 兜底", () => {
  assert.equal(starsPreview(10, { keep2: 10, keep3: 10 }), 1);
  assert.equal(starsPreview(10, { keep2: 12, keep3: 6 }), 1);
  assert.equal(starsPreview(10, { keep2: -1, keep3: 6 }), 1);
  assert.equal(starsPreview(10, null), 1);
});

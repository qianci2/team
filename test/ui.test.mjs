import test from "node:test";
import assert from "node:assert/strict";

import {
  cellAt,
  cellRect,
  clampCursor,
  computeLayout,
  isAdjacent,
  moveCursor,
  sameCell,
  swipeDirection,
  swipeTarget,
  tapIntent,
} from "../src/ui/layout.js";
import { CONTRAST_PAIRS, SYMBOLS, TILE_STYLES, auditContrast, contrastRatio, tileName } from "../src/ui/palette.js";
import { EFFECTS, effectPlan } from "../src/ui/audio.js";
import {
  applyStep,
  planSteps,
  stepTiming,
  swapBoard,
  tileKinds,
  iceMatrix,
} from "../src/ui/animation.js";
import { createBoard, settle } from "../src/lib/board.js";
import { createRng } from "../src/lib/random.js";

test("布局：正方形与窄高画布都保持等比格子", () => {
  const square = computeLayout({ width: 400, height: 400, rows: 8, cols: 8, padding: 20, gap: 8 });
  assert.equal(square.cell, 45);
  assert.equal(square.originX, 20);
  assert.equal(square.originY, 20);

  const tall = computeLayout({ width: 300, height: 600, rows: 8, cols: 8, padding: 10, gap: 6 });
  assert.equal(tall.cell, 35);
  assert.ok(tall.originY > 0, "竖向画布应在垂直方向居中");
  assert.equal(tall.boardHeight, 280);
});

test("布局：画布坐标与格子坐标互通，棋盘外返回 null", () => {
  const layout = computeLayout({ width: 360, height: 360, rows: 8, cols: 8, padding: 12, gap: 6 });
  assert.deepEqual(cellAt(layout, layout.originX + 1, layout.originY + 1), [0, 0]);
  assert.deepEqual(cellAt(layout, layout.originX + layout.cell * 7 + 1, layout.originY + layout.cell * 3 + 1), [3, 7]);
  assert.equal(cellAt(layout, -1, 10), null);
  assert.deepEqual(
    cellAt(layout, layout.originX + layout.boardWidth - 1, layout.originY + layout.boardHeight - 1),
    [7, 7],
  );
  assert.equal(cellAt(layout, layout.width - 1, layout.height - 1), null, "棋盘外的留白不命中");

  const rect = cellRect(layout, 2, 5);
  assert.ok(rect.x > layout.originX + layout.cell * 4);
  assert.ok(rect.width < layout.cell);
  assert.equal(rect.centerX, layout.originX + layout.cell * 5.5);
});

test("滑动：0.3 格阈值与主导轴判定（TC-30）", () => {
  const cell = 40;
  assert.equal(swipeTarget([3, 3], 0, 11, cell), null, "不足 0.3 格不触发");
  assert.deepEqual(swipeTarget([3, 3], 12, 0, cell), [3, 4]);
  assert.deepEqual(swipeTarget([3, 3], -12, 3, cell), [3, 2]);
  assert.deepEqual(swipeTarget([3, 3], 4, -20, cell), [2, 3]);
  assert.equal(swipeTarget([0, 0], -20, 0, cell), null, "越界不触发");
  assert.deepEqual(swipeDirection(5, 5), { dr: 0, dc: 1 });
  assert.deepEqual(swipeDirection(5, -9), { dr: -1, dc: 0 });
  assert.equal(swipeDirection(0, 0), null);
});

test("点击语义：选中、相邻交换、取消与改选", () => {
  assert.deepEqual(tapIntent(null, [1, 2]), { type: "select", at: [1, 2] });
  assert.deepEqual(tapIntent([1, 2], [1, 2]), { type: "clear" });
  assert.deepEqual(tapIntent([1, 2], [2, 2]), { type: "move", from: [1, 2], to: [2, 2] });
  assert.deepEqual(tapIntent([1, 2], [4, 4]), { type: "select", at: [4, 4] });
  assert.ok(isAdjacent([1, 2], [1, 3]));
  assert.ok(!isAdjacent([1, 2], [2, 3]));
  assert.ok(sameCell([0, 0], [0, 0]));
});

test("键盘光标：方向键移动并在边界钳制", () => {
  assert.deepEqual(moveCursor([0, 0], "ArrowUp", 8, 8), [0, 0]);
  assert.deepEqual(moveCursor([0, 0], "ArrowLeft", 8, 8), [0, 0]);
  assert.deepEqual(moveCursor([7, 7], "ArrowDown", 8, 8), [7, 7]);
  assert.deepEqual(moveCursor([3, 3], "ArrowRight", 8, 8), [3, 4]);
  assert.deepEqual(moveCursor([3, 3], "Enter", 8, 8), [3, 3]);
  assert.deepEqual(clampCursor([99, -4], 8, 8), [7, 0]);
});

test("配色：5 种星石形状唯一，文字与图形对比度达标（NFR-13 / FR-30）", () => {
  assert.equal(TILE_STYLES.length, 5);
  assert.equal(new Set(SYMBOLS).size, 5, "色觉辅助的 5 种形状不能重复");
  assert.equal(tileName("bomb"), "炸弹");
  assert.equal(tileName("rainbow"), "彩虹");

  for (const audit of auditContrast()) {
    assert.ok(audit.pass, `${audit.name} 对比度 ${audit.ratio}:1 低于 ${audit.min}:1`);
  }
  assert.ok(contrastRatio("#29251d", "#eee6d6") >= 4.5);
  assert.equal(CONTRAST_PAIRS.length, 8 + TILE_STYLES.length);
});

function firstAppliedMove(board) {
  for (let r = 0; r < board.rows; r += 1) {
    for (let c = 0; c < board.cols; c += 1) {
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        const to = [r + dr, c + dc];
        if (to[0] >= board.rows || to[1] >= board.cols) continue;
        const result = settle(board, { from: [r, c], to }, { rng: createRng(r * 97 + c) });
        if (result.variant === "applied") {
          return { move: { from: [r, c], to }, result };
        }
      }
    }
  }
  return null;
}

test("动画重建：逐步回放与 M1 结算结果逐格一致", () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    const board = createBoard(createRng(seed));
    const found = firstAppliedMove(board);
    assert.ok(found, `种子 ${seed} 应存在可消除交换`);
    const plan = planSteps(swapBoard(board, found.move), found.result.steps);
    assert.equal(plan.items.length, found.result.steps.length);
    assert.deepEqual(tileKinds(plan.board), tileKinds(found.result.board), `种子 ${seed} 的最终棋盘不一致`);
    assert.deepEqual(iceMatrix(plan.board), iceMatrix(found.result.board), `种子 ${seed} 的冰层不一致`);
  }
});

test("动画重建：单步清除、下落与补充保持网格完整", () => {
  const board = createBoard(createRng(9));
  const found = firstAppliedMove(board);
  const after = applyStep(swapBoard(board, found.move), found.result.steps[0]);
  assert.equal(after.board.tiles.flat().filter(Boolean).length, 64);
  assert.ok(after.falls.length > 0);
  assert.ok(after.refills.length > 0);
  assert.equal(after.clearedTiles.length, found.result.steps[0].cleared.length);
});

test("音效：5 类音效都有音符计划，连锁越高音高越高（FR-26）", () => {
  assert.equal(EFFECTS.length, 5);
  for (const effect of EFFECTS) {
    const plan = effectPlan(effect, 1);
    assert.ok(plan.length >= 1, `${effect} 应有音符`);
    for (const tone of plan) {
      assert.ok(tone.freq > 0 && tone.dur > 0 && tone.gain > 0);
      assert.ok(tone.at >= 0);
    }
  }
  const low = effectPlan("clear", 1)[0];
  const high = effectPlan("clear", 8)[0];
  assert.ok(high.freq > low.freq, "连锁 8 的音高应高于连锁 1");
  assert.equal(effectPlan("clear", 99)[0].freq, high.freq, "连锁序号钳制在 8");
  assert.equal(effectPlan("win").length, 3);
  assert.equal(effectPlan("fail").length, 2);
});

test("动画节奏：整段不超过 1.7s，单步 150–340ms", () => {
  const one = stepTiming(1);
  assert.equal(one.stepMs, 340);
  const four = stepTiming(4);
  assert.ok(four.totalMs <= 1700);
  const eight = stepTiming(8);
  assert.ok(eight.stepMs >= 150);
  assert.ok(eight.totalMs <= 1700);
  assert.deepEqual(stepTiming(0), { stepMs: 0, totalMs: 0 });
});

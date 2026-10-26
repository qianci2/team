import test from "node:test";
import assert from "node:assert/strict";

import {
  BOMB,
  RAINBOW,
  createBoard,
  boardFromKinds,
  isDeadlock,
  hasMatch,
  settle,
  settleCells,
  shuffleBoard,
  withIce,
} from "../src/lib/board.js";
import { createRng } from "../src/lib/random.js";

const BASE_ROWS = [
  [0, 1, 2, 3, 4, 0, 1, 2],
  [1, 2, 3, 4, 0, 1, 2, 3],
  [2, 3, 4, 0, 1, 2, 3, 4],
  [3, 4, 0, 1, 2, 3, 4, 0],
  [4, 0, 1, 2, 3, 4, 0, 1],
  [0, 1, 2, 3, 4, 0, 1, 2],
  [1, 2, 3, 4, 0, 1, 2, 3],
  [2, 3, 4, 0, 1, 2, 3, 4],
];

function baseRows() {
  return BASE_ROWS.map((row) => row.slice());
}

function patched(patch) {
  const rows = baseRows();
  for (const [r, c, kind] of patch) rows[r][c] = kind;
  return boardFromKinds(rows);
}

function keys(cells) {
  return cells.map(([r, c]) => `${r},${c}`);
}

function sortedKeys(cells) {
  return keys(cells).sort();
}

function countColor(board, color) {
  let count = 0;
  for (const row of board.tiles) {
    for (const tile of row) if (tile.kind === color) count += 1;
  }
  return count;
}

function horizontalThreeBoard(ice = null) {
  const rows = baseRows();
  rows[3][0] = 2;
  rows[3][1] = 0;
  rows[3][2] = 0;
  rows[3][4] = 3;
  return boardFromKinds(rows, ice);
}

test("FR-01：1000 次生成均无初始三连且存在可行交换", () => {
  for (let seed = 1; seed <= 1000; seed += 1) {
    const board = createBoard(createRng(seed));
    assert.equal(board.rows, 8);
    assert.equal(board.cols, 8);
    assert.equal(hasMatch(board), false, `seed ${seed} 出现初始三连`);
    assert.equal(isDeadlock(board), false, `seed ${seed} 是死局`);
    for (const row of board.tiles) {
      assert.equal(row.length, 8);
      for (const tile of row) assert.ok(tile.kind >= 0 && tile.kind < 5);
    }
  }
});

test("FR-02：合法但无消除的交换返回 rejected 且棋盘不变", () => {
  const board = boardFromKinds(baseRows());
  const result = settle(board, { from: [0, 0], to: [0, 1] }, { rng: createRng(1) });
  assert.equal(result.variant, "rejected");
  assert.equal(result.steps.length, 0);
  assert.equal(result.totalScoreDelta, 0);
  assert.deepEqual(result.board, board);
});

test("交换越界或不相邻抛 RangeError（调用方应先校验）", () => {
  const board = boardFromKinds(baseRows());
  assert.throws(() => settle(board, { from: [0, 0], to: [0, 2] }, { rng: createRng(1) }), RangeError);
  assert.throws(() => settle(board, { from: [7, 7], to: [8, 7] }, { rng: createRng(1) }), RangeError);
});

test("FR-03：横向三连整体消除", () => {
  const board = horizontalThreeBoard();
  const result = settle(board, { from: [3, 3], to: [2, 3] }, { rng: createRng(2) });
  assert.equal(result.variant, "applied");
  assert.deepEqual(sortedKeys(result.steps[0].cleared), ["3,1", "3,2", "3,3"]);
  assert.equal(result.steps[0].score.stepTotal, 30);
});

test("FR-03：纵向三连整体消除", () => {
  const rows = baseRows();
  rows[3][2] = 1;
  rows[3][3] = 0;
  rows[4][2] = 0;
  rows[5][2] = 0;
  const board = boardFromKinds(rows);

  const result = settle(board, { from: [3, 2], to: [3, 3] }, { rng: createRng(3) });
  assert.equal(result.variant, "applied");
  assert.deepEqual(sortedKeys(result.steps[0].cleared), ["3,2", "4,2", "5,2"]);
});

test("FR-03：L/T 型两条三连共享一格时全部消除且不生成特殊元素", () => {
  const board = patched([
    [3, 2, 2],
    [3, 4, 0],
    [3, 5, 0],
    [4, 3, 0],
    [5, 3, 0],
    [6, 3, 2],
  ]);
  const result = settle(board, { from: [3, 3], to: [2, 3] }, { rng: createRng(4) });
  assert.equal(result.variant, "applied");
  assert.deepEqual(sortedKeys(result.steps[0].cleared), ["3,3", "3,4", "3,5", "4,3", "5,3"]);
  assert.deepEqual(result.steps[0].spawned, []);
});

test("FR-06：4 连在中点生成炸弹", () => {
  const board = patched([
    [1, 4, 2],
    [2, 4, 0],
    [3, 2, 0],
    [3, 3, 0],
    [3, 4, 1],
    [3, 5, 0],
  ]);
  const result = settle(board, { from: [3, 4], to: [2, 4] }, { rng: createRng(5) });
  assert.equal(result.variant, "applied");
  assert.deepEqual(sortedKeys(result.steps[0].cleared), ["3,2", "3,3", "3,4", "3,5"]);
  assert.deepEqual(result.steps[0].spawned, [{ at: [3, 4], kind: BOMB }]);
  assert.equal(result.steps[0].score.base, 40);
});

test("FR-06：5 连在中点生成彩虹", () => {
  const board = patched([
    [3, 1, 0],
    [3, 2, 0],
    [3, 3, 1],
    [3, 4, 0],
    [3, 5, 0],
  ]);
  const result = settle(board, { from: [3, 3], to: [2, 3] }, { rng: createRng(6) });
  assert.equal(result.variant, "applied");
  assert.deepEqual(
    sortedKeys(result.steps[0].cleared),
    ["3,1", "3,2", "3,3", "3,4", "3,5"],
  );
  assert.deepEqual(result.steps[0].spawned, [{ at: [3, 3], kind: RAINBOW }]);
});

test("FR-05：连锁在消除后继续结算", () => {
  const rows = baseRows();
  rows[5][1] = 1;
  rows[5][2] = 0;
  rows[5][3] = 0;
  rows[5][4] = 0;
  rows[5][5] = 2;
  rows[4][3] = 1;
  rows[6][3] = 1;
  rows[7][3] = 1;
  const board = boardFromKinds(rows);

  const result = settleCells(board, [[5, 2], [5, 3], [5, 4]], { rng: createRng(7) });
  assert.equal(result.variant, "applied");
  assert.ok(result.steps.length >= 2);
  assert.equal(result.steps[0].chain, 1);
  assert.equal(result.steps[1].chain, 2);
  assert.ok(keys(result.steps[1].cleared).includes("5,3"));
  assert.ok(keys(result.steps[1].cleared).includes("6,3"));
  assert.ok(keys(result.steps[1].cleared).includes("7,3"));
});

test("连锁次数不超过 8，第 8 次系数 4.5", () => {
  const board = boardFromKinds(baseRows());
  const result = settleCells(board, [[0, 0]], { rng: createRng(8) });
  assert.ok(result.steps.length <= 8);
  for (const step of result.steps) {
    assert.ok(step.chain >= 1 && step.chain <= 8);
    assert.ok(step.score.chainFactor <= 4.5);
  }
});

test("炸弹被动消除触发 3×3 并计 100 分奖励", () => {
  const board = patched([[4, 3, BOMB]]);
  const result = settleCells(board, [[4, 3]], { rng: createRng(9) });
  assert.equal(result.steps[0].cleared.length, 9);
  assert.equal(result.steps[0].score.specialBonus, 100);
  assert.equal(result.steps[0].score.stepTotal, 9 * 10 + 100);
});

test("彩虹被动消除清除数量最多的颜色并计 300 分奖励", () => {
  const board = patched([[4, 3, RAINBOW]]);
  const counts = [0, 1, 2, 3, 4].map((color) => countColor(board, color));
  const majority = counts.indexOf(Math.max(...counts));

  const result = settleCells(board, [[4, 3]], { rng: createRng(10) });
  assert.equal(result.steps[0].cleared.length, 1 + counts[majority]);
  assert.equal(result.steps[0].score.specialBonus, 300);
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      if (board.tiles[r][c].kind === majority) {
        assert.ok(keys(result.steps[0].cleared).includes(`${r},${c}`));
      }
    }
  }
});

test("BR-10：彩虹 × 普通元素清除该颜色的全部元素", () => {
  const board = patched([
    [4, 3, RAINBOW],
    [4, 4, 1],
  ]);
  const count = countColor(board, 1);
  const result = settle(board, { from: [4, 3], to: [4, 4] }, { rng: createRng(11) });
  assert.equal(result.steps[0].cleared.length, 1 + count);
  assert.equal(result.steps[0].score.specialBonus, 300);
  assert.ok(keys(result.steps[0].cleared).includes("4,3"));
  assert.ok(keys(result.steps[0].cleared).includes("4,4"));
});

test("BR-10：炸弹 × 炸弹消除两格中点的 5×5 区域", () => {
  const board = patched([
    [3, 3, BOMB],
    [3, 4, BOMB],
  ]);
  const result = settle(board, { from: [3, 3], to: [3, 4] }, { rng: createRng(12) });
  assert.equal(result.steps[0].cleared.length, 25);
  assert.equal(result.steps[0].score.specialBonus, 200);
});

test("BR-10：彩虹 × 彩虹清空棋盘", () => {
  const board = patched([
    [3, 3, RAINBOW],
    [3, 4, RAINBOW],
  ]);
  const result = settle(board, { from: [3, 3], to: [3, 4] }, { rng: createRng(13) });
  assert.equal(result.steps[0].cleared.length, 64);
  assert.equal(result.steps[0].score.specialBonus, 600);
  assert.ok(result.board.tiles.flat().every((tile) => tile !== null));
});

test("BR-10：炸弹 × 彩虹把最多颜色转为炸弹并依次触发", () => {
  const board = patched([
    [3, 3, BOMB],
    [3, 4, RAINBOW],
  ]);
  const counts = [0, 1, 2, 3, 4].map((color) => countColor(board, color));
  const majority = counts.indexOf(Math.max(...counts));

  const result = settle(board, { from: [3, 3], to: [3, 4] }, { rng: createRng(14) });
  assert.equal(result.steps[0].score.specialBonus, (counts[majority] + 1) * 100 + 300);
  assert.ok(result.steps[0].cleared.length > 40);
});

test("FR-05：死局检测与可复现洗牌", () => {
  const rows = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => (r * 2 + c) % 5),
  );
  const dead = boardFromKinds(rows);
  assert.equal(isDeadlock(dead), true);
  assert.equal(hasMatch(dead), false);

  const first = shuffleBoard(dead, createRng(7));
  const second = shuffleBoard(dead, createRng(7));
  assert.deepEqual(first, second);
  assert.equal(isDeadlock(first), false);
  assert.equal(hasMatch(first), false);
});

test("洗牌保留冰层与特殊元素位置", () => {
  const board = withIce(patched([[0, 0, BOMB]]), [
    [2, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ]);
  const shuffled = shuffleBoard(board, createRng(21));
  assert.equal(shuffled.tiles[0][0].kind, BOMB);
  assert.equal(shuffled.ice[0][0], 2);
});

test("冰层是格子属性：消除后减层，双层冰第一次不破坏", () => {
  const doubleIce = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
  doubleIce[3][1] = 2;
  const board = horizontalThreeBoard(doubleIce);

  const result = settle(board, { from: [3, 3], to: [2, 3] }, { rng: createRng(15) });
  assert.deepEqual(sortedKeys(result.steps[0].iceReduced), ["3,1"]);
  assert.deepEqual(result.steps[0].iceBroken, []);

  const singleIce = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
  singleIce[3][1] = 1;
  const single = settle(horizontalThreeBoard(singleIce), { from: [3, 3], to: [2, 3] }, {
    rng: createRng(16),
  });
  assert.deepEqual(sortedKeys(single.steps[0].iceBroken), ["3,1"]);
  assert.deepEqual(single.steps[0].iceReduced, []);
});

test("冰层不影响元素参与交换与匹配", () => {
  const ice = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 1));
  const board = horizontalThreeBoard(ice);
  const result = settle(board, { from: [3, 3], to: [2, 3] }, { rng: createRng(17) });
  assert.equal(result.variant, "applied");
  assert.ok(result.steps[0].cleared.length >= 3);
});

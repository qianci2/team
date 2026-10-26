import test from "node:test";
import assert from "node:assert/strict";

import {
  applyMove,
  createRun,
  ensurePlayable,
  goalStatuses,
  outcomeOf,
  placeIce,
  statusOf,
  useItem,
} from "../src/lib/run.js";
import { boardFromKinds, isDeadlock, settle, withIce } from "../src/lib/board.js";
import { defaultLevel } from "../src/lib/levels.js";
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

function horizontalThreeBoard(ice = null) {
  const rows = baseRows();
  rows[3][0] = 2;
  rows[3][1] = 0;
  rows[3][2] = 0;
  rows[3][4] = 3;
  return boardFromKinds(rows, ice);
}

function runOn(board, cfg = defaultLevel(1), overrides = {}) {
  const run = createRun(cfg, 99);
  return {
    ...run,
    board,
    goalProgress: { score: 0, collect: 0, iceBroken: 0 },
    ...overrides,
  };
}

function findValidMove(board) {
  for (let r = 0; r < board.rows; r += 1) {
    for (let c = 0; c < board.cols; c += 1) {
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        const to = [r + dr, c + dc];
        if (to[0] >= board.rows || to[1] >= board.cols) continue;
        const result = settle(board, { from: [r, c], to }, { rng: createRng(1) });
        if (result.variant === "applied") return { from: [r, c], to };
      }
    }
  }
  throw new Error("棋盘没有可行交换");
}

function iceMatrix(cells) {
  const matrix = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
  for (const [r, c, layer] of cells) matrix[r][c] = layer;
  return matrix;
}

test("createRun 初始化步数、目标进度与道具记录", () => {
  const cfg = defaultLevel(1);
  const run = createRun(cfg, 42);
  assert.equal(run.level, 1);
  assert.equal(run.movesLeft, cfg.moves);
  assert.equal(run.movesUsed, 0);
  assert.equal(run.score, 0);
  assert.equal(run.status, "playing");
  assert.deepEqual(run.goalProgress, { score: 0, collect: 0, iceBroken: 0 });
  assert.deepEqual(run.itemUsed, { shuffle: false, hammer: false, plus5: false });
  assert.equal(run.board.rows, 8);
  assert.equal(run.board.ice.flat().every((layer) => layer === 0), true);
});

test("一次有效交换消耗 1 步并累计得分", () => {
  const run = createRun(defaultLevel(1), 42);
  const move = findValidMove(run.board);
  const outcome = applyMove(run, move);

  assert.equal(outcome.result, "applied");
  assert.equal(outcome.run.movesLeft, run.movesLeft - 1);
  assert.equal(outcome.run.movesUsed, 1);
  assert.ok(outcome.run.score > 0);
  assert.equal(outcome.run.status, "playing");
  assert.ok(outcome.events.some((event) => event.type === "board:settled"));
});

test("FR-02：无消除的交换不消耗步数、不改变得分", () => {
  const board = boardFromKinds(baseRows());
  const run = runOn(board);
  const outcome = applyMove(run, { from: [0, 0], to: [0, 1] });

  assert.equal(outcome.result, "rejected");
  assert.equal(outcome.reason, "no-match");
  assert.equal(outcome.run.movesLeft, run.movesLeft);
  assert.equal(outcome.run.score, 0);
  assert.deepEqual(outcome.run.board, board);
});

test("不相邻的交换被拒绝且不消耗步数", () => {
  const run = runOn(boardFromKinds(baseRows()));
  const outcome = applyMove(run, { from: [0, 0], to: [0, 2] });
  assert.equal(outcome.result, "rejected");
  assert.equal(outcome.reason, "not-adjacent");
  assert.equal(outcome.run.movesLeft, run.movesLeft);
});

test("FR-09：达成全部目标那一手立即结算，剩余步数保留", () => {
  const cfg = {
    ...defaultLevel(1),
    moves: 5,
    goals: { score: 1, ice: { total: 0, doubleRatio: 0 } },
  };
  const run = runOn(horizontalThreeBoard(), cfg);
  const outcome = applyMove(run, { from: [3, 3], to: [2, 3] });

  assert.equal(outcome.result, "clear");
  assert.equal(outcome.run.status, "clear");
  assert.equal(outcome.run.movesLeft, 4);
  assert.equal(outcomeOf(outcome.run).remainingMoves, 4);
  assert.deepEqual(outcomeOf(outcome.run).unfinished, []);
  assert.equal(applyMove(outcome.run, { from: [0, 0], to: [0, 1] }).result, "locked");
});

test("FR-08：步数耗尽且目标未达成判失败并给出差值", () => {
  const cfg = {
    ...defaultLevel(1),
    moves: 1,
    goals: { score: 999999, ice: { total: 0, doubleRatio: 0 } },
  };
  const run = runOn(horizontalThreeBoard(), cfg);
  const outcome = applyMove(run, { from: [3, 3], to: [2, 3] });

  assert.equal(outcome.result, "fail");
  assert.equal(outcome.run.movesLeft, 0);
  const result = outcomeOf(outcome.run);
  assert.equal(result.result, "fail");
  assert.equal(result.unfinished.length, 1);
  assert.equal(result.unfinished[0].kind, "score");
  assert.ok(result.unfinished[0].gap > 0);
});

test("达成与步数耗尽同手成立时优先判达成", () => {
  const cfg = {
    ...defaultLevel(1),
    moves: 1,
    goals: { score: 1, ice: { total: 0, doubleRatio: 0 } },
  };
  const run = runOn(horizontalThreeBoard(), cfg);
  const outcome = applyMove(run, { from: [3, 3], to: [2, 3] });
  assert.equal(outcome.result, "clear");
  assert.equal(outcome.run.movesLeft, 0);
});

test("FR-07：收集目标统计被消除元素中指定颜色的数量", () => {
  const cfg = {
    ...defaultLevel(6),
    moves: 20,
    goals: { score: 1, collect: { color: 0, count: 3 }, ice: { total: 0, doubleRatio: 0 } },
  };
  const run = runOn(horizontalThreeBoard(), cfg);
  const outcome = applyMove(run, { from: [3, 3], to: [2, 3] });

  assert.equal(outcome.result, "clear");
  assert.ok(outcome.run.goalProgress.collect >= 3);
  const collectGoal = goalStatuses(outcome.run).find((goal) => goal.kind === "collect");
  assert.equal(collectGoal.done, true);
});

test("FR-07：单层冰被消除时计入冰层目标", () => {
  const cfg = {
    ...defaultLevel(1),
    moves: 20,
    goals: { score: 1, ice: { total: 1, doubleRatio: 0 } },
  };
  const run = runOn(horizontalThreeBoard(iceMatrix([[3, 1, 1]])), cfg);
  const outcome = applyMove(run, { from: [3, 3], to: [2, 3] });

  assert.equal(outcome.result, "clear");
  assert.equal(outcome.run.goalProgress.iceBroken, 1);
});

test("FR-07：双层冰第一次消除不减目标，第二次才计入", () => {
  const cfg = {
    ...defaultLevel(1),
    moves: 20,
    goals: { score: 999999, ice: { total: 1, doubleRatio: 0 } },
  };
  const run = runOn(horizontalThreeBoard(iceMatrix([[3, 1, 2]])), cfg);

  const first = applyMove(run, { from: [3, 3], to: [2, 3] });
  assert.equal(first.result, "applied");
  assert.equal(first.run.goalProgress.iceBroken, 0);

  const second = useItem(first.run, "hammer", [3, 1]);
  assert.equal(second.result, "applied");
  assert.equal(second.run.goalProgress.iceBroken, 1);
});

test("FR-22：重排道具不消耗步数且每关限用一次", () => {
  const run = createRun(defaultLevel(3), 7);
  const snapshot = (board) =>
    board.tiles
      .map((row) => row.map((tile) => `${tile.kind}:${tile.id}`).join(","))
      .join("|");
  const before = snapshot(run.board);
  const shuffled = useItem(run, "shuffle");

  assert.equal(shuffled.result, "applied");
  assert.equal(shuffled.run.movesLeft, run.movesLeft);
  assert.equal(shuffled.run.itemUsed.shuffle, true);
  assert.equal(isDeadlock(shuffled.run.board), false);
  assert.notEqual(snapshot(shuffled.run.board), before);

  const again = useItem(shuffled.run, "shuffle");
  assert.equal(again.result, "rejected");
  assert.equal(again.reason, "item-used");
});

test("FR-22：+5 步道具增加 5 步且不消耗步数", () => {
  const run = createRun(defaultLevel(3), 8);
  const outcome = useItem(run, "plus5");
  assert.equal(outcome.result, "applied");
  assert.equal(outcome.run.movesLeft, run.movesLeft + 5);
  assert.equal(outcome.run.movesUsed, run.movesUsed);
  assert.equal(outcome.run.itemUsed.plus5, true);
});

test("FR-22：锤子消除任意一格且不消耗步数", () => {
  const run = runOn(horizontalThreeBoard());
  const outcome = useItem(run, "hammer", [0, 0]);
  assert.equal(outcome.result, "applied");
  assert.equal(outcome.run.movesLeft, run.movesLeft);
  assert.equal(outcome.run.itemUsed.hammer, true);
  assert.ok(outcome.run.score >= 10);
  assert.equal(outcome.run.board.tiles[0][0].kind !== undefined, true);
});

test("FR-22：锤子未给目标抛 TypeError，越界目标被拒绝", () => {
  const run = runOn(horizontalThreeBoard());
  assert.throws(() => useItem(run, "hammer"), TypeError);
  const outcome = useItem(run, "hammer", [9, 9]);
  assert.equal(outcome.result, "rejected");
  assert.equal(outcome.run.itemUsed.hammer, false);
});

test("终态下道具与交换均被锁定", () => {
  const cfg = {
    ...defaultLevel(1),
    moves: 5,
    goals: { score: 1, ice: { total: 0, doubleRatio: 0 } },
  };
  const run = runOn(horizontalThreeBoard(), cfg);
  const clear = applyMove(run, { from: [3, 3], to: [2, 3] }).run;
  assert.equal(useItem(clear, "shuffle").result, "locked");
  assert.equal(applyMove(clear, { from: [0, 0], to: [0, 1] }).result, "locked");
});

test("statusOf 输出 HUD 所需摘要与星级预告", () => {
  const run = runOn(horizontalThreeBoard(), {
    ...defaultLevel(1),
    starKeep: { keep2: 2, keep3: 4 },
  });
  const status = statusOf(run);
  assert.equal(status.status, "playing");
  assert.equal(status.movesLeft, 20);
  assert.equal(status.starsPreview, 3);
  assert.deepEqual(status.canUseItem, { shuffle: true, hammer: true, plus5: true });
  assert.equal(outcomeOf(run), null);
});

test("FR-05：连续 5 次洗牌仍死局时重建棋盘并保留冰层与目标进度", () => {
  const deadRows = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => (r * 2 + c) % 5),
  );
  const dead = withIce(boardFromKinds(deadRows), iceMatrix([[0, 0, 2], [1, 1, 1]]));
  assert.equal(isDeadlock(dead), true);

  const run = runOn(dead, defaultLevel(19), {
    goalProgress: { score: 120, collect: 5, iceBroken: 2 },
  });
  const playable = ensurePlayable(run, { shuffleFn: (board) => board });

  assert.equal(playable.events.filter((event) => event.rebuilt).length, 1);
  assert.equal(playable.events.filter((event) => event.type === "deadlock:shuffled").length, 6);
  assert.equal(playable.shuffleCount, 0);
  assert.equal(isDeadlock(playable.board), false);
  assert.deepEqual(playable.board.ice, dead.ice);
  assert.deepEqual(run.goalProgress, { score: 120, collect: 5, iceBroken: 2 });
});

test("FR-05：死局自动洗牌后恢复可玩", () => {
  const deadRows = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => (r * 2 + c) % 5),
  );
  const run = runOn(boardFromKinds(deadRows), defaultLevel(3));
  const playable = ensurePlayable(run);

  assert.equal(isDeadlock(playable.board), false);
  assert.ok(playable.events.length >= 1);
  assert.ok(playable.shuffleCount >= 1 && playable.shuffleCount <= 5);
});

test("冰层布置按行权重抽样，底行不布置且同种子可复现", () => {
  const first = placeIce({ total: 7, doubleRatio: 0.15 }, createRng(5));
  const second = placeIce({ total: 7, doubleRatio: 0.15 }, createRng(5));
  assert.deepEqual(first, second);

  let cells = 0;
  let doubles = 0;
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      if (first[r][c] > 0) cells += 1;
      if (first[r][c] === 2) doubles += 1;
      if (r === 7) assert.equal(first[r][c], 0);
    }
  }
  assert.equal(cells, 7);
  assert.equal(doubles, 1);
  assert.deepEqual(placeIce({ total: 0 }, createRng(5)), Array.from({ length: 8 }, () => Array(8).fill(0)));
});

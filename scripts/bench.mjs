#!/usr/bin/env node
/**
 * 领域层/应用层微基准（P7）。
 *
 * 只测 Node 中的纯逻辑耗时，不替代浏览器首屏/FPS 验收（TC-35/TC-36 仍需 P5
 * 合入后在真实浏览器测量）。输出可直接贴入测试报告，便于复跑对比。
 */

import { performance } from "node:perf_hooks";

import { boardFromKinds, createBoard, settle } from "../src/lib/board.js";
import { createRun, applyMove } from "../src/lib/run.js";
import { defaultLevel } from "../src/lib/levels.js";
import { scoreEvent } from "../src/lib/score.js";
import { createRng } from "../src/lib/random.js";
import { createDefaultSave, mergeSave, normalizeSave } from "../src/app/save-schema.js";
import { localBoard } from "../src/app/rank.js";

const T0 = Date.parse("2026-10-26T12:00:00+08:00");
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

function boardForMatch() {
  const rows = BASE_ROWS.map((row) => row.slice());
  rows[3][0] = 2;
  rows[3][1] = 0;
  rows[3][2] = 0;
  rows[3][4] = 3;
  return boardFromKinds(rows);
}

function bench(name, iterations, fn) {
  for (let i = 0; i < 10; i += 1) fn(i);
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) fn(i);
  const elapsed = performance.now() - start;
  return {
    name,
    iterations,
    totalMs: Number(elapsed.toFixed(2)),
    perOpMs: Number((elapsed / iterations).toFixed(4)),
    opsPerSecond: Math.round((iterations / elapsed) * 1000),
  };
}

const board = boardForMatch();
const run = {
  ...createRun(defaultLevel(1), 42),
  board,
  goalProgress: { score: 0, collect: 0, iceBroken: 0 },
};
const saveA = createDefaultSave(T0);
const saveB = {
  ...createDefaultSave(T0 + 1000),
  unlockedLevel: 5,
  stars: { 1: 3 },
  bestScores: { 1: 1200 },
};

const results = [
  bench("createBoard", 1000, (i) => createBoard(createRng(i + 1))),
  bench("settle(known move)", 1000, (i) => {
    const result = settle(board, { from: [3, 3], to: [2, 3] }, { rng: createRng(i + 1) });
    if (result.variant !== "applied") throw new Error("bench board should apply");
  }),
  bench("applyMove(run)", 1000, (i) => {
    const copy = { ...run, seed: 1000 + i };
    const outcome = applyMove(copy, { from: [3, 3], to: [2, 3] });
    if (outcome.result === "locked") throw new Error("unexpected locked");
  }),
  bench("scoreEvent", 10000, (i) =>
    scoreEvent({ chain: (i % 8) + 1, clearedCount: 64, bombsTriggered: 6, rainbowsTriggered: 0 }),
  ),
  bench("normalizeSave", 10000, () => normalizeSave(saveB, { now: T0 + 2000 })),
  bench("mergeSave", 10000, () => mergeSave(saveB, saveA)),
  bench("localBoard(100)", 1000, () => localBoard({ nickname: "星消乐玩家", totalScore: 90000 })),
];

const heap = process.memoryUsage();
console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      heapUsedMB: Number((heap.heapUsed / 1024 / 1024).toFixed(1)),
      results,
    },
    null,
    2,
  ),
);

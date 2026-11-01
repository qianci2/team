#!/usr/bin/env node
/**
 * 代理求解器与关卡标定（P7 / TC-39、TC-40）。
 *
 * 普通玩家代理策略：每一步枚举所有相邻交换，用 M3 的纯函数试算，
 * 选择“最弱目标进度 + 平均目标进度 + 分数进度”最高的结果。
 * 不使用道具，避免把道具收益混入关卡难度基线。
 *
 * 用法：
 *   node scripts/calibrate.mjs --runs=200 --levels=1-30 --out=docs/calibration.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyMove, createRun, goalStatuses, outcomeOf, useItem } from "../src/lib/run.js";
import { loadLevels } from "../src/lib/levels.js";
import { createRng } from "../src/lib/random.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const options = {
    runs: 200,
    levels: null,
    out: null,
    items: false,
    skill: 0.75,
    keep2Quantile: 0.2,
    keep3Quantile: 0.7,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "runs") options.runs = Number(value);
    if (key === "levels") options.levels = value;
    if (key === "out") options.out = value;
    if (key === "skill") options.skill = Number(value);
    if (key === "keep2") options.keep2Quantile = Number(value);
    if (key === "keep3") options.keep3Quantile = Number(value);
    if (key === "items") options.items = value !== "0" && value !== "false";
  }
  return options;
}

function parseLevels(spec) {
  if (!spec) return Array.from({ length: 30 }, (_, i) => i + 1);
  const out = [];
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map(Number);
    if (Number.isInteger(a) && Number.isInteger(b)) {
      for (let n = a; n <= b; n += 1) out.push(n);
    } else if (Number.isInteger(a)) {
      out.push(a);
    }
  }
  return [...new Set(out)].filter((n) => n >= 1 && n <= 30);
}

function enumerateMoves(board) {
  const moves = [];
  for (let r = 0; r < board.rows; r += 1) {
    for (let c = 0; c < board.cols; c += 1) {
      if (c + 1 < board.cols) moves.push({ from: [r, c], to: [r, c + 1] });
      if (r + 1 < board.rows) moves.push({ from: [r, c], to: [r + 1, c] });
    }
  }
  return moves;
}

function ratio(current, target) {
  if (!target || target <= 0) return 1;
  return Math.max(0, Math.min(1, current / target));
}

function evaluate(outcome, cfg) {
  const run = outcome.run;
  if (run.status === "clear") return 1e9 + run.movesLeft * 1000 + run.score;
  if (run.status === "fail") return -1e9;

  const goals = goalStatuses(run);
  const ratios = goals.map((goal) => ratio(goal.current, goal.target));
  const weakest = ratios.length ? Math.min(...ratios) : 0;
  const average = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  const scoreRatio = ratio(run.score, cfg.goals?.score ?? 0);
  const cleared = outcome.settle?.steps?.reduce((sum, step) => sum + step.cleared.length, 0) ?? 0;
  const specials =
    outcome.settle?.steps?.reduce(
      (sum, step) => sum + (step.bombsTriggered ?? 0) + (step.rainbowsTriggered ?? 0),
      0,
    ) ?? 0;

  return (
    weakest * 6 +
    average * 3 +
    scoreRatio * 1.2 +
    (run.movesLeft / Math.max(1, cfg.moves)) * 0.05 +
    cleared * 0.0001 +
    specials * 0.0002
  );
}

function chooseBestMove(run, cfg, policyRng, skill) {
  const candidates = [];
  for (const move of enumerateMoves(run.board)) {
    const outcome = applyMove(run, move);
    if (outcome.result === "rejected" || outcome.result === "locked") continue;
    candidates.push({ move, outcome, value: evaluate(outcome, cfg) });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.value - a.value);
  if (candidates.length === 1 || skill >= 1) return candidates[0];
  if (policyRng() < skill) return candidates[0];
  // 普通玩家不会每一步都找到最优解：在候选前 8 个中随机取一个。
  const pool = candidates.slice(0, Math.min(8, candidates.length));
  return pool[Math.floor(policyRng() * pool.length)];
}

function simulate(cfg, seed, { items = false, skill = 0.75 } = {}) {
  let run = createRun(cfg, seed);
  let guard = 0;
  const policyRng = createRng((seed ^ 0x85ebca6b) >>> 0);
  while (run.status === "playing" && guard < 200) {
    guard += 1;
    if (items && !run.itemUsed.plus5 && run.movesLeft <= 3) {
      // 与玩家操作走同一条 M3 路径；不使用道具时该分支不执行。
      const outcome = useItem(run, "plus5");
      if (outcome.result !== "rejected" && outcome.result !== "locked") run = outcome.run;
    }
    const best = chooseBestMove(run, cfg, policyRng, skill);
    if (!best) break;
    run = best.outcome.run;
  }
  return { run, outcome: run.status === "playing" ? null : outcomeOf(run), guard };
}

function wilsonLower(clears, n, z = 1.96) {
  if (n === 0) return 0;
  const p = clears / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (center - margin) / denom);
}

function quantile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const weight = pos - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function keepFromRemaining(remaining, moves, { keep2Quantile = 0.2, keep3Quantile = 0.7 } = {}) {
  const sorted = remaining.slice().sort((a, b) => a - b);
  let keep2 = Math.round(quantile(sorted, keep2Quantile));
  let keep3 = Math.round(quantile(sorted, keep3Quantile));
  keep2 = Math.max(0, Math.min(moves - 1, keep2));
  keep3 = Math.max(keep2 + 1, Math.min(moves, keep3));

  // BR-07 的最不利关卡 2★ 达标率 ≥45%：若离散取整让 2★ 区间过窄，
  // 向下调整 keep2，直到通关样本中 2★ 比例达到 45% 或 keep2 到 0。
  const twoStarRate = (cut) =>
    sorted.length === 0
      ? 0
      : sorted.filter((left) => left >= cut && left < keep3).length / sorted.length;
  while (keep2 > 0 && twoStarRate(keep2) < 0.45) keep2 -= 1;
  return { keep2, keep3 };
}

function solveLevel(cfg, runs, options) {
  const clears = [];
  const remaining = [];
  const starCounts = { 1: 0, 2: 0, 3: 0 };
  let failed = 0;
  for (let i = 0; i < runs; i += 1) {
    const seed = (Math.imul(cfg.level + 1, 100003) + Math.imul(i + 1, 7919) + 12345) >>> 0;
    const result = simulate(cfg, seed, options);

    const outcome = result.outcome;
    if (outcome?.result === "clear") {
      clears.push(outcome);
      remaining.push(outcome.remainingMoves);
      starCounts[3] += outcome.remainingMoves >= cfg.starKeep.keep3 ? 1 : 0;
      starCounts[2] +=
        outcome.remainingMoves >= cfg.starKeep.keep2 &&
        outcome.remainingMoves < cfg.starKeep.keep3
          ? 1
          : 0;
      starCounts[1] += outcome.remainingMoves < cfg.starKeep.keep2 ? 1 : 0;
    } else {
      failed += 1;
    }
  }
  const passRate = clears.length / runs;
  const proposedKeep = keepFromRemaining(remaining, cfg.moves, options);
  const proposedStars = { 1: 0, 2: 0, 3: 0 };
  for (const left of remaining) {
    if (left >= proposedKeep.keep3) proposedStars[3] += 1;
    else if (left >= proposedKeep.keep2) proposedStars[2] += 1;
    else proposedStars[1] += 1;
  }
  return {
    level: cfg.level,
    segment: cfg.segment,
    moves: cfg.moves,
    runs,
    clears: clears.length,
    failed,
    passRate: Number(passRate.toFixed(4)),
    wilsonLower: Number(wilsonLower(clears.length, runs).toFixed(4)),
    stars: {
      1: clears.length ? Number((starCounts[1] / clears.length).toFixed(4)) : 0,
      2: clears.length ? Number((starCounts[2] / clears.length).toFixed(4)) : 0,
      3: clears.length ? Number((starCounts[3] / clears.length).toFixed(4)) : 0,
    },
    remaining: {
      p35: Number(quantile(remaining.slice().sort((a, b) => a - b), 0.35).toFixed(2)),
      p70: Number(quantile(remaining.slice().sort((a, b) => a - b), 0.7).toFixed(2)),
      min: remaining.length ? Math.min(...remaining) : null,
      max: remaining.length ? Math.max(...remaining) : null,
    },
    currentKeep: { ...cfg.starKeep },
    proposedKeep,
    proposedStars: Object.fromEntries(
      [1, 2, 3].map((star) => [
        star,
        clears.length ? Number((proposedStars[star] / clears.length).toFixed(4)) : 0,
      ]),
    ),
  };
}

function summarize(rows) {
  const segments = [1, 2, 3].map((segment) => {
    const subset = rows.filter((row) => row.segment === segment);
    const passes = subset.reduce((sum, row) => sum + row.clears, 0);
    const total = subset.reduce((sum, row) => sum + row.runs, 0);
    return {
      segment,
      levels: subset.length,
      passRate: Number((passes / total).toFixed(4)),
      wilsonLower: Number(wilsonLower(passes, total).toFixed(4)),
      minLevelWilson: subset.length ? Math.min(...subset.map((row) => row.wilsonLower)) : 0,
    };
  });
  const starTotals = rows.reduce(
    (acc, row) => {
      for (const star of [1, 2, 3]) acc[star] += row.stars[star] * row.clears;
      return acc;
    },
    { 1: 0, 2: 0, 3: 0 },
  );
  const clears = rows.reduce((sum, row) => sum + row.clears, 0);
  const proposedTotals = rows.reduce(
    (acc, row) => {
      for (const star of [1, 2, 3]) acc[star] += row.proposedStars[star] * row.clears;
      return acc;
    },
    { 1: 0, 2: 0, 3: 0 },
  );
  return {
    segments,
    starDistribution: Object.fromEntries(
      [1, 2, 3].map((star) => [star, Number((starTotals[star] / clears).toFixed(4))]),
    ),
    proposedStarDistribution: Object.fromEntries(
      [1, 2, 3].map((star) => [star, Number((proposedTotals[star] / clears).toFixed(4))]),
    ),
    levelsFailedTarget: rows.filter((row) => row.wilsonLower < 0.6).map((row) => row.level),
    levelsBelowSegmentTarget: rows
      .filter((row) => {
        const target = row.segment === 1 ? 0.95 : row.segment === 2 ? 0.9 : 0.6;
        return row.passRate < target;
      })
      .map((row) => row.level),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(resolve(ROOT, "src/lib/levels.json"), "utf8"));
  const loaded = loadLevels(doc);
  const levels = parseLevels(options.levels)
    .map((n) => loaded.levels.find((level) => level.level === n))
    .filter(Boolean);

  const rows = [];
  const started = Date.now();
  for (const cfg of levels) {
    const row = solveLevel(cfg, options.runs, {
      items: options.items,
      skill: options.skill,
      keep2Quantile: options.keep2Quantile,
      keep3Quantile: options.keep3Quantile,
    });
    rows.push(row);
    console.log(
      `第 ${String(row.level).padStart(2, "0")} 关：通过 ${row.clears}/${row.runs} ` +
        `(${(row.passRate * 100).toFixed(1)}%, Wilson ${(row.wilsonLower * 100).toFixed(1)}%) ` +
        `stars ${row.stars[1]}/${row.stars[2]}/${row.stars[3]} ` +
        `keep ${row.currentKeep.keep2}/${row.currentKeep.keep3} → ${row.proposedKeep.keep2}/${row.proposedKeep.keep3}`,
    );
  }
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    runsPerLevel: options.runs,
    items: options.items,
    skill: options.skill,
    keep2Quantile: options.keep2Quantile,
    keep3Quantile: options.keep3Quantile,
    elapsedMs: Date.now() - started,
    rows,
    summary: summarize(rows),
  };
  if (options.out) {
    const outPath = resolve(ROOT, options.out);
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`报告写入 ${outPath}`);
  }
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

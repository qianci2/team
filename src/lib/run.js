/**
 * M3 关卡流程引擎（FR-07~FR-09、FR-22、FL-02）。
 *
 * 对外表现为“状态 + 动作 → 新状态 + 事件”的纯函数：
 * applyMove / useItem 每次都返回新的 RunState，不修改传入值。
 * 棋盘与冰层的唯一所有者是 RunState；星级、金币、生命属于 M4。
 */

import { createRng, shuffle as shuffleArray } from "./random.js";
import {
  ROWS,
  COLS,
  createBoard,
  isDeadlock,
  settle,
  settleCells,
  shuffleBoard,
  tileAt,
  withIce,
} from "./board.js";
import { starsPreview } from "./score.js";

export const ITEM_KINDS = Object.freeze(["shuffle", "hammer", "plus5"]);
const ICE_ROW_WEIGHTS = [12, 12, 12, 10, 8, 6, 4, 0];

function mixSeed(seed, action, salt = 0) {
  return (
    (Math.imul((Number(seed) >>> 0) ^ 0x9e3779b9, 1664525) +
      Math.imul(Number(action) + 1, 1013904223) +
      Math.imul(Number(salt) + 1, 2654435761)) >>>
    0
  );
}

function zeroProgress() {
  return { score: 0, collect: 0, iceBroken: 0 };
}

function copyItemUsed(itemUsed) {
  return {
    shuffle: Boolean(itemUsed?.shuffle),
    hammer: Boolean(itemUsed?.hammer),
    plus5: Boolean(itemUsed?.plus5),
  };
}

/**
 * 按 BR-06 / §7.3.3 的行权重布置冰层。
 *
 * 权重 [12,12,12,10,8,6,4,0] 合计 64，底行权重为 0；
 * 同一种子可复现，双层冰数量为 round(total × doubleRatio)。
 */
export function placeIce(iceGoal, rng) {
  const rows = ROWS;
  const cols = COLS;
  const total = Math.max(0, Math.min(rows * cols, Math.trunc(iceGoal?.total ?? 0)));
  const ratio = typeof iceGoal?.doubleRatio === "number" ? iceGoal.doubleRatio : 0;

  const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  if (total === 0) return matrix;

  const pool = [];
  for (let r = 0; r < rows; r += 1) {
    const weight = ICE_ROW_WEIGHTS[r] ?? 0;
    if (weight <= 0) continue;
    for (let c = 0; c < cols; c += 1) pool.push({ r, c, weight });
  }

  const selected = [];
  while (selected.length < total && pool.length > 0) {
    const sum = pool.reduce((acc, cell) => acc + cell.weight, 0);
    let ticket = rng() * sum;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      ticket -= pool[i].weight;
      if (ticket < 0) {
        index = i;
        break;
      }
    }
    selected.push(pool.splice(index, 1)[0]);
  }

  if (selected.length < total) {
    const chosen = new Set(selected.map((cell) => `${cell.r},${cell.c}`));
    const rest = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (!chosen.has(`${r},${c}`)) rest.push({ r, c });
      }
    }
    const shuffled = shuffleArray(rng, rest);
    selected.push(...shuffled.slice(0, total - selected.length));
  }

  const doubleCount = Math.max(0, Math.min(selected.length, Math.round(total * ratio)));
  const order = shuffleArray(rng, selected);
  const doubled = new Set(order.slice(0, doubleCount).map((cell) => `${cell.r},${cell.c}`));

  for (const cell of selected) {
    const key = `${cell.r},${cell.c}`;
    matrix[cell.r][cell.c] = doubled.has(key) ? 2 : 1;
  }

  return matrix;
}

/** 建立一次对局的运行时状态（I-09）。 */
export function createRun(cfg, seed = 1, clock = null) {
  const rng = createRng(seed);
  const board = withIce(createBoard(rng, cfg.colors ?? 5), placeIce(cfg.goals?.ice, rng));

  return {
    level: cfg.level,
    segment: cfg.segment,
    cfg,
    board,
    movesLeft: cfg.moves,
    movesUsed: 0,
    score: 0,
    goalProgress: zeroProgress(),
    itemUsed: copyItemUsed(null),
    shuffleCount: 0,
    status: "playing",
    seed: Number(seed) >>> 0,
    actionSeq: 0,
    clock,
  };
}

/** 生成目标状态列表；只有配置了的目标才出现。 */
export function goalStatuses(run) {
  const goals = [];
  const cfgGoals = run.cfg.goals ?? {};

  goals.push({
    kind: "score",
    current: run.score,
    target: cfgGoals.score ?? 0,
    done: run.score >= (cfgGoals.score ?? 0),
  });

  if (cfgGoals.collect) {
    goals.push({
      kind: "collect",
      current: run.goalProgress.collect,
      target: cfgGoals.collect.count,
      done: run.goalProgress.collect >= cfgGoals.collect.count,
    });
  }

  if ((cfgGoals.ice?.total ?? 0) > 0) {
    goals.push({
      kind: "ice",
      current: run.goalProgress.iceBroken,
      target: cfgGoals.ice.total,
      done: run.goalProgress.iceBroken >= cfgGoals.ice.total,
    });
  }

  return goals;
}

function computeStatus(run) {
  const goals = goalStatuses(run);
  if (goals.every((goal) => goal.done)) return "clear";
  if (run.movesLeft <= 0) return "fail";
  return "playing";
}

function countCollected(cfg, steps) {
  const collect = cfg.goals?.collect;
  if (!collect) return 0;
  let count = 0;
  for (const step of steps) {
    for (const entry of step.clearedTiles ?? []) {
      if (entry.kind === collect.color) count += 1;
    }
  }
  return count;
}

function countIceBroken(steps) {
  return steps.reduce((sum, step) => sum + (step.iceBroken?.length ?? 0), 0);
}

/**
 * 死局处理：自动洗牌（不消耗步数），连续 5 次仍死局则重建棋盘。
 *
 * 重建只重排元素颜色，保留冰层布局与已累计的目标进度、得分与步数（FR-05）。
 */
export function ensurePlayable(run, { shuffleFn = shuffleBoard, generateFn = createBoard, rng = null } = {}) {
  const events = [];
  let board = run.board;
  let shuffleCount = run.shuffleCount ?? 0;

  if (!isDeadlock(board)) {
    return { board, shuffleCount: 0, events };
  }

  const random = rng ?? createRng(mixSeed(run.seed, run.actionSeq, 7));

  while (isDeadlock(board) && shuffleCount < 5) {
    board = shuffleFn(board, random);
    shuffleCount += 1;
    events.push({ type: "deadlock:shuffled", count: shuffleCount, rebuilt: false });
  }

  if (isDeadlock(board)) {
    board = generateFn(createRng(mixSeed(run.seed, run.actionSeq, 11)), run.cfg.colors ?? 5);
    board = withIce(board, run.board.ice);
    shuffleCount = 0;
    events.push({ type: "deadlock:shuffled", count: 5, rebuilt: true });
  }

  return { board, shuffleCount, events };
}

function finishAction(previous, changes, events, options) {
  let next = {
    ...previous,
    ...changes,
    actionSeq: previous.actionSeq + 1,
  };

  let status = computeStatus(next);
  if (status === "playing") {
    const playable = ensurePlayable(next, options);
    next = {
      ...next,
      board: playable.board,
      shuffleCount: playable.shuffleCount,
    };
    events.push(...playable.events);
    status = computeStatus(next);
  }

  next.status = status;
  return {
    run: next,
    result: status === "playing" ? "applied" : status,
    events,
  };
}

function rejected(run, reason, extra = {}) {
  return { run, result: "rejected", reason, events: [], ...extra };
}

/**
 * 一次交换的完整处理（I-10）。
 *
 * 不相邻/越界 → rejected（不消耗步数）；终态 → locked；
 * 合法但无消除 → rejected 且棋盘不变（FR-02）。
 */
export function applyMove(run, move, options = {}) {
  if (run.status !== "playing") {
    return { run, result: "locked", events: [] };
  }

  const { from, to } = move ?? {};
  if (!Array.isArray(from) || !Array.isArray(to)) {
    return rejected(run, "invalid-move");
  }
  const distance = Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]);
  const inRange = [from, to].every(
    ([r, c]) =>
      Number.isInteger(r) &&
      Number.isInteger(c) &&
      r >= 0 &&
      r < run.board.rows &&
      c >= 0 &&
      c < run.board.cols,
  );
  if (!inRange || distance !== 1) {
    return rejected(run, "not-adjacent");
  }

  const rng = createRng(mixSeed(run.seed, run.actionSeq + 1, 0));
  const settlement = settle(run.board, move, { rng });
  if (settlement.variant === "rejected") {
    return rejected(run, "no-match", { settle: settlement });
  }

  const score = run.score + settlement.totalScoreDelta;
  const goalProgress = {
    score,
    collect: run.goalProgress.collect + countCollected(run.cfg, settlement.steps),
    iceBroken: run.goalProgress.iceBroken + countIceBroken(settlement.steps),
  };

  return {
    ...finishAction(
      run,
      {
        board: settlement.board,
        movesLeft: run.movesLeft - 1,
        movesUsed: run.movesUsed + 1,
        score,
        goalProgress,
      },
      [
        { type: "board:settled", steps: settlement.steps },
        { type: "score:changed", score, delta: settlement.totalScoreDelta },
        { type: "goals:changed", goals: goalStatuses({ ...run, score, goalProgress }) },
      ],
      options,
    ),
    settle: settlement,
  };
}

/**
 * 道具效果与结算（I-11）。
 *
 * 每关每种道具限用 1 次；使用道具不消耗步数（+5 步道具除外，它加 5）。
 * 库存扣减属于 M4/M10，本函数只维护本局限用记录。
 */
export function useItem(run, kind, target, options = {}) {
  if (run.status !== "playing") {
    return { run, result: "locked", events: [] };
  }
  if (!ITEM_KINDS.includes(kind)) {
    return rejected(run, "invalid-item");
  }
  if (run.itemUsed[kind]) {
    return rejected(run, "item-used");
  }

  if (kind === "hammer") {
    if (!Array.isArray(target) || target.length !== 2) {
      throw new TypeError("锤子道具必须指定目标格");
    }
    const [r, c] = target;
    if (!Number.isInteger(r) || !Number.isInteger(c) || !tileAt(run.board, r, c)) {
      return rejected(run, "invalid-target");
    }
  }

  const rng = createRng(mixSeed(run.seed, run.actionSeq + 1, 3));
  const itemUsed = copyItemUsed(run.itemUsed);
  itemUsed[kind] = true;
  const events = [{ type: "item:used", kind }];

  if (kind === "shuffle") {
    let board = run.board;
    for (let attempt = 0; attempt < 5 && isDeadlock(board); attempt += 1) {
      board = shuffleBoard(board, rng);
    }
    return {
      ...finishAction(run, { board, itemUsed }, events, options),
      settle: null,
    };
  }

  if (kind === "plus5") {
    return {
      ...finishAction(run, { movesLeft: run.movesLeft + 5, itemUsed }, events, options),
      settle: null,
    };
  }

  const settlement = settleCells(run.board, [target], { rng });
  if (settlement.variant === "rejected") {
    return rejected(run, "invalid-target");
  }

  const score = run.score + settlement.totalScoreDelta;
  const goalProgress = {
    score,
    collect: run.goalProgress.collect + countCollected(run.cfg, settlement.steps),
    iceBroken: run.goalProgress.iceBroken + countIceBroken(settlement.steps),
  };

  return {
    ...finishAction(
      run,
      {
        board: settlement.board,
        score,
        goalProgress,
        itemUsed,
      },
      [
        ...events,
        { type: "board:settled", steps: settlement.steps },
        { type: "score:changed", score, delta: settlement.totalScoreDelta },
        { type: "goals:changed", goals: goalStatuses({ ...run, score, goalProgress }) },
      ],
      options,
    ),
    settle: settlement,
  };
}

/** 生成状态摘要供 HUD 与弹窗使用（I-12）。 */
export function statusOf(run) {
  return {
    status: run.status,
    level: run.level,
    movesLeft: run.movesLeft,
    movesUsed: run.movesUsed,
    score: run.score,
    goals: goalStatuses(run),
    starsPreview: starsPreview(run.movesLeft, run.cfg.starKeep),
    canUseItem: {
      shuffle: !run.itemUsed.shuffle,
      hammer: !run.itemUsed.hammer,
      plus5: !run.itemUsed.plus5,
    },
    shuffleCount: run.shuffleCount,
  };
}

/** 终态载荷（I-13）；非终态返回 null。 */
export function outcomeOf(run) {
  if (run.status === "playing") return null;
  const goals = goalStatuses(run);
  return {
    level: run.level,
    result: run.status,
    score: run.score,
    remainingMoves: run.movesLeft,
    movesUsed: run.movesUsed,
    goals,
    unfinished: goals
      .filter((goal) => !goal.done)
      .map((goal) => ({ ...goal, gap: Math.max(0, goal.target - goal.current) })),
  };
}


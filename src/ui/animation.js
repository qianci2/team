/**
 * M6 动画数据（I-29 的回放计划）。
 *
 * 领域层已经给出可直接播放的 CascadeStep；本模块只按步骤重建
 * “每一步之后的棋盘”，不判断任何规则。纯函数，便于用真实结算
 * 结果做逐格对照测试。
 */

const DEFAULT_ROWS = 8;
const DEFAULT_COLS = 8;

function keyOf(pos) {
  return `${pos[0]},${pos[1]}`;
}

/**
 * 交换两格。M1 的结算步骤建立在“已经交换过”的棋盘上，
 * 渲染回放必须先补上这一步，否则动画会从交换前的棋盘开始。
 */
export function swapBoard(board, move) {
  if (!board || !Array.isArray(move?.from) || !Array.isArray(move?.to)) return board;
  const [ar, ac] = move.from;
  const [br, bc] = move.to;
  if (!board.tiles?.[ar]?.[ac] || !board.tiles?.[br]?.[bc]) return board;
  const tiles = board.tiles.map((row) => row.slice());
  const first = tiles[ar][ac];
  tiles[ar][ac] = tiles[br][bc];
  tiles[br][bc] = first;
  return { ...board, tiles };
}

export function maxTileId(board) {
  let max = -1;
  for (const row of board?.tiles ?? []) {
    for (const tile of row) {
      if (tile && tile.id > max) max = tile.id;
    }
  }
  return max;
}

function cloneIce(ice, rows, cols) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ice?.[r]?.[c] ?? 0),
  );
}

/**
 * 重建一步之后的棋盘。
 *
 * 语义与 M1 `applyClear` 一致：先清格/生成特殊元素，再按列下落，
 * 最后从顶部补充；冰层按 iceBroken / iceReduced 更新。
 *
 * @param {object} board 步骤执行前的棋盘
 * @param {object} step CascadeStep
 */
export function applyStep(board, step) {
  const rows = board?.rows ?? DEFAULT_ROWS;
  const cols = board?.cols ?? DEFAULT_COLS;
  const cleared = new Set((step?.cleared ?? []).map(keyOf));
  const spawns = new Map((step?.spawned ?? []).map((spawn) => [keyOf(spawn.at), spawn.kind]));
  let nextId = maxTileId(board) + 1;

  const working = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  );

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const key = keyOf([r, c]);
      if (spawns.has(key)) {
        working[r][c] = { kind: spawns.get(key), id: nextId };
        nextId += 1;
        continue;
      }
      const tile = board.tiles?.[r]?.[c] ?? null;
      if (tile && !cleared.has(key)) working[r][c] = tile;
    }
  }

  const refillMap = new Map((step?.refills ?? []).map((refill) => [keyOf(refill.at), refill]));
  const tiles = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  );
  const falls = [];
  const refills = [];

  for (let c = 0; c < cols; c += 1) {
    const stack = [];
    for (let r = rows - 1; r >= 0; r -= 1) {
      if (working[r][c]) stack.push({ tile: working[r][c], from: r });
    }

    let write = rows - 1;
    for (const item of stack) {
      tiles[write][c] = item.tile;
      if (item.from !== write) {
        falls.push({ from: [item.from, c], to: [write, c] });
      }
      write -= 1;
    }

    while (write >= 0) {
      const known = refillMap.get(keyOf([write, c]));
      const kind = known ? known.kind : 0;
      const id = known && Number.isInteger(known.id) ? known.id : nextId;
      if (!known) nextId += 1;
      tiles[write][c] = { kind, id };
      refills.push({ at: [write, c], kind, id });
      write -= 1;
    }
  }

  const ice = cloneIce(board.ice, rows, cols);
  for (const [r, c] of step?.iceBroken ?? []) {
    if (ice[r]?.[c] !== undefined) ice[r][c] = 0;
  }
  for (const [r, c] of step?.iceReduced ?? []) {
    if (ice[r]?.[c] > 0) ice[r][c] -= 1;
  }

  return {
    board: { ...board, rows, cols, tiles, ice },
    clearedTiles: step?.clearedTiles ?? [],
    falls,
    refills,
    iceBroken: step?.iceBroken ?? [],
    iceReduced: step?.iceReduced ?? [],
  };
}

/**
 * 把整段连锁展开为逐帧可用的“步骤前/后”快照。
 *
 * @returns {{items: Array<object>, board: object}}
 */
export function planSteps(board, steps) {
  const items = [];
  let current = board;
  for (const step of steps ?? []) {
    const applied = applyStep(current, step);
    items.push({ before: current, after: applied.board, step, ...applied });
    current = applied.board;
  }
  return { items, board: current };
}

/**
 * 动画节奏：整段控制在 1.7s 内，给 M5 的 2.4s 兜底留出余量。
 * 单步 150–340ms；连锁越长单步越短，但不会低于 150ms。
 */
export function stepTiming(stepCount, { maxTotal = 1700, minStep = 150, maxStep = 340 } = {}) {
  const count = Math.max(0, Math.trunc(stepCount) || 0);
  if (count === 0) return { stepMs: 0, totalMs: 0 };
  const stepMs = Math.min(maxStep, Math.max(minStep, maxTotal / count));
  return { stepMs, totalMs: stepMs * count };
}

export function easeOutCubic(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

export function easeInQuad(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped;
}

export function tileKinds(board) {
  return (board?.tiles ?? []).map((row) => row.map((tile) => (tile ? tile.kind : null)));
}

export function iceMatrix(board) {
  return cloneIce(board?.ice, board?.rows ?? DEFAULT_ROWS, board?.cols ?? DEFAULT_COLS);
}

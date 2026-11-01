/**
 * M1 棋盘核心引擎（FR-01~FR-06、BR-01、BR-06、BR-10）。
 *
 * 纯函数：Board 是不可变值对象，任何操作都返回新 Board。
 * 冰层是格子属性（覆盖层模型），`board.ice[r][c] ∈ {0,1,2}`。
 * 随机性全部通过注入的 rng 提供，同一种子可复现（M12）。
 */

import { createRng, randInt, shuffle as shuffleArray } from "./random.js";
import { CHAIN_LIMIT, scoreEvent } from "./score.js";

export const ROWS = 8;
export const COLS = 8;
export const COLOR_COUNT = 5;
export { CHAIN_LIMIT };
export const BOMB = "bomb";
export const RAINBOW = "rainbow";

export function isSpecialKind(kind) {
  return kind === BOMB || kind === RAINBOW;
}

export function isColorKind(kind) {
  return Number.isInteger(kind) && kind >= 0 && kind < COLOR_COUNT;
}

function keyOf(r, c) {
  return `${r},${c}`;
}

function parseKey(key) {
  const [r, c] = key.split(",").map(Number);
  return [r, c];
}

function posKey(pos) {
  return keyOf(pos[0], pos[1]);
}

function inBounds(board, r, c) {
  return r >= 0 && r < board.rows && c >= 0 && c < board.cols;
}

function tileAt(board, r, c) {
  return inBounds(board, r, c) ? board.tiles[r][c] : null;
}

function makeTile(kind, id) {
  return { kind, id };
}

function makeEmptyIce(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
}

function copyTiles(tiles) {
  return tiles.map((row) => row.map((tile) => (tile ? makeTile(tile.kind, tile.id) : null)));
}

function copyIce(ice) {
  return ice.map((row) => row.slice());
}

function makeBoard({ rows, cols, colors, tiles, ice }) {
  return { rows, cols, colors, tiles, ice };
}

function nextTileId(board) {
  let max = -1;
  for (const row of board.tiles) {
    for (const tile of row) {
      if (tile && tile.id > max) max = tile.id;
    }
  }
  return max + 1;
}

/** 测试与求解器用：从二维 kind 矩阵造棋盘，id 按行优先编号。 */
export function boardFromKinds(kinds, ice = null) {
  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new TypeError("kinds 必须是非空二维数组");
  }
  const cols = kinds[0].length;
  if (cols === 0 || kinds.some((row) => !Array.isArray(row) || row.length !== cols)) {
    throw new TypeError("kinds 必须是矩形二维数组");
  }

  let id = 0;
  const tiles = kinds.map((row) =>
    row.map((kind) => {
      if (!isColorKind(kind) && !isSpecialKind(kind)) {
        throw new RangeError(`非法元素类型：${String(kind)}`);
      }
      return makeTile(kind, id++);
    }),
  );

  const iceMatrix = makeEmptyIce(kinds.length, cols);
  if (ice) {
    if (ice.length !== kinds.length || ice.some((row) => row.length !== cols)) {
      throw new RangeError("ice 与棋盘尺寸不一致");
    }
    for (let r = 0; r < ice.length; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const layer = typeof ice[r][c] === "number" ? ice[r][c] : ice[r][c]?.layers;
        if (!Number.isInteger(layer) || layer < 0 || layer > 2) {
          throw new RangeError(`冰层厚度必须是 0–2：${layer}`);
        }
        iceMatrix[r][c] = layer;
      }
    }
  }

  return makeBoard({
    rows: kinds.length,
    cols,
    colors: COLOR_COUNT,
    tiles,
    ice: iceMatrix,
  });
}

/** 替换冰层矩阵，返回新棋盘（冰层布局独立于元素）。 */
export function withIce(board, ice) {
  const matrix = makeEmptyIce(board.rows, board.cols);
  for (let r = 0; r < board.rows; r += 1) {
    for (let c = 0; c < board.cols; c += 1) {
      const layer = typeof ice[r]?.[c] === "number" ? ice[r][c] : ice[r]?.[c]?.layers;
      if (!Number.isInteger(layer) || layer < 0 || layer > 2) {
        throw new RangeError(`冰层厚度必须是 0–2：${layer}`);
      }
      matrix[r][c] = layer;
    }
  }
  return makeBoard({ ...board, ice: matrix });
}

/** 生成开局棋盘：无初始三连，且至少存在一组可行交换（FR-01）。 */
export function createBoard(rng = createRng(1), colors = COLOR_COUNT) {
  if (typeof rng !== "function") {
    throw new TypeError("rng 必须是函数");
  }
  if (!Number.isInteger(colors) || colors < 3 || colors > COLOR_COUNT) {
    throw new RangeError(`colors 必须是 3–${COLOR_COUNT} 的整数`);
  }

  let last = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const tiles = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
    let id = 0;

    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const forbidden = new Set();
        if (c >= 2 && tiles[r][c - 1].kind === tiles[r][c - 2].kind) {
          forbidden.add(tiles[r][c - 1].kind);
        }
        if (r >= 2 && tiles[r - 1][c].kind === tiles[r - 2][c].kind) {
          forbidden.add(tiles[r - 1][c].kind);
        }
        const choices = [];
        for (let kind = 0; kind < colors; kind += 1) {
          if (!forbidden.has(kind)) choices.push(kind);
        }
        const kind = choices[randInt(rng, choices.length)];
        tiles[r][c] = makeTile(kind, id++);
      }
    }

    last = makeBoard({
      rows: ROWS,
      cols: COLS,
      colors,
      tiles,
      ice: makeEmptyIce(ROWS, COLS),
    });

    if (!isDeadlock(last)) return last;

    for (let shave = 0; shave < 5; shave += 1) {
      last = shuffleBoard(last, rng);
      if (!isDeadlock(last)) return last;
    }
  }

  return last;
}

/** 交换两格元素，只做位置互换，不做合法性判定（判定在 settle）。 */
export function swapCells(board, a, b) {
  if (!inBounds(board, a[0], a[1]) || !inBounds(board, b[0], b[1])) {
    throw new RangeError("交换位置越界");
  }
  const tiles = copyTiles(board.tiles);
  [tiles[a[0]][a[1]], tiles[b[0]][b[1]]] = [tiles[b[0]][b[1]], tiles[a[0]][a[1]]];
  return makeBoard({ ...board, tiles });
}

/**
 * 找出所有长度 ≥ 3 的同色连续段（横/竖）。
 *
 * 特殊元素不参与颜色匹配。L/T 型会返回两条共享一格的段，由调用方取并集。
 */
export function findRuns(tiles) {
  const rows = tiles.length;
  const cols = tiles[0].length;
  const runs = [];

  for (let r = 0; r < rows; r += 1) {
    let c = 0;
    while (c < cols) {
      const kind = tiles[r][c]?.kind;
      if (!isColorKind(kind)) {
        c += 1;
        continue;
      }
      let end = c + 1;
      while (end < cols && tiles[r][end]?.kind === kind) end += 1;
      const length = end - c;
      if (length >= 3) {
        const cells = [];
        for (let x = c; x < end; x += 1) cells.push([r, x]);
        runs.push({ direction: "h", kind, length, cells });
      }
      c = end;
    }
  }

  for (let c = 0; c < cols; c += 1) {
    let r = 0;
    while (r < rows) {
      const kind = tiles[r][c]?.kind;
      if (!isColorKind(kind)) {
        r += 1;
        continue;
      }
      let end = r + 1;
      while (end < rows && tiles[end][c]?.kind === kind) end += 1;
      const length = end - r;
      if (length >= 3) {
        const cells = [];
        for (let y = r; y < end; y += 1) cells.push([y, c]);
        runs.push({ direction: "v", kind, length, cells });
      }
      r = end;
    }
  }

  return runs;
}

export function hasMatch(board) {
  return findRuns(board.tiles).length > 0;
}

/** 4 连在中点生成炸弹，5 连及以上生成彩虹；同格冲突时彩虹优先。 */
export function planSpawns(runs) {
  const spawns = new Map();
  for (const run of runs) {
    if (run.length < 4) continue;
    const kind = run.length >= 5 ? RAINBOW : BOMB;
    const at = run.cells[Math.floor(run.cells.length / 2)];
    const key = posKey(at);
    const existing = spawns.get(key);
    if (!existing || kind === RAINBOW) {
      spawns.set(key, { at, kind });
    }
  }
  return Array.from(spawns.values());
}

function majorityColor(board, excluded = new Set()) {
  const counts = Array.from({ length: board.colors }, () => 0);
  for (let r = 0; r < board.rows; r += 1) {
    for (let c = 0; c < board.cols; c += 1) {
      const key = keyOf(r, c);
      if (excluded.has(key)) continue;
      const kind = board.tiles[r][c]?.kind;
      if (isColorKind(kind)) counts[kind] += 1;
    }
  }
  let best = -1;
  let bestCount = 0;
  for (let kind = 0; kind < counts.length; kind += 1) {
    if (counts[kind] > bestCount) {
      bestCount = counts[kind];
      best = kind;
    }
  }
  return best;
}

function squareKeys(board, r, c, radius) {
  const keys = [];
  for (let y = r - radius; y <= r + radius; y += 1) {
    for (let x = c - radius; x <= c + radius; x += 1) {
      if (inBounds(board, y, x)) keys.push(keyOf(y, x));
    }
  }
  return keys;
}

/**
 * 从初始消除格出发，展开连锁触发的特殊元素。
 *
 * counted 中的格子视为“已计入触发数”，noExpand 中的格子不再展开自身效果。
 * rainbowTargets 可为主动交换的彩虹指定目标颜色；未指定时取数量最多的颜色。
 */
function expandClears(board, seeds, { counted = new Set(), noExpand = new Set(), rainbowTargets = new Map() } = {}) {
  const cleared = new Set();
  const countedCells = new Set(counted);
  const queue = seeds.slice();
  let bombs = 0;
  let rainbows = 0;

  while (queue.length > 0) {
    const key = queue.pop();
    if (cleared.has(key)) continue;
    const [r, c] = parseKey(key);
    const tile = tileAt(board, r, c);
    cleared.add(key);
    if (!tile) continue;

    if (tile.kind === BOMB) {
      if (!countedCells.has(key)) {
        bombs += 1;
        countedCells.add(key);
      }
      if (!noExpand.has(key)) {
        queue.push(...squareKeys(board, r, c, 1));
      }
    } else if (tile.kind === RAINBOW) {
      if (!countedCells.has(key)) {
        rainbows += 1;
        countedCells.add(key);
      }
      if (!noExpand.has(key)) {
        const target = rainbowTargets.get(key) ?? majorityColor(board, cleared);
        if (target >= 0) {
          for (let y = 0; y < board.rows; y += 1) {
            for (let x = 0; x < board.cols; x += 1) {
              if (board.tiles[y][x]?.kind === target) queue.push(keyOf(y, x));
            }
          }
        }
      }
    }
  }

  return { cleared, bombs, rainbows };
}

function applyClear(board, cleared, spawns, rng) {
  const spawnMap = new Map(spawns.map((spawn) => [posKey(spawn.at), spawn.kind]));
  const ice = copyIce(board.ice);
  const clearedTiles = [];
  const iceBroken = [];
  const iceReduced = [];
  let id = nextTileId(board);

  for (const key of cleared) {
    const [r, c] = parseKey(key);
    const tile = tileAt(board, r, c);
    if (tile) clearedTiles.push({ pos: [r, c], kind: tile.kind });
    if (ice[r][c] > 0) {
      ice[r][c] -= 1;
      if (ice[r][c] === 0) iceBroken.push([r, c]);
      else iceReduced.push([r, c]);
    }
  }

  const working = Array.from({ length: board.rows }, () => Array.from({ length: board.cols }, () => null));
  for (let r = 0; r < board.rows; r += 1) {
    for (let c = 0; c < board.cols; c += 1) {
      const key = keyOf(r, c);
      if (spawnMap.has(key)) {
        working[r][c] = makeTile(spawnMap.get(key), id++);
      } else if (!cleared.has(key) && board.tiles[r][c]) {
        working[r][c] = board.tiles[r][c];
      }
    }
  }

  const falls = [];
  const refills = [];
  const tiles = Array.from({ length: board.rows }, () => Array.from({ length: board.cols }, () => null));

  for (let c = 0; c < board.cols; c += 1) {
    const stack = [];
    for (let r = board.rows - 1; r >= 0; r -= 1) {
      if (working[r][c]) stack.push({ tile: working[r][c], from: r });
    }

    let write = board.rows - 1;
    for (const { tile, from } of stack) {
      tiles[write][c] = tile;
      if (from !== write) falls.push({ from: [from, c], to: [write, c] });
      write -= 1;
    }

    while (write >= 0) {
      const kind = randInt(rng, board.colors);
      const tile = makeTile(kind, id++);
      tiles[write][c] = tile;
      refills.push({ at: [write, c], kind, id: tile.id });
      write -= 1;
    }
  }

  return {
    board: makeBoard({ ...board, tiles, ice }),
    clearedTiles,
    iceBroken,
    iceReduced,
    falls,
    refills,
  };
}

function runCascade(board, seeds, context, opts) {
  const rng = opts.rng ?? createRng(1);
  let current = board;
  let pendingSeeds = seeds;
  let spawns = context.spawns ?? [];
  let forced = context.forced ?? { bombs: 0, rainbows: 0 };
  let counted = context.counted ?? new Set();
  let noExpand = context.noExpand ?? new Set();
  let rainbowTargets = context.rainbowTargets ?? new Map();

  const steps = [];
  let runTotal = 0;
  let chain = 1;

  while (pendingSeeds.length > 0 && chain <= CHAIN_LIMIT) {
    const expanded = expandClears(current, pendingSeeds, { counted, noExpand, rainbowTargets });
    const cleared = expanded.cleared;
    const bombs = expanded.bombs + forced.bombs;
    const rainbows = expanded.rainbows + forced.rainbows;
    const activeSpawns = spawns.filter((spawn) => cleared.has(posKey(spawn.at)));

    const applied = applyClear(current, cleared, activeSpawns, rng);
    const score = scoreEvent(
      {
        chain,
        clearedCount: cleared.size,
        bombsTriggered: bombs,
        rainbowsTriggered: rainbows,
      },
      runTotal,
    );
    runTotal = score.runTotal;

    steps.push({
      chain,
      cleared: Array.from(cleared, (key) => parseKey(key)),
      clearedTiles: applied.clearedTiles,
      iceBroken: applied.iceBroken,
      iceReduced: applied.iceReduced,
      spawned: activeSpawns,
      falls: applied.falls,
      refills: applied.refills,
      score,
    });

    current = applied.board;
    chain += 1;

    forced = { bombs: 0, rainbows: 0 };
    counted = new Set();
    noExpand = new Set();
    rainbowTargets = new Map();

    if (chain > CHAIN_LIMIT) break;

    const runs = findRuns(current.tiles);
    if (runs.length === 0) {
      pendingSeeds = [];
    } else {
      pendingSeeds = Array.from(new Set(runs.flatMap((run) => run.cells.map(posKey))));
      spawns = planSpawns(runs);
    }
  }

  return {
    variant: "applied",
    board: current,
    steps,
    totalScoreDelta: runTotal,
  };
}

function rejected(board) {
  return { variant: "rejected", board, steps: [], totalScoreDelta: 0 };
}

function assertMove(board, move) {
  for (const pos of [move.from, move.to]) {
    if (!Array.isArray(pos) || !inBounds(board, pos[0], pos[1])) {
      throw new RangeError("交换位置越界");
    }
  }
  const distance = Math.abs(move.from[0] - move.to[0]) + Math.abs(move.from[1] - move.to[1]);
  if (distance !== 1) {
    throw new RangeError("只能交换上下左右相邻的两格");
  }
}

/**
 * 特殊元素组合与被动触发结算（BR-10 六类情形）。
 *
 * 两格均为普通元素时返回 rejected，交由 settle 的主流程处理。
 */
export function comboEffect(board, a, b, opts = {}) {
  assertMove(board, { from: a, to: b });
  const kindA = tileAt(board, a[0], a[1]).kind;
  const kindB = tileAt(board, b[0], b[1]).kind;
  if (!isSpecialKind(kindA) && !isSpecialKind(kindB)) return rejected(board);

  const swapped = swapCells(board, a, b);
  const plan = planCombo(swapped, a, b, kindA, kindB);
  return runCascade(plan.board ?? swapped, plan.seeds, plan, opts);
}

function planCombo(board, a, b, kindA, kindB) {
  const keyA = posKey(a);
  const keyB = posKey(b);
  const bothSpecial = isSpecialKind(kindA) && isSpecialKind(kindB);

  if (bothSpecial) {
    if (kindA === BOMB && kindB === BOMB) {
      const r = Math.round((a[0] + b[0]) / 2);
      const c = Math.round((a[1] + b[1]) / 2);
      return {
        seeds: squareKeys(board, r, c, 2),
        forced: { bombs: 2, rainbows: 0 },
        counted: new Set([keyA, keyB]),
        noExpand: new Set([keyA, keyB]),
        rainbowTargets: new Map(),
      };
    }

    if (kindA === RAINBOW && kindB === RAINBOW) {
      const seeds = [];
      for (let r = 0; r < board.rows; r += 1) {
        for (let c = 0; c < board.cols; c += 1) seeds.push(keyOf(r, c));
      }
      return {
        seeds,
        forced: { bombs: 0, rainbows: 2 },
        counted: new Set([keyA, keyB]),
        noExpand: new Set([keyA, keyB]),
        rainbowTargets: new Map(),
      };
    }

    // 炸弹 × 彩虹：把数量最多的颜色全部转为炸弹，随后依次触发。
    const target = majorityColor(board);
    const tiles = copyTiles(board.tiles);
    const transformed = [];
    if (target >= 0) {
      for (let r = 0; r < board.rows; r += 1) {
        for (let c = 0; c < board.cols; c += 1) {
          if (tiles[r][c]?.kind === target) {
            tiles[r][c] = makeTile(BOMB, tiles[r][c].id);
            transformed.push(keyOf(r, c));
          }
        }
      }
    }
    const transformedBoard = makeBoard({ ...board, tiles });
    const rainbowKey = kindA === RAINBOW ? keyB : keyA;
    const bombKey = kindA === BOMB ? keyB : keyA;
    const counted = new Set([rainbowKey, bombKey, ...transformed]);
    return {
      board: transformedBoard,
      seeds: [rainbowKey, bombKey, ...transformed],
      forced: { bombs: transformed.length + 1, rainbows: 1 },
      counted,
      noExpand: new Set([rainbowKey]),
      rainbowTargets: new Map(),
    };
  }

  // 特殊 × 普通：交换后特殊元素落在普通元素的原位置，以该格为中心触发。
  const specialWasA = isSpecialKind(kindA);
  const special = specialWasA ? kindA : kindB;
  const normalKind = specialWasA ? kindB : kindA;
  const specialKey = specialWasA ? keyB : keyA;
  const rainbowTargets = new Map();
  if (special === RAINBOW && isColorKind(normalKind)) {
    rainbowTargets.set(specialKey, normalKind);
  }

  return {
    seeds: [specialKey],
    forced: { bombs: 0, rainbows: 0 },
    counted: new Set(),
    noExpand: new Set(),
    rainbowTargets,
  };
}

/**
 * 执行一次交换并完成全部连锁结算（I-02）。
 *
 * 非法交换（不相邻/越界）抛 RangeError；合法但未形成消除返回 rejected，
 * 且 board 保持交换前的状态（FR-02）。
 */
export function settle(board, move, opts = {}) {
  assertMove(board, move);
  const kindA = tileAt(board, move.from[0], move.from[1]).kind;
  const kindB = tileAt(board, move.to[0], move.to[1]).kind;

  if (isSpecialKind(kindA) || isSpecialKind(kindB)) {
    return comboEffect(board, move.from, move.to, opts);
  }
  if (kindA === kindB) return rejected(board);

  const swapped = swapCells(board, move.from, move.to);
  const runs = findRuns(swapped.tiles);
  if (runs.length === 0) return rejected(board);

  const seeds = Array.from(new Set(runs.flatMap((run) => run.cells.map(posKey))));
  return runCascade(swapped, seeds, { spawns: planSpawns(runs) }, opts);
}

/** 直接消除指定格（锤子道具用，I-11 的内部结算入口）。 */
export function settleCells(board, cells, opts = {}) {
  if (!Array.isArray(cells) || cells.length === 0) return rejected(board);
  const seeds = [];
  for (const [r, c] of cells) {
    if (!inBounds(board, r, c)) throw new RangeError("消除位置越界");
    seeds.push(keyOf(r, c));
  }
  return runCascade(board, Array.from(new Set(seeds)), {}, opts);
}

/** 死局检测：枚举约 112 组合法交换，逐一试算能否形成三连（I-03）。 */
export function isDeadlock(board) {
  for (let r = 0; r < board.rows; r += 1) {
    for (let c = 0; c < board.cols; c += 1) {
      const tile = board.tiles[r][c];
      if (!tile) continue;
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(board, nr, nc)) continue;
        const other = board.tiles[nr][nc];
        if (!other) continue;
        if (isSpecialKind(tile.kind) || isSpecialKind(other.kind)) return false;
        if (tile.kind === other.kind) continue;
        const swapped = swapCells(board, [r, c], [nr, nc]);
        if (hasMatch(swapped)) return false;
      }
    }
  }
  return true;
}

/** 洗牌：仅重排普通元素的颜色，保留冰层与特殊元素位置（I-04）。 */
export function shuffleBoard(board, rng = createRng(1)) {
  const positions = [];
  const kinds = [];
  for (let r = 0; r < board.rows; r += 1) {
    for (let c = 0; c < board.cols; c += 1) {
      const tile = board.tiles[r][c];
      if (tile && !isSpecialKind(tile.kind)) {
        positions.push([r, c]);
        kinds.push(tile.kind);
      }
    }
  }

  let last = board;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const permuted = shuffleArray(rng, kinds);
    const tiles = copyTiles(board.tiles);
    positions.forEach(([r, c], index) => {
      tiles[r][c] = makeTile(permuted[index], tiles[r][c].id);
    });
    last = makeBoard({ ...board, tiles });
    if (!hasMatch(last) && !isDeadlock(last)) return last;
  }

  return last;
}

export { keyOf as cellKey, posKey, tileAt };

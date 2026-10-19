/*! 星消乐 Gemz Crush — 逻辑层 (logic.js)
 * 无 DOM 依赖：浏览器下作为普通 <script> 加载（挂到 window.GemzLogic），Node 下 require()。
 * 对应需求文档 01 的 FR-01 ~ FR-19、BR-1 ~ BR-4。
 * 该文件同时是自动化测试的被测对象（tests/test-logic.cjs）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GemzLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROWS = 8, COLS = 8, NUM_COLORS = 5;
  const T_NORMAL = 0, T_BOMB = 1, T_RAINBOW = 2;
  const SCORE = { PER_GEM: 10, BOMB: 100, RAINBOW: 300 };   // FR-14
  const LIVES_MAX = 5, LIVES_REGEN_MS = 15 * 60 * 1000;      // FR-13
  const ITEM_PRICE = { shuffle: 100, hammer: 200, plus5: 300 }; // FR-19
  const COIN_REWARD = [0, 50, 80, 120];                      // FR-19（下标=星级）

  const idx = (r, c) => r * COLS + c;
  const rowOf = i => (i / COLS) | 0;
  const colOf = i => i % COLS;
  const inBounds = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randInt = (rng, n) => Math.floor(rng() * n);
  function shuffleArray(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  const cloneCells = cells => cells.slice();

  function areAdjacent(a, b) {
    const dr = Math.abs(rowOf(a) - rowOf(b)), dc = Math.abs(colOf(a) - colOf(b));
    return dr + dc === 1;
  }
  function swapCells(cells, a, b) { const t = cells[a]; cells[a] = cells[b]; cells[b] = t; }

  /* ---------- 匹配检测 (FR-03) ---------- */
  function findRuns(cells) {
    const runs = [];
    for (let r = 0; r < ROWS; r++) {
      let len = 0, color = -1, start = 0;
      for (let c = 0; c <= COLS; c++) {
        const cell = c < COLS ? cells[idx(r, c)] : null;
        const cc = cell ? cell.c : -2;
        if (cc === color) len++;
        else {
          if (len >= 3) { const arr = []; for (let k = 0; k < len; k++) arr.push(idx(r, start + k)); runs.push(arr); }
          color = cc; len = 1; start = c;
        }
      }
    }
    for (let c = 0; c < COLS; c++) {
      let len = 0, color = -1, start = 0;
      for (let r = 0; r <= ROWS; r++) {
        const cell = r < ROWS ? cells[idx(r, c)] : null;
        const cc = cell ? cell.c : -2;
        if (cc === color) len++;
        else {
          if (len >= 3) { const arr = []; for (let k = 0; k < len; k++) arr.push(idx(start + k, c)); runs.push(arr); }
          color = cc; len = 1; start = r;
        }
      }
    }
    return runs;
  }

  /** 返回合并后的匹配组：{cells:[idx], size, maxRun} */
  function findGroups(cells) {
    const runs = findRuns(cells);
    const parent = runs.map((_, i) => i);
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    const owner = new Map();
    runs.forEach((run, i) => run.forEach(ci => { if (owner.has(ci)) union(owner.get(ci), i); else owner.set(ci, i); }));
    const acc = new Map();
    runs.forEach((run, i) => {
      const k = find(i);
      let g = acc.get(k);
      if (!g) { g = { cells: new Set(), maxRun: 0 }; acc.set(k, g); }
      run.forEach(ci => g.cells.add(ci));
      if (run.length > g.maxRun) g.maxRun = run.length;
    });
    const out = [];
    let id = 0;
    for (const g of acc.values()) out.push({ id: id++, cells: Array.from(g.cells), size: g.cells.size, maxRun: g.maxRun });
    return out;
  }

  /* ---------- 可行交换检测 (FR-02 / FR-05) ----------
   * 冰层（FR-07）建模为"果冻/糖霜"式覆盖层：附着在格子位置上，不阻止该格元素参与交换，
   * 该格元素被消除时冰层减少 1 层，减到 0 即破坏并计入冰块目标（双层冰需两次消除）。
   */
  function tryPair(cells, ice, a, b) {
    if (!cells[a] || !cells[b]) return false;
    if (cells[a].c === cells[b].c) return false;              // 同色交换不可能形成新匹配
    swapCells(cells, a, b);
    const ok = findGroups(cells).length > 0;
    swapCells(cells, a, b);
    return ok;
  }

  function hasPossibleMove(cells, ice) {
    for (let i = 0; i < cells.length; i++) if (cells[i] && cells[i].t === T_RAINBOW) return true;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      if (c + 1 < COLS && tryPair(cells, ice, i, idx(r, c + 1))) return true;
      if (r + 1 < ROWS && tryPair(cells, ice, i, idx(r + 1, c))) return true;
    }
    return false;
  }

  function swapMakesMatch(cells, ice, a, b) { return tryPair(cells, ice, a, b); }

  function canSwap(cells, ice, a, b) {
    if (!areAdjacent(a, b)) return false;
    return !!(cells[a] && cells[b]);
  }

  /* ---------- 洗牌 (FR-05) ---------- */
  function shuffleBoard(cells, ice, rng) {
    const colors = [];
    for (let i = 0; i < cells.length; i++) if (cells[i]) colors.push(cells[i].c);
    for (let attempt = 0; attempt < 200; attempt++) {
      shuffleArray(colors, rng);
      let k = 0;
      for (let i = 0; i < cells.length; i++) if (cells[i]) cells[i] = { c: colors[k++], t: cells[i].t };
      if (findGroups(cells).length === 0 && hasPossibleMove(cells, ice)) return true;
    }
    return false;
  }

  /* ---------- 关卡生成 (FR-01) ---------- */
  function createsImmediate(cells, r, c, color) {
    const l1 = c >= 1 ? cells[idx(r, c - 1)] : null, l2 = c >= 2 ? cells[idx(r, c - 2)] : null;
    if (l1 && l2 && l1.c === color && l2.c === color) return true;
    const u1 = r >= 1 ? cells[idx(r - 1, c)] : null, u2 = r >= 2 ? cells[idx(r - 2, c)] : null;
    if (u1 && u2 && u1.c === color && u2.c === color) return true;
    return false;
  }

  /* 冰层布置权重：按 8×8 棋盘实测的"各行消除频率"加权（tools/exp.html 实验 1：
   * 第 0~2 行各约 18%，第 5~7 行各约 8%/7%/4%）。冰层若均匀随机布置，
   * 会有约 1/4 的冰格落在几乎不会被消除的底部，导致冰块目标实际无法达成（实测通过率仅 17%）。
   * 因此按消除频率加权布置，保证每颗冰格都处在可被消除的区域。 */
  const ICE_ROW_WEIGHT = [18, 18, 19, 13, 12, 8, 7, 4];

  function placeIce(rng, board, iceCount, doubleRatio) {
    if (iceCount <= 0) return;
    const rowPool = [];
    for (let r = 0; r < ROWS; r++) for (let k = 0; k < ICE_ROW_WEIGHT[r]; k++) rowPool.push(r);
    let placed = 0, guard = 0;
    while (placed < iceCount && guard++ < 800) {
      const i = idx(rowPool[randInt(rng, rowPool.length)], randInt(rng, COLS));
      if (board.ice[i] > 0) continue;
      board.ice[i] = rng() < doubleRatio ? 2 : 1;
      placed++;
    }
  }

  /** 新棋盘：开局无匹配 + 至少存在一个可行交换；iceCount 冰层格数，doubleRatio 双层冰比例 */
  function newBoard(rng, iceCount, doubleRatio) {
    iceCount = iceCount || 0; doubleRatio = doubleRatio || 0;
    const board = { cells: null, ice: new Array(ROWS * COLS).fill(0) };
    for (let attempt = 0; attempt < 60; attempt++) {
      board.cells = new Array(ROWS * COLS).fill(null);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        let color = 0, tries = 0;
        do { color = randInt(rng, NUM_COLORS); tries++; } while (tries < 60 && createsImmediate(board.cells, r, c, color));
        board.cells[idx(r, c)] = { c: color, t: T_NORMAL };
      }
      if (findGroups(board.cells).length === 0) break;
    }
    placeIce(rng, board, iceCount, doubleRatio);
    for (let attempt = 0; attempt < 40 && !hasPossibleMove(board.cells, board.ice); attempt++) {
      if (!shuffleBoard(board.cells, board.ice, rng)) break;
    }
    return board;
  }

  /* ---------- 重力与补充 (FR-03) ---------- */
  function gravity(cells, rng) {
    const offsets = new Array(cells.length).fill(0);
    const spawned = [];
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        const i = idx(r, c);
        if (cells[i]) {
          const w = idx(write, c);
          if (w !== i) { cells[w] = cells[i]; cells[i] = null; offsets[w] = write - r; }
          write--;
        }
      }
      let n = 0;
      for (let r = write; r >= 0; r--) {
        const w = idx(r, c);
        cells[w] = { c: randInt(rng, NUM_COLORS), t: T_NORMAL };
        offsets[w] = (write - r) + 1;   // 从棋盘上方落入
        spawned.push(w);
        n++;
      }
    }
    return { offsets, spawned };
  }

  /** 选取新特殊元素的落点：优先普通元素格，避免"重建"已存在的特殊元素（它应被消耗而非保留） */
  function pickCell(group, pending, cells) {
    const normals = group.cells.filter(i => cells[i] && cells[i].t === T_NORMAL);
    const pool = normals.length ? normals : group.cells;
    if (pending) { for (const p of pending) if (pool.indexOf(p) >= 0) return p; }
    const sorted = pool.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /* ---------- 消除结算（含连锁 / 特殊元素 / 冰层） ---------- */
  /**
   * @param cells 棋盘（会被就地修改）
   * @param ice   冰层数组（0/1/2，可传 null）
   * @param rng   随机数
   * @param opts  {swapPair:[a,b], seedTrigger:idx}
   * @returns {steps, frames, total, iceCleared, colorCounts, reshuffled}
   */
  function resolve(cells, ice, rng, opts) {
    opts = opts || {};
    const steps = [], frames = [cloneCells(cells)];
    const totalCounts = new Array(NUM_COLORS).fill(0);
    let total = 0, iceCleared = 0, combo = 0, guard = 0, reshuffled = false;
    const pending = opts.swapPair || null;
    let seedPending = (opts.seedTrigger != null && cells[opts.seedTrigger] && cells[opts.seedTrigger].t !== T_NORMAL)
      ? opts.seedTrigger : null;

    while (guard++ < 80) {
      const groups = findGroups(cells);
      if (!groups.length && seedPending == null) break;
      combo++;
      const coef = 1 + 0.5 * (combo - 1);                     // FR-04
      const clearSet = new Set();
      const colorCounts = new Array(NUM_COLORS).fill(0);
      const newSpecials = [];                                  // FR-06
      let bonus = 0;

      for (const g of groups) {
        for (const ci of g.cells) clearSet.add(ci);
        if (g.maxRun >= 5) newSpecials.push({ idx: pickCell(g, pending, cells), type: T_RAINBOW });
        else if (g.maxRun === 4) newSpecials.push({ idx: pickCell(g, pending, cells), type: T_BOMB });
      }
      if (seedPending != null) { clearSet.add(seedPending); seedPending = null; }

      // 特殊元素触发连锁（炸弹 3×3 / 彩虹全屏同色）
      const queue = [];
      clearSet.forEach(i => { if (cells[i] && cells[i].t !== T_NORMAL) queue.push(i); });
      while (queue.length) {
        const i = queue.shift();
        const cell = cells[i];
        if (!cell) continue;
        if (cell.t === T_BOMB) {
          bonus += SCORE.BOMB;
          const r = rowOf(i), c = colOf(i);
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (!inBounds(r + dr, c + dc)) continue;
            const k = idx(r + dr, c + dc);
            if (cells[k] && !clearSet.has(k)) {
              clearSet.add(k);
              if (cells[k].t !== T_NORMAL) queue.push(k);
            }
          }
        } else if (cell.t === T_RAINBOW) {
          bonus += SCORE.RAINBOW;
          for (let k = 0; k < cells.length; k++) {
            if (cells[k] && cells[k].c === cell.c && !clearSet.has(k)) {
              clearSet.add(k);
              if (cells[k].t !== T_NORMAL) queue.push(k);
            }
          }
        }
      }

      // 本轮生成的特殊元素保留在原位，不参与消除
      for (const s of newSpecials) clearSet.delete(s.idx);

      const cleared = [];
      clearSet.forEach(i => { if (cells[i]) cleared.push(i); });
      for (const i of cleared) colorCounts[cells[i].c]++;

      let iceThis = 0;
      for (const i of cleared) {
        if (ice && ice[i] > 0) {
          ice[i]--;
          if (ice[i] === 0) { iceThis++; iceCleared++; }        // FR-07 冰块目标
        }
        cells[i] = null;
      }
      for (const s of newSpecials) { if (cells[s.idx]) cells[s.idx].t = s.type; }

      const gained = Math.round(cleared.length * SCORE.PER_GEM * coef) + bonus;
      total += gained;
      for (let k = 0; k < NUM_COLORS; k++) totalCounts[k] += colorCounts[k];

      const falls = gravity(cells, rng);
      frames.push(cloneCells(cells));
      steps.push({
        combo, coef, cleared, colorCounts, gained, iceCleared: iceThis, bonus,
        specials: newSpecials.map(s => ({ idx: s.idx, type: s.type })),
        offsets: falls.offsets, spawned: falls.spawned
      });
    }

    // FR-05：结算后若无可行交换，自动洗牌
    if (!hasPossibleMove(cells, ice)) {
      reshuffled = true;
      if (!shuffleBoard(cells, ice, rng)) {
        const nb = newBoard(rng, 0, 0);
        for (let i = 0; i < cells.length; i++) {
          cells[i] = nb.cells[i];
          if (ice) ice[i] = 0;
        }
      }
      frames.push(cloneCells(cells));
      steps.push({ combo: 0, coef: 0, cleared: [], colorCounts: new Array(NUM_COLORS).fill(0), gained: 0, iceCleared: 0, bonus: 0, specials: [], offsets: new Array(cells.length).fill(0), spawned: [], reshuffled: true });
    }
    return { steps, frames, total, iceCleared, colorCounts: totalCounts, reshuffled };
  }

  /** 结算"已经完成交换"的棋盘。
   *  调用方须保证 cells 已处于交换后的状态；本函数不再交换、也不回弹，
   *  返回 valid:false 时由调用方把棋盘换回去。
   *  界面层为播放交换动画会先把棋盘换位，因此必须走这条路径——
   *  早期界面层误用 playMove（内部会再交换一次，等于把棋盘换回去），
   *  导致每次交换都被判为"未形成三连"而静默失效。 */
  function resolveSwapped(cells, ice, rng, a, b) {
    const res = { valid: false, gained: 0, iceCleared: 0, steps: [], frames: [] };
    const rainbow = (cells[a].t === T_RAINBOW) ? a : ((cells[b].t === T_RAINBOW) ? b : null);
    if (findGroups(cells).length === 0 && rainbow == null) return res;
    const r = resolve(cells, ice, rng, { swapPair: [a, b], seedTrigger: rainbow });
    res.valid = true;
    res.gained = r.total;
    res.iceCleared = r.iceCleared;
    res.colorCounts = r.colorCounts;
    res.steps = r.steps;
    res.frames = r.frames;
    res.reshuffled = r.reshuffled;
    return res;
  }

  /** 完整走一手棋：交换 + 结算；非法交换返回 valid:false 且不改动棋盘 */
  function playMove(cells, ice, rng, a, b) {
    const empty = { valid: false, gained: 0, iceCleared: 0, steps: [], frames: [] };
    if (!canSwap(cells, ice, a, b)) return empty;
    swapCells(cells, a, b);
    const r = resolveSwapped(cells, ice, rng, a, b);
    if (!r.valid) { swapCells(cells, a, b); return empty; }   // FR-02：无效交换回弹，不消耗步数
    return r;
  }

  /* ---------- 关卡配置 BR-1 ~ BR-3 ----------
   * 三段难度曲线集中在此定义；buildLevels(over) 可用 overrides 覆盖，
   * 供 tools/tune*.html 用贪心求解器搜索"可解且难度递增"的实际数值。
   *
   * 星级阈值（由 tools/calib3.html 用 60 次模拟实测"完成时剩余步数"分布标定）：
   *   targetFrom/Step 通关分数线（达成全部目标即通关，不再与星级绑定）
   *   keep2From/Step  完成时剩余步数 ≥ keep2 → 2★（≈ 剩余步数 p35）
   *   keep3From/Step  完成时剩余步数 ≥ keep3 → 3★（≈ 剩余步数 p70）
   * 星级曾按"得分档位"评定，但各关得分分布差异大（同一关不同棋盘可差 15%~20%，且部分关卡重尾），
   * 得分档位既难标定又对玩家不透明（实测一度出现 29/30 关的 3★ 线不可获得）。
   * 改为按剩余步数评定后规则透明（"剩得越多星越高"），且不依赖得分分布（README D-17）。
   */
  /* 通关分数线沿用 BR-1~BR-3 的原有数值（只作"地板"，保证通关即可拿 1★）；
   * 星级线按实测分布标定，需同时满足两条约束：
   *   ① 可达到：2★ ≈ 0.9×p35、3★ ≈ 0.9×p80，并对同一关卡不同棋盘的得分差异（实测可达 15%~20%）留余量；
   *   ② 有区分度：2★ 线必须显著高于通关线（≥1.12×），3★ 线 ≥1.2× 2★ 线，
   *      否则"一通关就 2★"，或 2★/3★ 线交叉（两者都会让星级失去意义）。
   * 取两条约束下界的较大者后线性拟合得到下列系数。 */
  const SEG1 = { movesFrom: 20, movesTo: 15, targetFrom: 1000, targetStep: 250,
                 keep2From: 12.6, keep2Step: -2.1, keep3From: 15.8, keep3Step: -2.0 };
  const SEG2 = { movesFrom: 20, movesTo: 16, iceFrom: 3, iceTo: 10, dbl: 0,
                 targetFrom: 1300, targetStep: 80, collectFrom: 10, collectStep: 0.8,
                 keep2From: 11.6, keep2Step: -0.8, keep3From: 14.2, keep3Step: -0.7 };
  const SEG3 = { movesFrom: 25, movesTo: 21, iceFrom: 7, iceTo: 10, dbl: 0.15,
                 targetFrom: 1900, targetStep: 30, collectFrom: 12, collectStep: 0.7,
                 keep2From: 9.4, keep2Step: -0.3, keep3From: 14.0, keep3Step: -0.4 };

  const lerpInt = (a, b, t) => Math.round(a + (b - a) * t);
  const line = (from, step, k) => Math.round(from + step * k);

  function buildLevels(over) {
    over = over || {};
    const s1 = Object.assign({}, SEG1, over.seg1);
    const s2 = Object.assign({}, SEG2, over.seg2);
    const s3 = Object.assign({}, SEG3, over.seg3);
    const levels = [];
    for (let i = 1; i <= 30; i++) {
      let moves, goal, keep2, keep3, ice = 0, doubleRatio = 0;
      const goals = [];
      if (i <= 5) {                              // BR-1 仅分数目标（打满步数后按总分评定，见 FR-09）
        const k = i - 1, t = k / 4;
        moves = lerpInt(s1.movesFrom, s1.movesTo, t);
        goal = line(s1.targetFrom, s1.targetStep, k);
        keep2 = Math.max(1, line(s1.keep2From, s1.keep2Step, k));
        keep3 = Math.max(keep2 + 1, line(s1.keep3From, s1.keep3Step, k));
        goals.push({ type: 'score', amount: goal });
      } else if (i <= 15) {                      // BR-2 分数 + 收集目标 + 单层冰
        const k = i - 6, t = k / 9;
        moves = lerpInt(s2.movesFrom, s2.movesTo, t);
        ice = lerpInt(s2.iceFrom, s2.iceTo, t);
        doubleRatio = s2.dbl;
        goal = line(s2.targetFrom, s2.targetStep, k);
        keep2 = Math.max(1, line(s2.keep2From, s2.keep2Step, k));
        keep3 = Math.max(keep2 + 1, line(s2.keep3From, s2.keep3Step, k));
        goals.push({ type: 'score', amount: goal });
        goals.push({ type: 'collect', color: k % NUM_COLORS, amount: Math.round(s2.collectFrom + k * s2.collectStep) });
      } else {                                   // BR-3 分数 + 收集 + 冰块，含双层冰
        const k = i - 16, t = k / 14;
        moves = lerpInt(s3.movesFrom, s3.movesTo, t);
        ice = lerpInt(s3.iceFrom, s3.iceTo, t);
        doubleRatio = s3.dbl;
        goal = line(s3.targetFrom, s3.targetStep, k);
        keep2 = Math.max(1, line(s3.keep2From, s3.keep2Step, k));
        keep3 = Math.max(keep2 + 1, line(s3.keep3From, s3.keep3Step, k));
        goals.push({ type: 'score', amount: goal });
        goals.push({ type: 'collect', color: (k + 1) % NUM_COLORS, amount: Math.round(s3.collectFrom + k * s3.collectStep) });
        goals.push({ type: 'ice', amount: ice });
      }
      levels.push({
        id: i, moves, ice, doubleRatio, goals,
        targetScore: goal,                        // 通关分数线（达成全部目标即通关）
        keep2: keep2,                             // 完成时剩余步数 ≥ keep2 → 2★
        keep3: keep3                              // 完成时剩余步数 ≥ keep3 → 3★
      });
    }
    return levels;
  }
  const LEVELS = buildLevels();

  /** 是否只有分数目标：这类关卡打满全部步数后才结算。
   *  否则一达到分数线就结束，最终得分被锁死在分数线附近，星级永远只有 1 星（README D-12）。 */
  function isScoreOnly(level) {
    return level.goals.every(g => g.type === 'score');
  }

  /** 星级按"完成时剩余步数"评定（FR-09）：
   *  3★：剩余 ≥ keep3；2★：剩余 ≥ keep2；1★：达成目标但用步较多。
   *  用剩余步数而非得分档位：规则对玩家透明（"剩得越多星越高"），
   *  且不受各关得分分布差异（实测同一关不同棋盘可差 15%~20%）影响。 */
  function starsByMoves(level, movesLeft) {
    if (movesLeft >= level.keep3) return 3;
    if (movesLeft >= level.keep2) return 2;
    return 1;
  }

  /** 目标进度：state = {score, collected:{color:count}, iceCleared} */
  function goalProgress(level, state) {
    return level.goals.map(g => {
      if (g.type === 'score') return { goal: g, cur: state.score, need: g.amount, done: state.score >= g.amount };
      if (g.type === 'collect') {
        const cur = (state.collected && state.collected[g.color]) || 0;
        return { goal: g, cur, need: g.amount, done: cur >= g.amount };
      }
      return { goal: g, cur: state.iceCleared || 0, need: g.amount, done: (state.iceCleared || 0) >= g.amount };
    });
  }
  function allGoalsMet(level, state) { return goalProgress(level, state).every(p => p.done); }

  /* ---------- 生命恢复（FR-13，含时钟回拨处理） ---------- */
  /**
   * @returns {lives, updatedAt(ms)} —— 以存档时间戳为锚点计算，时钟回拨时不减少也不惩罚
   */
  function refreshLives(lives, updatedAtMs, nowMs) {
    if (lives >= LIVES_MAX) return { lives: LIVES_MAX, updatedAt: nowMs };
    let elapsed = nowMs - updatedAtMs;
    if (!isFinite(elapsed) || elapsed < 0) elapsed = 0;        // 时钟被回拨：不恢复也不惩罚
    const gained = Math.floor(elapsed / LIVES_REGEN_MS);
    if (gained <= 0) return { lives, updatedAt: updatedAtMs };
    const next = Math.min(LIVES_MAX, lives + gained);
    const anchor = next >= LIVES_MAX ? nowMs : updatedAtMs + gained * LIVES_REGEN_MS;
    return { lives: next, updatedAt: anchor };
  }

  return {
    ROWS, COLS, NUM_COLORS, T_NORMAL, T_BOMB, T_RAINBOW, SCORE,
    LIVES_MAX, LIVES_REGEN_MS, ITEM_PRICE, COIN_REWARD,
    SEG1, SEG2, SEG3,
    idx, rowOf, colOf, inBounds, makeRng, randInt, shuffleArray, cloneCells,
    areAdjacent, swapCells, canSwap, swapMakesMatch, findGroups, findRuns,
    hasPossibleMove, shuffleBoard, newBoard, gravity, resolve, resolveSwapped, playMove,
    buildLevels, LEVELS, starsByMoves, goalProgress, allGoalsMet, refreshLives
  };
});

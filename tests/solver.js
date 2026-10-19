/* 星消乐 — 目标导向贪心求解器 (tests/solver.js)
 * 作用：模拟"普通玩家"（只看一步的直接收益 + 追踪未完成的目标，不做多步规划），
 *       用于验证 BR-4「每关随机模拟中至少 60% 可在限定步数内通关」。
 *
 * 两阶段决策：
 *   1) 廉价筛选：对每个合法交换只算"直接匹配"的收益，取前 TOP_K 名（不做掉落模拟，快）
 *   2) 完整模拟：对前 TOP_K 名用真实规则 playMove 模拟连锁后的真实收益，选最优后落子
 *
 * 双端共用：Node require('./solver.js') / 浏览器 window.GemzSolver
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../game/logic.js'));
  else root.GemzSolver = factory(root.GemzLogic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  const TOP_K = 6;
  const W = { perGem: 10, collect: 80, ice: 200 };   // 未完成目标的权重（已完成的目标权重归零，模拟玩家转向下一个目标）

  const deep = cells => cells.map(x => (x ? { c: x.c, t: x.t } : null));

  /** 当前仍未完成的目标权重 */
  function weights(level, state) {
    const w = { colors: [], ice: 0, score: 0 };
    for (const g of level.goals) {
      if (g.type === 'collect' && ((state.collected && state.collected[g.color]) || 0) < g.amount) w.colors.push(g.color);
      else if (g.type === 'ice' && (state.iceCleared || 0) < g.amount) w.ice = W.ice;
      else if (g.type === 'score' && state.score < g.amount) w.score = 1;
    }
    return w;
  }

  /** 一次交换的收益估值；已在 trial 上完成交换，调用方负责还原 */
  function scoreSwap(trial, ice, a, b, w) {
    const rainbow = trial[a].t === L.T_RAINBOW || trial[b].t === L.T_RAINBOW;
    const groups = L.findGroups(trial);
    if (!groups.length && !rainbow) return null;
    let cleared = 0, hits = 0, iceHit = 0, bonus = 0;
    for (const g of groups) for (const i of g.cells) {
      cleared++;
      if (w.colors.indexOf(trial[i].c) >= 0) hits++;
      if (ice && ice[i] > 0) iceHit++;
      if (trial[i].t === L.T_BOMB) bonus += L.SCORE.BOMB;
      else if (trial[i].t === L.T_RAINBOW) bonus += L.SCORE.RAINBOW;
    }
    if (rainbow) { cleared += 8; bonus += L.SCORE.RAINBOW; }   // 彩虹交换至少清空一种颜色，给个下限估计
    return cleared * W.perGem + W.collect * hits + w.ice * iceHit + bonus;
  }

  /** 枚举全部合法交换，返回 {a,b,cheap} 候选列表（按廉价估值降序） */
  function candidates(cells, ice, w) {
    const list = [];
    for (let r = 0; r < L.ROWS; r++) for (let c = 0; c < L.COLS; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const rr = r + dr, cc = c + dc;
        if (rr >= L.ROWS || cc >= L.COLS) continue;
        const a = L.idx(r, c), b = L.idx(rr, cc);
        if (!L.canSwap(cells, ice, a, b)) continue;
        L.swapCells(cells, a, b);
        const value = scoreSwap(cells, ice, a, b, w);
        L.swapCells(cells, a, b);
        if (value != null) list.push({ a, b, cheap: value });
      }
    }
    list.sort((x, y) => y.cheap - x.cheap);
    return list;
  }

  /** 走完一整关；返回 {win, score, stars, movesLeft, plays}
   *  opts.fullBudget = true 时忽略"目标已达成"提前结束，打满全部步数（仅用于对照分析） */
  function solve(level, seed, opts) {
    opts = opts || {};
    const rng = L.makeRng(seed);
    const b = L.newBoard(rng, level.ice, level.doubleRatio);
    const cells = b.cells, ice = b.ice;
    let movesLeft = level.moves, score = 0, iceCleared = 0, plays = 0, guard = 0;
    const collected = {};
    const state = () => ({ score, collected, iceCleared });

    while (movesLeft > 0 && guard++ < 400) {
      if (!opts.fullBudget && L.allGoalsMet(level, state())) break;
      const w = weights(level, state());
      const cands = candidates(cells, ice, w);

      if (!cands.length) { L.shuffleBoard(cells, ice, rng); continue; }

      // 完整模拟前 TOP_K 名，取真实收益最高者
      let best = null;
      const top = cands.slice(0, TOP_K);
      for (let i = 0; i < top.length; i++) {
        const cd = top[i];
        const trial = deep(cells), trialIce = ice.slice();
        const res = L.playMove(trial, trialIce, L.makeRng(seed * 31 + plays * 7 + i), cd.a, cd.b);
        if (!res.valid) continue;
        let hits = 0;
        for (const col of w.colors) hits += res.colorCounts[col];
        const value = res.gained + W.collect * hits + w.ice * res.iceCleared + cd.cheap * 0.1;
        if (!best || value > best.value) best = { a: cd.a, b: cd.b, value };
      }
      if (!best) best = { a: top[0].a, b: top[0].b };

      const res = L.playMove(cells, ice, rng, best.a, best.b);
      if (!res.valid) { guard++; continue; }
      movesLeft--; plays++;
      score += res.gained;
      iceCleared += res.iceCleared;
      for (let k = 0; k < L.NUM_COLORS; k++) collected[k] = (collected[k] || 0) + res.colorCounts[k];
    }
    const won = L.allGoalsMet(level, state());
    return {
      win: won, score, iceCleared, movesLeft, plays,
      stars: won ? L.starsByMoves(level, movesLeft) : 0, collected
    };
  }

  /** 通过率：n 次独立模拟中通关的比例 */
  function passRate(level, n, seedBase) {
    let w = 0;
    for (let i = 0; i < n; i++) {
      if (solve(level, (seedBase || 1000) + level.id * 97 + i * 13).win) w++;
    }
    return w / n;
  }

  return { solve, passRate, W, TOP_K };
});

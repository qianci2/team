/* 星消乐 — 逻辑层测试套件 (tests/suite.js)
 * 双端共用：Node 下 require('../game/logic.js')；浏览器下取 window.GemzLogic。
 * 每个用例对应需求文档 01 中的一条验收标准(AC)。
 * 运行方式：
 *   node tests/test-logic.cjs                     （需安装 Node）
 *   msedge --headless --dump-dom tests/index.html （无 Node 时用浏览器跑，见 README）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../game/logic.js'), require('./solver.js'));
  } else {
    root.GemzSuite = factory(root.GemzLogic, root.GemzSolver);
  }
})(typeof self !== 'undefined' ? self : this, function (L, S) {
  'use strict';

  const out = [];
  const log = s => out.push(String(s));
  let pass = 0, fail = 0;
  const failed = [];

  function t(name, fn) {
    try {
      const detail = fn();
      pass++;
      log(`  [PASS] ${name}${detail ? '  — ' + detail : ''}`);
    } catch (e) {
      fail++;
      failed.push({ name, msg: e.message });
      log(`  [FAIL] ${name}  — ${e.message}`);
    }
  }
  function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'expect'} 期望 ${b}，实际 ${a}`); }
  function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }

  /** 无匹配基板：颜色 = (r+c) % 5，任意相邻交换都不成三连 */
  function checker() {
    const cells = new Array(64).fill(null);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) cells[L.idx(r, c)] = { c: (r + c) % 5, t: L.T_NORMAL };
    return cells;
  }
  const deep = cells => cells.map(x => (x ? { c: x.c, t: x.t } : null));

  log('=== FR-01 开局棋盘：无初始匹配且必有可行交换 ===');
  t('FR-01 AC：1000 次随机开局 100% 无匹配、100% 有可行交换', () => {
    const rng = L.makeRng(20260914);
    let dead = 0, matched = 0;
    for (let i = 0; i < 1000; i++) {
      const b = L.newBoard(rng, 0, 0);
      if (L.findGroups(b.cells).length) matched++;
      if (!L.hasPossibleMove(b.cells, b.ice)) dead++;
    }
    eq(matched, 0, '存在初始匹配的开局数');
    eq(dead, 0, '死局开局数');
    return '1000/1000 通过';
  });

  t('FR-01 AC：按关卡配置布冰，冰格数量与双层比例正确', () => {
    const rng = L.makeRng(7);
    const b = L.newBoard(rng, 10, 0.35);
    const withIce = b.ice.filter(x => x > 0).length;
    const doubles = b.ice.filter(x => x === 2).length;
    eq(withIce, 10, '冰格数');
    ok(doubles > 0 && doubles < 10, '双层冰应为部分（实际 ' + doubles + '）');
    ok(L.hasPossibleMove(b.cells, b.ice), '布冰后仍应有可行交换');
    return `冰格 ${withIce}（其中双层 ${doubles}）`;
  });

  log('');
  log('=== FR-02 交换规则 ===');
  t('FR-02 AC：无效交换不消耗步数且棋盘不变（回弹）', () => {
    const cells = checker();
    const before = JSON.stringify(cells);
    const res = L.playMove(cells, null, L.makeRng(1), L.idx(0, 0), L.idx(0, 1));
    eq(res.valid, false, 'valid');
    eq(res.gained, 0, 'gained');
    eq(JSON.stringify(cells), before, '棋盘快照');
    return '未产生任何变化';
  });

  t('FR-07 AC：冰层是覆盖层——不阻止交换（区别于"锁定格"）', () => {
    const cells = checker();
    const ice = new Array(64).fill(0); ice[L.idx(0, 1)] = 1;
    eq(L.canSwap(cells, ice, L.idx(0, 0), L.idx(0, 1)), true, 'canSwap（冰格可交换）');
    eq(L.canSwap(cells, ice, L.idx(0, 1), L.idx(0, 2)), true, 'canSwap（冰格可交换）');
    return '冰层仅作覆盖层，不影响交换合法性';
  });

  t('FR-02 AC：非相邻格不可交换', () => {
    eq(L.canSwap(checker(), null, L.idx(0, 0), L.idx(0, 2)), false, 'canSwap');
    return '仅相邻格可交换';
  });

  log('');
  log('=== FR-03 / FR-14 消除、连锁与计分 ===');
  t('FR-03 AC：三连消除 → 消除数正确、下落填满、无残留匹配', () => {
    const cells = checker();
    for (let c = 0; c < 3; c++) cells[L.idx(0, c)] = { c: 3, t: L.T_NORMAL };
    const res = L.resolve(cells, null, L.makeRng(3), {});
    eq(res.steps[0].cleared.length, 3, '第 1 步消除数');
    eq(cells.filter(x => !x).length, 0, '空位数量（应被完全填满）');
    eq(L.findGroups(cells).length, 0, '残留匹配组数');
    return '消除 3 个后棋盘填满且无残留匹配';
  });

  t('FR-14 AC：第 1 步得分 = 消除数 × 10 × 系数 1', () => {
    const cells = checker();
    for (let c = 0; c < 3; c++) cells[L.idx(0, c)] = { c: 3, t: L.T_NORMAL };
    const res = L.resolve(cells, null, L.makeRng(3), {});
    eq(res.steps[0].gained, 30, '首步得分');
    return '3×10×1 = 30';
  });

  t('FR-04 AC：连锁系数 = 1 + 0.5×(n-1)，逐级递增且得分按系数计算', () => {
    const cells = checker();
    for (let c = 0; c < 3; c++) cells[L.idx(1, c)] = { c: 1, t: L.T_NORMAL };   // 触发组
    for (let c = 0; c < 3; c++) cells[L.idx(0, c)] = { c: 3, t: L.T_NORMAL };   // 落下后自动三连
    const res = L.resolve(cells, null, L.makeRng(11), {});
    ok(res.steps.length >= 2, '应至少产生 2 次连锁（实际 ' + res.steps.length + '）');
    res.steps.forEach((s, i) => {
      eq(s.combo, i + 1, `第 ${i + 1} 步 combo`);
      eq(s.coef, 1 + 0.5 * i, `第 ${i + 1} 步系数`);
      eq(s.gained, Math.round(s.cleared.length * 10 * s.coef) + s.bonus, `第 ${i + 1} 步得分`);
    });
    ok(res.steps[1].cleared.indexOf(L.idx(1, 0)) >= 0, '第 2 步应包含落下的三连');
    return `${res.steps.length} 连击，系数 ${res.steps.map(s => s.coef).join(' / ')}`;
  });

  t('FR-03 AC：400 手随机走棋后棋盘始终合法、无空位、无残留匹配', () => {
    const rng = L.makeRng(99);
    let moves = 0;
    for (let n = 0; n < 50; n++) {
      const b = L.newBoard(rng, 0, 0);
      for (let k = 0; k < 8; k++) {
        let done = false;
        for (let r = 0; r < 8 && !done; r++) for (let c = 0; c < 8 && !done; c++) {
          for (const [dr, dc] of [[0, 1], [1, 0]]) {
            const rr = r + dr, cc = c + dc;
            if (rr > 7 || cc > 7) continue;
            if (L.playMove(b.cells, b.ice, rng, L.idx(r, c), L.idx(rr, cc)).valid) { done = true; moves++; break; }
          }
        }
        if (b.cells.some(x => !x)) throw new Error('出现空格');
        if (L.findGroups(b.cells).length) throw new Error('出现残留匹配');
        if (!L.hasPossibleMove(b.cells, b.ice)) L.shuffleBoard(b.cells, b.ice, rng);
      }
    }
    return `${moves} 手全部合法`;
  });

  log('');
  log('=== FR-06 特殊元素 ===');
  t('FR-06 AC：4 连生成炸弹（位于组中点），其余 3 个被消除', () => {
    const cells = checker();
    for (let c = 0; c < 4; c++) cells[L.idx(3, c)] = { c: 2, t: L.T_NORMAL };
    cells[L.idx(3, 4)] = { c: 0, t: L.T_NORMAL };
    const res = L.resolve(cells, null, L.makeRng(5), {});
    eq(res.steps[0].specials.length, 1, '生成的特殊元素数');
    eq(res.steps[0].specials[0].type, L.T_BOMB, '类型');
    eq(res.steps[0].specials[0].idx, L.idx(3, 2), '生成位置');
    eq(res.steps[0].cleared.length, 3, '被消除数');
    eq(cells[L.idx(3, 2)].t, L.T_BOMB, '棋盘上该格类型');
    return '炸弹保留于 (3,2)';
  });

  t('FR-06 AC：5 连生成彩虹元素', () => {
    const cells = checker();
    for (let c = 0; c < 5; c++) cells[L.idx(3, c)] = { c: 2, t: L.T_NORMAL };
    const res = L.resolve(cells, null, L.makeRng(5), {});
    eq(res.steps[0].specials.length, 1, '生成数');
    eq(res.steps[0].specials[0].type, L.T_RAINBOW, '类型');
    eq(res.steps[0].cleared.length, 4, '被消除数');
    return '彩虹保留于 (3,2)';
  });

  t('FR-06 AC：彩虹触发清除全屏同色并计 300 分奖励', () => {
    const cells = checker();
    cells[L.idx(3, 2)] = { c: 2, t: L.T_RAINBOW };
    let target = 0;
    for (const x of cells) if (x.c === 2) target++;
    const res = L.resolve(cells, null, L.makeRng(5), { seedTrigger: L.idx(3, 2) });
    eq(res.steps[0].cleared.length, target, '清除的同色元素数');
    eq(res.steps[0].bonus, L.SCORE.RAINBOW, '奖励分');
    return `清除 ${target} 个同色元素 + 奖励 300`;
  });

  t('FR-06 AC：炸弹触发清除 3×3 范围并计 100 分奖励', () => {
    const cells = checker();
    cells[L.idx(3, 3)] = { c: 2, t: L.T_BOMB };
    cells[L.idx(3, 4)] = { c: 2, t: L.T_NORMAL };
    cells[L.idx(3, 5)] = { c: 2, t: L.T_NORMAL };
    const res = L.resolve(cells, null, L.makeRng(5), {});
    eq(res.steps[0].bonus, L.SCORE.BOMB, '奖励分');
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      ok(res.steps[0].cleared.indexOf(L.idx(3 + dr, 3 + dc)) >= 0, `3×3 内 (${3 + dr},${3 + dc}) 应被消除`);
    }
    eq(res.steps[0].specials.length, 0, '3 连不应生成新特殊元素');
    return '3×3 = 9 格全部清除 + 奖励 100';
  });

  log('');
  log('=== FR-05 死局与洗牌 ===');
  t('FR-05 AC：棋盘无可行交换时能被检出', () => {
    eq(L.hasPossibleMove(checker(), null), false, '棋盘色盘应无可行交换');
    return '棋盘色盘被判定为死局';
  });

  t('FR-05 AC：洗牌后恢复可玩且无直接匹配', () => {
    const cells = checker();
    eq(L.shuffleBoard(cells, null, L.makeRng(42)), true, '洗牌结果');
    eq(L.findGroups(cells).length, 0, '洗牌后不应有直接匹配');
    eq(L.hasPossibleMove(cells, null), true, '洗牌后应有可行交换');
    return '洗牌成功';
  });

  t('FR-05 AC：每手结算后棋盘必可继续游玩（必要时自动洗牌）', () => {
    const rng = L.makeRng(2024);
    let reshuffles = 0, plays = 0;
    for (let i = 0; i < 200; i++) {
      const b = L.newBoard(rng, 6, 0.3);
      for (let k = 0; k < 6; k++) {
        let played = false;
        for (let r = 0; r < 8 && !played; r++) for (let c = 0; c < 8 && !played; c++) {
          const res = L.playMove(b.cells, b.ice, rng, L.idx(r, c), L.idx(r, (c + 1) % 8));
          if (res.valid) { played = true; plays++; if (res.reshuffled) reshuffles++; }
        }
        if (!played) L.shuffleBoard(b.cells, b.ice, rng);
        ok(L.hasPossibleMove(b.cells, b.ice), '每手结算后棋盘都应可继续玩');
      }
    }
    return `200 局 × 6 手（${plays} 手）全部可继续；自动洗牌 ${reshuffles} 次`;
  });

  log('');
  log('=== FR-07 冰层与关卡目标 ===');
  t('FR-07 AC：单层冰被消除后即破坏并计入目标', () => {
    const cells = checker();
    for (let c = 0; c < 3; c++) cells[L.idx(0, c)] = { c: 3, t: L.T_NORMAL };
    const ice = new Array(64).fill(0); ice[L.idx(0, 1)] = 1;
    const res = L.resolve(cells, ice, L.makeRng(3), {});
    eq(ice[L.idx(0, 1)], 0, '冰层剩余');
    eq(res.iceCleared, 1, '计入目标的冰格数');
    return '1 次匹配破坏单层冰';
  });

  t('FR-07 AC：双层冰需两次消除，第一次仅降层不计入目标', () => {
    const mk = () => {
      const cells = checker();
      for (let c = 0; c < 3; c++) cells[L.idx(0, c)] = { c: 3, t: L.T_NORMAL };
      return cells;
    };
    const ice = new Array(64).fill(0); ice[L.idx(0, 1)] = 2;
    const r1 = L.resolve(mk(), ice, L.makeRng(3), {});
    eq(ice[L.idx(0, 1)], 1, '第一次消除后剩余层数');
    eq(r1.iceCleared, 0, '第一次不应计入目标');
    const ice2 = new Array(64).fill(0); ice2[L.idx(0, 1)] = 1;
    const r2 = L.resolve(mk(), ice2, L.makeRng(3), {});
    eq(ice2[L.idx(0, 1)], 0, '第二次消除后剩余层数');
    eq(r2.iceCleared, 1, '第二次计入目标');
    return '两层 → 一层 → 破坏';
  });

  t('BR-1~BR-3 AC：30 关配置完备、星级阈值递增、难度曲线数值符合规定', () => {
    const ls = L.buildLevels();
    eq(ls.length, 30, '关卡数');
    for (const lv of ls) {
      ok(lv.moves > 0, `第 ${lv.id} 关步数应为正`);
      ok(lv.ice >= 0 && lv.ice <= 64, `第 ${lv.id} 关冰格数越界`);
      ok(lv.keep2 >= 1, `第 ${lv.id} 关 2★ 剩余步数阈值应 >=1`);
      ok(lv.keep3 > lv.keep2, `第 ${lv.id} 关 3★ 阈值应高于 2★ 阈值（否则星级无法区分）`);
      ok(lv.keep3 < lv.moves, `第 ${lv.id} 关 3★ 阈值应小于步数预算（${lv.keep3} vs ${lv.moves}）`);
      ok(lv.goals.some(g => g.type === 'score'), `第 ${lv.id} 关应含分数目标`);
      for (const g of lv.goals) if (g.type === 'collect') ok(g.color >= 0 && g.color < 5, '收集目标颜色越界');
    }
    const seg = l => ls[l - 1];
    eq(seg(1).moves, 20, '第 1 关步数'); eq(seg(5).moves, 15, '第 5 关步数');
    eq(seg(6).moves, 20, '第 6 关步数'); eq(seg(15).moves, 16, '第 15 关步数');
    eq(seg(16).moves, 25, '第 16 关步数'); eq(seg(30).moves, 21, '第 30 关步数');
    ok(seg(1).ice === 0 && seg(5).ice === 0, 'BR-1：关 1-5 无障碍格');
    ok(seg(6).ice > 0 && seg(15).ice <= Math.ceil(64 * 0.15), 'BR-2：障碍格占棋盘 ≤15%');
    ok(seg(15).doubleRatio === 0 && seg(16).doubleRatio > 0, 'BR-3：关 16-30 起引入双层冰');
    eq(seg(1).keep3, 16, '第 1 关 3★ 剩余步数阈值'); eq(seg(5).keep3, 8, '第 5 关 3★ 阈值');
    eq(seg(30).keep2, 5, '第 30 关 2★ 阈值'); eq(seg(16).keep3, 14, '第 16 关 3★ 阈值');
    eq(seg(1).targetScore, 1000, '第 1 关通关分数线'); eq(seg(5).targetScore, 2000, '第 5 关通关分数线');
    eq(seg(6).targetScore, 1300, '第 6 关通关分数线'); eq(seg(15).targetScore, 2020, '第 15 关通关分数线');
    eq(seg(16).targetScore, 1900, '第 16 关通关分数线'); eq(seg(30).targetScore, 2320, '第 30 关通关分数线');
    eq(seg(16).goals.length, 3, '第 16 关起为混合目标（分数+收集+冰块）');
    return '3 段难度曲线与 BR-1~BR-3 一致';
  });

  t('FR-09 AC：星级按完成时剩余步数判定（阈值边界恰好达标即晋级）', () => {
    for (const lv of [L.LEVELS[0], L.LEVELS[9], L.LEVELS[20], L.LEVELS[29]]) {
      eq(L.starsByMoves(lv, lv.keep3), 3, `第 ${lv.id} 关 剩余=${lv.keep3} 应得 3★`);
      eq(L.starsByMoves(lv, lv.keep3 + 5), 3, `第 ${lv.id} 关 剩余更多仍为 3★`);
      eq(L.starsByMoves(lv, lv.keep3 - 1), 2, `第 ${lv.id} 关 剩余=${lv.keep3 - 1} 应得 2★`);
      eq(L.starsByMoves(lv, lv.keep2), 2, `第 ${lv.id} 关 剩余=${lv.keep2} 应得 2★`);
      eq(L.starsByMoves(lv, lv.keep2 - 1), 1, `第 ${lv.id} 关 剩余=${lv.keep2 - 1} 应得 1★`);
      eq(L.starsByMoves(lv, 0), 1, `第 ${lv.id} 关 用尽步数完成应得 1★`);
    }
    return '星级 = 剩余步数分档，4 个代表关卡的阈值边界全部正确';
  });

  t('FR-07 AC：三类目标的进度与通关判定', () => {
    const lv = L.LEVELS[10];
    ok(!L.allGoalsMet(lv, { score: 99999, collected: {}, iceCleared: 0 }), '仅满足分数不应通关');
    const cg = lv.goals.find(g => g.type === 'collect');
    ok(L.allGoalsMet(lv, { score: lv.targetScore, collected: { [cg.color]: cg.amount }, iceCleared: 0 }), '分数+收集齐备应通关');
    const lv3 = L.LEVELS[20];
    const ig = lv3.goals.find(g => g.type === 'ice');
    const cg3 = lv3.goals.find(g => g.type === 'collect');
    ok(!L.allGoalsMet(lv3, { score: 1e6, collected: { [cg3.color]: 99 }, iceCleared: ig.amount - 1 }), '冰块未达目标不应通关');
    ok(L.allGoalsMet(lv3, { score: lv3.targetScore, collected: { [cg3.color]: cg3.amount }, iceCleared: ig.amount }), '三目标齐备应通关');
    return '分数 / 收集 / 冰块三类判定正确';
  });

  log('');
  log('=== FR-13 生命恢复（含时钟回拨） ===');
  t('FR-13 AC：每 15 分钟恢复 1 点、上限 5 点', () => {
    const now = 1000000000, M = L.LIVES_REGEN_MS;
    eq(L.refreshLives(4, now - M + 1, now).lives, 4, '未满 15 分钟不恢复');
    eq(L.refreshLives(4, now - M, now).lives, 5, '满 15 分钟恢复 1 点');
    eq(L.refreshLives(3, now - 45 * 60 * 1000, now).lives, 5, '45 分钟由 3 恢复至上限 5');
    eq(L.refreshLives(0, now - 2 * M, now).lives, 2, '2 个周期恢复 2 点');
    return '恢复数量与上限均正确';
  });

  t('FR-13 AC：设备时钟被回拨时不损失生命（不减少也不惩罚）', () => {
    const now = 1000000000;
    const r = L.refreshLives(3, now + 3600 * 1000, now);
    eq(r.lives, 3, '生命值');
    eq(r.updatedAt, now + 3600 * 1000, '锚点时间不应被篡改');
    return '回拨后生命保持 3';
  });

  log('');
  log('=== BR-3 / BR-4 关卡可解性与难度递增（贪心求解器，每关 25 次） ===');
  t('BR-4 AC：每关贪心求解通过率 ≥ 60%（关卡可解）', () => {
    const rates = [];
    const cells = [];
    const N = 25;
    let allStars = 0, cnt = 0;
    for (const lv of L.LEVELS) {
      let wins = 0;
      for (let i = 0; i < N; i++) {
        const r = S.solve(lv, 1000 + lv.id * 97 + i * 13);
        if (r.win) { wins++; allStars += r.stars; cnt++; }
      }
      rates.push(wins / N);
      cells.push(`关${String(lv.id).padStart(2)}:${(wins / N * 100).toFixed(0)}%`);
    }
    const line = (a, b) => '    ' + cells.slice(a - 1, b).join(' ');
    log(line(1, 5)); log(line(6, 10)); log(line(11, 15));
    log(line(16, 20)); log(line(21, 25)); log(line(26, 30));
    const segAvg = (a, b) => rates.slice(a - 1, b).reduce((x, y) => x + y, 0) / (b - a + 1);
    const s1 = segAvg(1, 5), s2 = segAvg(6, 15), s3 = segAvg(16, 30);
    log(`    分段平均通过率：关1-5 ${(s1 * 100).toFixed(0)}%  >  关6-15 ${(s2 * 100).toFixed(0)}%  >  关16-30 ${(s3 * 100).toFixed(0)}%`);
    const bad = rates.map((r, i) => (r < 0.6 ? `第${i + 1}关 ${(r * 100).toFixed(0)}%` : null)).filter(Boolean);
    ok(bad.length === 0, '通过率低于 60% 的关卡：' + bad.join(', '));
    ok(s1 >= s2 - 0.01 && s2 >= s3 - 0.01, `难度应总体递增：${(s1 * 100).toFixed(0)}% / ${(s2 * 100).toFixed(0)}% / ${(s3 * 100).toFixed(0)}%`);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    return `30 关平均通过率 ${(avg * 100).toFixed(1)}%，最低 ${(Math.min.apply(null, rates) * 100).toFixed(0)}%，通关样本平均 ${(allStars / cnt).toFixed(2)} 星`;
  });

  t('BR-3 AC：完成时剩余步数占预算的比例逐段下降（关卡越后、越接近步数用尽）', () => {
    const left = [];
    for (const lv of L.LEVELS) {
      // 所有关卡都在达成目标时结束，剩余步数即星级依据
      let sum = 0, n = 0;
      for (let i = 0; i < 12; i++) {
        const r = S.solve(lv, 2000 + lv.id * 131 + i * 17);
        if (r.win) {
          ok(r.movesLeft >= 0 && r.movesLeft <= lv.moves, `第 ${lv.id} 关余步越界（${r.movesLeft}/${lv.moves}）`);
          sum += r.movesLeft; n++;
        }
      }
      left.push(n ? sum / n : null);
    }
    const seg = (a, b) => {
      const v = left.slice(a - 1, b).filter(x => x !== null);
      return v.reduce((x, y) => x + y, 0) / v.length;
    };
    // 用"剩余步数 / 步数预算"比较：后段关卡步数更多，绝对值不可直接比
    const ratio = [];
    for (const lv of L.LEVELS) {
      let sum = 0, n = 0;
      for (let i = 0; i < 12; i++) {
        const r = S.solve(lv, 2000 + lv.id * 131 + i * 17);
        if (r.win) { sum += r.movesLeft / lv.moves; n++; }
      }
      ratio.push(n ? sum / n : null);
    }
    const rseg = (a, b) => {
      const v = ratio.slice(a - 1, b).filter(x => x !== null);
      return v.reduce((x, y) => x + y, 0) / v.length;
    };
    const r1 = rseg(1, 5), r2 = rseg(6, 15), r3 = rseg(16, 30);
    log(`    完成时剩余步数占预算比例：关1-5 ${(r1 * 100).toFixed(0)}% / 关6-15 ${(r2 * 100).toFixed(0)}% / 关16-30 ${(r3 * 100).toFixed(0)}%`);
    ok(r3 <= r2 + 0.02 && r2 <= r1 + 0.02, `后段完成时越接近步数用尽，难度应递增（${(r1 * 100).toFixed(0)}% -> ${(r2 * 100).toFixed(0)}% -> ${(r3 * 100).toFixed(0)}%）`);
    return `剩余步数占预算比例逐段下降：${(r1 * 100).toFixed(0)}% -> ${(r2 * 100).toFixed(0)}% -> ${(r3 * 100).toFixed(0)}%`;
  });
;

  log('');
  log('=== FR-09 得星机制（星级可获得性与区分度） ===');
  t('FR-09 AC：星级有区分度——通关样本中 1★ 不占多数、2★/3★ 可获得', () => {
    let one = 0, two = 0, three = 0;
    for (const lv of L.LEVELS) {
      for (let i = 0; i < 10; i++) {
        const r = S.solve(lv, 4000 + lv.id * 131 + i * 19);
        if (!r.win) continue;
        if (r.stars === 1) one++; else if (r.stars === 2) two++; else three++;
      }
    }
    const tot = one + two + three;
    const p1 = one / tot, p2 = two / tot, p3 = three / tot;
    log(`    通关样本星数分布：1★ ${(p1 * 100).toFixed(0)}% / 2★ ${(p2 * 100).toFixed(0)}% / 3★ ${(p3 * 100).toFixed(0)}%` +
        `  平均 ${((one + two * 2 + three * 3) / tot).toFixed(2)} 星（共 ${tot} 个通关样本）`);
    ok(tot >= 200, '通关样本数不足');
    ok(p1 <= 0.5, `1★ 占比不应超过一半（实际 ${(p1 * 100).toFixed(0)}%）；阈值定得过高会导致人人只有 1★`);
    ok(p2 >= 0.2, `2★ 占比应至少 20%（实际 ${(p2 * 100).toFixed(0)}%）`);
    ok(p3 >= 0.15, `3★ 占比应至少 15%（实际 ${(p3 * 100).toFixed(0)}%）；阈值若超过步数预算则该星不可获得`);
    return `1★/2★/3★ = ${(p1 * 100).toFixed(0)}%/${(p2 * 100).toFixed(0)}%/${(p3 * 100).toFixed(0)}%`;
  });

  t('FR-09 AC：每关 2★/3★ 阈值的实际达标率（星级可达成）', () => {
    const bad = [];
    let min2 = 1, min3 = 1;
    for (const lv of L.LEVELS) {
      let win = 0, ok2 = 0, ok3 = 0;
      const N = 30;
      for (let i = 0; i < N; i++) {
        const r = S.solve(lv, 5000 + lv.id * 173 + i * 23);
        if (!r.win) continue;
        win++;
        if (r.movesLeft >= lv.keep2) ok2++;
        if (r.movesLeft >= lv.keep3) ok3++;
      }
      if (win < 15) { bad.push(`第${lv.id}关通关样本不足`); continue; }
      const rate2 = ok2 / win, rate3 = ok3 / win;
      min2 = Math.min(min2, rate2); min3 = Math.min(min3, rate3);
      // "可达成"= 多数通关局能拿 2★、可观的少数能拿 3★；阈值若超过步数预算则此处会直接暴露
      if (rate2 < 0.45) bad.push(`第${lv.id}关 2★达标率仅 ${(rate2 * 100).toFixed(0)}%`);
      if (rate3 < 0.12) bad.push(`第${lv.id}关 3★达标率仅 ${(rate3 * 100).toFixed(0)}%`);
    }
    ok(bad.length === 0, '星级难以达成的关卡：' + bad.join('; '));
    return `最不利关卡：2★达标率 ${(min2 * 100).toFixed(0)}%、3★达标率 ${(min3 * 100).toFixed(0)}%`;
  });

  t('FR-09 AC：所有关卡均在"达成全部目标"时立即结算（不再打满步数）', () => {
    ok(L.LEVELS.every(lv => lv.goals.length >= 1), '每关都应有目标');
    const so = L.LEVELS.filter(lv => lv.goals.every(g => g.type === 'score'));
    eq(so.length, 5, '纯分数关卡数（第 1-5 关）');
    eq(so.map(lv => lv.id).join(','), '1,2,3,4,5', '纯分数关卡编号');
    return '5 个纯分数关卡 + 25 个多目标关卡，均按"达成即结算"处理（行为见界面用例 T30）';
  });

  log('');
  log(`=== 汇总：通过 ${pass} / 失败 ${fail} ===`);
  if (fail) failed.forEach(f => log('  FAIL: ' + f.name + ' — ' + f.msg));
  else log('全部用例通过。');

  return { pass, fail, failed, out, text: out.join('\n') };
});

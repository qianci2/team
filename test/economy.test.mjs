import test from "node:test";
import assert from "node:assert/strict";

import {
  ITEM_PRICES,
  LIFE_INTERVAL_MS,
  MAX_LIVES,
  REFILL_COST,
  STAR_REWARDS,
  buyItem,
  consumeLife,
  evaluateStars,
  refillLives,
  restoreLives,
  settleCoins,
  settleLevel,
  unlockAfter,
} from "../src/lib/economy.js";
import { defaultLevel } from "../src/lib/levels.js";

const T0 = Date.parse("2026-09-14T10:30:00+08:00");

function makeSave(overrides = {}) {
  return {
    version: 1,
    unlockedLevel: 1,
    stars: {},
    bestScores: {},
    totalScore: 0,
    coins: 0,
    items: { shuffle: 0, hammer: 0, plus5: 0 },
    lives: 5,
    livesUpdatedAt: new Date(T0).toISOString(),
    livesRestored: 0,
    muted: false,
    colorblind: false,
    nickname: "",
    rewardPaidStars: {},
    updatedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

test("BR-07：星级在阈值与阈值 ±1 处判定正确", () => {
  const keep = { keep2: 6, keep3: 11 };
  assert.equal(evaluateStars(12, keep), 3);
  assert.equal(evaluateStars(11, keep), 3);
  assert.equal(evaluateStars(10, keep), 2);
  assert.equal(evaluateStars(6, keep), 2);
  assert.equal(evaluateStars(5, keep), 1);
  assert.equal(evaluateStars(0, keep), 1);
  assert.equal(evaluateStars(12, { keep2: 11, keep3: 11 }), 1);
});

test("FR-23：首通按星级发放，重复通关折半，刷高星级补发差额", () => {
  assert.deepEqual(settleCoins(1, 3, 0), { delta: 120, paidAfter: 3 });
  assert.deepEqual(settleCoins(1, 2, 0), { delta: 80, paidAfter: 2 });
  assert.deepEqual(settleCoins(1, 1, 0), { delta: 50, paidAfter: 1 });

  assert.deepEqual(settleCoins(1, 3, 3), { delta: 60, paidAfter: 3 });
  assert.deepEqual(settleCoins(1, 1, 3), { delta: 25, paidAfter: 3 });
  assert.deepEqual(settleCoins(1, 3, 1), { delta: 70, paidAfter: 3 });
  assert.deepEqual(settleCoins(1, 2, 1), { delta: 30, paidAfter: 2 });

  assert.throws(() => settleCoins(1, 4, 0), RangeError);
  assert.throws(() => settleCoins(0, 1, 0), RangeError);
});

test("道具价格与余额不足时不扣款、不发道具", () => {
  assert.deepEqual(ITEM_PRICES, { shuffle: 100, hammer: 200, plus5: 300 });

  const rich = makeSave({ coins: 250, items: { shuffle: 0, hammer: 0, plus5: 0 } });
  const bought = buyItem(rich, "hammer");
  assert.equal(bought.ok, true);
  assert.equal(bought.save.coins, 50);
  assert.equal(bought.save.items.hammer, 1);

  const poor = makeSave({ coins: 100, items: { shuffle: 1, hammer: 0, plus5: 0 } });
  const failed = buyItem(poor, "hammer");
  assert.equal(failed.ok, false);
  assert.equal(failed.diff, 100);
  assert.equal(failed.save, poor);
  assert.equal(failed.save.coins, 100);
  assert.equal(failed.save.items.hammer, 0);
});

test("FR-14：生命每 15 分钟恢复 1 点，锚点按已恢复次数推进", () => {
  const save = makeSave({ lives: 0, livesRestored: 0 });

  const after15 = restoreLives(save, T0 + LIFE_INTERVAL_MS);
  assert.equal(after15.gained, 1);
  assert.equal(after15.save.lives, 1);
  assert.equal(after15.save.livesRestored, 1);
  assert.equal(Date.parse(after15.save.livesUpdatedAt), T0 + LIFE_INTERVAL_MS);

  const after30 = restoreLives(save, T0 + 2 * LIFE_INTERVAL_MS);
  assert.equal(after30.gained, 2);
  assert.equal(after30.save.lives, 2);

  const after45 = restoreLives(save, T0 + 3 * LIFE_INTERVAL_MS);
  assert.equal(after45.gained, 3);
  assert.equal(after45.save.lives, 3);

  const after10 = restoreLives(save, T0 + 10 * 60 * 1000);
  assert.equal(after10.gained, 0);
  assert.equal(after10.save.lives, 0);
});

test("FR-14 / FM-07：时间回拨不恢复也不惩罚，锚点保持", () => {
  const save = makeSave({ lives: 2, livesRestored: 0 });
  const rolled = restoreLives(save, T0 - 3 * 60 * 60 * 1000);
  assert.equal(rolled.gained, 0);
  assert.equal(rolled.save.lives, 2);
  assert.equal(rolled.save.livesUpdatedAt, save.livesUpdatedAt);
});

test("FR-14 / FM-07：大幅前拨受上限 5 截断，锚点不直接取 now", () => {
  const save = makeSave({ lives: 0, livesRestored: 0 });
  const now = T0 + 10 * 60 * 60 * 1000 + 5 * 60 * 1000;
  const restored = restoreLives(save, now);
  assert.equal(restored.save.lives, MAX_LIVES);
  assert.equal(restored.gained, MAX_LIVES);
  assert.equal(
    Date.parse(restored.save.livesUpdatedAt),
    T0 + 40 * LIFE_INTERVAL_MS,
  );
  assert.notEqual(Date.parse(restored.save.livesUpdatedAt), now);

  const again = restoreLives(restored.save, now);
  assert.equal(again.gained, 0);
  assert.equal(again.save.lives, MAX_LIVES);
});

test("FR-14：生命已满时不囤积恢复次数", () => {
  const save = makeSave({ lives: 5, livesRestored: 0 });
  const later = restoreLives(save, T0 + 2 * LIFE_INTERVAL_MS);
  assert.equal(later.gained, 0);
  assert.equal(later.save.lives, 5);
  assert.equal(later.save.livesRestored, 2);

  const laterAgain = restoreLives(later.save, T0 + 3 * LIFE_INTERVAL_MS);
  assert.equal(laterAgain.gained, 0);
  assert.equal(laterAgain.save.livesRestored, 3);
});

test("FR-14：时间为 0 时 200 金币补满，金币不足时按钮置灰且不改变状态", () => {
  const poor = makeSave({ coins: 100, lives: 0 });
  const failed = refillLives(poor, T0);
  assert.equal(failed.ok, false);
  assert.equal(failed.diff, 100);
  assert.equal(failed.save, poor);

  const rich = makeSave({ coins: 200, lives: 0 });
  const refilled = refillLives(rich, T0);
  assert.equal(refilled.ok, true);
  assert.equal(refilled.save.coins, 0);
  assert.equal(refilled.save.lives, MAX_LIVES);
  assert.equal(refilled.save.livesRestored, 0);
  assert.equal(refilled.save.livesUpdatedAt, new Date(T0).toISOString());

  const full = makeSave({ coins: 500, lives: 5 });
  const fullResult = refillLives(full, T0);
  assert.equal(fullResult.ok, false);
  assert.equal(fullResult.diff, 0);
  assert.equal(fullResult.save.coins, 500);
});

test("失败扣 1 点生命，满生命失败时恢复计时从当前时刻重新开始", () => {
  const full = makeSave({ lives: 5 });
  const after = consumeLife(full, T0 + 1000);
  assert.equal(after.lives, 4);
  assert.equal(after.livesUpdatedAt, new Date(T0 + 1000).toISOString());

  const partial = makeSave({ lives: 3, livesRestored: 1 });
  const afterPartial = consumeLife(partial, T0 + 1000);
  assert.equal(afterPartial.lives, 2);
  assert.equal(afterPartial.livesUpdatedAt, partial.livesUpdatedAt);
  assert.equal(afterPartial.livesRestored, 1);
});

test("FL-02：首通 3★ 发 120，3★ 重玩发 60，1★ 重玩发 25", () => {
  const cfg = defaultLevel(1);
  const result3 = { score: 1500, remainingMoves: cfg.starKeep.keep3 };

  const first = settleLevel(makeSave(), cfg, result3);
  assert.equal(first.stars, 3);
  assert.equal(first.coinDelta, 120);
  assert.equal(first.save.coins, 120);
  assert.equal(first.save.rewardPaidStars[1], 3);
  assert.equal(first.save.stars[1], 3);
  assert.equal(first.save.bestScores[1], 1500);
  assert.equal(first.save.totalScore, 1500);
  assert.equal(first.save.unlockedLevel, 2);

  const replay = settleLevel(first.save, cfg, result3);
  assert.equal(replay.coinDelta, 60);
  assert.equal(replay.save.coins, 180);

  const low = settleLevel(first.save, cfg, { score: 900, remainingMoves: cfg.starKeep.keep2 - 1 });
  assert.equal(low.stars, 1);
  assert.equal(low.coinDelta, 25);
  assert.equal(low.save.stars[1], 3);
  assert.equal(low.save.totalScore, 1500);
});

test("BR-08：首通 1★ 后刷到 3★ 补发 70", () => {
  const cfg = defaultLevel(1);
  const first = settleLevel(makeSave(), cfg, {
    score: 800,
    remainingMoves: cfg.starKeep.keep2 - 1,
  });
  assert.equal(first.stars, 1);
  assert.equal(first.coinDelta, 50);
  assert.equal(first.save.rewardPaidStars[1], 1);

  const upgraded = settleLevel(first.save, cfg, {
    score: 1600,
    remainingMoves: cfg.starKeep.keep3,
  });
  assert.equal(upgraded.stars, 3);
  assert.equal(upgraded.coinDelta, 70);
  assert.equal(upgraded.save.rewardPaidStars[1], 3);
  assert.equal(upgraded.save.coins, 120);
  assert.equal(upgraded.save.stars[1], 3);
  assert.equal(upgraded.save.bestScores[1], 1600);
});

test("FR-17：重玩低分时总积分不下降", () => {
  const cfg = defaultLevel(1);
  const first = settleLevel(makeSave(), cfg, { score: 2000, remainingMoves: 12 });
  const lower = settleLevel(first.save, cfg, { score: 500, remainingMoves: 12 });
  assert.equal(lower.save.bestScores[1], 2000);
  assert.equal(lower.save.totalScore, 2000);
});

test("FR-11：通关解锁下一关，30 关封顶", () => {
  const cfg = defaultLevel(30);
  const cleared = settleLevel(makeSave({ unlockedLevel: 30 }), cfg, {
    score: 3000,
    remainingMoves: cfg.starKeep.keep3,
  });
  assert.equal(cleared.save.unlockedLevel, 30);
});

test("unlockAfter 仅更新解锁与最高星级，不改最高分", () => {
  const save = makeSave({ unlockedLevel: 1, stars: { 4: 3 }, bestScores: { 4: 1000 } });
  const next = unlockAfter(save, 4, 2);
  assert.equal(next.unlockedLevel, 5);
  assert.equal(next.stars[4], 3);
  assert.equal(next.bestScores[4], 1000);
  assert.deepEqual(save.stars, { 4: 3 });
});

test("TC-42：金币不足时补满生命与购买锤子均失败且状态不变", () => {
  const save = makeSave({ coins: 100, lives: 0, items: { shuffle: 0, hammer: 0, plus5: 0 } });

  const refill = refillLives(save, T0);
  assert.equal(refill.ok, false);
  assert.equal(refill.diff, REFILL_COST - 100);
  assert.equal(refill.save.coins, 100);
  assert.equal(refill.save.lives, 0);

  const buy = buyItem(save, "hammer");
  assert.equal(buy.ok, false);
  assert.equal(buy.diff, ITEM_PRICES.hammer - 100);
  assert.equal(buy.save.coins, 100);
  assert.equal(buy.save.items.hammer, 0);
});

test("数值常量与设计基线一致", () => {
  assert.equal(MAX_LIVES, 5);
  assert.equal(LIFE_INTERVAL_MS, 15 * 60 * 1000);
  assert.equal(REFILL_COST, 200);
  assert.deepEqual(STAR_REWARDS, { 1: 50, 2: 80, 3: 120 });
});

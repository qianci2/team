/**
 * M4 经济与进度系统（FR-09~FR-15、FR-23、BR-07~BR-09）。
 *
 * 纯函数：所有时间都作为显式参数（now/锚点）传入，不读系统时钟，
 * 因此 FM-07 的时间篡改场景可以在单测中精确构造。
 */

import { starsPreview } from "./score.js";

export const MAX_LIVES = 5;
export const LIFE_INTERVAL_MS = 15 * 60 * 1000;
export const REFILL_COST = 200;

export const ITEM_PRICES = Object.freeze({
  shuffle: 100,
  hammer: 200,
  plus5: 300,
});

export const STAR_REWARDS = Object.freeze({
  1: 50,
  2: 80,
  3: 120,
});

function iso(ms) {
  return new Date(ms).toISOString();
}

function normalizedStars(stars) {
  return Math.min(3, Math.max(1, Math.trunc(Number(stars) || 1)));
}

/**
 * 星级判定（I-14、BR-07）：剩余步数 ≥ keep3 得 3★，≥ keep2 得 2★，否则 1★。
 * 阈值非法时按 1★ 兜底。
 */
export function evaluateStars(remaining, keep) {
  return starsPreview(remaining, keep);
}

/**
 * 金币结算（I-15、FR-23）。
 *
 * paid 为该关已发放奖励的最高星级（0 表示未发放）。
 * 本局星级更高时补发两档差额；不高于记录时按本局星级奖励的 50% 向下取整。
 */
export function settleCoins(level, stars, paid = 0) {
  if (!Number.isInteger(level) || level < 1 || level > 30) {
    throw new RangeError(`关卡号必须在 1–30 之间：${level}`);
  }
  if (![1, 2, 3].includes(stars)) {
    throw new RangeError(`星级必须是 1、2 或 3：${stars}`);
  }
  if (![0, 1, 2, 3].includes(paid)) {
    throw new RangeError(`已发放星级必须是 0–3：${paid}`);
  }

  if (stars > paid) {
    const base = paid === 0 ? 0 : STAR_REWARDS[paid];
    return { delta: STAR_REWARDS[stars] - base, paidAfter: stars };
  }

  return { delta: Math.floor(STAR_REWARDS[stars] / 2), paidAfter: paid };
}

function copyMap(map) {
  return { ...(map ?? {}) };
}

function copyItems(items) {
  return {
    shuffle: Math.max(0, Math.trunc(items?.shuffle ?? 0)),
    hammer: Math.max(0, Math.trunc(items?.hammer ?? 0)),
    plus5: Math.max(0, Math.trunc(items?.plus5 ?? 0)),
  };
}

function sumBestScores(bestScores) {
  return Object.values(bestScores ?? {}).reduce(
    (sum, score) => sum + (Number.isFinite(score) ? Math.max(0, Math.trunc(score)) : 0),
    0,
  );
}

/**
 * 通关后的进度更新（FR-09、FR-11、FR-17）：
 * 星级取历史最高、最高分取较大值、总积分按最高分重算、首次通关解锁下一关。
 */
export function recordResult(save, { level, stars, score }) {
  const star = normalizedStars(stars);
  const starsMap = copyMap(save.stars);
  const bestScores = copyMap(save.bestScores);

  starsMap[level] = Math.max(starsMap[level] ?? 0, star);
  bestScores[level] = Math.max(bestScores[level] ?? 0, Math.max(0, Math.trunc(score)));

  return {
    ...save,
    stars: starsMap,
    bestScores,
    totalScore: sumBestScores(bestScores),
    unlockedLevel: Math.min(30, Math.max(save.unlockedLevel ?? 1, level + 1)),
  };
}

/** 仅处理解锁与星级（I-19）；分数更新由 recordResult 承担。 */
export function unlockAfter(save, level, stars) {
  if (!Number.isInteger(level) || level < 1 || level > 30) return save;
  const star = normalizedStars(stars);
  if (star < 1) return save;
  return {
    ...save,
    stars: { ...(save.stars ?? {}), [level]: Math.max(save.stars?.[level] ?? 0, star) },
    unlockedLevel: Math.min(30, Math.max(save.unlockedLevel ?? 1, level + 1)),
  };
}

/** 购买道具（I-16、FR-23、FM-14）；余额不足时不扣款、不改库存。 */
export function buyItem(save, kind) {
  const price = ITEM_PRICES[kind];
  if (!price) {
    throw new RangeError(`未知道具：${kind}`);
  }
  const coins = Math.max(0, Math.trunc(save.coins ?? 0));
  if (coins < price) {
    return { ok: false, save, diff: price - coins, reason: "insufficient" };
  }

  return {
    ok: true,
    diff: 0,
    save: {
      ...save,
      coins: coins - price,
      items: { ...copyItems(save.items), [kind]: (save.items?.[kind] ?? 0) + 1 },
    },
  };
}

/**
 * 生命恢复推算（I-17、FR-14、FM-07）。
 *
 * elapsed = max(0, now − anchor)；gained = ⌊elapsed / 15min⌋ − livesRestored；
 * 锚点按 "anchor + gained × 15min" 推进，不直接取 now。
 * 生命已满时不累积恢复次数，避免离线/前拨时间囤积生命。
 */
export function restoreLives(save, now, { intervalMs = LIFE_INTERVAL_MS, maxLives = MAX_LIVES } = {}) {
  if (!Number.isFinite(now)) {
    throw new TypeError("now 必须是毫秒时间戳");
  }

  const anchor = Date.parse(save.livesUpdatedAt);
  const currentLives = Math.min(maxLives, Math.max(0, Math.trunc(save.lives ?? maxLives)));
  const restored = Math.max(0, Math.min(maxLives, Math.trunc(save.livesRestored ?? 0)));

  if (!Number.isFinite(anchor)) {
    return { save, gained: 0, error: "invalid-anchor" };
  }

  const elapsed = Math.max(0, now - anchor);
  const intervals = Math.floor(elapsed / intervalMs);

  if (currentLives >= maxLives) {
    const credited = Math.min(maxLives, Math.max(0, intervals));
    let nextAnchor = anchor;
    if (intervals > maxLives) {
      nextAnchor = anchor + (intervals - maxLives) * intervalMs;
    }
    return {
      save: {
        ...save,
        livesRestored: credited,
        livesUpdatedAt: iso(nextAnchor),
      },
      gained: 0,
    };
  }

  const gained = Math.max(0, intervals - restored);
  if (gained === 0) {
    return { save, gained: 0 };
  }

  const lives = Math.min(maxLives, currentLives + gained);
  return {
    save: {
      ...save,
      lives,
      livesRestored: Math.min(maxLives, restored + gained),
      livesUpdatedAt: iso(anchor + gained * intervalMs),
    },
    gained: lives - currentLives,
  };
}

/** 200 金币补满生命（I-18、FR-14、FM-14）。 */
export function refillLives(save, now) {
  if (!Number.isFinite(now)) {
    throw new TypeError("now 必须是毫秒时间戳");
  }
  const lives = Math.min(MAX_LIVES, Math.max(0, Math.trunc(save.lives ?? MAX_LIVES)));
  if (lives >= MAX_LIVES) {
    return { ok: false, save, diff: 0, reason: "full" };
  }

  const coins = Math.max(0, Math.trunc(save.coins ?? 0));
  if (coins < REFILL_COST) {
    return { ok: false, save, diff: REFILL_COST - coins, reason: "insufficient" };
  }

  return {
    ok: true,
    diff: 0,
    save: {
      ...save,
      coins: coins - REFILL_COST,
      lives: MAX_LIVES,
      livesUpdatedAt: iso(now),
      livesRestored: 0,
    },
  };
}

/** 关卡失败扣 1 点生命（FR-08、BR-09）；满生命失败时重新开始计时。 */
export function consumeLife(save, now) {
  if (!Number.isFinite(now)) {
    throw new TypeError("now 必须是毫秒时间戳");
  }
  const before = Math.min(MAX_LIVES, Math.max(0, Math.trunc(save.lives ?? MAX_LIVES)));
  const lives = Math.max(0, before - 1);
  if (before >= MAX_LIVES) {
    return {
      ...save,
      lives,
      livesUpdatedAt: iso(now),
      livesRestored: 0,
    };
  }
  return { ...save, lives };
}

/**
 * 一局通关的完整结算（FL-02）：星级 → 金币 → 星级/最高分/解锁。
 *
 * @param {object} save DS-1 存档
 * @param {object} cfg 关卡配置（使用 starKeep）
 * @param {{score:number, remainingMoves:number}} result 终态载荷
 */
export function settleLevel(save, cfg, result) {
  const stars = evaluateStars(result.remainingMoves, cfg.starKeep);
  const level = cfg.level;
  const paid = Math.min(3, Math.max(0, Math.trunc(save.rewardPaidStars?.[level] ?? 0)));
  const { delta, paidAfter } = settleCoins(level, stars, paid);

  const next = recordResult(save, { level, stars, score: result.score });
  return {
    save: {
      ...next,
      coins: Math.max(0, Math.trunc(next.coins ?? 0)) + delta,
      rewardPaidStars: { ...(next.rewardPaidStars ?? {}), [level]: paidAfter },
    },
    stars,
    previousBestStars: save.stars?.[level] ?? 0,
    coinDelta: delta,
  };
}

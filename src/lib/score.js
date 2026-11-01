/**
 * M2 计分系统（FR-04、FR-16、NFR-08）。
 *
 * 纯函数：输入一批消除的计数，输出可追溯的得分明细。
 * 本模块只提供理论上限常量，不拦截超限分数（拦截在提交链路上）。
 */

export const CHAIN_LIMIT = 8;
export const CHAIN_FACTOR_MAX = 4.5;
export const BOMB_BONUS = 100;
export const RAINBOW_BONUS = 300;

const TILE_SCORE = 10;
const TILE_COUNT = 64;
/** 单批特殊奖励上限（炸弹 100 × 6 或彩虹 300 × 2 的等价值），见 K-07。 */
export const MAX_SPECIAL_BONUS = 600;

/** 单步理论上限：64 格 × 10 分 × 4.5 + 600（NFR-08）。 */
export const S_MAX = TILE_COUNT * TILE_SCORE * CHAIN_FACTOR_MAX + MAX_SPECIAL_BONUS;
/** 总积分硬上限：ΣM(n) = 615，615 × 3480（设计文档 K-03）。 */
export const TOTAL_MAX = 615 * S_MAX;

function clampChain(chain) {
  if (!Number.isFinite(chain)) return 1;
  return Math.min(CHAIN_LIMIT, Math.max(1, Math.trunc(chain)));
}

function nonNegativeInt(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/** 第 n 次连锁的得分系数：1 + 0.5 × (n − 1)，n 钳在 1..8。 */
export function chainFactor(chain) {
  return 1 + 0.5 * (clampChain(chain) - 1);
}

/**
 * 计算一批消除的得分。
 *
 * @param {{chain:number, clearedCount:number, bombsTriggered:number, rainbowsTriggered:number}} event
 * @param {number} prevTotal 本步之前的累计分
 * @returns {{base:number, chainFactor:number, specialBonus:number, stepTotal:number, runTotal:number}}
 */
export function scoreEvent(event, prevTotal = 0) {
  const chain = clampChain(event.chain);
  const factor = chainFactor(chain);
  const clearedCount = nonNegativeInt(event.clearedCount);
  const base = clearedCount * TILE_SCORE;
  const rawSpecialBonus =
    nonNegativeInt(event.bombsTriggered) * BOMB_BONUS +
    nonNegativeInt(event.rainbowsTriggered) * RAINBOW_BONUS;
  // K-07：单批特殊奖励钳到 600，保证 stepTotal ≤ S_MAX（NFR-08 的不变量）。
  const specialBonus = Math.min(MAX_SPECIAL_BONUS, rawSpecialBonus);
  const stepTotal = Math.round(base * factor) + specialBonus;
  const runTotal = nonNegativeInt(prevTotal) + stepTotal;

  return { base, chainFactor: factor, specialBonus, stepTotal, runTotal };
}

/**
 * 局内星级预告（FR-10、I-08）。
 *
 * 剩余步数达到 keep3 得 3★，达到 keep2 得 2★，否则 1★。
 * 阈值非法时按 1★ 兜底（启动期配置校验已拦截，这里只做运行期兜底）。
 */
export function starsPreview(remaining, keep) {
  const keep2 = keep?.keep2;
  const keep3 = keep?.keep3;
  if (
    !Number.isInteger(remaining) ||
    !Number.isInteger(keep2) ||
    !Number.isInteger(keep3) ||
    keep2 < 0 ||
    keep2 >= keep3
  ) {
    return 1;
  }
  if (remaining >= keep3) return 3;
  if (remaining >= keep2) return 2;
  return 1;
}

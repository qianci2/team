/**
 * 可注入种子的伪随机数发生器（M12）。
 *
 * 相同种子产生相同序列，便于测试、关卡标定与问题复现。
 * 领域层不直接使用 Math.random，所有随机性都从这里注入。
 */

export function createRng(seed = 1) {
  let state = Number(seed) >>> 0;
  if (state === 0) state = 1;

  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng, maxExclusive) {
  if (typeof rng !== "function") {
    throw new TypeError("rng 必须是函数");
  }
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError("maxExclusive 必须是正整数");
  }
  return Math.floor(rng() * maxExclusive);
}

export function pick(rng, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RangeError("items 必须是非空数组");
  }
  return items[randInt(rng, items.length)];
}

export function shuffle(rng, items) {
  if (!Array.isArray(items)) {
    throw new TypeError("items 必须是数组");
  }
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

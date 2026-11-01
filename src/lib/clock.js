/**
 * 时钟抽象（M12）。
 *
 * 业务代码不直接读 Date.now，测试与求解器可以注入假时钟，
 * 从而复现生命恢复、限时与写盘节流等时间相关行为。
 */

export function createClock(nowFn = () => Date.now()) {
  if (typeof nowFn !== "function") {
    throw new TypeError("nowFn 必须是函数");
  }
  return Object.freeze({ now: () => nowFn() });
}

export function systemClock() {
  return createClock();
}

export function createFakeClock(start = 0) {
  let current = Number(start);
  if (!Number.isFinite(current)) {
    throw new TypeError("start 必须是有限数字");
  }

  return {
    now: () => current,
    advance(ms) {
      if (!Number.isFinite(ms)) {
        throw new TypeError("ms 必须是有限数字");
      }
      current += ms;
      return current;
    },
    set(ms) {
      if (!Number.isFinite(ms)) {
        throw new TypeError("ms 必须是有限数字");
      }
      current = ms;
      return current;
    },
  };
}

/**
 * 分级日志（M12）。
 *
 * 默认输出到 console；测试与降级场景可以注入 sink 与时钟，
 * 避免业务模块直接依赖全局 console。
 */

export const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

const CONSOLE_METHOD = {
  debug: "log",
  info: "log",
  warn: "warn",
  error: "error",
};

export function createLogger({ level = "info", sink = null, clock = null } = {}) {
  const threshold = LOG_LEVELS[level];
  if (threshold === undefined) {
    throw new RangeError(`未知日志级别：${level}`);
  }

  const write = (name, args) => {
    if (LOG_LEVELS[name] < threshold) return;
    const entry = {
      level: name,
      time: clock ? clock.now() : undefined,
      args,
    };
    if (sink) {
      sink(entry);
      return;
    }
    const method = CONSOLE_METHOD[name] || "log";
    console[method](...args);
  };

  return {
    debug: (...args) => write("debug", args),
    info: (...args) => write("info", args),
    warn: (...args) => write("warn", args),
    error: (...args) => write("error", args),
  };
}

export function createSilentLogger() {
  return createLogger({ level: "silent", sink: () => {} });
}

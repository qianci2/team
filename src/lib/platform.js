/**
 * M12 平台适配与工具的统一出口。
 *
 * 领域层只从这里取随机数、时钟与日志，不直接访问宿主环境。
 */

export { createRng, randInt, pick, shuffle } from "./random.js";
export { createClock, systemClock, createFakeClock } from "./clock.js";
export { createLogger, createSilentLogger, LOG_LEVELS } from "./logger.js";

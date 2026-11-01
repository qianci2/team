/**
 * 应用启动装配（M5 入口）。
 *
 * 只负责把 M11/M10/M9/M5 接起来；DOM、Canvas、Web Audio、输入监听由
 * P5 的 M6/M7/M8 通过 `presentation` 注入。这样 P6 可以先用测试替身验证，
 * 也不会把表现层实现藏进应用层。
 */

import { loadLevelsFromUrl } from "./levels-loader.js";
import { createRankClient } from "./rank.js";
import { createSession } from "./session.js";
import { createStore } from "./store.js";

/**
 * @param {{
 *   storage?: Storage,
 *   storageTarget?: EventTarget,
 *   fetchImpl?: Function,
 *   clock?: {now: () => number},
 *   presentation?: object,
 *   rankBaseUrl?: string,
 *   logger?: object,
 *   levels?: object[],
 *   timeoutMs?: number,
 * }} options
 */
export async function bootstrapSession({
  storage = globalThis.localStorage,
  storageTarget = globalThis,
  fetchImpl = globalThis.fetch,
  clock = null,
  presentation = null,
  rankBaseUrl = "",
  logger = null,
  levels = null,
  timeoutMs = 3000,
} = {}) {
  let levelsResult = null;
  let resolvedLevels = levels;
  if (!resolvedLevels) {
    levelsResult = await loadLevelsFromUrl("/src/lib/levels.json", {
      fetchImpl,
      timeoutMs,
      logger,
    });
    resolvedLevels = levelsResult.levels;
  }

  const store = createStore({ storage, clock, logger });
  const rank = createRankClient({
    fetchImpl,
    baseUrl: rankBaseUrl,
    clock,
    saveProvider: () => store.get(),
    logger,
  });
  const session = createSession({
    store,
    rank,
    clock,
    levels: resolvedLevels,
    presentation,
    logger,
  });
  const detachStorage = storageTarget ? store.attachStorage(storageTarget) : () => {};

  return {
    store,
    rank,
    session,
    levels: resolvedLevels,
    levelsReport: levelsResult,
    detachStorage,
    destroy() {
      detachStorage();
      session.destroy();
    },
  };
}

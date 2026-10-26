/**
 * 应用层关卡配置加载器（M5 边界）。
 *
 * M11（src/lib/levels.js）保持纯函数；网络、超时与 AbortController 属于
 * 应用层职责，集中在这里。网络失败、超时、非 2xx 或 JSON 解析失败都回落
 * 内置默认配置，不抛异常（FM-12）。
 */

import { fallbackLevels, loadLevels } from "../lib/levels.js";

/**
 * 从 URL 加载关卡配置（浏览器端入口）。
 *
 * @param {string} url
 * @param {{fetchImpl?: Function, timeoutMs?: number, logger?: object}} options
 */
export async function loadLevelsFromUrl(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = 3000, logger = null } = {},
) {
  if (typeof fetchImpl !== "function") {
    return fallbackLevels("当前环境没有 fetch，已使用内置默认配置", logger);
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response?.ok) {
      return fallbackLevels(`关卡配置请求失败：HTTP ${response?.status}`, logger);
    }
    const text = await response.text();
    return loadLevels(text, { logger });
  } catch (error) {
    return fallbackLevels(`关卡配置加载失败：${error.message}`, logger);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

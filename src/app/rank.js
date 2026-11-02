/**
 * M9 排行榜客户端（I-33~I-35、FL-05）。
 *
 * 远端优先、失败降级为本地兜底空榜。`submit`/`fetch` 永不 reject：
 * 网络、超时、业务错误码都转为结构化结果，调用方（M5）不需要 try/catch。
 */

import { TOTAL_MAX } from "../lib/score.js";
import { createRng } from "../lib/random.js";
import { isValidNickname } from "./save-schema.js";

export const RANK_TIMEOUT_MS = 3000;
export const RANK_LIMIT = 100;
export const NICKNAME_MESSAGE = "昵称仅支持 3–12 个中英文、数字或下划线";
export const SCORE_MESSAGE = "分数数据异常，本次成绩未提交";
export const OFFLINE_MESSAGE = "网络不可用，排行榜暂不可用，单机游玩不受影响";
export const SERVER_MESSAGE = "排行榜暂时不可用";

export const NICKNAME_PATTERN = /^[\u4e00-\u9fa5A-Za-z0-9_]{3,12}$/u;

export function validateNickname(nickname) {
  return typeof nickname === "string" && NICKNAME_PATTERN.test(nickname) && isValidNickname(nickname);
}

export function validateScore(totalScore) {
  return Number.isInteger(totalScore) && totalScore >= 0 && totalScore <= TOTAL_MAX;
}

function nowOf(clock) {
  const value = clock?.now?.();
  return Number.isFinite(value) ? value : Date.now();
}

/**
 * 本地兜底榜（I-35）。
 *
 * 默认空榜；只有玩家本次会话成功提交过成绩，才显示自己这一条。
 * 不再生成虚构玩家，避免“打开排行榜就有一百个人”的假数据。
 * `save` 保留在签名里，供后续把“已提交”状态持久化时使用。
 */
export function localBoard(save = {}, rng = createRng(20261026), submitted = null) {
  void save;
  void rng;
  const nickname = submitted?.nickname;
  const totalScore = submitted?.totalScore;
  if (!validateNickname(nickname) || !validateScore(totalScore)) return [];
  return [{ rank: 1, nickname, totalScore, avatar: null, self: true }];
}

function normalizeRemoteList(payload) {
  if (!payload || payload.code !== 0 || !Array.isArray(payload.list)) return null;
  const list = [];
  for (const item of payload.list.slice(0, RANK_LIMIT)) {
    const nickname = item?.nickname;
    const totalScore = item?.totalScore;
    if (!validateNickname(nickname) || !Number.isInteger(totalScore) || totalScore < 0) continue;
    list.push({
      rank: Number.isInteger(item.rank) ? item.rank : list.length + 1,
      nickname,
      totalScore,
      avatar: null,
      self: false,
    });
  }
  list.sort((a, b) => b.totalScore - a.totalScore || a.rank - b.rank);
  return list.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * @param {{
 *   fetchImpl?: Function,
 *   baseUrl?: string,
 *   clock?: {now: () => number},
 *   timeoutMs?: number,
 *   saveProvider?: () => object,
 *   rng?: Function,
 *   logger?: object,
 *   onStatus?: (state: string, detail?: object) => void
 * }} options
 */
export function createRankClient({
  fetchImpl = globalThis.fetch,
  baseUrl = "",
  clock = null,
  timeoutMs = RANK_TIMEOUT_MS,
  saveProvider = () => ({}),
  rng = createRng(20261026),
  logger = null,
  onStatus = () => {},
} = {}) {
  let submitting = null;
  let lastFetchAt = -Infinity;
  let lastFetch = null;
  let submittedEntry = null;

  async function requestJson(path, init) {
    if (typeof fetchImpl !== "function") {
      return { ok: false, code: "offline", message: OFFLINE_MESSAGE };
    }
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response?.ok) {
        return { ok: false, code: "error", message: SERVER_MESSAGE, status: response?.status };
      }
      const payload = await response.json();
      return { ok: true, payload };
    } catch (error) {
      logger?.warn?.("排行榜请求失败，已降级", error);
      return { ok: false, code: "offline", message: OFFLINE_MESSAGE };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function submit(entry) {
    const nickname = entry?.nickname;
    const totalScore = entry?.totalScore;
    if (!validateNickname(nickname)) {
      return { ok: false, code: 1001, message: NICKNAME_MESSAGE };
    }
    if (!validateScore(totalScore)) {
      return { ok: false, code: 1002, message: SCORE_MESSAGE };
    }
    if (submitting) {
      return { ok: false, code: "busy", message: "提交中，请稍候" };
    }

    submitting = (async () => {
      onStatus("submitting");
      const result = await requestJson("/api/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname, totalScore }),
      });
      if (!result.ok) {
        onStatus("degraded", result);
        return result;
      }
      const payload = result.payload;
      if (payload?.code === 0 && Number.isInteger(payload.rank)) {
        submittedEntry = { nickname, totalScore };
        lastFetch = null;
        lastFetchAt = -Infinity;
        onStatus("ok", payload);
        return { ok: true, code: 0, rank: payload.rank };
      }
      if (payload?.code === 1001) {
        onStatus("error", payload);
        return { ok: false, code: 1001, message: NICKNAME_MESSAGE };
      }
      if (payload?.code === 1002) {
        onStatus("error", payload);
        return { ok: false, code: 1002, message: SCORE_MESSAGE };
      }
      onStatus("error", payload);
      return {
        ok: false,
        code: payload?.code ?? 5000,
        message: payload?.msg ?? SERVER_MESSAGE,
      };
    })().finally(() => {
      submitting = null;
    });

    return submitting;
  }

  async function fetchBoard(limit = RANK_LIMIT, { force = false } = {}) {
    const safeLimit = Math.min(RANK_LIMIT, Math.max(1, Number.isInteger(limit) ? limit : RANK_LIMIT));
    const now = nowOf(clock);
    if (!force && lastFetch && now - lastFetchAt < 10000) {
      return lastFetch;
    }

    onStatus("submitting");
    const result = await requestJson(`/api/rank?limit=${safeLimit}`, { method: "GET" });
    if (result.ok) {
      const list = normalizeRemoteList(result.payload);
      if (list) {
        lastFetch = { ok: true, source: "remote", list, code: 0 };
        lastFetchAt = now;
        onStatus("ok", { source: "remote" });
        return lastFetch;
      }
    }

    const fallback = {
      ok: false,
      source: "local",
      list: localBoard(saveProvider(), rng, submittedEntry),
      code: result.code ?? "error",
      message: result.message ?? SERVER_MESSAGE,
    };
    lastFetch = fallback;
    lastFetchAt = now;
    onStatus("degraded", fallback);
    return fallback;
  }

  return {
    submit,
    fetch: fetchBoard,
    localBoard: (save = saveProvider()) => localBoard(save, rng, submittedEntry),
    isSubmitting: () => Boolean(submitting),
  };
}

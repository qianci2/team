/**
 * M10 存档与状态仓库（I-21~I-24）。
 *
 * 内存是唯一事实源；localStorage 只是适配器。所有读写都收敛在这里，
 * 上层只看到 `WriteResult`，不处理存储异常（FM-01）。
 */

import {
  SAVE_KEY,
  createDefaultSave,
  deepFreeze,
  exportSave,
  mergeSave,
  normalizeSave,
  parseStoredSave,
  validateSaveImport,
} from "./save-schema.js";

export const WRITE_REASONS = Object.freeze([
  "settle",
  "fail",
  "lives",
  "purchase",
  "item",
  "settings",
  "import",
]);

function safeNow(clock, fallback = Date.now) {
  try {
    const value = clock?.now?.();
    return Number.isFinite(value) ? value : fallback();
  } catch {
    return fallback();
  }
}

function clone(save) {
  return JSON.parse(JSON.stringify(save));
}

function isStorageLike(storage) {
  return Boolean(storage && typeof storage.getItem === "function" && typeof storage.setItem === "function");
}

/**
 * @param {{
 *   storage?: Storage,
 *   key?: string,
 *   clock?: {now: () => number},
 *   logger?: object
 * }} options
 */
export function createStore({
  storage = globalThis.localStorage,
  key = SAVE_KEY,
  clock = null,
  logger = null,
} = {}) {
  const subscribers = new Map();
  let readonly = Boolean(!isStorageLike(storage));
  let status = "ok";
  let lastRaw = null;
  let initialized = false;

  function emit(channel, payload) {
    for (const fn of subscribers.get(channel) ?? []) {
      try {
        fn(payload);
      } catch (error) {
        logger?.warn?.("save subscriber failed", error);
      }
    }
  }

  function readRaw() {
    if (!isStorageLike(storage)) return { ok: false };
    try {
      return { ok: true, value: storage.getItem(key) };
    } catch (error) {
      logger?.warn?.("读取存档失败", error);
      readonly = true;
      return { ok: false };
    }
  }

  function writeRaw(raw) {
    if (readonly || !isStorageLike(storage)) return { ok: false, readonly: true };
    try {
      storage.setItem(key, raw);
      lastRaw = raw;
      return { ok: true };
    } catch (error) {
      logger?.warn?.("写入存档失败，进入不可保存模式", error);
      readonly = true;
      emit("storage:readonly", { reason: "write-failed" });
      return { ok: false, readonly: true };
    }
  }

  function backupCorrupt(raw, now) {
    if (!isStorageLike(storage)) return;
    try {
      storage.setItem(`${key}.corrupt.${now}`, raw);
    } catch (error) {
      logger?.warn?.("备份损坏存档失败", error);
    }
  }

  function initialize() {
    const now = safeNow(clock);
    const read = readRaw();
    if (!read.ok) {
      return { save: createDefaultSave(now), changed: false };
    }
    if (read.value === null || read.value === undefined) {
      return { save: createDefaultSave(now), changed: false };
    }

    lastRaw = read.value;
    const parsed = parseStoredSave(read.value, { now });
    status = parsed.status;
    if (parsed.status === "corrupt") {
      backupCorrupt(read.value, now);
      const save = createDefaultSave(now);
      const raw = JSON.stringify(save);
      if (writeRaw(raw).ok) lastRaw = raw;
      logger?.warn?.("存档已损坏，已备份并重置");
      return { save, changed: true, warning: "存档已损坏，已备份并重置" };
    }
    if (parsed.status === "recovered") {
      logger?.warn?.("存档字段已补齐", parsed.warnings);
    }
    return { save: parsed.save, changed: false };
  }

  const initial = initialize();
  initialized = true;
  let save = initial.save;

  function get() {
    return deepFreeze(clone(save));
  }

  function getStatus() {
    return {
      status,
      readonly,
      key,
      initialized,
      warning: initial.warning ?? null,
    };
  }

  /**
   * 把一次提交叠加到当前内存状态。
   *
   * 普通提交按 FL-04 处理嵌套字段：单调 map 逐项取大、items 按键合并，
   * 避免较旧标签页用整份快照覆盖刚合并进来的外部进度。导入是“整体替换”，
   * 直接使用校验后的存档。
   */
  function applyPatch(current, patch, reason) {
    const rawPatch = typeof patch === "function" ? patch(current) : patch ?? {};
    if (reason === "import") return rawPatch;
    const base = { ...current, ...rawPatch };
    for (const field of ["stars", "bestScores", "rewardPaidStars"]) {
      const merged = { ...(current[field] ?? {}) };
      for (const [key, value] of Object.entries(rawPatch[field] ?? {})) {
        merged[key] = Math.max(merged[key] ?? 0, Number(value) || 0);
      }
      base[field] = merged;
    }
    base.items = { ...(current.items ?? {}), ...(rawPatch.items ?? {}) };
    base.unlockedLevel = Math.max(current.unlockedLevel ?? 1, rawPatch.unlockedLevel ?? 0);
    return base;
  }

  /**
   * 提交变更并同步落盘（I-22）。
   *
   * 写前读取外部存档；若外部 `updatedAt` 更新，先按 FL-04 合并再写。
   * 写失败不抛异常，返回 `{saved:false, mode:'readonly'}`。
   */
  function commit(patch, reason = "settings") {
    const now = safeNow(clock);
    const read = readRaw();
    if (read.ok && typeof read.value === "string" && read.value !== lastRaw) {
      const external = parseStoredSave(read.value, { now });
      if (external.status !== "corrupt") {
        const merged = mergeSave(external.save, save);
        save = merged;
        emit("save:external", { save: get(), merged: true });
      }
    }

    const base = applyPatch(save, patch, reason);
    const baseMs = Date.parse(save.updatedAt);
    const nextMs = Math.max(now, Number.isFinite(baseMs) ? baseMs + 1 : now);
    const normalized = normalizeSave(
      { ...base, updatedAt: new Date(nextMs).toISOString() },
      { now: nextMs },
    );
    save = normalized.save;

    const raw = JSON.stringify(save);
    const written = writeRaw(raw);
    const result = {
      saved: written.ok,
      mode: written.ok ? "sync" : "readonly",
      reason,
      save: get(),
    };
    status = written.ok ? "ok" : "readonly";
    emit("save:changed", result);
    return result;
  }

  function subscribe(channel, fn) {
    if (typeof fn !== "function") throw new TypeError("订阅回调必须是函数");
    if (!subscribers.has(channel)) subscribers.set(channel, new Set());
    subscribers.get(channel).add(fn);
    return () => {
      subscribers.get(channel)?.delete(fn);
    };
  }

  /** 处理 `storage` 事件（I-24）；解析失败时忽略，不覆盖本地。 */
  function mergeExternal(raw) {
    const now = safeNow(clock);
    const parsed = parseStoredSave(raw, { now });
    if (parsed.status === "corrupt") {
      logger?.warn?.("忽略无法解析的外部存档");
      return { merged: false, reason: "corrupt" };
    }
    const externalNewer = Date.parse(parsed.save.updatedAt) > Date.parse(save.updatedAt);
    const merged = externalNewer
      ? mergeSave(parsed.save, save)
      : mergeSave(save, parsed.save);
    save = merged;
    status = "ok";
    const report = {
      merged: true,
      externalNewer,
      save: get(),
      warnings: parsed.warnings,
    };
    emit("save:external", report);
    emit("save:changed", {
      saved: false,
      mode: readonly ? "readonly" : "sync",
      reason: "external",
      save: get(),
    });
    return report;
  }

  function attachStorage(target) {
    if (!target || typeof target.addEventListener !== "function") {
      return () => {};
    }
    const handler = (event) => {
      if (event?.key !== key) return;
      if (typeof event.newValue !== "string") return;
      mergeExternal(event.newValue);
    };
    target.addEventListener("storage", handler);
    return () => target.removeEventListener?.("storage", handler);
  }

  function importFromText(text) {
    const checked = validateSaveImport(text, { now: safeNow(clock) });
    if (!checked.ok) {
      return { ok: false, errors: checked.errors, save: get() };
    }
    const result = commit(checked.save, "import");
    return { ok: result.saved, errors: [], warnings: checked.warnings, save: result.save };
  }

  function exportToText() {
    return exportSave(save);
  }

  return {
    get,
    getStatus,
    commit,
    subscribe,
    mergeExternal,
    attachStorage,
    importFromText,
    exportToText,
    isReadonly: () => readonly,
  };
}

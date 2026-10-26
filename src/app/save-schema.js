/**
 * DS-1 存档结构、迁移、归一化与多标签页合并（M10 的数据层）。
 *
 * 本文件保持纯函数：不访问 localStorage、不读系统时钟；时间由调用方传入。
 * localStorage 适配与订阅在 `store.js`。
 */

export const SAVE_KEY = "gemz_save_v1";
export const SAVE_VERSION = 1;
export const LEVEL_COUNT = 30;
export const MAX_LIVES = 5;
export const MAX_IMPORT_BYTES = 256 * 1024;

export const ITEM_KEYS = Object.freeze(["shuffle", "hammer", "plus5"]);

const NICKNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_]{3,12}$/u;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toInt(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  const int = Math.trunc(value);
  return Math.min(max, Math.max(min, int));
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function parseIso(value, fallbackMs) {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : fallbackMs;
}

function validNickname(value) {
  return typeof value === "string" && (value === "" || NICKNAME_RE.test(value));
}

/** 昵称长度按 Unicode 字符计数，供 UI/排行榜复用。 */
export function nicknameLength(nickname) {
  return typeof nickname === "string" ? Array.from(nickname).length : 0;
}

export function isValidNickname(nickname) {
  return validNickname(nickname) && (nickname === "" || nicknameLength(nickname) <= 12);
}

function normalizeMap(raw, { min, max, maxValue = Number.MAX_SAFE_INTEGER, warnings, label }) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  if (!isPlainObject(raw)) {
    warnings.push(`${label} 不是对象，已重置为空`);
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < 1 || level > LEVEL_COUNT) {
      warnings.push(`${label} 的键 ${key} 不在 1–${LEVEL_COUNT}，已丢弃`);
      continue;
    }
    if (!Number.isFinite(value)) {
      warnings.push(`${label}[${key}] 不是数字，已丢弃`);
      continue;
    }
    const int = Math.trunc(value);
    if (int < min || int > Math.min(max, maxValue)) {
      warnings.push(`${label}[${key}] 超出 ${min}–${Math.min(max, maxValue)}，已丢弃`);
      continue;
    }
    out[level] = int;
  }
  return out;
}

function sumBestScores(bestScores) {
  return Object.values(bestScores).reduce((sum, score) => sum + score, 0);
}

function normalizeItems(raw, warnings) {
  const out = {};
  if (raw !== undefined && raw !== null && !isPlainObject(raw)) {
    warnings.push("items 不是对象，已使用默认库存");
  }
  for (const key of ITEM_KEYS) {
    out[key] = toInt(raw?.[key], key === "shuffle" ? 1 : key === "hammer" ? 1 : 1, 0, 9999);
  }
  return out;
}

/** 新建默认存档（B1）。 */
export function createDefaultSave(now = Date.now()) {
  const iso = toIso(now);
  return {
    version: SAVE_VERSION,
    unlockedLevel: 1,
    stars: {},
    bestScores: {},
    totalScore: 0,
    coins: 0,
    items: { shuffle: 1, hammer: 1, plus5: 1 },
    lives: MAX_LIVES,
    livesUpdatedAt: iso,
    livesRestored: 0,
    muted: false,
    colorblind: false,
    nickname: "",
    rewardPaidStars: {},
    updatedAt: iso,
  };
}

/** 迁移链：当前只有 v1；保留入口，供后续版本追加。 */
export function migrateSave(input) {
  if (!isPlainObject(input)) return { ok: false, reason: "not-object" };
  let version = Number.isInteger(input.version) ? input.version : SAVE_VERSION;
  if (version < 1) version = SAVE_VERSION;
  if (version > SAVE_VERSION) return { ok: false, reason: "future-version", version };
  let save = { ...input, version };
  while (version < SAVE_VERSION) {
    const migrate = MIGRATIONS[version];
    if (typeof migrate !== "function") {
      return { ok: false, reason: "no-migration", version };
    }
    save = migrate(save);
    version += 1;
    save.version = version;
  }
  return { ok: true, save };
}

const MIGRATIONS = Object.freeze({});

/**
 * 逐字段补齐/归一化（B3、INV-1~INV-7）。
 *
 * 返回新对象，不修改入参；无法验证的字段丢弃并写入 warnings。
 */
export function normalizeSave(input, { now = Date.now() } = {}) {
  const warnings = [];
  const migrated = migrateSave(input);
  if (!migrated.ok) {
    warnings.push(`存档版本不可用（${migrated.reason}），已使用默认存档`);
    return { save: createDefaultSave(now), warnings, recovered: true };
  }

  const raw = migrated.save;
  const save = createDefaultSave(now);
  const fallbackMs = now;

  save.unlockedLevel = toInt(raw.unlockedLevel, 1, 1, LEVEL_COUNT);
  save.stars = normalizeMap(raw.stars, { min: 1, max: 3, warnings, label: "stars" });
  save.bestScores = normalizeMap(raw.bestScores, {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    warnings,
    label: "bestScores",
  });
  save.rewardPaidStars = normalizeMap(raw.rewardPaidStars, {
    min: 1,
    max: 3,
    warnings,
    label: "rewardPaidStars",
  });
  save.totalScore = sumBestScores(save.bestScores);

  save.coins = toInt(raw.coins, 0, 0, Number.MAX_SAFE_INTEGER);
  save.items = normalizeItems(raw.items, warnings);
  save.lives = toInt(raw.lives, MAX_LIVES, 0, MAX_LIVES);
  save.livesRestored = toInt(raw.livesRestored, 0, 0, MAX_LIVES);
  save.livesUpdatedAt = toIso(parseIso(raw.livesUpdatedAt, fallbackMs));
  save.muted = Boolean(raw.muted);
  save.colorblind = Boolean(raw.colorblind);
  save.nickname = validNickname(raw.nickname) ? raw.nickname : "";
  if (raw.nickname !== undefined && raw.nickname !== save.nickname) {
    warnings.push("nickname 不符合 3–12 个中英文/数字/下划线，已清空");
  }
  save.updatedAt = toIso(parseIso(raw.updatedAt, fallbackMs));

  return { save, warnings, recovered: warnings.length > 0 };
}

function laterIso(a, b) {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * 多标签页合并（I-20、FL-04）。
 *
 * `a` 视为较新一方：可消耗资源、设置与生命锚点取 `a`；
 * 单调字段逐项取大；totalScore 按合并后的 bestScores 重算。
 */
export function mergeSave(a, b) {
  const newer = Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? a : b;
  const older = newer === a ? b : a;

  const maxMap = (left, right) => {
    const out = { ...left };
    for (const [key, value] of Object.entries(right)) {
      out[key] = Math.max(out[key] ?? 0, value);
    }
    return out;
  };

  const bestScores = maxMap(older.bestScores ?? {}, newer.bestScores ?? {});
  return {
    ...newer,
    version: SAVE_VERSION,
    unlockedLevel: Math.max(older.unlockedLevel ?? 1, newer.unlockedLevel ?? 1),
    stars: maxMap(older.stars ?? {}, newer.stars ?? {}),
    bestScores,
    totalScore: sumBestScores(bestScores),
    rewardPaidStars: maxMap(older.rewardPaidStars ?? {}, newer.rewardPaidStars ?? {}),
    updatedAt: laterIso(older.updatedAt, newer.updatedAt),
  };
}

/**
 * 导入校验（FR-13、§6.3.3）。
 *
 * 先检查 JSON/版本/字段类型，再走归一化；任一步失败都返回 errors，调用方不得落盘。
 */
export function validateSaveImport(text, { now = Date.now(), maxBytes = MAX_IMPORT_BYTES } = {}) {
  const errors = [];
  if (typeof text !== "string") {
    return { ok: false, errors: ["存档内容必须是 JSON 文本"] };
  }
  if (text.length > maxBytes) {
    return { ok: false, errors: [`存档文件超过 ${Math.floor(maxBytes / 1024)}KB 上限`] };
  }

  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`存档不是合法 JSON：${error.message}`] };
  }
  if (!isPlainObject(doc)) return { ok: false, errors: ["存档根节点必须是对象"] };
  if (!Number.isInteger(doc.version) || doc.version < 1) {
    errors.push("version 必须是 ≥1 的整数");
  } else if (doc.version > SAVE_VERSION) {
    errors.push(`version ${doc.version} 高于当前支持的 ${SAVE_VERSION}`);
  }

  const expectInt = (value, min, max, label) => {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${label} 必须是 ${min}–${max} 的整数`);
    }
  };
  expectInt(doc.unlockedLevel, 1, LEVEL_COUNT, "unlockedLevel");
  expectInt(doc.coins, 0, Number.MAX_SAFE_INTEGER, "coins");
  expectInt(doc.lives, 0, MAX_LIVES, "lives");
  expectInt(doc.livesRestored, 0, MAX_LIVES, "livesRestored");
  for (const key of ITEM_KEYS) {
    if (doc.items !== undefined && !isPlainObject(doc.items)) {
      errors.push("items 必须是对象");
      break;
    }
    if (doc.items?.[key] !== undefined && (!Number.isInteger(doc.items[key]) || doc.items[key] < 0)) {
      errors.push(`items.${key} 必须是非负整数`);
    }
  }
  for (const [field, min, max] of [
    ["stars", 1, 3],
    ["bestScores", 0, Number.MAX_SAFE_INTEGER],
    ["rewardPaidStars", 1, 3],
  ]) {
    if (doc[field] === undefined) continue;
    if (!isPlainObject(doc[field])) {
      errors.push(`${field} 必须是对象`);
      continue;
    }
    for (const [level, value] of Object.entries(doc[field])) {
      const n = Number(level);
      if (!Number.isInteger(n) || n < 1 || n > LEVEL_COUNT) errors.push(`${field} 的键 ${level} 越界`);
      if (!Number.isInteger(value) || value < min || value > max) {
        errors.push(`${field}[${level}] 必须是 ${min}–${max} 的整数`);
      }
    }
  }
  if (doc.nickname !== undefined && !isValidNickname(doc.nickname)) {
    errors.push("昵称仅支持 3–12 个中英文、数字或下划线");
  }
  if (doc.updatedAt !== undefined && !Number.isFinite(Date.parse(doc.updatedAt))) {
    errors.push("updatedAt 必须是可解析的 ISO 8601 时间");
  }
  if (doc.livesUpdatedAt !== undefined && !Number.isFinite(Date.parse(doc.livesUpdatedAt))) {
    errors.push("livesUpdatedAt 必须是可解析的 ISO 8601 时间");
  }

  if (errors.length > 0) return { ok: false, errors };

  const normalized = normalizeSave(doc, { now });
  return { ok: true, save: normalized.save, errors: [], warnings: normalized.warnings };
}

export function exportSave(save) {
  return JSON.stringify(save, null, 2);
}

export function parseStoredSave(raw, { now = Date.now() } = {}) {
  if (typeof raw !== "string") {
    return { status: "missing", save: createDefaultSave(now), warnings: [] };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    return {
      status: "corrupt",
      save: createDefaultSave(now),
      warnings: [`存档 JSON 解析失败：${error.message}`],
    };
  }
  const normalized = normalizeSave(doc, { now });
  return {
    status: normalized.recovered ? "recovered" : "ok",
    save: normalized.save,
    warnings: normalized.warnings,
  };
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

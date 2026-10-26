/**
 * M11 关卡配置加载与校验（DS-2、§7.3、FM-12）。
 *
 * 纯函数：输入已解析的配置对象或 JSON 文本，输出 30 关的可用配置与自检报告。
 * 外部配置逐条校验；非法条目回落为该关的内置默认值，整份配置损坏时整体回落。
 */

export const LEVEL_COUNT = 30;
export const BOARD_ROWS = 8;
export const BOARD_COLS = 8;
export const BOARD_COLORS = 5;

const MOVE_MIN = 16;
const MOVE_MAX = 25;
const SCORE_MIN = 1000;
const SCORE_MAX = 2740;
const COLLECT_COUNT_MAX = 64;
const ICE_TOTAL_MAX = 64;

/** 设计文档 §7.3.2 的星级阈值预置值（标定前可玩性预置，非最终值）。 */
const STAR_KEEP = [
  [7, 12],
  [6, 10],
  [6, 10],
  [5, 10],
  [5, 9],
  [6, 10],
  [6, 10],
  [6, 10],
  [6, 10],
  [6, 10],
  [6, 10],
  [6, 10],
  [6, 10],
  [6, 10],
  [6, 10],
  [6, 11],
  [6, 10],
  [6, 10],
  [6, 10],
  [5, 10],
  [5, 10],
  [5, 10],
  [5, 10],
  [5, 10],
  [5, 9],
  [5, 9],
  [5, 9],
  [5, 9],
  [5, 9],
  [5, 9],
];

/** 关卡所属分段：1–5 段 1，6–15 段 2，16–30 段 3。 */
export function segmentOf(level) {
  if (level <= 5) return 1;
  if (level <= 15) return 2;
  return 3;
}

/** 按 BR-02~BR-04 公式生成第 n 关的基线配置（也是校验回落用的内置默认）。 */
export function defaultLevel(level) {
  if (!Number.isInteger(level) || level < 1 || level > LEVEL_COUNT) {
    throw new RangeError(`关卡号必须在 1–${LEVEL_COUNT} 之间：${level}`);
  }

  const segment = segmentOf(level);
  let moves;
  let score;
  let collect = null;
  let iceTotal = 0;

  if (segment === 1) {
    moves = 20 - (level - 1);
    score = 1000 + 300 * (level - 1);
  } else if (segment === 2) {
    moves = 20 - Math.floor((level - 6) / 2);
    score = 1400 + 100 * (level - 6);
    collect = { color: (level + 1) % 5, count: 10 + (level - 6) };
  } else {
    moves = 25 - Math.floor((level - 16) / 3);
    score = 1900 + 60 * (level - 16);
    collect = { color: (level + 1) % 5, count: 14 + (level - 16) };
    iceTotal = 7 + Math.round((level - 16) / 5);
  }

  const [keep2, keep3] = STAR_KEEP[level - 1];

  return {
    level,
    segment,
    rows: BOARD_ROWS,
    cols: BOARD_COLS,
    colors: BOARD_COLORS,
    moves,
    goals: {
      score,
      ...(collect ? { collect } : {}),
      ice: { total: iceTotal, doubleRatio: segment === 3 ? 0.15 : 0 },
    },
    starKeep: { keep2, keep3 },
  };
}

function defaultLevels() {
  return Array.from({ length: LEVEL_COUNT }, (_, index) => defaultLevel(index + 1));
}

/** 内置默认配置：外部配置整体不可用时使用。 */
export const DEFAULT_LEVELS_DOC = Object.freeze({
  version: 1,
  levels: Object.freeze(defaultLevels().map((level) => Object.freeze(level))),
});

export function defaultLevelsDoc() {
  return {
    version: 1,
    levels: defaultLevels(),
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInt(value) {
  return Number.isInteger(value);
}

/**
 * 校验单条关卡配置并归一化。
 *
 * @returns {{ok:boolean, value:object|null, errors:string[], warnings:string[]}}
 */
export function validateLevelEntry(entry, { index = 0 } = {}) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(entry)) {
    return {
      ok: false,
      value: null,
      errors: [`第 ${index + 1} 条关卡配置不是对象`],
      warnings,
    };
  }

  const level = entry.level;
  if (!isInt(level) || level < 1 || level > LEVEL_COUNT) {
    return {
      ok: false,
      value: null,
      errors: [`第 ${index + 1} 条关卡的 level 必须是 1–${LEVEL_COUNT} 的整数，实际为 ${level}`],
      warnings,
    };
  }

  const segment = segmentOf(level);
  if (entry.segment !== segment) {
    errors.push(`第 ${level} 关的 segment 应为 ${segment}，实际为 ${entry.segment}`);
  }
  if (entry.rows !== BOARD_ROWS || entry.cols !== BOARD_COLS) {
    errors.push(`第 ${level} 关的棋盘必须是 ${BOARD_ROWS}×${BOARD_COLS}（BR-01）`);
  }
  if (entry.colors !== BOARD_COLORS) {
    errors.push(`第 ${level} 关的元素颜色数必须是 ${BOARD_COLORS}（BR-01）`);
  }

  const moves = entry.moves;
  if (!isInt(moves) || moves < MOVE_MIN || moves > MOVE_MAX) {
    errors.push(`第 ${level} 关的 moves 必须是 ${MOVE_MIN}–${MOVE_MAX} 的整数，实际为 ${moves}`);
  }

  const goals = entry.goals;
  if (!isPlainObject(goals)) {
    errors.push(`第 ${level} 关缺少 goals 对象`);
  }

  const score = goals?.score;
  if (!isInt(score) || score < SCORE_MIN || score > SCORE_MAX) {
    errors.push(`第 ${level} 关的 goals.score 必须是 ${SCORE_MIN}–${SCORE_MAX} 的整数，实际为 ${score}`);
  }

  let collect = null;
  const rawCollect = goals?.collect;
  if (rawCollect !== undefined && rawCollect !== null) {
    if (!isPlainObject(rawCollect)) {
      warnings.push(`第 ${level} 关的收集目标不是对象，已忽略`);
    } else if (!isInt(rawCollect.color) || rawCollect.color < 0 || rawCollect.color > 4) {
      warnings.push(`第 ${level} 关的收集颜色必须在 0–4 之间，已忽略该收集目标`);
    } else if (
      !isInt(rawCollect.count) ||
      rawCollect.count < 1 ||
      rawCollect.count > COLLECT_COUNT_MAX
    ) {
      warnings.push(`第 ${level} 关的收集数量必须在 1–${COLLECT_COUNT_MAX} 之间，已忽略该收集目标`);
    } else {
      collect = { color: rawCollect.color, count: rawCollect.count };
    }
  }

  const rawIce = goals?.ice;
  let iceTotal = 0;
  let doubleRatio = 0;
  if (rawIce !== undefined && rawIce !== null) {
    if (!isPlainObject(rawIce)) {
      errors.push(`第 ${level} 关的冰层目标不是对象`);
    } else {
      iceTotal = rawIce.total ?? 0;
      if (!isInt(iceTotal) || iceTotal < 0 || iceTotal > ICE_TOTAL_MAX) {
        errors.push(`第 ${level} 关的冰层格数必须是 0–${ICE_TOTAL_MAX} 的整数，实际为 ${rawIce.total}`);
      }
      const ratio = rawIce.doubleRatio ?? 0;
      if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        warnings.push(`第 ${level} 关的双层冰比例越界，已按 0 处理`);
      } else {
        doubleRatio = ratio;
      }
    }
  }

  const rawKeep = entry.starKeep;
  let keep2 = rawKeep?.keep2;
  let keep3 = rawKeep?.keep3;
  if (
    !isPlainObject(rawKeep) ||
    !isInt(keep2) ||
    !isInt(keep3) ||
    keep2 < 0 ||
    keep2 >= keep3 ||
    keep3 > moves
  ) {
    keep2 = 0;
    keep3 = isInt(moves) && moves > 0 ? moves : MOVE_MAX;
    warnings.push(
      `第 ${level} 关的星级阈值不满足 0 ≤ keep2 < keep3 ≤ moves，已按保守值 keep2=${keep2}、keep3=${keep3} 处理（BR-07 待标定）`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, value: null, errors, warnings };
  }

  return {
    ok: true,
    errors,
    warnings,
    value: {
      level,
      segment,
      rows: BOARD_ROWS,
      cols: BOARD_COLS,
      colors: BOARD_COLORS,
      moves,
      goals: {
        score,
        ...(collect ? { collect } : {}),
        ice: { total: iceTotal, doubleRatio },
      },
      starKeep: { keep2, keep3 },
    },
  };
}

function fallback(reason, logger) {
  logger?.warn?.(reason);
  return {
    source: "default",
    ok: false,
    levels: defaultLevels(),
    errors: [reason],
    warnings: [],
    recovered: Array.from({ length: LEVEL_COUNT }, (_, index) => index + 1),
  };
}

function parseText(text) {
  if (typeof text !== "string") {
    throw new TypeError("关卡配置文本必须是字符串");
  }
  return JSON.parse(text);
}

/**
 * 加载并校验整份关卡配置。
 *
 * 输入可以是已解析的对象或 JSON 文本。整份配置缺少 version/levels 时回落内置默认；
 * 单条非法时用该关默认值替换并写入 warnings，保证返回结果始终是 30 关。
 */
export function loadLevels(input, { logger = null } = {}) {
  let doc = input;

  if (typeof input === "string") {
    try {
      doc = parseText(input);
    } catch (error) {
      return fallback(`关卡配置不是合法 JSON：${error.message}`, logger);
    }
  }

  if (!isPlainObject(doc)) {
    return fallback("缺少关卡配置，已使用内置默认配置", logger);
  }
  if (!isInt(doc.version) || doc.version < 1) {
    return fallback(`关卡配置版本非法：${doc.version}，已使用内置默认配置`, logger);
  }
  if (!Array.isArray(doc.levels)) {
    return fallback("关卡配置缺少 levels 数组，已使用内置默认配置", logger);
  }

  const byLevel = new Map();
  const errors = [];
  const warnings = [];
  const recovered = [];

  doc.levels.forEach((entry, index) => {
    const result = validateLevelEntry(entry, { index });
    if (!result.ok) {
      errors.push(...result.errors);
      return;
    }
    const { level } = result.value;
    if (byLevel.has(level)) {
      errors.push(`第 ${level} 关重复出现，保留首次出现的配置`);
      return;
    }
    byLevel.set(level, result.value);
    warnings.push(...result.warnings);
  });

  const levels = [];
  for (let level = 1; level <= LEVEL_COUNT; level += 1) {
    if (byLevel.has(level)) {
      levels.push(byLevel.get(level));
    } else {
      levels.push(defaultLevel(level));
      recovered.push(level);
      warnings.push(`第 ${level} 关缺失或非法，已回落为内置默认配置`);
    }
  }

  if (recovered.length === LEVEL_COUNT) {
    return fallback("关卡配置中没有可用条目，已使用内置默认配置", logger);
  }

  errors.forEach((message) => logger?.warn?.(message));
  warnings.forEach((message) => logger?.warn?.(message));

  return {
    source: errors.length === 0 && recovered.length === 0 ? "external" : "recovered",
    ok: recovered.length === 0 && errors.length === 0,
    levels,
    errors,
    warnings,
    recovered,
  };
}

/** 严格校验：30 关全部合法、无重复、无缺失才算通过。 */
export function validateLevelsDoc(input) {
  const loaded = loadLevels(input);
  return {
    ok: loaded.ok && loaded.source === "external",
    errors: loaded.errors,
    warnings: loaded.warnings,
    levels: loaded.levels,
  };
}

/** 从 JSON 文本加载；解析失败按“损坏配置”回落内置默认。 */
export function loadLevelsFromText(text, options = {}) {
  return loadLevels(text, options);
}

/**
 * 从 URL 加载关卡配置（浏览器端入口）。
 *
 * 网络失败、超时、非 2xx 或 JSON 解析失败都回落内置默认，不抛异常。
 */
export async function loadLevelsFromUrl(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = 3000, logger = null } = {},
) {
  if (typeof fetchImpl !== "function") {
    return fallback("当前环境没有 fetch，已使用内置默认配置", logger);
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response?.ok) {
      return fallback(`关卡配置请求失败：HTTP ${response?.status}`, logger);
    }
    const text = await response.text();
    return loadLevels(text, { logger });
  } catch (error) {
    return fallback(`关卡配置加载失败：${error.message}`, logger);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 按关卡号取配置；不存在时返回 null。 */
export function getLevel(levels, level) {
  return levels.find((entry) => entry.level === level) ?? null;
}

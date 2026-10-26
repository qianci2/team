/**
 * M6 配色与形状通道（FR-30、NFR-13）。
 *
 * 色值来自设计基线附录的 Organic 令牌；5 种星石在砂纸底色上
 * 保持 ≥3:1 的图形对比度，并在色觉辅助模式下叠加唯一形状，
 * 让颜色与形状成为两条独立的识别通道。
 */

export const COLORS = Object.freeze({
  ground: "#eee6d6",
  surface: "#f5eddf",
  ink: "#29251d",
  primary: "#35422d",
  field: "#694737",
  artAccent: "#ad7d62",
  surfaceMuted: "#ddd5c3",
  highlight: "#b9b28b",
  inkMuted: "#443b2f",
});

/**
 * 5 种普通星石。symbol 与颜色一一绑定，全局一致（设计 §8.2）。
 * 色值全部落在土色系内，且相对纸面 ≥3:1（见 CONTRAST_PAIRS）。
 */
export const TILE_STYLES = Object.freeze([
  Object.freeze({
    kind: 0,
    name: "苔绿",
    color: "#46563a",
    rim: "#2c3724",
    shade: "#39472f",
    symbol: "circle",
  }),
  Object.freeze({
    kind: 1,
    name: "陶红",
    color: "#8b4f3a",
    rim: "#5a3024",
    shade: "#74402e",
    symbol: "square",
  }),
  Object.freeze({
    kind: 2,
    name: "赭黄",
    color: "#a27a3e",
    rim: "#6d5027",
    shade: "#8a6631",
    symbol: "triangle",
  }),
  Object.freeze({
    kind: 3,
    name: "石青",
    color: "#596d6b",
    rim: "#394846",
    shade: "#4a5c5a",
    symbol: "diamond",
  }),
  Object.freeze({
    kind: 4,
    name: "烟褐",
    color: "#6f5744",
    rim: "#4a382b",
    shade: "#5c4737",
    symbol: "star",
  }),
]);

export const SPECIAL_STYLES = Object.freeze({
  bomb: Object.freeze({ name: "炸弹", color: "#3b332b", rim: "#201c17", symbol: "burst" }),
  rainbow: Object.freeze({ name: "彩虹", color: "#5b4a3c", rim: "#2f261f", symbol: "rainbow" }),
});

export const SYMBOLS = Object.freeze(TILE_STYLES.map((style) => style.symbol));

export function tileStyle(kind) {
  if (Number.isInteger(kind)) {
    const style = TILE_STYLES[kind];
    if (style) return style;
  }
  return SPECIAL_STYLES[kind] ?? null;
}

export function tileName(kind) {
  return tileStyle(kind)?.name ?? "未知星石";
}

/** #rrggbb → {r,g,b}（0–255）。 */
export function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** WCAG 相对亮度（0–1）。 */
export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG 对比度；返回 1–21 的数值。 */
export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * 界面里实际使用的文字/图形配色组合。
 * min 为 WCAG 阈值：普通文字 4.5，图形与大字 3.0。
 */
export const CONTRAST_PAIRS = Object.freeze([
  { name: "正文 / 砂色地", fg: COLORS.ink, bg: COLORS.ground, min: 4.5, kind: "text" },
  { name: "次级文字 / 砂色地", fg: COLORS.inkMuted, bg: COLORS.ground, min: 4.5, kind: "text" },
  { name: "正文 / 纸面", fg: COLORS.ink, bg: COLORS.surface, min: 4.5, kind: "text" },
  { name: "次级文字 / 纸面", fg: COLORS.inkMuted, bg: COLORS.surface, min: 4.5, kind: "text" },
  { name: "纸面字 / 苔色按钮", fg: COLORS.surface, bg: COLORS.primary, min: 4.5, kind: "text" },
  { name: "纸面字 / 陶土色块", fg: COLORS.surface, bg: COLORS.field, min: 4.5, kind: "text" },
  { name: "深色字 / 干草色", fg: COLORS.ink, bg: COLORS.highlight, min: 4.5, kind: "text" },
  { name: "深色字 / 石色底", fg: COLORS.ink, bg: COLORS.surfaceMuted, min: 4.5, kind: "text" },
  ...TILE_STYLES.map((style) => ({
    name: `${style.name}星石 / 纸面`,
    fg: style.color,
    bg: COLORS.surface,
    min: 3,
    kind: "graphic",
  })),
]);

/** 逐条核对配色，返回 {name, ratio, min, pass, kind} 数组。 */
export function auditContrast() {
  return CONTRAST_PAIRS.map((pair) => {
    const ratio = contrastRatio(pair.fg, pair.bg);
    return {
      name: pair.name,
      ratio: Math.round(ratio * 100) / 100,
      min: pair.min,
      kind: pair.kind,
      pass: ratio >= pair.min,
    };
  });
}

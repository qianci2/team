/**
 * 表现层文案与数值格式（纯函数）。
 *
 * 集中处理星数、章节名、目标标签与千分位，避免各界面各写一套；
 * 也便于在 Node 里直接测试文案口径，不依赖 DOM。
 */

import { TILE_STYLES } from "./palette.js";

const CHAPTER_NAMES = Object.freeze({ 1: "第一程", 2: "第二程", 3: "第三程" });

export function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "0";
}

export function starText(count) {
  const filled = Math.max(0, Math.min(3, Math.trunc(count) || 0));
  return `${"★".repeat(filled)}${"☆".repeat(3 - filled)}`;
}

export function sumStars(stars) {
  return Object.values(stars ?? {}).reduce((total, value) => total + (Number(value) || 0), 0);
}

export function chapterName(segment) {
  return CHAPTER_NAMES[segment] ?? `第 ${segment} 程`;
}

export function goalLabel(goal, cfg) {
  if (goal.kind === "score") return "目标分";
  if (goal.kind === "collect") {
    const color = cfg?.goals?.collect?.color;
    const style = Number.isInteger(color) ? TILE_STYLES[color] : null;
    return style ? `收集${style.name}` : "收集星石";
  }
  return "破除冰层";
}

export function goalSummary(cfg) {
  const parts = [];
  if (cfg?.goals?.score) parts.push(`${formatNumber(cfg.goals.score)} 分`);
  if (cfg?.goals?.collect) parts.push(`收集 ×${cfg.goals.collect.count}`);
  if (cfg?.goals?.ice?.total) parts.push(`冰层 ×${cfg.goals.ice.total}`);
  return parts.join(" · ");
}

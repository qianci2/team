/**
 * M6 棋盘布局（I-29/I-31/I-32 的共享几何信息）。
 *
 * 纯函数：只根据画布尺寸与行列数计算格子位置，不做 DOM 查询，
 * 也不保存任何状态。指针命中与键盘光标都消费同一份 LayoutInfo，
 * 保证不同缩放下“0.3 格滑动即交换”的阈值一致（TC-30）。
 */

/** 滑动判定阈值：0.3 个格子（设计 §8.2）。 */
export const SWIPE_THRESHOLD_RATIO = 0.3;

export const SWIPE_KEYS = Object.freeze(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const DIRECTIONS = Object.freeze({
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * 计算棋盘在画布内的正方形网格位置。
 *
 * @param {{width:number,height:number,rows:number,cols:number,padding?:number,gap?:number}} input
 */
export function computeLayout({ width, height, rows, cols, padding = 14, gap = 6 } = {}) {
  const safeRows = Math.max(1, Math.trunc(finite(rows, 8)));
  const safeCols = Math.max(1, Math.trunc(finite(cols, 8)));
  const safeWidth = Math.max(1, finite(width, 1));
  const safeHeight = Math.max(1, finite(height, 1));
  const safePadding = Math.max(0, finite(padding, 14));
  const safeGap = Math.max(0, finite(gap, 6));

  const innerWidth = Math.max(1, safeWidth - safePadding * 2);
  const innerHeight = Math.max(1, safeHeight - safePadding * 2);
  const cell = Math.max(1, Math.min(innerWidth / safeCols, innerHeight / safeRows));
  const boardWidth = cell * safeCols;
  const boardHeight = cell * safeRows;

  return Object.freeze({
    width: safeWidth,
    height: safeHeight,
    rows: safeRows,
    cols: safeCols,
    padding: safePadding,
    gap: safeGap,
    cell,
    boardWidth,
    boardHeight,
    originX: (safeWidth - boardWidth) / 2,
    originY: (safeHeight - boardHeight) / 2,
  });
}

/** 格子左上角（不含内缩）。 */
export function cellOrigin(layout, row, col) {
  return {
    x: layout.originX + col * layout.cell,
    y: layout.originY + row * layout.cell,
  };
}

/** 格子中心的绘制矩形（含 gap 内缩）。 */
export function cellRect(layout, row, col) {
  const origin = cellOrigin(layout, row, col);
  const inset = layout.gap / 2;
  return {
    x: origin.x + inset,
    y: origin.y + inset,
    width: layout.cell - layout.gap,
    height: layout.cell - layout.gap,
    centerX: origin.x + layout.cell / 2,
    centerY: origin.y + layout.cell / 2,
  };
}

/** 画布坐标 → 格子坐标；棋盘外返回 null。 */
export function cellAt(layout, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const localX = x - layout.originX;
  const localY = y - layout.originY;
  if (localX < 0 || localY < 0 || localX >= layout.boardWidth || localY >= layout.boardHeight) {
    return null;
  }
  const col = Math.floor(localX / layout.cell);
  const row = Math.floor(localY / layout.cell);
  if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) return null;
  return [row, col];
}

/** 把任意光标钳制在棋盘内。 */
export function clampCursor(cursor, rows, cols) {
  const maxRow = Math.max(0, Math.trunc(rows) - 1);
  const maxCol = Math.max(0, Math.trunc(cols) - 1);
  const row = Array.isArray(cursor) ? Math.trunc(finite(cursor[0], 0)) : 0;
  const col = Array.isArray(cursor) ? Math.trunc(finite(cursor[1], 0)) : 0;
  return [Math.min(maxRow, Math.max(0, row)), Math.min(maxCol, Math.max(0, col))];
}

/** 方向键移动光标；非方向键返回原光标。 */
export function moveCursor(cursor, key, rows, cols) {
  const base = clampCursor(cursor, rows, cols);
  const delta = DIRECTIONS[key];
  if (!delta) return base;
  return clampCursor([base[0] + delta[0], base[1] + delta[1]], rows, cols);
}

export function isAdjacent(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
}

export function sameCell(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
}

/**
 * 滑动方向：取位移较大的轴；位移为零返回 null。
 *
 * @returns {{dr:number,dc:number}|null}
 */
export function swipeDirection(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return { dr: 0, dc: Math.sign(dx) };
  return { dr: Math.sign(dy), dc: 0 };
}

/**
 * 滑动起止格：超过 0.3 格才视为有效滑动（TC-30）。
 * 目标越界时返回 null，由调用方忽略。
 */
export function swipeTarget(start, dx, dy, cell, threshold = SWIPE_THRESHOLD_RATIO, rows = 8, cols = 8) {
  if (!Array.isArray(start)) return null;
  if (!Number.isFinite(cell) || cell <= 0) return null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * threshold) return null;
  const direction = swipeDirection(dx, dy);
  if (!direction) return null;
  const target = [start[0] + direction.dr, start[1] + direction.dc];
  if (target[0] < 0 || target[1] < 0 || target[0] >= rows || target[1] >= cols) return null;
  return target;
}

/**
 * 点击语义：选中、取消、交换或交给道具模式。
 *
 * @returns {{type:'select',at:number[]}|{type:'clear'}|{type:'move',from:number[],to:number[]}}
 */
export function tapIntent(selection, at) {
  if (!Array.isArray(at)) return { type: "clear" };
  if (!Array.isArray(selection)) return { type: "select", at };
  if (sameCell(selection, at)) return { type: "clear" };
  if (isAdjacent(selection, at)) return { type: "move", from: selection, to: at };
  return { type: "select", at };
}

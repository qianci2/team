/**
 * M8 输入与输入队列（I-31/I-32，FR-28/FR-29/FR-25）。
 *
 * 指针、触屏与键盘统一转换成语义化 InputIntent；动画期间的排队
 * 已由 M5（session.dispatch）负责，这里不做第二层队列，避免双缓冲
 * 导致“点两次只执行一次”。
 */

import {
  SWIPE_THRESHOLD_RATIO,
  cellAt,
  isAdjacent,
  moveCursor,
  sameCell,
  swipeTarget,
  tapIntent,
} from "./layout.js";
import { tileName } from "./palette.js";

function eventPoint(canvas, layout, event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: (event.clientX - rect.left) * (layout.width / rect.width),
    y: (event.clientY - rect.top) * (layout.height / rect.height),
  };
}

function cellDescription(view, at, colorblind) {
  if (!Array.isArray(at)) return "";
  const [row, col] = at;
  const tile = view?.board?.tiles?.[row]?.[col];
  const ice = view?.board?.ice?.[row]?.[col] ?? 0;
  const parts = [`第 ${row + 1} 行第 ${col + 1} 列`];
  if (tile) {
    parts.push(`${tileName(tile.kind)}${colorblind ? "图形" : ""}`);
  } else {
    parts.push("空格");
  }
  if (ice > 0) parts.push(`冰层 ${ice} 层`);
  return parts.join("，");
}

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   getLayout: () => object,
 *   getView: () => object,
 *   onIntent: (intent: object) => void,
 *   onChange: (state: object) => void,
 *   announce?: (text: string) => void,
 *   onHammerRequest?: () => void,
 * }} options
 */
export function createBoardInput({
  canvas,
  getLayout,
  getView,
  onIntent,
  onChange = () => {},
  announce = () => {},
  onHammerRequest = () => {},
}) {
  if (!canvas || typeof canvas.addEventListener !== "function") {
    throw new TypeError("createBoardInput 需要棋盘元素");
  }

  let enabled = true;
  let selection = null;
  let cursor = [0, 0];
  let cursorVisible = false;
  let hammerMode = false;
  let hover = null;
  let drag = null;
  let pointer = null;
  let lastAnnounced = "";

  function emitState() {
    onChange({ selection, cursor, cursorVisible, hammer: hammerMode, hover, drag });
  }

  function speak(text, { force = false } = {}) {
    if (!text) return;
    if (!force && text === lastAnnounced) return;
    lastAnnounced = text;
    announce(text);
  }

  function describeCursor() {
    return cellDescription(getView(), cursor, Boolean(getView()?.colorblind));
  }

  function updateCanvasLabel() {
    const view = getView();
    const board = view?.board;
    const label = board
      ? `棋盘，${board.rows} 行 ${board.cols} 列。当前光标：${describeCursor()}。方向键移动，空格选定，再按方向键或空格交换相邻星石，Esc 取消。`
      : "棋盘";
    canvas.setAttribute("aria-label", label);
  }

  function setCursor(at, { visible = true } = {}) {
    const layout = getLayout();
    const next = [
      Math.min(layout.rows - 1, Math.max(0, at[0])),
      Math.min(layout.cols - 1, Math.max(0, at[1])),
    ];
    cursor = next;
    if (visible) cursorVisible = true;
    updateCanvasLabel();
    emitState();
    speak(describeCursor());
  }

  function setSelection(at) {
    selection = at;
    emitState();
  }

  function clearSelection() {
    selection = null;
    emitState();
  }

  function exitHammer() {
    if (!hammerMode) return;
    hammerMode = false;
    emitState();
  }

  function setHammerMode(next) {
    hammerMode = Boolean(next);
    if (hammerMode) {
      cursorVisible = true;
      speak("锤子模式：移动到要敲碎的格子，按空格确认。Esc 取消。", { force: true });
    }
    emitState();
  }

  function tap(at) {
    if (!enabled || !Array.isArray(at)) return;
    if (hammerMode) {
      onIntent({ type: "item", kind: "hammer", target: at });
      hammerMode = false;
      selection = null;
      emitState();
      speak("使用锤子", { force: true });
      return;
    }
    const action = tapIntent(selection, at);
    if (action.type === "move") {
      selection = null;
      emitState();
      speak(isAdjacent(action.from, action.to) ? "交换星石" : "", { force: true });
      onIntent({ type: "move", from: action.from, to: action.to });
      return;
    }
    if (action.type === "select") {
      selection = action.at;
      emitState();
      speak(`${describeCursor()}，已选中`, { force: true });
      return;
    }
    selection = null;
    emitState();
    speak("已取消选择", { force: true });
  }

  function resetPointer() {
    pointer = null;
    drag = null;
    hover = null;
    emitState();
  }

  function onPointerDown(event) {
    if (!enabled || event.button !== 0 || event.pointerType === "mouse" && event.buttons !== 1) {
      return;
    }
    const layout = getLayout();
    const point = eventPoint(canvas, layout, event);
    const at = cellAt(layout, point.x, point.y);
    if (!at) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // 某些浏览器对合成事件不支持捕获；后续 move/up 仍可工作。
    }
    pointer = {
      id: event.pointerId,
      startX: point.x,
      startY: point.y,
      cell: at,
      moved: false,
    };
    cursor = at;
    cursorVisible = false;
    hover = at;
    emitState();
  }

  function onPointerMove(event) {
    const layout = getLayout();
    const point = eventPoint(canvas, layout, event);
    const at = cellAt(layout, point.x, point.y);
    hover = at;

    if (pointer && pointer.id === event.pointerId) {
      const dx = point.x - pointer.startX;
      const dy = point.y - pointer.startY;
      const threshold = layout.cell * SWIPE_THRESHOLD_RATIO;
      if (!pointer.moved && Math.max(Math.abs(dx), Math.abs(dy)) >= threshold) {
        const target = swipeTarget(pointer.cell, dx, dy, layout.cell, SWIPE_THRESHOLD_RATIO);
        if (target) {
          pointer.moved = true;
          drag = {
            from: pointer.cell,
            to: target,
            currentX: point.x,
            currentY: point.y,
          };
        }
      } else if (pointer.moved) {
        // 指针可能仍在起始格内；目标由位移方向决定，而不是指针所在格。
        const target = swipeTarget(pointer.cell, dx, dy, layout.cell, SWIPE_THRESHOLD_RATIO);
        drag = { ...drag, currentX: point.x, currentY: point.y, to: target };
      }
    }
    emitState();
  }

  function onPointerUp(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const layout = getLayout();
    const point = eventPoint(canvas, layout, event);
    const start = pointer.cell;
    const draggedTo = pointer.moved ? drag?.to ?? null : null;
    const upCell = cellAt(layout, point.x, point.y) ?? start;
    resetPointer();
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      // 忽略未捕获的指针。
    }
    if (draggedTo) {
      onIntent({ type: "move", from: start, to: draggedTo });
      speak("交换星石", { force: true });
      return;
    }
    tap(upCell);
  }

  function onPointerCancel(event) {
    if (pointer && pointer.id === event.pointerId) resetPointer();
  }

  function onPointerLeave() {
    if (!pointer) {
      hover = null;
      emitState();
    }
  }

  function onKeyDown(event) {
    if (!enabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    if (key === " " || key === "Spacebar" || key === "Enter") {
      event.preventDefault();
      tap(cursor);
      return;
    }
    if (key === "Escape") {
      if (hammerMode) {
        exitHammer();
        speak("已退出锤子模式", { force: true });
      } else if (selection) {
        clearSelection();
        speak("已取消选择", { force: true });
      }
      return;
    }
    if (key === "h" || key === "H") {
      event.preventDefault();
      onHammerRequest();
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
      event.preventDefault();
      if (!cursorVisible) cursorVisible = true;
      const view = getView();
      const rows = view?.board?.rows ?? getLayout().rows;
      const cols = view?.board?.cols ?? getLayout().cols;
      setCursor(moveCursor(cursor, key, rows, cols));
    }
  }

  function onFocus() {
    const view = getView();
    if (!view || view.scene !== "playing") return;
    cursorVisible = true;
    updateCanvasLabel();
    emitState();
  }

  function onBlur() {
    cursorVisible = false;
    emitState();
  }

  function setEnabled(next) {
    const value = Boolean(next);
    if (enabled === value) return;
    enabled = value;
    if (!value) {
      resetPointer();
      selection = null;
      emitState();
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("focus", onFocus);
  canvas.addEventListener("blur", onBlur);

  return {
    setEnabled,
    setHammerMode,
    clear() {
      selection = null;
      hammerMode = false;
      emitState();
    },
    resetView() {
      cursor = [0, 0];
      cursorVisible = false;
      selection = null;
      hammerMode = false;
      hover = null;
      drag = null;
      pointer = null;
      updateCanvasLabel();
      emitState();
    },
    sync() {
      updateCanvasLabel();
      emitState();
    },
    getState: () => ({ selection, cursor, cursorVisible, hammer: hammerMode, hover, drag }),
    destroy() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("focus", onFocus);
      canvas.removeEventListener("blur", onBlur);
    },
  };
}

/**
 * 让网格容器里的按钮支持方向键移动焦点（选关页 30 张卡片）。
 * 没有可聚焦子项时静默返回。
 */
export function attachGridKeyboard(container, selector = "button:not([disabled])") {
  if (!container) return () => {};

  function onKeyDown(event) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const items = Array.from(container.querySelectorAll(selector));
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();

    const grid = document.activeElement?.parentElement;
    const template = grid ? getComputedStyle(grid).gridTemplateColumns : "";
    const columns = Math.max(1, template.split(" ").filter(Boolean).length || 1);
    let next = current;
    if (event.key === "ArrowRight") next = Math.min(items.length - 1, current + 1);
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    if (event.key === "ArrowDown") next = Math.min(items.length - 1, current + columns);
    if (event.key === "ArrowUp") next = Math.max(0, current - columns);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    items[next].focus();
  }

  container.addEventListener("keydown", onKeyDown);
  return () => container.removeEventListener("keydown", onKeyDown);
}

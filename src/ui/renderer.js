/**
 * M6 渲染与动画（I-29）。
 *
 * 只读 ViewState 里的棋盘并绘制，不修改任何游戏状态；动画只消费
 * M1/M3 给出的 CascadeStep。Canvas 尺寸、命中信息与键盘光标共用
 * `layout.js` 的同一份 LayoutInfo（I-31/I-32）。
 */

import { cellRect, computeLayout } from "./layout.js";
import { COLORS, SPECIAL_STYLES, TILE_STYLES, tileStyle } from "./palette.js";
import { easeInQuad, easeOutCubic, planSteps, stepTiming, swapBoard } from "./animation.js";

const PAPER = COLORS.surface;
const INK = COLORS.ink;
const ICE_FILL = "rgba(185, 178, 139, 0.42)";
const ICE_EDGE = "rgba(68, 59, 47, 0.4)";

function hash(value) {
  let x = Math.imul((Number(value) || 0) + 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function roundedPath(ctx, x, y, width, height, radii) {
  const [tl, tr, br, bl] = radii;
  const w = width;
  const h = height;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function organicRadii(size, seed) {
  const base = size * 0.3;
  return [0, 1, 2, 3].map((index) => base * (0.72 + hash(seed + index * 17) * 0.5));
}

function drawSymbol(ctx, symbol, cx, cy, size, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.4, size * 0.09);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const half = size / 2;

  if (symbol === "circle") {
    ctx.beginPath();
    ctx.arc(cx, cy, half * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  } else if (symbol === "square") {
    roundedPath(ctx, cx - half * 0.58, cy - half * 0.58, half * 1.16, half * 1.16, [
      half * 0.16,
      half * 0.16,
      half * 0.16,
      half * 0.16,
    ]);
    ctx.stroke();
  } else if (symbol === "triangle") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - half * 0.68);
    ctx.lineTo(cx + half * 0.66, cy + half * 0.5);
    ctx.lineTo(cx - half * 0.66, cy + half * 0.5);
    ctx.closePath();
    ctx.stroke();
  } else if (symbol === "diamond") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - half * 0.7);
    ctx.lineTo(cx + half * 0.62, cy);
    ctx.lineTo(cx, cy + half * 0.7);
    ctx.lineTo(cx - half * 0.62, cy);
    ctx.closePath();
    ctx.stroke();
  } else if (symbol === "star") {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const radius = i % 2 === 0 ? half * 0.72 : half * 0.3;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  } else if (symbol === "burst") {
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i * Math.PI) / 4;
      ctx.moveTo(cx + Math.cos(angle) * half * 0.18, cy + Math.sin(angle) * half * 0.18);
      ctx.lineTo(cx + Math.cos(angle) * half * 0.68, cy + Math.sin(angle) * half * 0.68);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, half * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (symbol === "rainbow") {
    TILE_STYLES.forEach((style, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / TILE_STYLES.length;
      ctx.beginPath();
      ctx.fillStyle = style.color;
      ctx.arc(
        cx + Math.cos(angle) * half * 0.42,
        cy + Math.sin(angle) * half * 0.42,
        half * 0.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, half * 0.74, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

export function createRenderer(canvas, { reducedMotion = false, onStats = null } = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("createRenderer 需要 canvas");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new TypeError("无法获取 2D 上下文");

  let layout = computeLayout({ width: 320, height: 320, rows: 8, cols: 8 });
  let board = null;
  let selection = null;
  let cursor = [0, 0];
  let cursorVisible = false;
  let hammerMode = false;
  let hover = null;
  let drag = null;
  let paused = false;
  let colorblind = false;
  let dirty = true;
  let running = false;
  let rafId = 0;
  let lastFrameAt = 0;
  let frameTimes = [];
  let grain = [];
  let scale = 1;
  let anim = null;
  let animResolve = null;
  let particles = [];
  let combo = null;
  let shakeUntil = 0;
  let reduced = Boolean(reducedMotion);
  let destroyed = false;

  function now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  function rebuildGrain(width, height) {
    const rng = makeRng(20261026);
    const count = Math.max(60, Math.round((width * height) / 2600));
    grain = Array.from({ length: count }, () => ({
      x: rng() * width,
      y: rng() * height,
      r: 0.4 + rng() * 0.9,
      alpha: 0.025 + rng() * 0.04,
    }));
  }

  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || canvas.clientWidth || 320);
    const height = Math.max(1, rect.height || canvas.clientHeight || width);
    const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padding = Math.max(8, width * 0.018);
    const gap = Math.max(3, width * 0.012);
    layout = computeLayout({
      width,
      height,
      rows: board?.rows ?? 8,
      cols: board?.cols ?? 8,
      padding,
      gap,
    });
    rebuildGrain(width, height);
    dirty = true;
  }

  function layoutInfo() {
    return layout;
  }

  function setBoard(nextBoard) {
    if (!nextBoard) return;
    if (board?.rows !== nextBoard.rows || board?.cols !== nextBoard.cols) {
      board = nextBoard;
      resize();
      return;
    }
    board = nextBoard;
    dirty = true;
  }

  function syncBoard(nextBoard) {
    anim = null;
    if (animResolve) {
      const resolve = animResolve;
      animResolve = null;
      resolve();
    }
    setBoard(nextBoard);
  }

  function setInteraction(next = {}) {
    if ("selection" in next) selection = next.selection;
    if ("cursor" in next) cursor = next.cursor ?? [0, 0];
    if ("cursorVisible" in next) cursorVisible = Boolean(next.cursorVisible);
    if ("hammer" in next) hammerMode = Boolean(next.hammer);
    if ("hover" in next) hover = next.hover;
    if ("drag" in next) drag = next.drag;
    dirty = true;
  }

  function setColorblind(value) {
    colorblind = Boolean(value);
    dirty = true;
  }

  function setPaused(value) {
    paused = Boolean(value);
    dirty = true;
  }

  function setReducedMotion(value) {
    reduced = Boolean(value);
  }

  function shake() {
    if (reduced) return;
    shakeUntil = now() + 190;
    dirty = true;
  }

  function spawnParticles(item) {
    if (reduced) return;
    const at = now();
    for (const tile of item.clearedTiles ?? []) {
      const rect = cellRect(layout, tile.pos[0], tile.pos[1]);
      const style = tileStyle(tile.kind) ?? TILE_STYLES[0];
      const count = 4;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2 + hash(at + i) * 0.9;
        const speed = 16 + hash(at + i * 3) * 26;
        particles.push({
          x: rect.centerX,
          y: rect.centerY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 12,
          bornAt: at,
          life: 380 + hash(at + i * 7) * 220,
          size: Math.max(1.5, rect.width * (0.035 + hash(at + i * 11) * 0.045)),
          color: style.color,
        });
      }
    }
  }

  function finishAnimation() {
    if (animResolve) {
      const resolve = animResolve;
      animResolve = null;
      resolve();
    }
    anim = null;
    dirty = true;
  }

  /**
   * 播放一整批连锁。返回的 Promise 只表示动画批次结束，不参与规则判定。
   * 即使调用方在 2.4s 兜底时提前解锁，动画也会继续把画面收尾。
   */
  function play(steps, targetBoard = null, move = null) {
    if (!board || !Array.isArray(steps) || steps.length === 0) {
      if (targetBoard) syncBoard(targetBoard);
      return Promise.resolve();
    }
    if (animResolve) finishAnimation();
    const start = swapBoard(board, move);
    const plan = planSteps(start, steps);
    if (reduced) {
      board = targetBoard ?? plan.board;
      dirty = true;
      return Promise.resolve();
    }
    const timing = stepTiming(plan.items.length);
    anim = {
      items: plan.items,
      index: 0,
      stepMs: timing.stepMs,
      startedAt: now(),
      target: targetBoard ?? plan.board,
    };
    board = plan.items[0].before;
    combo = null;
    spawnParticles(plan.items[0]);
    if (plan.items[0].step.chain >= 2) {
      combo = { chain: plan.items[0].step.chain, until: now() + timing.stepMs };
    }
    return new Promise((resolve) => {
      animResolve = resolve;
    });
  }

  function advanceAnimation(time) {
    if (!anim) return;
    const item = anim.items[anim.index];
    if (!item) {
      finishAnimation();
      return;
    }
    const elapsed = time - anim.startedAt;
    if (elapsed >= anim.stepMs) {
      board = item.after;
      anim.index += 1;
      anim.startedAt += anim.stepMs;
      combo = null;
      if (anim.index >= anim.items.length) {
        if (anim.target) board = anim.target;
        finishAnimation();
        return;
      }
      const nextItem = anim.items[anim.index];
      spawnParticles(nextItem);
      if (nextItem.step.chain >= 2) {
        combo = { chain: nextItem.step.chain, until: now() + anim.stepMs };
      }
      dirty = true;
    }
  }

  function drawParticles(time) {
    if (particles.length === 0) return;
    const alive = [];
    for (const particle of particles) {
      const age = time - particle.bornAt;
      if (age > particle.life) continue;
      alive.push(particle);
      const t = age / particle.life;
      const x = particle.x + particle.vx * t;
      const y = particle.y + particle.vy * t + 26 * t * t;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(x, y, particle.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    particles = alive;
  }

  function drawBoardPlate() {
    const pad = layout.padding;
    const radii = organicRadii(Math.min(layout.width, layout.height), 41);
    roundedPath(ctx, pad, pad, layout.width - pad * 2, layout.height - pad * 2, radii);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.strokeStyle = "rgba(41, 37, 29, 0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const dot of grain) {
      ctx.globalAlpha = dot.alpha;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCellBase(row, col) {
    const rect = cellRect(layout, row, col);
    roundedPath(ctx, rect.x, rect.y, rect.width, rect.height, [
      rect.width * 0.2,
      rect.width * 0.24,
      rect.width * 0.18,
      rect.width * 0.22,
    ]);
    ctx.fillStyle = "rgba(41, 37, 29, 0.035)";
    ctx.fill();
  }

  function drawIce(row, col, level) {
    if (!level) return;
    const rect = cellRect(layout, row, col);
    const inset = rect.width * 0.04;
    roundedPath(
      ctx,
      rect.x + inset,
      rect.y + inset,
      rect.width - inset * 2,
      rect.height - inset * 2,
      [rect.width * 0.22, rect.width * 0.2, rect.width * 0.24, rect.width * 0.2],
    );
    ctx.fillStyle = ICE_FILL;
    ctx.fill();
    ctx.strokeStyle = ICE_EDGE;
    ctx.lineWidth = Math.max(1, rect.width * (level > 1 ? 0.045 : 0.028));
    ctx.stroke();

    if (level > 1) {
      const inner = rect.width * 0.17;
      roundedPath(
        ctx,
        rect.x + inner,
        rect.y + inner,
        rect.width - inner * 2,
        rect.height - inner * 2,
        [rect.width * 0.14, rect.width * 0.12, rect.width * 0.16, rect.width * 0.12],
      );
      ctx.strokeStyle = "rgba(68, 59, 47, 0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rect.centerX - rect.width * 0.22, rect.centerY - rect.height * 0.08);
      ctx.lineTo(rect.centerX, rect.centerY + rect.height * 0.12);
      ctx.lineTo(rect.centerX + rect.width * 0.18, rect.centerY - rect.height * 0.18);
      ctx.strokeStyle = "rgba(41, 37, 29, 0.2)";
      ctx.stroke();
    }
  }

  function drawTile(tile, row, col, { alpha = 1, scaleTile = 1, offsetY = 0, offsetX = 0 } = {}) {
    if (!tile) return;
    const style = tileStyle(tile.kind);
    if (!style) return;
    const rect = cellRect(layout, row, col);
    const seed = tile.id ?? row * 31 + col;
    const size = Math.min(rect.width, rect.height) * 0.86 * scaleTile;
    const jitterX = (hash(seed + 3) - 0.5) * rect.width * 0.045;
    const jitterY = (hash(seed + 9) - 0.5) * rect.height * 0.045;
    const cx = rect.centerX + jitterX + offsetX;
    const cy = rect.centerY + jitterY + offsetY;
    const rotation = (hash(seed + 21) - 0.5) * 0.14;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    const x = -size / 2;
    const y = -size / 2;
    const radii = organicRadii(size, seed + 5);

    roundedPath(ctx, x, y + size * 0.045, size, size, radii);
    ctx.fillStyle = style.rim;
    ctx.globalAlpha = alpha * 0.32;
    ctx.fill();
    ctx.globalAlpha = alpha;

    roundedPath(ctx, x, y, size, size, radii);
    ctx.fillStyle = style.color;
    ctx.fill();
    ctx.strokeStyle = style.rim;
    ctx.lineWidth = Math.max(1.2, size * 0.045);
    ctx.stroke();

    // 平面高光：一块偏上的浅色弧，不使用渐变。
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.3, Math.PI * 1.08, Math.PI * 1.92);
    ctx.strokeStyle = "rgba(245, 237, 223, 0.16)";
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.stroke();

    const glyphColor = colorblind ? COLORS.surface : "rgba(245, 237, 223, 0.75)";
    const glyphAlpha = colorblind ? 0.96 : 0.3;
    drawSymbol(ctx, style.symbol, 0, 0, size, glyphColor, glyphAlpha);

    ctx.restore();
  }

  function drawSelection() {
    if (!selection) return;
    const [row, col] = selection;
    if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) return;
    const rect = cellRect(layout, row, col);
    const inflate = rect.width * 0.06;
    roundedPath(
      ctx,
      rect.x - inflate,
      rect.y - inflate,
      rect.width + inflate * 2,
      rect.height + inflate * 2,
      [rect.width * 0.26, rect.width * 0.22, rect.width * 0.28, rect.width * 0.24],
    );
    ctx.strokeStyle = COLORS.artAccent;
    ctx.lineWidth = Math.max(2, rect.width * 0.055);
    ctx.stroke();
    ctx.strokeStyle = "rgba(41, 37, 29, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawCursor() {
    if (!cursorVisible || !Array.isArray(cursor)) return;
    const rect = cellRect(layout, cursor[0], cursor[1]);
    const inset = rect.width * 0.01;
    const x = rect.x - inset;
    const y = rect.y - inset;
    const w = rect.width + inset * 2;
    const h = rect.height + inset * 2;
    const arm = Math.max(6, rect.width * 0.2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.6, rect.width * 0.035);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y + arm);
    ctx.lineTo(x, y);
    ctx.lineTo(x + arm, y);
    ctx.moveTo(x + w - arm, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + arm);
    ctx.moveTo(x + w, y + h - arm);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - arm, y + h);
    ctx.moveTo(x + arm, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + h - arm);
    ctx.stroke();
  }

  function drawHover() {
    if (!hover || !Array.isArray(hover)) return;
    const rect = cellRect(layout, hover[0], hover[1]);
    ctx.strokeStyle = hammerMode ? COLORS.field : "rgba(41, 37, 29, 0.28)";
    ctx.lineWidth = hammerMode ? 2.4 : 1.4;
    ctx.setLineDash(hammerMode ? [5, 4] : []);
    roundedPath(ctx, rect.x, rect.y, rect.width, rect.height, [
      rect.width * 0.22,
      rect.width * 0.22,
      rect.width * 0.22,
      rect.width * 0.22,
    ]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (hammerMode) {
      const cx = rect.centerX;
      const cy = rect.centerY;
      ctx.strokeStyle = COLORS.field;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rect.width * 0.22, 0, Math.PI * 2);
      ctx.moveTo(cx - rect.width * 0.3, cy);
      ctx.lineTo(cx + rect.width * 0.3, cy);
      ctx.moveTo(cx, cy - rect.height * 0.3);
      ctx.lineTo(cx, cy + rect.height * 0.3);
      ctx.stroke();
    }
  }

  function drawDrag() {
    if (!drag || !drag.from) return;
    const from = cellRect(layout, drag.from[0], drag.from[1]);
    const to = drag.to ? cellRect(layout, drag.to[0], drag.to[1]) : null;
    const targetX = to ? to.centerX : drag.currentX;
    const targetY = to ? to.centerY : drag.currentY;
    ctx.strokeStyle = COLORS.artAccent;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(from.centerX, from.centerY);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();

    const angle = Math.atan2(targetY - from.centerY, targetX - from.centerX);
    ctx.beginPath();
    ctx.moveTo(targetX, targetY);
    ctx.lineTo(
      targetX - Math.cos(angle - 0.5) * from.width * 0.16,
      targetY - Math.sin(angle - 0.5) * from.width * 0.16,
    );
    ctx.moveTo(targetX, targetY);
    ctx.lineTo(
      targetX - Math.cos(angle + 0.5) * from.width * 0.16,
      targetY - Math.sin(angle + 0.5) * from.width * 0.16,
    );
    ctx.stroke();
  }

  function drawCombo() {
    if (!combo) return;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = COLORS.field;
    ctx.font = `600 ${Math.max(18, layout.cell * 0.46)}px Georgia, "Songti SC", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Combo ×${combo.chain}`, layout.width / 2, layout.originY + layout.cell * 0.6);
    ctx.restore();
  }

  function drawBoardWithState(stateBoard, item, phase) {
    if (!stateBoard) return;
    const popping = item && phase < 0.45;
    const dropping = item && phase >= 0.3;
    const dropProgress = item ? easeOutCubic(Math.min(1, Math.max(0, (phase - 0.3) / 0.7))) : 1;
    const popProgress = item ? easeInQuad(Math.min(1, phase / 0.45)) : 0;
    const cleared = new Set(
      popping ? (item.step.cleared ?? []).map((pos) => `${pos[0]},${pos[1]}`) : [],
    );
    const moving = new Map();
    if (dropping && item) {
      for (const fall of item.falls ?? []) {
        moving.set(`${fall.to[0]},${fall.to[1]}`, fall.from);
      }
    }
    const refillKeys = new Set(
      dropping && item ? (item.refills ?? []).map((refill) => `${refill.at[0]},${refill.at[1]}`) : [],
    );

    for (let r = 0; r < stateBoard.rows; r += 1) {
      for (let c = 0; c < stateBoard.cols; c += 1) {
        drawCellBase(r, c);
        const tile = stateBoard.tiles?.[r]?.[c];
        if (!tile) continue;

        if (cleared.has(`${r},${c}`)) {
          drawTile(tile, r, c, { alpha: 1 - popProgress, scaleTile: 1 - popProgress * 0.35 });
          continue;
        }

        if (dropping && moving.has(`${r},${c}`)) {
          const from = moving.get(`${r},${c}`);
          const offsetY = (from[0] - r) * layout.cell * (1 - dropProgress);
          drawTile(tile, r, c, { offsetY });
          continue;
        }
        if (dropping && refillKeys.has(`${r},${c}`)) {
          const offsetY = -(r + 1) * layout.cell * (1 - dropProgress);
          drawTile(tile, r, c, { offsetY });
          continue;
        }
        drawTile(tile, r, c);
      }
    }

    for (let r = 0; r < stateBoard.rows; r += 1) {
      for (let c = 0; c < stateBoard.cols; c += 1) {
        const iceStill = !dropping || !item || !moving.has(`${r},${c}`) && !refillKeys.has(`${r},${c}`);
        if (iceStill) drawIce(r, c, stateBoard.ice?.[r]?.[c] ?? 0);
      }
    }
  }

  function draw(time) {
    ctx.clearRect(0, 0, layout.width, layout.height);
    ctx.save();

    if (time < shakeUntil && !reduced) {
      const remaining = (shakeUntil - time) / 190;
      ctx.translate(Math.sin((shakeUntil - time) / 14) * 3 * remaining, 0);
    }

    drawBoardPlate();

    if (!board) {
      ctx.restore();
      return;
    }

    if (anim) {
      const item = anim.items[anim.index];
      const elapsed = time - anim.startedAt;
      const phase = anim.stepMs > 0 ? Math.min(1, Math.max(0, elapsed / anim.stepMs)) : 1;
      const stateBoard = phase < 0.3 ? item.before : item.after;
      drawBoardWithState(stateBoard, item, phase);
      drawParticles(time);
      drawCombo();
    } else {
      drawBoardWithState(board, null, 1);
      drawParticles(time);
      drawSelection();
      drawHover();
      drawDrag();
      drawCursor();
    }

    if (paused) {
      ctx.fillStyle = "rgba(245, 237, 223, 0.62)";
      ctx.fillRect(0, 0, layout.width, layout.height);
    }

    ctx.restore();
  }

  function frame(time = now()) {
    if (destroyed) return;
    const cadence = reduced ? 250 : 1000 / 60;
    if (time - lastFrameAt >= cadence) {
      const index = anim ? anim.index : -1;
      advanceAnimation(time);
      if (anim && anim.index !== index) dirty = true;
      frameTimes.push(time);
      while (frameTimes.length > 0 && time - frameTimes[0] > 1000) frameTimes.shift();
      const stats = {
        fps: frameTimes.length,
        animating: Boolean(anim),
        particles: particles.length,
      };
      onStats?.(stats);
      if (dirty || anim || particles.length > 0 || combo || time < shakeUntil) {
        draw(time);
        dirty = false;
      }
      lastFrameAt = time;
    }
    rafId = globalThis.requestAnimationFrame(frame);
  }

  function start() {
    if (running || destroyed) return;
    running = true;
    resize();
    rafId = globalThis.requestAnimationFrame(frame);
  }

  function destroy() {
    destroyed = true;
    running = false;
    if (rafId) globalThis.cancelAnimationFrame?.(rafId);
    resizeObserver?.disconnect?.();
    globalThis.removeEventListener?.("resize", resize);
    if (animResolve) {
      const resolve = animResolve;
      animResolve = null;
      resolve();
    }
  }

  let resizeObserver = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvas);
  }
  globalThis.addEventListener?.("resize", resize);

  return {
    start,
    destroy,
    resize,
    frame,
    layoutInfo,
    setBoard,
    syncBoard,
    setInteraction,
    setColorblind,
    setPaused,
    setReducedMotion,
    play,
    shake,
    stats: () => ({ fps: frameTimes.length, animating: Boolean(anim) }),
    get isPlaying() {
      return Boolean(anim);
    },
  };
}

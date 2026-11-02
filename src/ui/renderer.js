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
import { createEffectSystem, effectForStep } from "./effects.js";

const PAPER = COLORS.surface;
const INK = COLORS.ink;
const ICE_FILL = "rgba(178, 226, 244, 0.5)";
const ICE_EDGE = "rgba(39, 112, 145, 0.9)";
const ICE_GLOW = "rgba(82, 183, 219, 0.55)";

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

/** 炸弹：不是浅色线稿，而是“白热核心 + 旋转金色日珥”。 */
function drawBombGlyph(c, size, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time / 230);
  const core = size * (0.2 + pulse * 0.035);
  c.save();
  c.globalCompositeOperation = "lighter";

  const glow = c.createRadialGradient(0, 0, 0, 0, 0, size * 0.62);
  glow.addColorStop(0, "rgba(255, 252, 235, .95)");
  glow.addColorStop(0.18, "rgba(255, 210, 126, .9)");
  glow.addColorStop(0.5, "rgba(235, 126, 45, .3)");
  glow.addColorStop(1, "rgba(235, 126, 45, 0)");
  c.fillStyle = glow;
  c.beginPath();
  c.arc(0, 0, size * 0.62, 0, Math.PI * 2);
  c.fill();

  c.save();
  c.rotate(time / 1250);
  c.shadowColor = "rgba(255, 166, 64, .85)";
  c.shadowBlur = size * 0.16;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI) / 4;
    const long = size * (0.44 + 0.045 * Math.sin(time / 280 + i * 1.7));
    const short = size * 0.12;
    const width = size * 0.055;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    c.beginPath();
    c.moveTo(cos * short, sin * short);
    c.lineTo(cos * long - sin * width, sin * long + cos * width);
    c.lineTo(cos * long + sin * width, sin * long - cos * width);
    c.closePath();
    c.fillStyle = "rgba(255, 228, 164, .98)";
    c.fill();
  }
  c.restore();

  c.beginPath();
  c.arc(0, 0, core, 0, Math.PI * 2);
  c.fillStyle = "#fffdf2";
  c.fill();
  c.strokeStyle = "rgba(255, 191, 96, .85)";
  c.lineWidth = Math.max(1, size * 0.035);
  c.stroke();
  c.restore();
}

/** 彩虹：暗底上的棱镜核，五色光点带独立光晕。 */
function drawRainbowGlyph(c, size, time) {
  c.save();
  c.globalCompositeOperation = "lighter";
  const ring = size * 0.34;
  TILE_STYLES.forEach((style, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / TILE_STYLES.length + time / 2200;
    const x = Math.cos(angle) * ring;
    const y = Math.sin(angle) * ring;
    const glow = c.createRadialGradient(x, y, 0, x, y, size * 0.22);
    glow.addColorStop(0, style.color);
    glow.addColorStop(0.4, style.color);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = glow;
    c.beginPath();
    c.arc(x, y, size * 0.22, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(255,255,245,.9)";
    c.beginPath();
    c.arc(x, y, size * 0.035, 0, Math.PI * 2);
    c.fill();
  });
  const core = c.createRadialGradient(0, 0, 0, 0, 0, size * 0.2);
  core.addColorStop(0, "rgba(255,255,255,.95)");
  core.addColorStop(0.35, "rgba(255,235,250,.7)");
  core.addColorStop(1, "rgba(255,235,250,0)");
  c.fillStyle = core;
  c.beginPath();
  c.arc(0, 0, size * 0.2, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "rgba(255,245,255,.45)";
  c.lineWidth = Math.max(1, size * 0.018);
  c.beginPath();
  c.arc(0, 0, size * 0.26, 0, Math.PI * 2);
  c.stroke();
  c.restore();
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
  let bursts = [];
  let combo = null;
  let shakeUntil = 0;
  let flashUntil = 0;
  let clockMs = 0;
  let reduced = Boolean(reducedMotion);
  let destroyed = false;
  const effects = createEffectSystem({ reducedMotion: reduced });

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
    effects.setReducedMotion(reduced);
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

  function triggerLayeredEffect(item) {
    if (reduced) return;
    const spec = effectForStep(item?.step);
    if (!spec) return;
    const [row, col] = spec.pos ?? [];
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) return;
    const rect = cellRect(layout, row, col);
    const tile = (item.step.clearedTiles ?? []).find(
      (entry) => entry.pos?.[0] === row && entry.pos?.[1] === col,
    );
    const color =
      spec.kind === "frost"
        ? "#9fe8ff"
        : spec.kind === "gravity"
          ? "#e4b5ef"
          : "#ffd28a";
    effects.trigger(spec.kind, {
      x: rect.centerX,
      y: rect.centerY,
      color,
      cell: rect.width,
      now: now(),
    });
    dirty = true;
  }

  function spawnSpecialBurst(item) {
    if (reduced) return;
    const step = item?.step;
    if (!step) return;
    triggerLayeredEffect(item);
    const at = now();
    const points = [];
    for (const spawn of step.spawned ?? []) points.push({ pos: spawn.at, kind: spawn.kind });
    for (const tile of step.clearedTiles ?? []) {
      if (tile.kind === "bomb" || tile.kind === "rainbow") points.push({ pos: tile.pos, kind: tile.kind });
    }
    if ((step.score?.specialBonus ?? 0) > 0 && points.length === 0) {
      points.push({ pos: step.cleared?.[0] ?? [4, 4], kind: "bomb" });
    }
    if (points.length === 0) return;
    for (const point of points) {
      const rect = cellRect(layout, point.pos[0], point.pos[1]);
      bursts.push({
        x: rect.centerX,
        y: rect.centerY,
        bornAt: at,
        life: 560,
        radius: rect.width * (point.kind === "rainbow" ? 1.45 : 1.05),
        color: point.kind === "rainbow" ? "rgba(176, 112, 190, 0.9)" : "rgba(230, 142, 68, 0.9)",
      });
    }
    flashUntil = Math.max(flashUntil, at + 180);
    shake();
    dirty = true;
  }

  function drawSpecialBursts(time) {
    if (bursts.length === 0) return;
    const alive = [];
    for (const burst of bursts) {
      const age = time - burst.bornAt;
      if (age > burst.life) continue;
      alive.push(burst);
      const t = Math.max(0, Math.min(1, age / burst.life));
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = Math.max(1.5, burst.radius * 0.06 * (1 - t));
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, burst.radius * (0.35 + t * 0.85), 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i += 1) {
        const angle = (i * Math.PI) / 4 + t * 0.35;
        const inner = burst.radius * (0.2 + t * 0.45);
        const outer = burst.radius * (0.55 + t * 0.7);
        ctx.beginPath();
        ctx.moveTo(burst.x + Math.cos(angle) * inner, burst.y + Math.sin(angle) * inner);
        ctx.lineTo(burst.x + Math.cos(angle) * outer, burst.y + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }
    bursts = alive;
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
    spawnSpecialBurst(plan.items[0]);
    if (plan.items[0].step.chain >= 2) {
      showCombo(plan.items[0].step.chain, timing.stepMs);
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
      spawnSpecialBurst(nextItem);
      if (nextItem.step.chain >= 2) {
        showCombo(nextItem.step.chain, anim.stepMs);
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
    const inset = rect.width * 0.03;
    const frost = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
    frost.addColorStop(0, "rgba(230, 250, 255, 0.72)");
    frost.addColorStop(0.5, "rgba(165, 220, 240, 0.42)");
    frost.addColorStop(1, "rgba(94, 172, 205, 0.52)");

    roundedPath(
      ctx,
      rect.x + inset,
      rect.y + inset,
      rect.width - inset * 2,
      rect.height - inset * 2,
      [rect.width * 0.22, rect.width * 0.2, rect.width * 0.24, rect.width * 0.2],
    );
    ctx.fillStyle = frost;
    ctx.fill();
    ctx.save();
    ctx.shadowColor = ICE_GLOW;
    ctx.shadowBlur = rect.width * 0.22;
    ctx.strokeStyle = ICE_EDGE;
    ctx.lineWidth = Math.max(2, rect.width * (level > 1 ? 0.07 : 0.05));
    ctx.stroke();
    ctx.restore();

    // 六角雪花：让冰层不只依赖颜色，也能远距离识别。
    const arm = rect.width * 0.26;
    ctx.save();
    ctx.translate(rect.centerX, rect.centerY);
    ctx.strokeStyle = "rgba(22, 91, 122, 0.9)";
    ctx.lineWidth = Math.max(1.5, rect.width * 0.035);
    ctx.lineCap = "round";
    for (let i = 0; i < 6; i += 1) {
      const angle = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * arm, Math.sin(angle) * arm);
      ctx.stroke();
      const bx = Math.cos(angle) * arm * 0.58;
      const by = Math.sin(angle) * arm * 0.58;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle + 0.7) * arm * 0.22, by + Math.sin(angle + 0.7) * arm * 0.22);
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle - 0.7) * arm * 0.22, by + Math.sin(angle - 0.7) * arm * 0.22);
      ctx.stroke();
    }
    ctx.restore();

    if (level > 1) {
      const badge = rect.width * 0.3;
      ctx.beginPath();
      ctx.arc(rect.x + rect.width - badge * 0.62, rect.y + badge * 0.62, badge * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(26, 92, 122, 0.94)";
      ctx.fill();
      ctx.fillStyle = "#f4fcff";
      ctx.font = `700 ${Math.max(10, rect.width * 0.24)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("2", rect.x + rect.width - badge * 0.62, rect.y + badge * 0.62);
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

    if (tile.kind === "bomb" || tile.kind === "rainbow") {
      const pulse = 0.5 + 0.5 * Math.sin(clockMs / 170 + seed);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha * 0.7;
      const aura = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.72);
      aura.addColorStop(0, tile.kind === "rainbow" ? "rgba(214, 150, 235, .38)" : "rgba(255, 170, 72, .42)");
      aura.addColorStop(0.45, tile.kind === "rainbow" ? "rgba(180, 110, 220, .15)" : "rgba(235, 120, 40, .16)");
      aura.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha * (0.28 + pulse * 0.3);
      ctx.strokeStyle = tile.kind === "rainbow" ? "#e4b5ef" : "#ffc37a";
      ctx.lineWidth = Math.max(2, size * 0.06);
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = size * 0.22;
      ctx.beginPath();
      ctx.arc(0, 0, size * (0.55 + pulse * 0.08), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

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

    if (tile.kind === "bomb") {
      drawBombGlyph(ctx, size, clockMs);
    } else if (tile.kind === "rainbow") {
      drawRainbowGlyph(ctx, size, clockMs);
    } else {
      const glyphColor = colorblind ? COLORS.surface : "rgba(245, 237, 223, 0.75)";
      const glyphAlpha = colorblind ? 0.96 : 0.3;
      drawSymbol(ctx, style.symbol, 0, 0, size, glyphColor, glyphAlpha);
    }

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

  function showCombo(chain, duration) {
    const at = now();
    combo = { chain, bornAt: at, until: at + Math.max(260, duration) };
    shakeUntil = Math.max(shakeUntil, at + 280);
  }

  function drawCombo(time) {
    if (!combo || time > combo.until) return;
    const age = Math.max(0, time - combo.bornAt);
    const span = Math.max(1, combo.until - combo.bornAt);
    const t = Math.min(1, age / span);
    const intro = Math.min(1, age / 170);
    const settle = easeOutCubic(intro);
    const pop = 0.72 + settle * 0.28 + Math.sin(intro * Math.PI) * 0.12;
    const fade = t > 0.72 ? Math.max(0, 1 - (t - 0.72) / 0.28) : 1;
    const shakeX = Math.sin(age * 0.09) * (1 - settle) * 10;
    const shakeY = Math.cos(age * 0.13) * (1 - settle) * 5;
    const bannerWidth = Math.min(layout.width * 0.86, 420);
    const bannerHeight = Math.max(48, layout.cell * 0.92);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(layout.width / 2 + shakeX, layout.originY + layout.cell * 1.38 + shakeY);
    ctx.rotate(-0.075 + Math.sin(age * 0.02) * 0.012);
    ctx.scale(pop, pop);

    ctx.save();
    ctx.shadowColor = "rgba(41, 37, 29, 0.22)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    roundedPath(
      ctx,
      -bannerWidth / 2,
      -bannerHeight / 2,
      bannerWidth,
      bannerHeight,
      [14, 10, 16, 12],
    );
    ctx.fillStyle = "rgba(255, 250, 240, 0.94)";
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(41, 37, 29, 0.16)";
    ctx.lineWidth = 2;
    roundedPath(
      ctx,
      -bannerWidth / 2,
      -bannerHeight / 2,
      bannerWidth,
      bannerHeight,
      [14, 10, 16, 12],
    );
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.max(30, Math.min(58, layout.cell * 0.78))}px "Segoe UI", "PingFang SC", system-ui, sans-serif`;
    ctx.lineWidth = 8;
    ctx.strokeStyle = COLORS.surface;
    ctx.strokeText(`COMBO ×${combo.chain}`, 0, 1);
    ctx.fillStyle = combo.chain >= 5 ? "#b33f2c" : COLORS.field;
    ctx.fillText(`COMBO ×${combo.chain}`, 0, 1);
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
    clockMs = time;
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
      drawSpecialBursts(time);
      drawCombo(time);
    } else {
      drawBoardWithState(board, null, 1);
      drawParticles(time);
      drawSpecialBursts(time);
      drawSelection();
      drawHover();
      drawDrag();
      drawCursor();
    }

    effects.drawBackdrop(ctx, time);
    effects.draw(ctx, time);

    if (time < flashUntil && !reduced) {
      const opacity = Math.max(0, (flashUntil - time) / 180) * 0.22;
      ctx.fillStyle = `rgba(255, 246, 214, ${opacity})`;
      ctx.fillRect(0, 0, layout.width, layout.height);
    }

    if (paused) {
      ctx.fillStyle = "rgba(245, 237, 223, 0.62)";
      ctx.fillRect(0, 0, layout.width, layout.height);
    }

    ctx.restore();
  }

  function frame(time = now()) {
    if (destroyed) return;
    // 阈值略低于一帧，避免 16.6ms / 16.67ms 的抖动把 60Hz 降到 30Hz。
    const cadence = reduced ? 250 : 1000 / 120;
    if (time - lastFrameAt >= cadence) {
      const index = anim ? anim.index : -1;
      advanceAnimation(time);
      effects.update(time);
      if (anim && anim.index !== index) dirty = true;
      frameTimes.push(time);
      while (frameTimes.length > 0 && time - frameTimes[0] > 1000) frameTimes.shift();
      const stats = {
        fps: frameTimes.length,
        animating: Boolean(anim),
        particles: particles.length,
      };
      onStats?.(stats);
      const hasSpecial = board?.tiles?.some((row) =>
        row.some((tile) => tile?.kind === "bomb" || tile?.kind === "rainbow"),
      );
      if (
        dirty ||
        anim ||
        particles.length > 0 ||
        effects.count() > 0 ||
        combo ||
        time < shakeUntil ||
        hasSpecial
      ) {
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
    effects.clear();
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
    stats: () => ({ fps: frameTimes.length, animating: Boolean(anim), effects: effects.count() }),
    get isPlaying() {
      return Boolean(anim);
    },
  };
}

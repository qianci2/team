/* eslint-disable no-bitwise */
/**
 * 分层特效实验室（Canvas 2D）。
 *
 * 目的不是“一条 shader 线”，而是验证游戏内可用的分层效果：
 * 底层烟尘/光晕 + 中层液体彩带/引力轨道 + 顶层碎片/花瓣/火花。
 * 全部程序化绘制，零外部依赖，可直接移植到 src/ui/renderer.js。
 */

const canvas = document.querySelector("#lab");
const ctx = canvas.getContext("2d");
const autoButton = document.querySelector("#auto");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));

const GEMS = [
  { color: "#45c58b", light: "#b8ffe2", shape: "circle" },
  { color: "#f06b78", light: "#ffd0d4", shape: "square" },
  { color: "#f4bf56", light: "#fff0bd", shape: "triangle" },
  { color: "#5d9bf0", light: "#cfe3ff", shape: "diamond" },
  { color: "#b47ae8", light: "#ead4ff", shape: "star" },
];
const ROWS = 8;
const COLS = 8;
const TAU = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const easeOut = (t) => 1 - (1 - t) ** 3;

let width = 0;
let height = 0;
let dpr = 1;
let layout = { size: 0, cell: 0, gap: 0, left: 0, top: 0 };
let stars = [];
let board = [];
let fx = null;
let mode = 0;
let auto = true;
let lastTrigger = 0;
let lastFrame = 0;

function resize() {
  dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  width = globalThis.innerWidth;
  height = globalThis.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const size = Math.min(width * 0.84, height * 0.62);
  const gap = Math.max(5, size * 0.012);
  const cell = (size - gap * (COLS - 1)) / COLS;
  layout = {
    size,
    cell,
    gap,
    left: (width - size) / 2,
    top: (height - size) / 2 + height * 0.015,
  };
  stars = Array.from({ length: 150 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: rand(0.4, 1.7),
    a: rand(0.12, 0.65),
    phase: rand(0, TAU),
  }));
}

function cellCenter(row, col) {
  return [
    layout.left + col * (layout.cell + layout.gap) + layout.cell / 2,
    layout.top + row * (layout.cell + layout.gap) + layout.cell / 2,
  ];
}

function cellAt(x, y) {
  const col = Math.floor((x - layout.left) / (layout.cell + layout.gap));
  const row = Math.floor((y - layout.top) / (layout.cell + layout.gap));
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
  return [row, col];
}

function roundedRect(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function gemPath(shape, size) {
  const h = size / 2;
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(0, 0, h * 0.62, 0, TAU);
  } else if (shape === "square") {
    roundedRect(-h * 0.58, -h * 0.58, h * 1.16, h * 1.16, h * 0.18);
  } else if (shape === "triangle") {
    ctx.moveTo(0, -h * 0.7);
    ctx.lineTo(h * 0.66, h * 0.5);
    ctx.lineTo(-h * 0.66, h * 0.5);
    ctx.closePath();
  } else if (shape === "diamond") {
    ctx.moveTo(0, -h * 0.72);
    ctx.lineTo(h * 0.62, 0);
    ctx.lineTo(0, h * 0.72);
    ctx.lineTo(-h * 0.62, 0);
    ctx.closePath();
  } else {
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const radius = i % 2 === 0 ? h * 0.72 : h * 0.3;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

function drawGem(shape, color, light, x, y, size, alpha = 1, scale = 1, rotation = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;

  const gradient = ctx.createRadialGradient(-size * 0.18, -size * 0.24, size * 0.05, 0, 0, size * 0.7);
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.38, color);
  gradient.addColorStop(1, "#11151f");

  gemPath(shape, size);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.stroke();

  gemPath(shape, size * 0.55);
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-size * 0.14, -size * 0.2, size * 0.08, 0, TAU);
  ctx.fillStyle = "rgba(255,255,255,.82)";
  ctx.fill();
  ctx.restore();
}

function drawBoard(time, factor = 1) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const [cx, cy] = cellCenter(row, col);
      const gem = GEMS[board[row][col]];
      ctx.save();
      ctx.globalAlpha = factor;
      roundedRect(
        cx - layout.cell / 2,
        cy - layout.cell / 2,
        layout.cell,
        layout.cell,
        layout.cell * 0.2,
      );
      const tile = ctx.createLinearGradient(0, cy - layout.cell / 2, 0, cy + layout.cell / 2);
      tile.addColorStop(0, "rgba(255,255,255,.085)");
      tile.addColorStop(1, "rgba(0,0,0,.2)");
      ctx.fillStyle = tile;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.07)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const wobble = Math.sin(time * 0.8 + row * 1.7 + col * 2.3) * 0.012;
      drawGem(
        gem.shape,
        gem.color,
        gem.light,
        cx,
        cy,
        layout.cell * 0.78,
        1,
        1 + wobble,
        Math.sin(time * 0.5 + row + col) * 0.04,
      );
      ctx.restore();
    }
  }
}

function drawBackground(time, dim = 0) {
  const bg = ctx.createRadialGradient(width * 0.5, height * 0.38, 10, width * 0.5, height * 0.5, Math.max(width, height) * 0.8);
  bg.addColorStop(0, `rgba(24, 31, 48, ${0.95 - dim * 0.3})`);
  bg.addColorStop(0.5, "#0b0f19");
  bg.addColorStop(1, "#05070c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  for (const star of stars) {
    const twinkle = 0.55 + 0.45 * Math.sin(time * 0.9 + star.phase);
    ctx.globalAlpha = star.a * twinkle * (1 - dim * 0.4);
    ctx.fillStyle = "#dbeaff";
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function spawnSpark(x, y, color, count, speed, size = 2.2) {
  for (let i = 0; i < count; i += 1) {
    const angle = rand(0, TAU);
    const velocity = rand(speed * 0.25, speed);
    fx.sparks.push({
      x, y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      age: 0,
      life: rand(0.45, 1.25),
      size: rand(size * 0.4, size),
      color,
      gravity: rand(20, 140),
      drag: rand(1.4, 3.8),
    });
  }
}

function spawnSmoke(x, y, color, count, size, speed = 30) {
  for (let i = 0; i < count; i += 1) {
    const angle = rand(0, TAU);
    fx.smoke.push({
      x: x + rand(-8, 8),
      y: y + rand(-8, 8),
      vx: Math.cos(angle) * rand(0, speed),
      vy: Math.sin(angle) * rand(0, speed) - rand(4, 22),
      age: 0,
      life: rand(0.9, 2.2),
      size: rand(size * 0.4, size),
      grow: rand(0.4, 1.2),
      color,
      alpha: rand(0.05, 0.16),
    });
  }
}

function spawnShards(x, y, color, count, size) {
  for (let i = 0; i < count; i += 1) {
    const sides = Math.floor(rand(3, 6));
    const points = [];
    for (let s = 0; s < sides; s += 1) {
      const angle = (s / sides) * TAU + rand(-0.25, 0.25);
      const radius = rand(0.45, 1) * size;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    fx.shards.push({
      x, y,
      vx: rand(-230, 230),
      vy: rand(-280, 40),
      age: 0,
      life: rand(0.7, 1.7),
      size,
      rotation: rand(0, TAU),
      spin: rand(-9, 9),
      color,
      points,
      gravity: rand(360, 620),
    });
  }
}

function spawnPetals(x, y, color, light, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = rand(0, TAU);
    const speed = rand(70, 250);
    fx.petals.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rand(0, 60),
      age: 0,
      life: rand(0.7, 1.4),
      length: rand(42, 112),
      width: rand(9, 24),
      rotation: angle + rand(-0.5, 0.5),
      spin: rand(-4, 4),
      color,
      light,
      alpha: rand(0.5, 0.95),
    });
  }
}

function spawnRing(x, y, color, radius, width = 10) {
  fx.rings.push({ x, y, radius: 8, target: radius, width, color, age: 0, life: 0.85 });
}

function addCrack(x, y, angle, length, width, depth, color) {
  const points = [];
  let px = x;
  let py = y;
  let a = angle;
  const steps = Math.floor(length / 4);
  for (let i = 0; i < steps; i += 1) {
    a += rand(-0.2, 0.2);
    px += Math.cos(a) * 4;
    py += Math.sin(a) * 4;
    points.push([px, py]);
  }
  fx.cracks.push({ points, width, color, age: 0, life: 1.5 });
  if (depth > 0 && Math.random() < 0.35) {
    const branchAt = points[Math.floor(rand(1, points.length - 1))];
    if (branchAt) {
      addCrack(branchAt[0], branchAt[1], a + rand(-0.9, 0.9), length * 0.45, width * 0.6, depth - 1, color);
    }
  }
}

function makeRibbon(color, start, end) {
  const points = [];
  const mx = (start[0] + end[0]) / 2 + rand(-160, 160);
  const my = (start[1] + end[1]) / 2 + rand(-160, 160);
  for (let i = 0; i <= 64; i += 1) {
    const t = i / 64;
    const inv = 1 - t;
    const x = inv * inv * start[0] + 2 * inv * t * mx + t * t * end[0];
    const y = inv * inv * start[1] + 2 * inv * t * my + t * t * end[1];
    points.push([x, y + Math.sin(t * 12 + rand(-0.3, 0.3)) * 14 * Math.sin(t * Math.PI)]);
  }
  return { points, color, progress: 0, speed: rand(1.1, 1.7), width: rand(8, 18) };
}

function edgePoint() {
  const side = Math.floor(rand(0, 4));
  const left = layout.left;
  const top = layout.top;
  const size = layout.size;
  if (side === 0) return [rand(left, left + size), top - 30];
  if (side === 1) return [left + size + 30, rand(top, top + size)];
  if (side === 2) return [rand(left, left + size), top + size + 30];
  return [left - 30, rand(top, top + size)];
}

function start(kind, row = 3, col = 3) {
  const [x, y] = cellCenter(row, col);
  const gem = GEMS[board[row][col]];
  fx = {
    kind, t: 0, x, y, row, col,
    color: gem.color, light: gem.light,
    sparks: [], smoke: [], shards: [], petals: [], rings: [], cracks: [], ribbons: [], orbs: [],
    flash: 0, burst: false, shake: 0,
  };
  lastTrigger = performance.now();

  if (kind === 0) {
    for (const source of GEMS) {
      spawnPetals(x, y, source.color, source.light, 6);
    }
    spawnSpark(x, y, gem.light, 36, 260, 2.2);
    spawnSpark(x, y, gem.color, 64, 220, 3.2);
    spawnSmoke(x, y, "60, 40, 74", 30, 150, 45);
    spawnShards(x, y, gem.color, 24, layout.cell * 0.18);
    spawnRing(x, y, gem.light, layout.cell * 4.6, 10);
    spawnRing(x, y, gem.color, layout.cell * 2.8, 6);
    fx.flash = 0.55;
    fx.shake = 9;
  } else if (kind === 1) {
    addCrack(x, y, rand(0, TAU), layout.cell * 3.4, 7, 1, "rgba(235,250,255,.95)");
    for (let i = 0; i < 7; i += 1) {
      addCrack(
        x,
        y,
        (i / 7) * TAU + rand(-0.2, 0.2),
        layout.cell * rand(1.8, 3.6),
        rand(4, 8),
        1,
        "rgba(220,245,255,.9)",
      );
    }
    spawnShards(x, y, "rgba(195,235,255,1)", 44, layout.cell * 0.32);
    spawnSpark(x, y, "#effcff", 46, 150, 2);
    spawnSmoke(x, y, "90, 160, 200", 32, 130, 18);
    spawnRing(x, y, "#d8f6ff", layout.cell * 3.4, 8);
    fx.flash = 0.4;
    fx.shake = 3;
  } else if (kind === 2) {
    const startPoint = edgePoint();
    for (const g of GEMS) {
      fx.ribbons.push(makeRibbon(g.color, startPoint, [x, y]));
    }
    fx.ribbons.push(makeRibbon(gem.light, edgePoint(), [x, y]));
    spawnSmoke(x, y, "80, 60, 110", 18, 90, 18);
    fx.flash = 0.25;
  } else {
    for (let i = 0; i < 56; i += 1) {
      const angle = rand(0, TAU);
      const radius = rand(layout.cell * 1.2, layout.size * 0.72);
      const source = GEMS[Math.floor(rand(0, GEMS.length))];
      fx.orbs.push({
        angle,
        radius,
        startRadius: radius,
        speed: rand(2.2, 5.2),
        size: rand(layout.cell * 0.08, layout.cell * 0.2),
        color: source.color,
        light: source.light,
        trail: [],
      });
    }
    spawnSmoke(x, y, "38, 28, 58", 20, 130, 20);
    fx.flash = 0.2;
  }
}

function burst(kind) {
  if (!fx) return;
  if (kind === 2) {
    for (const gem of GEMS) spawnSpark(fx.x, fx.y, gem.color, 26, 300, 3.2);
    spawnSmoke(fx.x, fx.y, "92, 60, 120", 28, 130, 35);
    spawnRing(fx.x, fx.y, fx.light, layout.cell * 4.4, 12);
    fx.flash = 0.85;
    fx.shake = 7;
  } else if (kind === 3) {
    spawnSpark(fx.x, fx.y, fx.light, 120, 360, 3.6);
    for (const gem of GEMS) spawnSpark(fx.x, fx.y, gem.color, 18, 240, 3.2);
    spawnShards(fx.x, fx.y, fx.color, 26, layout.cell * 0.18);
    spawnSmoke(fx.x, fx.y, "42, 30, 66", 26, 125, 32);
    spawnRing(fx.x, fx.y, fx.light, layout.cell * 5.4, 16);
    fx.flash = 1;
    fx.shake = 9;
  }
}

function update(dt) {
  if (!fx) return;
  fx.t += dt;
  fx.flash = Math.max(0, fx.flash - dt * 3.4);
  fx.shake = Math.max(0, fx.shake - dt * 28);

  for (const p of fx.sparks) {
    p.age += dt;
    p.vx *= 1 - p.drag * dt;
    p.vy = p.vy * (1 - p.drag * dt) + p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (const s of fx.smoke) {
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy -= 8 * dt;
    s.size *= 1 + s.grow * dt;
  }
  for (const s of fx.shards) {
    s.age += dt;
    s.vy += s.gravity * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.rotation += s.spin * dt;
  }
  for (const p of fx.petals) {
    p.age += dt;
    p.vx *= 1 - 2.1 * dt;
    p.vy = p.vy * (1 - 2.1 * dt) + 36 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.spin * dt;
  }
  for (const r of fx.rings) {
    r.age += dt;
    r.radius += (r.target - r.radius) * Math.min(1, dt * 3.6);
  }
  for (const c of fx.cracks) c.age += dt;

  if (fx.kind === 2) {
    for (const ribbon of fx.ribbons) {
      ribbon.progress = Math.min(1, ribbon.progress + dt * ribbon.speed);
    }
    if (!fx.burst && fx.t > 0.78) {
      fx.burst = true;
      burst(2);
    }
  }
  if (fx.kind === 3) {
    for (const orb of fx.orbs) {
      orb.trail.push([orb.x ?? fx.x, orb.y ?? fx.y]);
      if (orb.trail.length > 7) orb.trail.shift();
      orb.angle += orb.speed * dt;
      orb.radius *= Math.pow(0.1, dt);
    }
    if (!fx.burst && fx.t > 1.05) {
      fx.burst = true;
      burst(3);
    }
  }

  fx.sparks = fx.sparks.filter((p) => p.age < p.life);
  fx.smoke = fx.smoke.filter((s) => s.age < s.life);
  fx.shards = fx.shards.filter((s) => s.age < s.life);
  fx.petals = fx.petals.filter((p) => p.age < p.life);
  fx.rings = fx.rings.filter((r) => r.age < r.life);
  fx.cracks = fx.cracks.filter((c) => c.age < c.life);
  if (fx.t > 3.2) fx = null;
}

function drawRings() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const ring of fx.rings) {
    const alpha = Math.max(0, 1 - ring.age / ring.life) ** 1.4;
    ctx.strokeStyle = ring.color;
    ctx.globalAlpha = alpha * 0.5;
    ctx.lineWidth = ring.width;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.16;
    ctx.lineWidth = ring.width * 3;
    ctx.stroke();
  }
  ctx.restore();
}

function drawSmoke() {
  ctx.save();
  for (const s of fx.smoke) {
    const alpha = Math.max(0, 1 - s.age / s.life) * s.alpha;
    const gradient = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.size);
    gradient.addColorStop(0, `rgba(${s.color}, ${alpha})`);
    gradient.addColorStop(0.55, `rgba(${s.color}, ${alpha * 0.55})`);
    gradient.addColorStop(1, `rgba(${s.color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawPetals() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of fx.petals) {
    const alpha = Math.max(0, 1 - p.age / p.life) * p.alpha;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    const gradient = ctx.createLinearGradient(0, -p.length, 0, p.length * 0.4);
    gradient.addColorStop(0, p.light);
    gradient.addColorStop(0.45, p.color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, -p.length);
    ctx.bezierCurveTo(p.width, -p.length * 0.35, p.width * 0.8, p.length * 0.35, 0, p.length * 0.5);
    ctx.bezierCurveTo(-p.width * 0.8, p.length * 0.35, -p.width, -p.length * 0.35, 0, -p.length);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawShards() {
  for (const s of fx.shards) {
    const alpha = Math.max(0, 1 - s.age / s.life);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rotation);
    ctx.globalAlpha = alpha * 0.75;
    ctx.beginPath();
    s.points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.65)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

function drawSparks() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of fx.sparks) {
    const alpha = Math.max(0, 1 - p.age / p.life);
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.2);
    gradient.addColorStop(0, p.color);
    gradient.addColorStop(0.35, p.color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 2.2, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawCracks() {
  ctx.save();
  // 霜痕用 source-over，保持“冰面裂开”的实体感，不做电弧式叠加发光。
  for (const crack of fx.cracks) {
    const reveal = clamp(crack.age / 0.3, 0, 1);
    const alpha = Math.max(0, 1 - crack.age / crack.life);
    const count = Math.floor(crack.points.length * reveal);
    if (count < 2) continue;

    ctx.beginPath();
    ctx.moveTo(crack.points[0][0], crack.points[0][1]);
    for (let i = 1; i < count; i += 1) ctx.lineTo(crack.points[i][0], crack.points[i][1]);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = alpha * 0.28;
    ctx.strokeStyle = "rgba(195, 238, 255, 1)";
    ctx.lineWidth = crack.width * 3.2;
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.9;
    ctx.strokeStyle = "rgba(250, 255, 255, 0.95)";
    ctx.lineWidth = Math.max(1, crack.width * 0.42);
    ctx.stroke();

    // 在分叉点/末端加霜花，弱化“闪电”感。
    for (let i = 8; i < count; i += 18) {
      const [x, y] = crack.points[i];
      const size = crack.width * 0.8;
      ctx.globalAlpha = alpha * 0.75;
      ctx.strokeStyle = "rgba(235, 252, 255, .95)";
      ctx.lineWidth = 1;
      for (let a = 0; a < 6; a += 1) {
        const angle = (a / 6) * TAU;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawRibbons() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const ribbon of fx.ribbons) {
    const count = Math.floor(ribbon.points.length * ribbon.progress);
    for (let i = 0; i < count; i += 1) {
      const [x, y] = ribbon.points[i];
      const taper = Math.sin((i / count) * Math.PI);
      ctx.globalAlpha = 0.12 + taper * 0.55;
      ctx.fillStyle = ribbon.color;
      ctx.beginPath();
      ctx.arc(x, y, ribbon.width * 0.18 + taper * ribbon.width * 0.4, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawOrbs() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const orb of fx.orbs) {
    const p = clamp(fx.t / 1.05, 0, 1);
    const radius = orb.startRadius * (1 - p) ** 1.7;
    const angle = orb.angle;
    orb.x = fx.x + Math.cos(angle) * radius;
    orb.y = fx.y + Math.sin(angle) * radius * 0.72;
    for (let i = 0; i < orb.trail.length; i += 1) {
      const [tx, ty] = orb.trail[i];
      const alpha = (i / orb.trail.length) * 0.4;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = orb.color;
      ctx.beginPath();
      ctx.arc(tx, ty, orb.size * (i / orb.trail.length), 0, TAU);
      ctx.fill();
    }
    const gradient = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.size * 2.4);
    gradient.addColorStop(0, orb.light);
    gradient.addColorStop(0.35, orb.color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, orb.size * 2.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawFlash() {
  if (!fx || fx.flash <= 0) return;
  const gradient = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, layout.cell * 6);
  gradient.addColorStop(0, `rgba(255,255,255,${fx.flash * 0.8})`);
  gradient.addColorStop(0.35, `rgba(255,235,190,${fx.flash * 0.35})`);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function render(time) {
  ctx.clearRect(0, 0, width, height);
  drawBackground(time, fx ? 1 : 0);

  ctx.save();
  if (fx && fx.shake > 0) {
    ctx.translate(rand(-fx.shake, fx.shake), rand(-fx.shake, fx.shake));
  }
  drawBoard(time, fx ? 0.48 : 1);
  if (fx) {
    drawSmoke();
    drawRings();
    drawRibbons();
    drawCracks();
    drawOrbs();
    drawPetals();
    drawShards();
    drawSparks();
    drawFlash();
  }
  ctx.restore();
}

function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000 || 0.016));
  lastFrame = now;
  update(dt);
  render(now / 1000);

  if (auto && (!fx || fx.t > 2.2) && now - lastTrigger > 3200) {
    start(mode, Math.floor(rand(1, ROWS - 1)), Math.floor(rand(1, COLS - 1)));
  }
  requestAnimationFrame(loop);
}

function setMode(next) {
  mode = next;
  modeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.mode) === mode));
  });
  const [row, col] = fx ? [fx.row, fx.col] : [3, 3];
  start(mode, row, col);
}

canvas.addEventListener("pointerdown", (event) => {
  const cell = cellAt(event.clientX, event.clientY);
  if (cell) start(mode, cell[0], cell[1]);
  else start(mode, Math.floor(rand(1, ROWS - 1)), Math.floor(rand(1, COLS - 1)));
});
modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(Number(button.dataset.mode)));
});
autoButton.addEventListener("click", () => {
  auto = !auto;
  autoButton.setAttribute("aria-pressed", String(auto));
});
globalThis.addEventListener("keydown", (event) => {
  if (event.key >= "1" && event.key <= "4") setMode(Number(event.key) - 1);
  if (event.code === "Space") {
    event.preventDefault();
    const [row, col] = fx ? [fx.row, fx.col] : [3, 3];
    start(mode, row, col);
  }
});
globalThis.addEventListener("resize", resize);

resize();
board = Array.from({ length: ROWS }, (_, row) =>
  Array.from({ length: COLS }, (_, col) => (row * 3 + col * 2) % GEMS.length),
);
setMode(0);
requestAnimationFrame(loop);

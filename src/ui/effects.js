/**
 * 游戏内轻量特效层（M6）。
 *
 * 从特效实验室里挑出的三种效果，按 CascadeStep 自动触发：
 * - star：4/5 连生成特殊元素、炸弹/彩虹触发；
 * - frost：冰层破裂/减层；
 * - gravity：彩虹触发或 4+ 连锁。
 *
 * 只画在棋盘上层，不参与规则；粒子数量刻意压得比实验室少，
 * 保证低端设备和长连锁下仍然稳定。
 */

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => min + Math.random() * (max - min);

function isSpecial(kind) {
  return kind === "bomb" || kind === "rainbow";
}

/**
 * 纯函数：决定这一步该放哪种效果。没有合适事件时返回 null。
 * 优先级：彩虹 > 特殊元素/生成 > 冰层 > 4+ 连锁。
 */
export function effectForStep(step) {
  if (!step || typeof step !== "object") return null;
  const first = (list) => (Array.isArray(list) && list.length > 0 ? list[0] : null);

  if ((step.rainbowsTriggered ?? 0) > 0) {
    return { kind: "gravity", pos: first(step.spawned)?.at ?? first(step.cleared) ?? [4, 4] };
  }

  const spawned = (step.spawned ?? []).find((entry) => isSpecial(entry?.kind));
  if (spawned) return { kind: "star", pos: spawned.at };

  const special = (step.clearedTiles ?? []).find((tile) => isSpecial(tile?.kind));
  if (special) return { kind: "star", pos: special.pos };

  const ice = first(step.iceBroken) ?? first(step.iceReduced);
  if (ice) return { kind: "frost", pos: ice };

  if ((step.chain ?? 0) >= 4) {
    return { kind: "star", pos: first(step.cleared) ?? [4, 4] };
  }
  return null;
}

function makeShard(size, color) {
  const sides = 3 + Math.floor(rand(0, 3));
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * TAU + rand(-0.25, 0.25);
    const radius = rand(0.35, 1) * size;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return { points, color };
}

function makeCrack(x, y, angle, length, width) {
  const points = [];
  let px = x;
  let py = y;
  let a = angle;
  const steps = Math.max(4, Math.floor(length / 6));
  for (let i = 0; i < steps; i += 1) {
    a += rand(-0.22, 0.22);
    px += Math.cos(a) * 6;
    py += Math.sin(a) * 6;
    points.push([px, py]);
  }
  return { points, width, bornAt: 0 };
}

export function createEffectSystem({ reducedMotion = false } = {}) {
  let reduced = Boolean(reducedMotion);
  let sparks = [];
  let petals = [];
  let shards = [];
  let rings = [];
  let cracks = [];
  let orbs = [];
  let centers = [];

  function clear() {
    sparks = [];
    petals = [];
    shards = [];
    rings = [];
    cracks = [];
    orbs = [];
    centers = [];
  }

  function setReducedMotion(value) {
    reduced = Boolean(value);
    if (reduced) clear();
  }

  function trigger(kind, { x, y, color = "#f5eddf", cell = 32, now = 0 } = {}) {
    if (reduced || !Number.isFinite(x) || !Number.isFinite(y)) return;
    // 屏幕上同时存在一次大效果就够了，避免连锁时叠成白屏。
    if (sparks.length + petals.length + shards.length + orbs.length > 180) return;
    centers.push({ x, y, cell, bornAt: now, life: 720 });

    if (kind === "star") {
      for (let i = 0; i < 18; i += 1) {
        const angle = rand(0, TAU);
        const speed = rand(cell * 0.8, cell * 2.8);
        petals.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - cell * 0.4,
          bornAt: now,
          life: rand(380, 700),
          size: cell * rand(0.14, 0.28),
          color,
          rotation: angle,
        });
      }
      for (let i = 0; i < 60; i += 1) {
        const angle = rand(0, TAU);
        const speed = rand(cell * 0.9, cell * 4.2);
        sparks.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - cell * 0.5,
          bornAt: now,
          life: rand(320, 760),
          size: rand(1.2, 3.2),
          color: i % 3 === 0 ? "#fff6da" : color,
          gravity: cell * 4,
        });
      }
      for (let i = 0; i < 12; i += 1) {
        shards.push({
          ...makeShard(cell * 0.1, color),
          x: x + rand(-cell * 0.25, cell * 0.25),
          y: y + rand(-cell * 0.25, cell * 0.25),
          vx: rand(-cell * 2.2, cell * 2.2),
          vy: rand(-cell * 3, cell * 0.3),
          bornAt: now,
          life: rand(420, 800),
          rotation: rand(0, TAU),
          spin: rand(-5, 5),
          gravity: cell * 5,
        });
      }
      rings.push({ x, y, bornAt: now, life: 520, radius: cell * 2.4, color });
      return;
    }

    if (kind === "frost") {
      cracks.push({ ...makeCrack(x, y, rand(0, TAU), cell * 2.6, 2), bornAt: now, life: 620 });
      for (let i = 0; i < 7; i += 1) {
        cracks.push({
          ...makeCrack(x, y, (i / 7) * TAU + rand(-0.2, 0.2), cell * rand(1.2, 2.4), rand(1, 2)),
          bornAt: now,
          life: 620,
        });
      }
      for (let i = 0; i < 34; i += 1) {
        shards.push({
          ...makeShard(cell * 0.08, "rgba(214, 244, 255, .9)"),
          x: x + rand(-cell * 0.6, cell * 0.6),
          y: y + rand(-cell * 0.6, cell * 0.6),
          vx: rand(-cell * 1.4, cell * 1.4),
          vy: rand(-cell * 2.2, cell * 0.2),
          bornAt: now,
          life: rand(420, 900),
          rotation: rand(0, TAU),
          spin: rand(-4, 4),
          gravity: cell * 3,
        });
      }
      rings.push({ x, y, bornAt: now, life: 460, radius: cell * 1.8, color: "#d8f6ff" });
      return;
    }

    if (kind === "gravity") {
      for (let i = 0; i < 56; i += 1) {
        orbs.push({
          x,
          y,
          angle: rand(0, TAU),
          radius: rand(cell * 1.6, cell * 3.4),
          speed: rand(0.004, 0.01),
          size: rand(0.9, 2.6),
          color: i % 4 === 0 ? "#ffe8b0" : color,
          bornAt: now,
          life: 620,
        });
      }
      rings.push({ x, y, bornAt: now, life: 620, radius: cell * 3.4, color });
    }
  }

  function update(now) {
    const alive = (item) => now - item.bornAt <= item.life;
    sparks = sparks.filter(alive);
    petals = petals.filter(alive);
    shards = shards.filter(alive);
    rings = rings.filter(alive);
    cracks = cracks.filter(alive);
    orbs = orbs.filter(alive);
    centers = centers.filter(alive);
  }

  function drawSparks(ctx, now) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const spark of sparks) {
      const age = (now - spark.bornAt) / 1000;
      const t = clamp((now - spark.bornAt) / spark.life, 0, 1);
      const x = spark.x + spark.vx * age;
      const y = spark.y + spark.vy * age + spark.gravity * age * age;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, spark.size * 2.6);
      gradient.addColorStop(0, spark.color);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, spark.size * 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPetals(ctx, now) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const petal of petals) {
      const age = (now - petal.bornAt) / 1000;
      const t = clamp((now - petal.bornAt) / petal.life, 0, 1);
      const x = petal.x + petal.vx * age;
      const y = petal.y + petal.vy * age;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(petal.rotation);
      ctx.globalAlpha = (1 - t) * 0.68;
      ctx.fillStyle = petal.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, petal.size * 0.36, petal.size * 1.5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawShards(ctx, now) {
    for (const shard of shards) {
      const t = clamp((now - shard.bornAt) / shard.life, 0, 1);
      const age = (now - shard.bornAt) / 1000;
      ctx.save();
      ctx.translate(shard.x + shard.vx * age, shard.y + shard.vy * age + shard.gravity * age * age);
      ctx.rotate(shard.rotation + shard.spin * age);
      ctx.globalAlpha = (1 - t) * 0.65;
      ctx.beginPath();
      shard.points.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = shard.color;
      ctx.fill();
      ctx.restore();
    }
  }

  function drawRings(ctx, now) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const ring of rings) {
      const t = clamp((now - ring.bornAt) / ring.life, 0, 1);
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius * (0.3 + t * 0.75), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCracks(ctx, now) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const crack of cracks) {
      const t = clamp((now - crack.bornAt) / crack.life, 0, 1);
      const count = Math.max(2, Math.floor(crack.points.length * clamp(t * 4, 0, 1)));
      ctx.globalAlpha = (1 - t) * 0.75;
      ctx.strokeStyle = "rgba(235, 252, 255, .95)";
      ctx.lineWidth = crack.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(crack.points[0][0], crack.points[0][1]);
      for (let i = 1; i < count; i += 1) ctx.lineTo(crack.points[i][0], crack.points[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawOrbs(ctx, now) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const orb of orbs) {
      const t = clamp((now - orb.bornAt) / orb.life, 0, 1);
      const radius = orb.radius * (1 - t) ** 0.9;
      const angle = orb.angle + t * 2.4;
      const x = orb.x + Math.cos(angle) * radius;
      const y = orb.y + Math.sin(angle) * radius;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, orb.size * 3);
      gradient.addColorStop(0, orb.color);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, orb.size * 3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBackdrop(ctx, now = 0) {
    for (const center of centers) {
      const t = clamp((now - center.bornAt) / center.life, 0, 1);
      const radius = center.cell * 3.3;
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
      gradient.addColorStop(0, `rgba(24, 20, 16, ${0.4 * (1 - t)})`);
      gradient.addColorStop(0.55, `rgba(24, 20, 16, ${0.2 * (1 - t)})`);
      gradient.addColorStop(1, "rgba(24, 20, 16, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
    }
  }

  function draw(ctx, now = 0) {
    if (sparks.length === 0 && petals.length === 0 && shards.length === 0 && rings.length === 0 && cracks.length === 0 && orbs.length === 0) {
      return;
    }
    drawRings(ctx, now);
    drawCracks(ctx, now);
    drawOrbs(ctx, now);
    drawPetals(ctx, now);
    drawShards(ctx, now);
    drawSparks(ctx, now);
  }

  function count() {
    return sparks.length + petals.length + shards.length + rings.length + cracks.length + orbs.length;
  }

  return { trigger, update, draw, drawBackdrop, clear, count, setReducedMotion };
}

import test from "node:test";
import assert from "node:assert/strict";

import { createRng, randInt, pick, shuffle } from "../src/lib/random.js";
import { createClock, systemClock, createFakeClock } from "../src/lib/clock.js";
import { createLogger, createSilentLogger } from "../src/lib/logger.js";
import * as platform from "../src/lib/platform.js";

test("随机数：相同种子产生相同序列", () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = Array.from({ length: 8 }, () => a());
  const seqB = Array.from({ length: 8 }, () => b());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((n) => n >= 0 && n < 1));
});

test("随机数：不同种子序列不同", () => {
  assert.notEqual(createRng(1)(), createRng(2)());
});

test("randInt：范围、边界与非法参数", () => {
  const rng = createRng(7);
  for (let i = 0; i < 200; i += 1) {
    const n = randInt(rng, 10);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 10);
  }
  assert.equal(randInt(rng, 1), 0);
  assert.throws(() => randInt(rng, 0), RangeError);
  assert.throws(() => randInt(rng, 1.5), RangeError);
});

test("pick 与 shuffle：纯函数、可复现、不修改输入", () => {
  const items = [1, 2, 3, 4, 5];
  const rng = createRng(99);
  assert.ok(items.includes(pick(rng, items)));
  assert.throws(() => pick(rng, []), RangeError);

  const shuffled = shuffle(rng, items);
  assert.deepEqual(items, [1, 2, 3, 4, 5]);
  assert.deepEqual([...shuffled].sort((x, y) => x - y), items);
  assert.deepEqual(shuffle(createRng(99), items), shuffle(createRng(99), items));
});

test("时钟：注入、假时钟推进与系统时钟", () => {
  const fixed = createClock(() => 123);
  assert.equal(fixed.now(), 123);

  const fake = createFakeClock(100);
  assert.equal(fake.now(), 100);
  assert.equal(fake.advance(50), 150);
  assert.equal(fake.set(0), 0);
  assert.equal(fake.now(), 0);

  assert.ok(Math.abs(systemClock().now() - Date.now()) < 1000);
  assert.throws(() => createClock("not a function"), TypeError);
});

test("日志：按级别过滤、注入 sink 与时钟", () => {
  const entries = [];
  const clock = createFakeClock(1000);
  const logger = createLogger({
    level: "warn",
    sink: (entry) => entries.push(entry),
    clock,
  });

  logger.debug("d");
  logger.info("i");
  logger.warn("w", 1);
  logger.error("e");

  assert.deepEqual(
    entries.map((entry) => entry.level),
    ["warn", "error"],
  );
  assert.equal(entries[0].time, 1000);
  assert.deepEqual(entries[0].args, ["w", 1]);
  assert.throws(() => createLogger({ level: "nope" }), RangeError);
});

test("静默日志不产生输出", () => {
  const logger = createSilentLogger();
  assert.doesNotThrow(() => logger.error("should not throw"));
});

test("platform 统一出口导出全部工具", () => {
  for (const name of [
    "createRng",
    "randInt",
    "pick",
    "shuffle",
    "createClock",
    "systemClock",
    "createFakeClock",
    "createLogger",
    "createSilentLogger",
    "LOG_LEVELS",
  ]) {
    assert.equal(typeof platform[name], name === "LOG_LEVELS" ? "object" : "function");
  }
});

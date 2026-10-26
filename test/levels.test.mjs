import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_LEVELS_DOC,
  LEVEL_COUNT,
  defaultLevel,
  getLevel,
  loadLevels,
  loadLevelsFromText,
  segmentOf,
  validateLevelEntry,
  validateLevelsDoc,
} from "../src/lib/levels.js";
import { loadLevelsFromUrl } from "../src/app/levels-loader.js";

const levelsJson = JSON.parse(
  readFileSync(new URL("../src/lib/levels.json", import.meta.url), "utf8"),
);

function cloneLevelsDoc() {
  return JSON.parse(JSON.stringify(levelsJson));
}

function withLevel(doc, level, patch) {
  const copy = JSON.parse(JSON.stringify(doc));
  const index = copy.levels.findIndex((entry) => entry.level === level);
  copy.levels[index] = typeof patch === "function" ? patch(copy.levels[index]) : { ...copy.levels[index], ...patch };
  return copy;
}

test("30 关字段完整且与设计基线公式一致", () => {
  const { levels } = loadLevels(levelsJson);
  assert.equal(levels.length, LEVEL_COUNT);
  assert.equal(levels.reduce((sum, level) => sum + level.moves, 0), 615);

  for (const level of levels) {
    const n = level.level;
    assert.equal(level.segment, segmentOf(n));
    assert.equal(level.rows, 8);
    assert.equal(level.cols, 8);
    assert.equal(level.colors, 5);
    assert.ok(level.moves >= 16 && level.moves <= 25);
    assert.ok(level.starKeep.keep2 >= 0);
    assert.ok(level.starKeep.keep2 < level.starKeep.keep3);
    assert.ok(level.starKeep.keep3 <= level.moves);

    if (n <= 5) {
      assert.equal(level.moves, 20 - (n - 1));
      assert.equal(level.goals.score, 1000 + 300 * (n - 1));
      assert.equal(level.goals.collect, undefined);
      assert.equal(level.goals.ice.total, 0);
    } else if (n <= 15) {
      assert.equal(level.moves, 20 - Math.floor((n - 6) / 2));
      assert.equal(level.goals.score, 1400 + 100 * (n - 6));
      assert.equal(level.goals.collect.count, 10 + (n - 6));
      assert.equal(level.goals.collect.color, (n + 1) % 5);
      assert.equal(level.goals.ice.total, 0);
    } else {
      assert.equal(level.moves, 25 - Math.floor((n - 16) / 3));
      assert.equal(level.goals.score, 1900 + 60 * (n - 16));
      assert.equal(level.goals.collect.count, 14 + (n - 16));
      assert.equal(level.goals.collect.color, (n + 1) % 5);
      assert.equal(level.goals.ice.total, 7 + Math.round((n - 16) / 5));
      assert.equal(level.goals.ice.doubleRatio, 0.15);
    }
  }
});

test("levels.json 与内置默认配置完全一致", () => {
  const loaded = loadLevels(levelsJson);
  assert.equal(loaded.source, "external");
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.levels, JSON.parse(JSON.stringify(DEFAULT_LEVELS_DOC.levels)));
});

test("星级阈值与设计文档 §7.3.2 的预置表一致", () => {
  const expected = [
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
  const { levels } = loadLevels(levelsJson);
  expected.forEach(([keep2, keep3], index) => {
    assert.deepEqual(levels[index].starKeep, { keep2, keep3 }, `第 ${index + 1} 关`);
  });
});

test("严格校验通过，并能按关号取配置", () => {
  const report = validateLevelsDoc(levelsJson);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  const level16 = getLevel(report.levels, 16);
  assert.equal(level16.goals.score, 1900);
  assert.equal(level16.goals.collect.count, 14);
  assert.equal(level16.goals.ice.total, 7);
  assert.equal(getLevel(report.levels, 31), null);
});

test("版本号非法时整份配置回落内置默认", () => {
  const doc = cloneLevelsDoc();
  doc.version = 0;
  const loaded = loadLevels(doc);
  assert.equal(loaded.source, "default");
  assert.equal(loaded.levels.length, LEVEL_COUNT);
  assert.match(loaded.errors[0], /版本非法/);
  assert.deepEqual(loaded.levels, JSON.parse(JSON.stringify(DEFAULT_LEVELS_DOC.levels)));
});

test("JSON 损坏与缺少配置都回落内置默认并给出可读原因", () => {
  const broken = loadLevelsFromText("{ not json");
  assert.equal(broken.source, "default");
  assert.match(broken.errors[0], /不是合法 JSON/);

  const missing = loadLevels(null);
  assert.equal(missing.source, "default");
  assert.match(missing.errors[0], /缺少关卡配置/);

  const noLevels = loadLevels({ version: 1 });
  assert.equal(noLevels.source, "default");
  assert.match(noLevels.errors[0], /levels 数组/);
});

test("缺失关卡用内置默认补齐并报告待标定关号", () => {
  const doc = cloneLevelsDoc();
  doc.levels = doc.levels.slice(0, 29);
  const loaded = loadLevels(doc);
  assert.equal(loaded.source, "recovered");
  assert.equal(loaded.levels.length, LEVEL_COUNT);
  assert.deepEqual(loaded.recovered, [30]);
  assert.deepEqual(loaded.levels[29], defaultLevel(30));
  assert.ok(loaded.warnings.some((message) => message.includes("第 30 关")));
});

test("单条非法配置被替换为该关默认值，其余关卡保留", () => {
  const doc = withLevel(levelsJson, 3, { moves: 30 });
  const loaded = loadLevels(doc);
  assert.equal(loaded.source, "recovered");
  assert.ok(loaded.errors.some((message) => message.includes("moves")));
  assert.deepEqual(loaded.levels[2], defaultLevel(3));
  assert.deepEqual(loaded.levels[3], levelsJson.levels[3]);
});

test("重复关卡号保留首次出现的配置并给出错误", () => {
  const doc = cloneLevelsDoc();
  doc.levels.push(JSON.parse(JSON.stringify(doc.levels[0])));
  const loaded = loadLevels(doc);
  assert.equal(loaded.source, "recovered");
  assert.ok(loaded.errors.some((message) => message.includes("重复")));
  assert.equal(loaded.levels.length, LEVEL_COUNT);
});

test("收集目标字段越界时忽略该目标而非整关丢弃", () => {
  const doc = withLevel(levelsJson, 6, (entry) => ({
    ...entry,
    goals: { ...entry.goals, collect: { color: 9, count: 10 } },
  }));
  const loaded = loadLevels(doc);
  assert.equal(loaded.source, "external");
  assert.equal(loaded.levels[5].goals.collect, undefined);
  assert.ok(loaded.warnings.some((message) => message.includes("收集颜色")));
});

test("冰层格数越界、双层比例越界与星级阈值非法的处理符合设计", () => {
  const badIce = loadLevels(withLevel(levelsJson, 20, (entry) => ({
    ...entry,
    goals: { ...entry.goals, ice: { total: 65, doubleRatio: 0.15 } },
  })));
  assert.equal(badIce.source, "recovered");
  assert.deepEqual(badIce.levels[19], defaultLevel(20));
  assert.ok(badIce.errors.some((message) => message.includes("冰层格数")));

  const badRatio = loadLevels(withLevel(levelsJson, 21, (entry) => ({
    ...entry,
    goals: { ...entry.goals, ice: { total: 8, doubleRatio: 2 } },
  })));
  assert.equal(badRatio.levels[20].goals.ice.doubleRatio, 0);
  assert.ok(badRatio.warnings.some((message) => message.includes("双层冰比例")));

  const badKeep = loadLevels(withLevel(levelsJson, 22, {
    starKeep: { keep2: 10, keep3: 5 },
  }));
  assert.equal(badKeep.levels[21].starKeep.keep2, 0);
  assert.equal(badKeep.levels[21].starKeep.keep3, badKeep.levels[21].moves);
  assert.ok(badKeep.warnings.some((message) => message.includes("星级阈值")));
});

test("单条校验会拒绝越界字段并说明期望范围", () => {
  const bad = validateLevelEntry({
    ...defaultLevel(1),
    rows: 7,
    colors: 4,
    moves: 0,
    goals: { score: 999, ice: { total: 0, doubleRatio: 0 } },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((message) => message.includes("8×8")));
  assert.ok(bad.errors.some((message) => message.includes("颜色数")));
  assert.ok(bad.errors.some((message) => message.includes("moves")));
  assert.ok(bad.errors.some((message) => message.includes("goals.score")));
});

test("从 URL 加载成功沿用外部配置，网络失败回落默认", async () => {
  const ok = await loadLevelsFromUrl("levels.json", {
    fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(levelsJson) }),
  });
  assert.equal(ok.source, "external");

  const offline = await loadLevelsFromUrl("levels.json", {
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(offline.source, "default");
  assert.match(offline.errors[0], /加载失败/);

  const noFetch = await loadLevelsFromUrl("levels.json", { fetchImpl: null });
  assert.equal(noFetch.source, "default");
  assert.match(noFetch.errors[0], /没有 fetch/);

  const http500 = await loadLevelsFromUrl("levels.json", {
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  assert.equal(http500.source, "default");
  assert.match(http500.errors[0], /HTTP 500/);
});

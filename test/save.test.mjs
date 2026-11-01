import test from "node:test";
import assert from "node:assert/strict";

import {
  SAVE_VERSION,
  createDefaultSave,
  exportSave,
  isValidNickname,
  mergeSave,
  normalizeSave,
  parseStoredSave,
  validateSaveImport,
} from "../src/app/save-schema.js";

const T0 = Date.parse("2026-10-26T12:00:00+08:00");

function saveAt(offsetMs = 0, overrides = {}) {
  return {
    ...createDefaultSave(T0 + offsetMs),
    ...overrides,
  };
}

test("B1：默认存档字段完整，生命锚点与 updatedAt 使用注入时间", () => {
  const save = createDefaultSave(T0);
  assert.equal(save.version, SAVE_VERSION);
  assert.equal(save.unlockedLevel, 1);
  assert.equal(save.totalScore, 0);
  assert.equal(save.lives, 5);
  assert.equal(save.items.shuffle, 1);
  assert.equal(save.livesUpdatedAt, new Date(T0).toISOString());
  assert.equal(save.updatedAt, new Date(T0).toISOString());
  assert.equal(save.nickname, "");
  assert.deepEqual(save.stars, {});
});

test("B3：缺字段按默认值补齐，已验证进度保留，totalScore 按 bestScores 重算", () => {
  const { save, warnings } = normalizeSave(
    {
      version: 1,
      unlockedLevel: 7,
      stars: { 1: 3, 2: 2 },
      bestScores: { 1: 4500, 2: 3200 },
      totalScore: 1,
      coins: 120,
    },
    { now: T0 },
  );
  assert.equal(save.unlockedLevel, 7);
  assert.equal(save.stars[1], 3);
  assert.equal(save.totalScore, 7700);
  assert.equal(save.coins, 120);
  assert.equal(save.lives, 5);
  assert.deepEqual(warnings, []);
});

test("INV-1~INV-7：越界/非法字段被钳制或丢弃，不整档丢弃", () => {
  const { save } = normalizeSave(
    {
      version: 1,
      unlockedLevel: 99,
      stars: { 1: 9, 2: 2, 31: 3 },
      bestScores: { 1: -5, 2: 1500, 3: "x" },
      coins: -10,
      items: { shuffle: -1, hammer: 2, plus5: 0 },
      lives: 9,
      livesRestored: -3,
      nickname: "<script>alert(1)</script>",
      rewardPaidStars: { 1: 4, 2: 2 },
      livesUpdatedAt: "bad",
      updatedAt: "bad",
    },
    { now: T0 },
  );
  assert.equal(save.unlockedLevel, 30);
  assert.deepEqual(save.stars, { 2: 2 });
  assert.deepEqual(save.bestScores, { 2: 1500 });
  assert.equal(save.totalScore, 1500);
  assert.equal(save.coins, 0);
  assert.equal(save.items.shuffle, 0);
  assert.equal(save.items.hammer, 2);
  assert.equal(save.lives, 5);
  assert.equal(save.livesRestored, 0);
  assert.equal(save.nickname, "");
  assert.deepEqual(save.rewardPaidStars, { 2: 2 });
  assert.equal(save.livesUpdatedAt, new Date(T0).toISOString());
});

test("昵称白名单：3–12 个中英文、数字或下划线", () => {
  assert.equal(isValidNickname(""), true);
  assert.equal(isValidNickname("星消乐玩家"), true);
  assert.equal(isValidNickname("abc_123"), true);
  assert.equal(isValidNickname("ab"), false);
  assert.equal(isValidNickname("a".repeat(13)), false);
  assert.equal(isValidNickname("<script>"), false);
  assert.equal(isValidNickname("星 消 乐"), false);
});

test("版本高于当前时回落到默认并给出警告", () => {
  const result = normalizeSave({ ...createDefaultSave(T0), version: 99 }, { now: T0 });
  assert.equal(result.save.version, SAVE_VERSION);
  assert.equal(result.save.unlockedLevel, 1);
  assert.equal(result.recovered, true);
  assert.match(result.warnings[0], /版本不可用/);
});

test("FL-04：合并逐关取大、totalScore 重算、资源取较新一方", () => {
  const older = saveAt(0, {
    unlockedLevel: 5,
    stars: { 1: 2, 2: 1 },
    bestScores: { 1: 1000, 2: 800 },
    totalScore: 1800,
    coins: 100,
    items: { shuffle: 1, hammer: 0, plus5: 0 },
    lives: 5,
    livesUpdatedAt: new Date(T0).toISOString(),
    livesRestored: 0,
    muted: false,
  });
  const newer = saveAt(60_000, {
    unlockedLevel: 4,
    stars: { 1: 3, 2: 2, 3: 1 },
    bestScores: { 1: 1500, 2: 700, 3: 500 },
    totalScore: 2700,
    coins: 40,
    items: { shuffle: 0, hammer: 2, plus5: 0 },
    lives: 3,
    livesUpdatedAt: new Date(T0 + 60_000).toISOString(),
    livesRestored: 1,
    muted: true,
  });

  const merged = mergeSave(newer, older);
  assert.equal(merged.unlockedLevel, 5);
  assert.deepEqual(merged.stars, { 1: 3, 2: 2, 3: 1 });
  assert.deepEqual(merged.bestScores, { 1: 1500, 2: 800, 3: 500 });
  assert.equal(merged.totalScore, 2800);
  assert.equal(merged.coins, 40);
  assert.equal(merged.items.hammer, 2);
  assert.equal(merged.lives, 3);
  assert.equal(merged.livesUpdatedAt, newer.livesUpdatedAt);
  assert.equal(merged.muted, true);
  assert.equal(merged.updatedAt, newer.updatedAt);
});

test("FL-04/E1：updatedAt 相同时以传入的 a 为较新一方，不凭空造币", () => {
  const a = saveAt(1000, { coins: 30, stars: { 1: 3 }, bestScores: { 1: 900 } });
  const b = saveAt(1000, { coins: 90, stars: { 1: 2 }, bestScores: { 1: 1200 } });
  const merged = mergeSave(a, b);
  assert.equal(merged.coins, 30);
  assert.equal(merged.stars[1], 3);
  assert.equal(merged.bestScores[1], 1200);
  assert.equal(merged.totalScore, 1200);
});

test("FM-10：损坏 JSON 返回 corrupt 并给出默认存档", () => {
  const parsed = parseStoredSave("{not-json", { now: T0 });
  assert.equal(parsed.status, "corrupt");
  assert.equal(parsed.save.lives, 5);
  assert.match(parsed.warnings[0], /JSON 解析失败/);
});

test("FR-13：合法导入通过并返回归一化存档", () => {
  const text = JSON.stringify({
    ...createDefaultSave(T0),
    unlockedLevel: 4,
    bestScores: { 1: 1600 },
    totalScore: 1,
  });
  const result = validateSaveImport(text, { now: T0 });
  assert.equal(result.ok, true);
  assert.equal(result.save.unlockedLevel, 4);
  assert.equal(result.save.totalScore, 1600);
});

test("FR-13：非法 JSON、版本过高、字段类型错误都被拒绝且不修改当前存档", () => {
  assert.equal(validateSaveImport("{bad", { now: T0 }).ok, false);
  assert.equal(validateSaveImport(JSON.stringify({ version: 99 }), { now: T0 }).ok, false);
  assert.equal(
    validateSaveImport(JSON.stringify({ ...createDefaultSave(T0), coins: "100" }), { now: T0 }).ok,
    false,
  );
  assert.equal(
    validateSaveImport(JSON.stringify({ ...createDefaultSave(T0), nickname: "<x>" }), { now: T0 }).ok,
    false,
  );
  assert.equal(validateSaveImport("{}", { now: T0 }).ok, false);
  const tooLarge = validateSaveImport("x".repeat(300 * 1024), { now: T0 });
  assert.equal(tooLarge.ok, false);
  assert.match(tooLarge.errors[0], /256KB/);
});

test("导出 → 导入保持字段一致", () => {
  const save = saveAt(0, {
    unlockedLevel: 12,
    stars: { 1: 3, 2: 2 },
    bestScores: { 1: 2000, 2: 1800 },
    totalScore: 3800,
    nickname: "星消乐玩家",
  });
  const imported = validateSaveImport(exportSave(save), { now: T0 });
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.save, save);
});

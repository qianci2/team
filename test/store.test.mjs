import test from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/app/store.js";
import { createDefaultSave, SAVE_KEY, SAVE_VERSION } from "../src/app/save-schema.js";

const T0 = Date.parse("2026-10-26T12:00:00+08:00");

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
    map,
  };
}

function clockAt(ms) {
  let now = ms;
  return {
    now: () => now,
    advance: (delta) => {
      now += delta;
      return now;
    },
    set: (value) => {
      now = value;
    },
  };
}

function jsonSave(overrides = {}, at = T0) {
  return JSON.stringify({ ...createDefaultSave(at), ...overrides });
}

test("首次读取无键时使用默认存档，不写盘", () => {
  const storage = memoryStorage();
  const store = createStore({ storage, clock: clockAt(T0) });
  assert.equal(store.get().lives, 5);
  assert.equal(store.getStatus().status, "ok");
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test("commit 同步写盘、更新 updatedAt，并在同一毫秒内保持单调递增", () => {
  const storage = memoryStorage();
  const clock = clockAt(T0);
  const store = createStore({ storage, clock });

  const first = store.commit({ coins: 120 }, "settle");
  assert.equal(first.saved, true);
  assert.equal(first.mode, "sync");
  assert.equal(store.get().coins, 120);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).coins, 120);

  const second = store.commit({ coins: 150 }, "settle");
  assert.equal(second.saved, true);
  assert.ok(Date.parse(second.save.updatedAt) > Date.parse(first.save.updatedAt));
});

test("FM-01：写入抛异常时进入 readonly，commit 不抛异常且内存继续可用", () => {
  const storage = memoryStorage();
  let fail = false;
  const original = storage.setItem;
  storage.setItem = (key, value) => {
    if (fail) throw new Error("QuotaExceededError");
    original(key, value);
  };
  const store = createStore({ storage, clock: clockAt(T0) });
  fail = true;

  const result = store.commit({ coins: 50 }, "purchase");
  assert.equal(result.saved, false);
  assert.equal(result.mode, "readonly");
  assert.equal(store.isReadonly(), true);
  assert.equal(store.get().coins, 50);
  assert.doesNotThrow(() => store.commit({ coins: 60 }, "purchase"));
});

test("FM-10：损坏存档备份到临时键并以默认存档启动", () => {
  const storage = memoryStorage({ [SAVE_KEY]: "{broken" });
  const store = createStore({ storage, clock: clockAt(T0) });
  const dump = storage.dump();
  assert.equal(store.getStatus().status, "corrupt");
  assert.equal(store.get().unlockedLevel, 1);
  assert.ok(Object.keys(dump).some((key) => key.startsWith(`${SAVE_KEY}.corrupt.`)));
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version, SAVE_VERSION);
});

test("FL-04：写前发现外部更新时先合并，再写入本地变更", () => {
  const storage = memoryStorage();
  const store = createStore({ storage, clock: clockAt(T0) });
  store.commit({ coins: 100, unlockedLevel: 3, bestScores: { 1: 1000 } }, "settle");

  // 另一个标签页写入了更新的进度。
  storage.setItem(
    SAVE_KEY,
    jsonSave(
      {
        unlockedLevel: 5,
        coins: 30,
        stars: { 1: 3 },
        bestScores: { 1: 1200, 2: 900 },
      },
      T0 + 60_000,
    ),
  );

  const result = store.commit({ coins: 200 }, "purchase");
  assert.equal(result.saved, true);
  assert.equal(store.get().unlockedLevel, 5);
  assert.equal(store.get().bestScores[1], 1200);
  assert.equal(store.get().totalScore, 2100);
  assert.equal(store.get().coins, 200);
});

test("I-24：mergeExternal 合并 storage 事件，不覆盖较新的本地进度", () => {
  const storage = memoryStorage();
  const store = createStore({ storage, clock: clockAt(T0) });
  store.commit({ unlockedLevel: 8, bestScores: { 1: 3000 } }, "settle");

  const report = store.mergeExternal(
    jsonSave({ unlockedLevel: 4, stars: { 1: 3 }, bestScores: { 1: 2500 } }, T0 - 10_000),
  );
  assert.equal(report.merged, true);
  assert.equal(store.get().unlockedLevel, 8);
  assert.equal(store.get().bestScores[1], 3000);
  assert.equal(store.get().stars[1], 3);
});

test("订阅 save:changed / save:external，取消订阅后不再回调", () => {
  const storage = memoryStorage();
  const store = createStore({ storage, clock: clockAt(T0) });
  const changed = [];
  const external = [];
  const off = store.subscribe("save:changed", (payload) => changed.push(payload));
  store.subscribe("save:external", (payload) => external.push(payload));

  store.commit({ coins: 10 }, "settings");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].reason, "settings");

  store.mergeExternal(jsonSave({ coins: 20 }, T0 + 1000));
  assert.equal(external.length, 1);
  off();
  store.commit({ coins: 30 }, "settings");
  assert.equal(changed.length, 2);
});

test("attachStorage 只处理本存档键的 storage 事件", () => {
  const storage = memoryStorage();
  const store = createStore({ storage, clock: clockAt(T0) });
  const handlers = new Map();
  const target = {
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: (type) => handlers.delete(type),
  };
  const detach = store.attachStorage(target);
  handlers.get("storage")({ key: "other", newValue: "{}" });
  handlers.get("storage")({ key: SAVE_KEY, newValue: jsonSave({ unlockedLevel: 6 }, T0 + 1000) });
  assert.equal(store.get().unlockedLevel, 6);
  detach();
  assert.equal(handlers.has("storage"), false);
});

test("TC-14：同一存储反复重新加载 20 次，进度字段保持一致", () => {
  const storage = memoryStorage();
  const clock = clockAt(T0);
  const first = createStore({ storage, clock });
  first.commit(
    {
      unlockedLevel: 7,
      stars: { 1: 3, 2: 2 },
      bestScores: { 1: 2000, 2: 1800 },
      coins: 320,
      items: { shuffle: 2, hammer: 1, plus5: 0 },
      lives: 3,
      muted: true,
      colorblind: true,
      nickname: "星消乐玩家",
    },
    "settle",
  );
  const expected = first.get();

  for (let i = 0; i < 20; i += 1) {
    clock.advance(1000);
    const reloaded = createStore({ storage, clock });
    const actual = reloaded.get();
    assert.equal(actual.unlockedLevel, expected.unlockedLevel);
    assert.deepEqual(actual.stars, expected.stars);
    assert.deepEqual(actual.bestScores, expected.bestScores);
    assert.equal(actual.totalScore, expected.totalScore);
    assert.equal(actual.coins, expected.coins);
    assert.deepEqual(actual.items, expected.items);
    assert.equal(actual.lives, expected.lives);
    assert.equal(actual.muted, true);
    assert.equal(actual.colorblind, true);
    assert.equal(actual.nickname, expected.nickname);
  }
});

test("TC-41：两个 store 模拟两个标签页，各自通关不同关后合并保留两关进度", () => {
  const storage = memoryStorage();
  const clock = clockAt(T0);
  const tabA = createStore({ storage, clock });
  const tabB = createStore({ storage, clock });

  tabA.commit({ unlockedLevel: 2, stars: { 1: 3 }, bestScores: { 1: 1500 } }, "settle");
  clock.advance(1000);
  const b = tabB.get();
  tabB.commit(
    {
      ...b,
      unlockedLevel: 3,
      stars: { ...b.stars, 2: 2 },
      bestScores: { ...b.bestScores, 2: 1200 },
    },
    "settle",
  );

  assert.equal(tabB.get().stars[1], 3);
  assert.equal(tabB.get().bestScores[1], 1500);
  assert.equal(tabB.get().stars[2], 2);
  assert.equal(tabB.get().bestScores[2], 1200);
  assert.equal(tabB.get().unlockedLevel, 3);
  assert.equal(tabB.get().totalScore, 2700);
});

test("FR-13：导入合法存档、导出文本；非法导入不改变当前存档", () => {
  const storage = memoryStorage();
  const store = createStore({ storage, clock: clockAt(T0) });
  store.commit({ unlockedLevel: 3, bestScores: { 1: 1000 } }, "settle");

  const bad = store.importFromText("{bad");
  assert.equal(bad.ok, false);
  assert.equal(store.get().unlockedLevel, 3);

  const incoming = JSON.stringify({
    ...createDefaultSave(T0),
    unlockedLevel: 9,
    bestScores: { 1: 2000 },
    nickname: "星消乐玩家",
  });
  const imported = store.importFromText(incoming);
  assert.equal(imported.ok, true);
  assert.equal(store.get().unlockedLevel, 9);
  assert.equal(store.get().nickname, "星消乐玩家");
  assert.equal(JSON.parse(store.exportToText()).totalScore, 2000);
});

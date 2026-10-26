import test from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../src/app/session.js";
import { createStore } from "../src/app/store.js";
import { createDefaultSave, SAVE_KEY } from "../src/app/save-schema.js";
import { boardFromKinds } from "../src/lib/board.js";
import { createRun } from "../src/lib/run.js";
import { defaultLevel } from "../src/lib/levels.js";

const T0 = Date.parse("2026-10-26T12:00:00+08:00");
const BASE_ROWS = [
  [0, 1, 2, 3, 4, 0, 1, 2],
  [1, 2, 3, 4, 0, 1, 2, 3],
  [2, 3, 4, 0, 1, 2, 3, 4],
  [3, 4, 0, 1, 2, 3, 4, 0],
  [4, 0, 1, 2, 3, 4, 0, 1],
  [0, 1, 2, 3, 4, 0, 1, 2],
  [1, 2, 3, 4, 0, 1, 2, 3],
  [2, 3, 4, 0, 1, 2, 3, 4],
];

function boardForMatch(ice = null) {
  const rows = BASE_ROWS.map((row) => row.slice());
  rows[3][0] = 2;
  rows[3][1] = 0;
  rows[3][2] = 0;
  rows[3][4] = 3;
  return boardFromKinds(rows, ice);
}

function makeClock(start = T0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
      return now;
    },
    set: (ms) => {
      now = ms;
    },
  };
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    dump: () => Object.fromEntries(map),
  };
}

function makeLevel(level, overrides = {}) {
  return {
    ...defaultLevel(level),
    moves: 5,
    goals: { score: 1, ice: { total: 0, doubleRatio: 0 } },
    starKeep: { keep2: 2, keep3: 4 },
    ...overrides,
  };
}

function setup({ levels = [makeLevel(1), makeLevel(2)], board = boardForMatch(), presentation = null, rank = null } = {}) {
  const storage = memoryStorage();
  const clock = makeClock();
  const store = createStore({ storage, clock });
  const runFactory = (cfg, seed) => ({
    ...createRun(cfg, seed, clock),
    board,
    goalProgress: { score: 0, collect: 0, iceBroken: 0 },
  });
  const session = createSession({ store, clock, levels, presentation, rank, runFactory });
  return { storage, clock, store, session };
}

function winLevel1(session) {
  assert.equal(session.startLevel(1), true);
  assert.equal(session.dispatch({ type: "move", from: [3, 3], to: [2, 3] }), "clear");
}

test("I-25：合法场景转移可进入，非法转移被忽略", () => {
  const { session } = setup();
  assert.equal(session.view().scene, "menu");
  assert.equal(session.toScene("levelSelect"), true);
  assert.equal(session.view().scene, "levelSelect");
  assert.equal(session.toScene("rank"), false);
  assert.equal(session.view().scene, "levelSelect");
  assert.equal(session.toScene("menu"), true);
  assert.equal(session.toScene("settings"), true);
});

test("FL-02：达成目标立即结算、写盘、弹胜利窗并解锁下一关", () => {
  const { session, store, storage } = setup();
  winLevel1(session);

  const view = session.view();
  assert.equal(view.dialog.type, "win");
  assert.equal(view.dialog.actions.includes("next"), true);
  assert.ok(view.dialog.lines.some((entry) => entry.label === "星级" && entry.value === "★★★"));
  assert.equal(view.score, 30);
  assert.equal(view.movesLeft, 4);

  const save = store.get();
  assert.equal(save.stars[1], 3);
  assert.equal(save.bestScores[1], 30);
  assert.equal(save.coins, 120);
  assert.equal(save.unlockedLevel, 2);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).unlockedLevel, 2);
});

test("FL-02：胜利后下一关/重玩/返回主菜单三个动作", () => {
  const { session } = setup();
  winLevel1(session);
  assert.equal(session.dispatch({ type: "dialogAction", action: "next" }), true);
  assert.equal(session.view().scene, "playing");
  assert.equal(session.view().level, 2);

  assert.equal(session.dispatch({ type: "move", from: [3, 3], to: [2, 3] }), "clear");
  assert.equal(session.dispatch({ type: "dialogAction", action: "replay" }), true);
  assert.equal(session.view().level, 2);

  assert.equal(session.dispatch({ type: "move", from: [3, 3], to: [2, 3] }), "clear");
  assert.equal(session.dispatch({ type: "dialogAction", action: "menu" }), true);
  assert.equal(session.view().scene, "menu");
  assert.equal(session.view().board, null);
});

test("FR-08/FR-14：失败扣 1 生命、弹窗列出未完成目标与差值", () => {
  const { session, store } = setup({
    levels: [makeLevel(1, { moves: 1, goals: { score: 999999, ice: { total: 0, doubleRatio: 0 } } })],
  });
  assert.equal(session.startLevel(1), true);
  assert.equal(session.dispatch({ type: "move", from: [3, 3], to: [2, 3] }), "fail");

  const view = session.view();
  assert.equal(view.dialog.type, "fail");
  assert.ok(view.dialog.lines.some((entry) => entry.label === "目标分" && entry.value.includes("还差")));
  assert.equal(store.get().lives, 4);
});

test("P6：失败结算先恢复离线生命再扣 1，恢复不被覆盖", () => {
  const old = new Date(T0 - 31 * 60 * 1000).toISOString();
  const initial = { ...createDefaultSave(T0 - 31 * 60 * 1000), lives: 0, livesUpdatedAt: old };
  const storage = memoryStorage({ [SAVE_KEY]: JSON.stringify(initial) });
  const clock = makeClock();
  const store = createStore({ storage, clock });
  const session = createSession({
    store,
    clock,
    levels: [makeLevel(1, { moves: 1, goals: { score: 999999, ice: { total: 0, doubleRatio: 0 } } })],
    runFactory: (cfg, seed) => ({
      ...createRun(cfg, seed, clock),
      board: boardForMatch(),
      goalProgress: { score: 0, collect: 0, iceBroken: 0 },
    }),
  });

  assert.equal(session.startLevel(1), true);
  assert.equal(store.get().lives, 2);
  session.dispatch({ type: "move", from: [3, 3], to: [2, 3] });
  assert.equal(store.get().lives, 1);
});

test("FR-11：未解锁关卡不可进入，解锁后可进入", () => {
  const { session, store } = setup();
  assert.equal(session.startLevel(2), false);
  assert.equal(session.view().dialog.id, "locked-level");
  assert.match(session.view().dialog.lines[0].value, /先通过第 1 关/);

  store.commit({ unlockedLevel: 2 }, "settle");
  assert.equal(session.startLevel(2), true);
  assert.equal(session.view().level, 2);
});

test("无生命时阻止进入并给出补满入口；补满后扣 200 金币", () => {
  const { session, store } = setup();
  store.commit({ lives: 0, coins: 300 }, "lives");
  assert.equal(session.startLevel(1), false);
  assert.equal(session.view().dialog.id, "no-lives");
  assert.equal(session.dispatch({ type: "dialogAction", action: "refill" }), true);
  assert.equal(store.get().lives, 5);
  assert.equal(store.get().coins, 100);
  assert.equal(session.startLevel(1), true);
});

test("FR-22：道具使用扣库存、每关限用一次；库存不足给提示", () => {
  const { session, store } = setup();
  store.commit({ items: { shuffle: 2, hammer: 1, plus5: 1 } }, "purchase");
  session.startLevel(1);
  const before = store.get();
  assert.equal(session.dispatch({ type: "item", kind: "shuffle" }), "applied");
  assert.equal(store.get().items.shuffle, before.items.shuffle - 1);
  const again = session.dispatch({ type: "item", kind: "shuffle" });
  assert.equal(again, "rejected");
  assert.match(session.view().notice, /已使用/);

  store.commit({ items: { shuffle: 0, hammer: 0, plus5: 0 } }, "purchase");
  session.startLevel(1);
  assert.equal(session.dispatch({ type: "item", kind: "hammer", target: [0, 0] }), "rejected");
  assert.equal(session.view().dialog.id, "no-item");
});

test("FR-23/FM-14：购买成功与金币不足的弹窗", () => {
  const { session, store } = setup();
  store.commit({ coins: 250 }, "settle");
  assert.equal(session.dispatch({ type: "buy", kind: "hammer" }), true);
  assert.equal(store.get().coins, 50);
  assert.equal(store.get().items.hammer, 2);

  store.commit({ coins: 0 }, "settle");
  assert.equal(session.dispatch({ type: "buy", kind: "hammer" }), false);
  assert.equal(session.view().dialog.id, "insufficient");
  assert.match(session.view().dialog.lines[0].value, /还差 200/);
});

test("FR-26/FR-30：静音与色盲设置立即落盘", () => {
  const { session, store } = setup();
  session.dispatch({ type: "setMuted", muted: true });
  session.dispatch({ type: "setColorblind", colorblind: true });
  assert.equal(store.get().muted, true);
  assert.equal(store.get().colorblind, true);
  assert.equal(session.view().muted, true);
});

test("FR-19：昵称校验、空串允许清空、合法昵称持久化", () => {
  const { session, store } = setup();
  assert.equal(session.dispatch({ type: "setNickname", nickname: "ab" }), false);
  assert.match(session.view().notice, /3–12/);
  assert.equal(session.dispatch({ type: "setNickname", nickname: "星消乐玩家" }), true);
  assert.equal(store.get().nickname, "星消乐玩家");
  assert.equal(session.dispatch({ type: "setNickname", nickname: "" }), true);
  assert.equal(store.get().nickname, "");
});

test("FR-25：表现层动画期间输入排队，容量 2，结束后释放输入锁", async () => {
  const events = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const presentation = {
    play: async () => {
      await gate;
    },
    audio: () => {},
    onScene: () => {},
  };
  const { session } = setup({
    presentation,
    levels: [makeLevel(1, { goals: { score: 999999, ice: { total: 0, doubleRatio: 0 } } })],
  });
  session.subscribe((event) => events.push(event.type));
  session.startLevel(1);
  assert.equal(session.dispatch({ type: "move", from: [3, 3], to: [2, 3] }), "applied");
  assert.equal(session.view().inputLocked, true);

  // 锁内入队；容量 2，第三次入队丢弃最旧。
  assert.equal(session.dispatch({ type: "move", from: [0, 0], to: [0, 1] }), "queued");
  assert.equal(session.dispatch({ type: "move", from: [0, 1], to: [0, 2] }), "queued");
  assert.equal(session.dispatch({ type: "move", from: [0, 2], to: [0, 3] }), "queued");
  assert.equal(events.filter((type) => type === "input:queued").length, 3);

  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.view().inputLocked, false);
});

test("FM-01：存储只读时对局继续，view 暴露 readonly", () => {
  const storage = memoryStorage();
  let fail = false;
  const original = storage.setItem;
  storage.setItem = (key, value) => {
    if (fail) throw new Error("quota");
    original(key, value);
  };
  const clock = makeClock();
  const store = createStore({ storage, clock });
  const session = createSession({
    store,
    clock,
    levels: [makeLevel(1)],
    runFactory: (cfg, seed) => ({
      ...createRun(cfg, seed, clock),
      board: boardForMatch(),
      goalProgress: { score: 0, collect: 0, iceBroken: 0 },
    }),
  });
  fail = true;
  assert.equal(session.startLevel(1), true);
  assert.equal(session.dispatch({ type: "move", from: [3, 3], to: [2, 3] }), "clear");
  assert.equal(session.view().saveMode, "readonly");
  assert.equal(session.view().dialog.type, "win");
});

test("FM-13：外部存档合并后给出提示，不中断当前对局", () => {
  const { session, store } = setup();
  session.startLevel(1);
  store.mergeExternal(
    JSON.stringify({ ...createDefaultSave(T0 + 1000), unlockedLevel: 9, bestScores: { 1: 1200 } }),
  );
  assert.match(session.view().notice, /其他标签页/);
  assert.equal(session.view().scene, "playing");
});

test("FR-18~FR-20：排行榜提交与降级展示经 M5 编排", async () => {
  const calls = [];
  const rank = {
    submit: async (entry) => {
      calls.push(["submit", entry]);
      return { ok: true, code: 0, rank: 3 };
    },
    fetch: async () => {
      calls.push(["fetch"]);
      return {
        ok: false,
        source: "local",
        list: [{ rank: 1, nickname: "星友001", totalScore: 100, avatar: null }],
        code: "offline",
        message: "网络不可用",
      };
    },
  };
  const { session, store } = setup({ rank });
  store.commit({ nickname: "星消乐玩家", bestScores: { 1: 500 } }, "settings");
  session.toScene("rank");
  await new Promise((resolve) => setImmediate(resolve));
  const view = session.view();
  assert.equal(view.rank.source, "local");
  assert.equal(view.rank.list.length, 1);
  assert.match(view.rank.message, /网络不可用/);

  await session.submitRank();
  assert.deepEqual(calls[0], ["fetch"]);
  assert.deepEqual(calls[1], ["submit", { nickname: "星消乐玩家", totalScore: 500 }]);
  assert.equal(session.view().rank.bestRank, 3);
});

test("FR-13：导入/导出经 M5 委托 M10，非法导入不破坏当前存档", () => {
  const { session, store } = setup();
  store.commit({ unlockedLevel: 4, bestScores: { 1: 1000 } }, "settle");
  const text = session.exportSave();
  assert.match(text, /"unlockedLevel": 4/);

  assert.equal(session.dispatch({ type: "importSave", text: "{bad" }), false);
  assert.equal(session.view().dialog.id, "import-failed");
  assert.equal(store.get().unlockedLevel, 4);

  session.dispatch({ type: "dialogAction", action: "close" });
  const incoming = JSON.stringify({ ...createDefaultSave(T0), unlockedLevel: 8, bestScores: { 1: 2000 } });
  assert.equal(session.dispatch({ type: "importSave", text: incoming }), true);
  assert.equal(store.get().unlockedLevel, 8);
});

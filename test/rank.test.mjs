import test from "node:test";
import assert from "node:assert/strict";

import {
  OFFLINE_MESSAGE,
  createRankClient,
  localBoard,
  validateNickname,
  validateScore,
} from "../src/app/rank.js";
import { TOTAL_MAX } from "../src/lib/score.js";
import { createRankServer, startMockRankServer } from "../scripts/mock-rank-server.mjs";

const T0 = Date.parse("2026-10-26T12:00:00+08:00");
const RNG0 = () => 0.5;

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test("昵称与分数客户端校验", () => {
  assert.equal(validateNickname("星消乐玩家"), true);
  assert.equal(validateNickname("ab"), false);
  assert.equal(validateNickname("<script>"), false);
  assert.equal(validateScore(0), true);
  assert.equal(validateScore(TOTAL_MAX), true);
  assert.equal(validateScore(TOTAL_MAX + 1), false);
  assert.equal(validateScore(1.5), false);
  assert.equal(validateScore("100"), false);
});

test("I-35：本地模拟榜单 100 条、确定性、玩家按分数插入", () => {
  const save = { nickname: "星消乐玩家", totalScore: 90000 };
  const first = localBoard(save, RNG0);
  const second = localBoard(save, RNG0);
  assert.equal(first.length, 100);
  assert.deepEqual(first, second);
  assert.equal(first.some((entry) => entry.nickname === "星消乐玩家" && entry.self), true);
  for (let i = 1; i < first.length; i += 1) {
    assert.ok(first[i - 1].totalScore >= first[i].totalScore);
    assert.equal(first[i].rank, i + 1);
  }
});

test("I-33：昵称/分数非法时本地拒绝，不发起请求", async () => {
  let calls = 0;
  const rank = createRankClient({
    fetchImpl: async () => {
      calls += 1;
      return response({ code: 0, rank: 1 });
    },
    clock: { now: () => T0 },
  });
  const badNick = await rank.submit({ nickname: "ab", totalScore: 100 });
  assert.equal(badNick.code, 1001);
  const badScore = await rank.submit({ nickname: "星消乐玩家", totalScore: TOTAL_MAX + 1 });
  assert.equal(badScore.code, 1002);
  assert.equal(calls, 0);
});

test("I-33：提交成功返回名次；同一时刻只允许一个提交", async () => {
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const rank = createRankClient({
    fetchImpl: async () => {
      calls += 1;
      await gate;
      return response({ code: 0, rank: 5 });
    },
    clock: { now: () => T0 },
  });

  const first = rank.submit({ nickname: "星消乐玩家", totalScore: 1000 });
  const second = await rank.submit({ nickname: "星消乐玩家", totalScore: 1000 });
  assert.equal(second.code, "busy");
  release();
  assert.deepEqual(await first, { ok: true, code: 0, rank: 5 });
  assert.equal(calls, 1);
});

test("FM-03：超时/网络失败降级为 offline，永不 reject", async () => {
  const rank = createRankClient({
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    timeoutMs: 20,
    clock: { now: () => T0 },
    saveProvider: () => ({ nickname: "", totalScore: 0 }),
  });
  const result = await rank.submit({ nickname: "星消乐玩家", totalScore: 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "offline");
  assert.match(result.message, /网络不可用/);

  const board = await rank.fetch(10);
  assert.equal(board.source, "local");
  assert.equal(board.list.length, 100);
});

test("FM-04：服务端 5xx 与 5000 不阻塞单机，查询降级本地", async () => {
  const rank = createRankClient({
    fetchImpl: async () => response({ code: 5000, msg: "boom" }, { ok: true }),
    clock: { now: () => T0 },
    saveProvider: () => ({ nickname: "", totalScore: 0 }),
  });
  const submitted = await rank.submit({ nickname: "星消乐玩家", totalScore: 1000 });
  assert.equal(submitted.ok, false);
  assert.equal(submitted.code, 5000);

  const board = await rank.fetch(100);
  assert.equal(board.source, "local");
  assert.equal(board.code, "error");
});

test("I-34：远端榜单成功时 source=remote，10 秒内复用结果", async () => {
  let calls = 0;
  const rank = createRankClient({
    fetchImpl: async () => {
      calls += 1;
      return response({
        code: 0,
        list: [
          { rank: 1, nickname: "星消乐玩家", totalScore: 2000, avatar: null },
          { rank: 2, nickname: "abc_123", totalScore: 1000, avatar: null },
        ],
      });
    },
    clock: { now: () => T0 },
    saveProvider: () => ({ nickname: "", totalScore: 0 }),
  });
  const first = await rank.fetch(100);
  assert.equal(first.source, "remote");
  assert.equal(first.list[0].nickname, "星消乐玩家");
  const second = await rank.fetch(100);
  assert.equal(second, first);
  assert.equal(calls, 1);
});

test("HTTP-1/HTTP-2 mock server：校验、同分排序、10 秒节流与 limit", async () => {
  let now = T0;
  const mock = createRankServer({ now: () => now, throttleMs: 10_000 });
  assert.deepEqual(mock.submit({ nickname: "星消乐玩家", totalScore: 1200 }), { code: 0, rank: 1 });
  assert.equal(mock.submit({ nickname: "abc_123", totalScore: 1200 }).rank, 2);
  assert.equal(mock.submit({ nickname: "ab", totalScore: 1 }).code, 1001);
  assert.equal(mock.submit({ nickname: "abc_123", totalScore: 2_150_001 }).code, 1002);
  assert.equal(mock.submit({ nickname: "边界玩家", totalScore: 2_150_000 }).code, 1002);
  assert.equal(mock.submit({ nickname: "边界玩家", totalScore: 2_149_999 }).code, 0);

  // 10 秒内第二次提交被节流，但返回当前名次。
  assert.deepEqual(mock.submit({ nickname: "星消乐玩家", totalScore: 9999 }), {
    code: 0,
    rank: 2,
    throttled: true,
  });
  now += 10_001;
  assert.equal(mock.submit({ nickname: "星消乐玩家", totalScore: 9999 }).rank, 2);
  assert.equal(mock.submit({ nickname: "abc_123", totalScore: 9999 }).rank, 3);

  const started = await startMockRankServer({ port: 0 });
  try {
    const submit = await fetch(`${started.url}/api/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "星消乐玩家", totalScore: 1800 }),
    });
    assert.deepEqual(await submit.json(), { code: 0, rank: 1 });

    const bad = await fetch(`${started.url}/api/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "bad name", totalScore: 1 }),
    });
    assert.equal((await bad.json()).code, 1001);

    const rank = await fetch(`${started.url}/api/rank?limit=1`);
    const payload = await rank.json();
    assert.equal(payload.code, 0);
    assert.equal(payload.list.length, 1);
    assert.deepEqual(payload.list[0], {
      rank: 1,
      nickname: "星消乐玩家",
      totalScore: 1800,
      avatar: null,
    });
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
  }
});

test("OFFLINE_MESSAGE 与设计文案一致", () => {
  assert.equal(OFFLINE_MESSAGE, "网络不可用，排行榜暂不可用，单机游玩不受影响");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { bootstrapSession } from "../src/app/bootstrap.js";

const levelsJson = readFileSync(new URL("../src/lib/levels.json", import.meta.url), "utf8");

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

test("bootstrap 装配 M11/M10/M9/M5，不依赖 DOM", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/src/lib/levels.json")) {
      return { ok: true, status: 200, text: async () => levelsJson };
    }
    return { ok: false, status: 503 };
  };

  const app = await bootstrapSession({
    storage: memoryStorage(),
    storageTarget: null,
    fetchImpl,
    clock: { now: () => Date.parse("2026-10-26T12:00:00+08:00") },
    rankBaseUrl: "",
  });

  assert.equal(app.levels.length, 30);
  assert.equal(app.levelsReport.source, "external");
  assert.equal(app.session.view().scene, "menu");
  assert.equal(app.session.view().lives, 5);
  assert.equal(calls[0], "/src/lib/levels.json");
  app.destroy();
});

test("bootstrap 在关卡配置不可用时回落内置默认", async () => {
  const app = await bootstrapSession({
    storage: memoryStorage(),
    storageTarget: null,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(app.levels.length, 30);
  assert.equal(app.levelsReport.source, "default");
  assert.equal(app.session.view().scene, "menu");
  app.destroy();
});

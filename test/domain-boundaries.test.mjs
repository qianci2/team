import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LIB = new URL("../src/lib/", import.meta.url);
const APP = new URL("../src/app/", import.meta.url);

function source(url) {
  return readFileSync(url, "utf8");
}

function importsOf(url) {
  const text = source(url);
  return Array.from(text.matchAll(/(?:^|\n)\s*import\s+[^;]*?from\s+["']([^"']+)["']/g), (m) => m[1]);
}

test("AC-A3：领域层 import 图无环且只允许既定单向边", () => {
  const allowed = {
    "board.js": ["./random.js", "./score.js"],
    "score.js": [],
    "economy.js": [],
    "run.js": ["./random.js", "./board.js", "./score.js"],
    "levels.js": [],
    "random.js": [],
  };

  for (const [file, expected] of Object.entries(allowed)) {
    const actual = importsOf(new URL(file, LIB)).sort();
    assert.deepEqual(actual, expected.slice().sort(), `${file} 的 import 不符合 AC-A3`);
  }
});

test("AC-A1：领域层不直接使用浏览器 API 或系统时钟", () => {
  const forbidden = [
    [/\bdocument\b/, "document"],
    [/\bwindow\b/, "window"],
    [/\blocalStorage\b/, "localStorage"],
    [/\bAudioContext\b/, "AudioContext"],
    [/\bfetch\s*\(/, "fetch"],
    [/\bDate\.now\s*\(/, "Date.now"],
    [/\bAbortController\b/, "AbortController"],
  ];

  // AC-A1 约束 M1~M4 与 M11；M12 的 clock 封装本身就是 Date.now 的唯一注入点。
  const domainFiles = ["board.js", "score.js", "economy.js", "run.js", "levels.js"];
  for (const file of domainFiles) {
    const text = source(new URL(file, LIB));
    for (const [pattern, label] of forbidden) {
      assert.equal(pattern.test(text), false, `${file} 不应直接使用 ${label}`);
    }
  }
});

test("M11 保持纯函数：网络加载位于应用层", () => {
  const levels = source(new URL("levels.js", LIB));
  assert.equal(/\bsetTimeout\s*\(/.test(levels), false);
  assert.equal(/\bfetch\s*\(/.test(levels), false);

  const loader = source(new URL("levels-loader.js", APP));
  assert.match(loader, /loadLevelsFromUrl/);
  assert.match(loader, /AbortController/);
});

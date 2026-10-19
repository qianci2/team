import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkRepo } from "../scripts/check-repo.mjs";

test("仓库结构与基线文档校验通过", () => {
  const { errors } = checkRepo();
  assert.deepEqual(errors, [], `校验错误：\n${errors.join("\n")}`);
});

test("缺少必需文件时给出明确错误", () => {
  const dir = mkdtempSync(join(tmpdir(), "gemz-check-"));
  try {
    const { errors } = checkRepo(dir);
    assert.ok(errors.some((error) => error.includes("README.md")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

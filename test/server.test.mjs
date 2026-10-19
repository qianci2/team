import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createStaticServer } from "../scripts/serve.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function withServer(fn) {
  const server = createStaticServer({ root: ROOT });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("开发服务器：首页、静态资源与 404", async () => {
  await withServer(async (base) => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /星消乐/);

    const css = await fetch(`${base}/web/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") || "", /text\/css/);

    const module = await fetch(`${base}/src/lib/platform.js`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get("content-type") || "", /javascript/);

    const missing = await fetch(`${base}/nope`);
    assert.equal(missing.status, 404);
  });
});

test("开发服务器：拒绝路径穿越", async () => {
  await withServer(async (base) => {
    const forbidden = await fetch(`${base}/..%2Fpackage.json`);
    assert.equal(forbidden.status, 403);
  });
});

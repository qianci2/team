#!/usr/bin/env node
/**
 * 排行榜 mock server（HTTP-1 / HTTP-2）。
 *
 * 仅用于契约测试与本地联调，不代表真实后端：数据在内存中，进程退出即丢失，
 * 不实现 SQLite、账号、持久化或反作弊。真实服务端仍按设计 §7.4 可选部署。
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const NICKNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_]{3,12}$/u;
const REJECT_SCORE = 2_150_000;
const BODY_LIMIT = 16 * 1024;

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "cache-control": "no-store",
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("body-too-large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * @param {{now?: () => number, throttleMs?: number}} options
 */
export function createRankServer({ now = () => Date.now(), throttleMs = 10_000 } = {}) {
  /** @type {Map<string, {id:number,nickname:string,totalScore:number,createdAt:string,updatedAt:string,lastSubmitAt:number}>} */
  const rows = new Map();
  let seq = 0;

  function ranked() {
    return Array.from(rows.values())
      .sort((a, b) => b.totalScore - a.totalScore || a.id - b.id)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  function currentRank(nickname) {
    return ranked().find((row) => row.nickname === nickname)?.rank ?? null;
  }

  function submit({ nickname, totalScore }) {
    if (typeof nickname !== "string" || !NICKNAME_RE.test(nickname)) {
      return { code: 1001, msg: "昵称仅支持 3–12 个中英文、数字或下划线" };
    }
    if (!Number.isInteger(totalScore) || totalScore < 0 || totalScore > REJECT_SCORE) {
      return { code: 1002, msg: "分数数据异常，本次成绩未提交" };
    }

    const timestamp = now();
    const existing = rows.get(nickname);
    if (existing && timestamp - existing.lastSubmitAt < throttleMs) {
      return { code: 0, rank: currentRank(nickname), throttled: true };
    }

    if (!existing) {
      seq += 1;
      const iso = new Date(timestamp).toISOString();
      rows.set(nickname, {
        id: seq,
        nickname,
        totalScore,
        createdAt: iso,
        updatedAt: iso,
        lastSubmitAt: timestamp,
      });
    } else if (totalScore > existing.totalScore) {
      existing.totalScore = totalScore;
      existing.updatedAt = new Date(timestamp).toISOString();
      existing.lastSubmitAt = timestamp;
    } else {
      existing.lastSubmitAt = timestamp;
    }
    return { code: 0, rank: currentRank(nickname) };
  }

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      json(res, 204, {});
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "POST" && url.pathname === "/api/score") {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 200, { code: 1002, msg: "请求体不是合法 JSON" });
          return;
        }
        json(res, 200, submit(body ?? {}));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/rank") {
        const raw = Number(url.searchParams.get("limit") ?? 100);
        const limit = Math.min(100, Math.max(1, Number.isInteger(raw) ? raw : 100));
        json(res, 200, {
          code: 0,
          list: ranked()
            .slice(0, limit)
            .map((row) => ({
              rank: row.rank,
              nickname: row.nickname,
              totalScore: row.totalScore,
              avatar: null,
            })),
        });
        return;
      }

      json(res, 404, { code: 5000, msg: "not found" });
    } catch {
      json(res, 500, { code: 5000, msg: "internal error" });
    }
  });

  return {
    server,
    rows,
    submit,
    ranked,
    reset() {
      rows.clear();
      seq = 0;
    },
  };
}

export function startMockRankServer({ port = 8787, host = "127.0.0.1" } = {}) {
  const { server } = createRankServer();
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolveStart({ server, url: `http://${host}:${address.port}` });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 8787);
  startMockRankServer({ port })
    .then(({ url }) => console.log(`Gemz mock rank server: ${url}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

/**
 * 浏览器入口（组合根）。
 *
 * 只有这里同时知道 M5/M6/M7/M8：先用契约对象把 presentation 注入
 * bootstrapSession，再创建 UI 并回填。表现层模块之间不互相 import 应用层。
 */

import { bootstrapSession } from "/src/app/bootstrap.js";
import { MESSAGES } from "/src/app/messages.js";
import { ITEM_PRICES } from "/src/lib/economy.js";
import { createClock, createLogger } from "/src/lib/platform.js";
import { createAudioEngine } from "/src/ui/audio.js";
import { createUi } from "/src/ui/app.js";

const params = new URLSearchParams(globalThis.location?.search ?? "");
const debug = params.get("debug") === "1";
const reducedMotion = Boolean(
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
);
const logger = createLogger?.({ level: debug ? "debug" : "warn" }) ?? null;
const audio = createAudioEngine({ logger });
const clock = createClock();

let ui = null;

const presentation = {
  onScene(scene) {
    ui?.showScene(scene);
  },
  play(events, meta) {
    return ui ? ui.play(events, meta) : Promise.resolve();
  },
  audio(effect, chain) {
    audio.play(effect, chain);
  },
  visibility(hidden) {
    ui?.visibility(hidden);
  },
  tick(now) {
    ui?.tick(now);
  },
};

function showFatalError(error) {
  const main = document.querySelector("#main");
  if (!main) return;
  main.textContent = "";
  const box = document.createElement("section");
  box.className = "fatal";
  const title = document.createElement("h1");
  title.textContent = "页面没能启动";
  const detail = document.createElement("p");
  detail.textContent =
    "请通过 npm run dev 启动开发服务器后再打开 http://127.0.0.1:5173。直接双击 HTML 文件时，浏览器会拦截 ES Module 与关卡数据请求。";
  const message = document.createElement("pre");
  message.textContent = String(error?.message ?? error ?? "未知错误");
  box.append(title, detail, message);
  main.append(box);
}

async function main() {
  const app = await bootstrapSession({
    clock,
    presentation,
    logger,
    storage: globalThis.localStorage,
    storageTarget: globalThis,
    fetchImpl: globalThis.fetch,
  });

  ui = createUi({
    session: app.session,
    levels: app.levels,
    itemPrices: ITEM_PRICES,
    messages: MESSAGES,
    audio,
    debug,
    reducedMotion,
  });
  ui.start();

  // 演示与截图用深链：?level=3 直接进入某关；?scene=rank 进入指定场景。
  const scene = params.get("scene");
  if (scene && ["menu", "levelSelect", "rank", "settings"].includes(scene)) {
    app.session.toScene(scene);
  }
  const level = Number(params.get("level"));
  if (Number.isInteger(level) && level >= 1 && level <= 30) {
    app.session.startLevel(level);
  }

  globalThis.gemz = { app, ui };
  globalThis.addEventListener?.("beforeunload", () => {
    ui?.destroy();
    app.destroy();
  });
}

main().catch((error) => {
  console.error(error);
  showFatalError(error);
});

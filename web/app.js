import { createRng, randInt, createClock } from "/src/lib/platform.js";

const demo = document.querySelector("#demo");

if (demo) {
  const rng = createRng(20261019);
  const clock = createClock();
  const value = randInt(rng, 100);
  const time = new Date(clock.now()).toLocaleTimeString("zh-CN");
  demo.textContent = `平台工具自检：种子 20261019 → ${value}；时钟 ${time}`;
}

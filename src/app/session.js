/**
 * M5 会话与场景控制（I-25~I-28、FL-02/FL-03/FL-06/FL-07）。
 *
 * 唯一编排者：场景状态机、对局生命周期、弹窗、写盘时机、生命恢复、
 * 排行榜提交与异常降级都收敛在这里。M6/M7/M8 通过注入的 `presentation`
 * 接口接入；本文件不实现 Canvas、输入监听或 Web Audio。
 */

import {
  applyMove,
  createRun,
  outcomeOf,
  statusOf,
  useItem,
} from "../lib/run.js";
import {
  buyItem,
  consumeLife,
  refillLives,
  restoreLives,
  settleLevel,
} from "../lib/economy.js";
import { DEFAULT_LEVELS_DOC } from "../lib/levels.js";
import { deepFreeze, isValidNickname } from "./save-schema.js";
import { MESSAGES } from "./messages.js";

export const SCENES = Object.freeze(["menu", "levelSelect", "playing", "rank", "settings"]);

const TRANSITIONS = Object.freeze({
  menu: ["levelSelect", "rank", "settings"],
  levelSelect: ["menu"],
  playing: [],
  rank: ["menu"],
  settings: ["menu"],
});

const QUEUE_LIMIT = 2;
const ANIMATION_FALLBACK_MS = 2400;

function nowOf(clock) {
  const value = clock?.now?.();
  return Number.isFinite(value) ? value : Date.now();
}

function freezeView(view) {
  return deepFreeze(JSON.parse(JSON.stringify(view)));
}

function line(label, value) {
  return { label, value: String(value) };
}

function hasNickname(nickname) {
  return typeof nickname === "string" && nickname.length > 0 && isValidNickname(nickname);
}

/**
 * @param {{
 *   store: ReturnType<typeof import("./store.js").createStore>,
 *   rank?: object,
 *   clock?: {now: () => number},
 *   levels?: object[],
 *   presentation?: object,
 *   logger?: object,
 *   runFactory?: Function,
 * }} options
 */
export function createSession({
  store,
  rank = null,
  clock = null,
  levels = DEFAULT_LEVELS_DOC.levels,
  presentation = null,
  logger = null,
  runFactory = createRun,
} = {}) {
  if (!store || typeof store.get !== "function" || typeof store.commit !== "function") {
    throw new TypeError("createSession 需要 M10 store");
  }

  const listeners = new Set();
  let scene = "menu";
  let run = null;
  let dialog = null;
  let notice = null;
  let lastOutcome = null;
  let inputQueue = [];
  let locked = false;
  let lockDeadline = 0;
  let lastLivesCheck = -Infinity;
  let audioAvailable = true;
  let destroyed = false;

  let rankState = {
    list: [],
    source: "none",
    message: "",
    loading: false,
    submitting: false,
    bestRank: null,
  };

  function emit(event) {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (error) {
        logger?.warn?.("session subscriber failed", error);
      }
    }
  }

  function setNotice(message) {
    notice = message;
    emit({ type: "notice:changed", message });
  }

  function toast(message) {
    if (message) setNotice(message);
  }

  function playAudio(effect, chain) {
    if (!audioAvailable || typeof presentation?.audio !== "function") return;
    try {
      presentation.audio(effect, chain);
    } catch (error) {
      audioAvailable = false;
      setNotice(MESSAGES.audio);
      logger?.warn?.("音频播放失败，已静默降级", error);
    }
  }

  function animationEvents(events, meta = null) {
    const play = presentation?.play;
    if (typeof play !== "function") {
      return;
    }
    locked = true;
    lockDeadline = nowOf(clock) + ANIMATION_FALLBACK_MS;
    Promise.resolve()
      .then(() => play(events, meta))
      .catch((error) => logger?.warn?.("动画播放失败，已释放输入锁", error))
      .finally(() => {
        locked = false;
        emit({ type: "input:unlock" });
        flushQueue();
      });
  }

  function flushQueue() {
    if (locked || dialog) return;
    const next = inputQueue.shift();
    if (next) dispatch(next);
  }

  function restoreLivesIfNeeded() {
    const save = store.get();
    const now = nowOf(clock);
    const result = restoreLives(save, now);
    if (JSON.stringify(result.save) !== JSON.stringify(save)) {
      store.commit(result.save, "lives");
      if (result.gained > 0) emit({ type: "lives:restored", gained: result.gained });
    }
  }

  function toScene(next) {
    if (!SCENES.includes(next)) {
      logger?.warn?.(`未知场景：${next}`);
      return false;
    }
    if (next === scene) return true;
    if (!(TRANSITIONS[scene] ?? []).includes(next)) {
      logger?.warn?.(`不允许从 ${scene} 进入 ${next}`);
      return false;
    }
    scene = next;
    dialog = null;
    if (next !== "playing") run = null;
    emit({ type: "scene:changed", scene });
    try {
      presentation?.onScene?.(next);
    } catch (error) {
      logger?.warn?.("场景切换渲染回调失败", error);
    }
    if (next === "rank") void loadRank();
    return true;
  }

  function startLevel(level) {
    if (!Number.isInteger(level) || level < 1 || level > 30) {
      toast("关卡号无效");
      return false;
    }
    restoreLivesIfNeeded();
    const save = store.get();
    if (level > save.unlockedLevel) {
      dialog = {
        id: "locked-level",
        type: "info",
        lines: [line("提示", MESSAGES.lockedLevel(level))],
        actions: ["close"],
      };
      emit({ type: "level:locked", level });
      return false;
    }
    if (save.lives <= 0) {
      dialog = {
        id: "no-lives",
        type: "info",
        lines: [
          line("生命", `0 / 5`),
          line("提示", "生命不足，可等待恢复或使用 200 金币补满"),
        ],
        actions: ["refill", "close"],
      };
      emit({ type: "lives:empty" });
      return false;
    }

    const cfg = levels.find((entry) => entry.level === level);
    if (!cfg) {
      dialog = {
        id: "bad-config",
        type: "info",
        lines: [line("提示", MESSAGES.config)],
        actions: ["close"],
      };
      return false;
    }

    const seed = (Math.floor(nowOf(clock)) ^ Math.imul(level, 2654435761)) >>> 0;
    run = runFactory(cfg, seed, clock);
    scene = "playing";
    dialog = null;
    notice = null;
    lastOutcome = null;
    inputQueue = [];
    locked = false;
    emit({ type: "level:started", level });
    try {
      presentation?.onScene?.("playing");
    } catch (error) {
      logger?.warn?.("对局场景渲染回调失败", error);
    }
    return true;
  }

  function settleRun(outcome) {
    const cfg = run.cfg;
    lastOutcome = outcome;
    if (outcome.result === "clear") {
      const current = store.get();
      const settled = settleLevel(current, cfg, {
        score: outcome.score,
        remainingMoves: outcome.remainingMoves,
      });
      store.commit(settled.save, "settle");
      const nextUnlocked = settled.save.unlockedLevel;
      dialog = {
        id: "win",
        type: "win",
        lines: [
          line("本关得分", outcome.score),
          line("星级", "★".repeat(settled.stars)),
          line("金币奖励", `+${settled.coinDelta}`),
          line("总积分", settled.save.totalScore),
        ],
        actions: [
          ...(outcome.level < 30 && nextUnlocked > outcome.level ? ["next"] : []),
          "replay",
          "menu",
        ],
      };
      playAudio("win");
      emit({
        type: "run:clear",
        level: outcome.level,
        score: outcome.score,
        stars: settled.stars,
        previousBestStars: settled.previousBestStars,
        coinDelta: settled.coinDelta,
      });
      autoSubmitRank();
      return;
    }

    // FL-02/FL-06：先结算离线恢复，再扣失败生命，避免恢复被失败覆盖。
    restoreLivesIfNeeded();
    const current = store.get();
    const consumed = consumeLife(current, nowOf(clock));
    store.commit(consumed, "fail");
    const unfinished = outcome.unfinished
      .map((goal) => {
        const label = goal.kind === "score" ? "目标分" : goal.kind === "collect" ? "收集" : "冰层";
        return line(label, `${goal.current}/${goal.target}，还差 ${goal.gap}`);
      })
      .concat([line("本次得分", outcome.score)]);
    dialog = {
      id: "fail",
      type: "fail",
      lines: unfinished,
      actions: ["retry", "menu"],
    };
    playAudio("fail");
    emit({ type: "run:fail", level: outcome.level, lives: consumed.lives });
  }

  function afterRun(outcome) {
    if (outcome.result === "clear" || outcome.result === "fail") {
      settleRun(outcomeOf(outcome.run));
    }
  }

  function performMove(intent) {
    if (!run || scene !== "playing") return "ignored";
    const outcome = applyMove(run, { from: intent.from, to: intent.to });
    if (outcome.result === "rejected" || outcome.result === "locked") {
      emit({ type: "move:rejected", reason: outcome.reason ?? outcome.result });
      return outcome.result;
    }
    run = outcome.run;
    const events = outcome.events ?? [];
    emit({ type: "run:changed", run: statusOf(run) });
    emit({ type: "input:lock" });
    playAudio("clear", events.find((event) => event.type === "board:settled")?.steps?.length ?? 1);
    animationEvents(events, {
      type: "move",
      move: { from: [...intent.from], to: [...intent.to] },
    });
    afterRun(outcome);
    return outcome.result;
  }

  function performItem(intent) {
    if (!run || scene !== "playing") return "ignored";
    const save = store.get();
    if ((save.items?.[intent.kind] ?? 0) <= 0) {
      dialog = {
        id: "no-item",
        type: "info",
        lines: [line("道具", "库存不足，可前往商店购买")],
        actions: ["close"],
      };
      return "rejected";
    }
    const outcome = useItem(run, intent.kind, intent.target);
    if (outcome.result === "rejected" || outcome.result === "locked") {
      const message = outcome.reason === "item-used" ? MESSAGES.itemUsed : "该操作不可用";
      toast(message);
      emit({ type: "item:rejected", reason: outcome.reason ?? outcome.result });
      return outcome.result;
    }
    run = outcome.run;
    store.commit(
      { items: { ...save.items, [intent.kind]: Math.max(0, save.items[intent.kind] - 1) } },
      "item",
    );
    emit({ type: "item:used", kind: intent.kind });
    playAudio("item");
    animationEvents(outcome.events ?? [], {
      type: "item",
      item: intent.kind,
      target: intent.target ?? null,
    });
    afterRun(outcome);
    return outcome.result;
  }

  function buy(kind) {
    const result = buyItem(store.get(), kind);
    if (!result.ok) {
      dialog = {
        id: "insufficient",
        type: "info",
        lines: [line("提示", MESSAGES.coins(result.diff))],
        actions: ["close"],
      };
      return false;
    }
    store.commit(result.save, "purchase");
    toast("购买成功");
    emit({ type: "item:bought", kind });
    return true;
  }

  function refill() {
    const result = refillLives(store.get(), nowOf(clock));
    if (!result.ok) {
      dialog = {
        id: "refill-failed",
        type: "info",
        lines: [
          line(
            "提示",
            result.reason === "full" ? "生命已满" : MESSAGES.coins(result.diff),
          ),
        ],
        actions: ["close"],
      };
      return false;
    }
    store.commit(result.save, "lives");
    dialog = null;
    toast("生命已补满");
    emit({ type: "lives:refilled" });
    return true;
  }

  async function submitRank({ silent = false } = {}) {
    if (!rank || rankState.submitting) return null;
    const save = store.get();
    if (!hasNickname(save.nickname)) {
      if (!silent) toast(MESSAGES.nickname);
      return null;
    }
    rankState = { ...rankState, submitting: true };
    const result = await rank.submit({ nickname: save.nickname, totalScore: save.totalScore });
    rankState = { ...rankState, submitting: false, bestRank: result.ok ? result.rank : rankState.bestRank };
    if (!result.ok) {
      toast(result.message ?? MESSAGES.server);
      emit({ type: "rank:submit-failed", code: result.code });
      return result;
    }
    toast(`已提交，当前第 ${result.rank} 名`);
    emit({ type: "rank:submitted", rank: result.rank });
    return result;
  }

  function autoSubmitRank() {
    const save = store.get();
    if (!rank || !hasNickname(save.nickname)) return;
    void submitRank({ silent: true });
  }

  async function loadRank() {
    if (!rank || rankState.loading) return rankState;
    rankState = { ...rankState, loading: true };
    const result = await rank.fetch(100);
    rankState = {
      ...rankState,
      loading: false,
      list: result.list,
      source: result.source,
      message: result.ok ? "" : result.message ?? MESSAGES.offline,
    };
    emit({ type: "rank:loaded", source: result.source });
    return rankState;
  }

  function setNickname(nickname) {
    if (!isValidNickname(nickname)) {
      toast(MESSAGES.nickname);
      return false;
    }
    store.commit({ nickname }, "settings");
    toast(nickname === "" ? "昵称已清空" : "昵称已保存");
    return true;
  }

  function handleDialogAction(action) {
    const current = dialog;
    if (!current) return false;
    if (action === "close") {
      dialog = null;
      return true;
    }
    if (action === "refill") {
      dialog = null;
      return refill();
    }
    if (action === "menu") {
      dialog = null;
      run = null;
      scene = "menu";
      emit({ type: "scene:changed", scene });
      presentation?.onScene?.("menu");
      return true;
    }
    if (action === "retry" || action === "replay") {
      const level = lastOutcome?.level ?? run?.level;
      dialog = null;
      return startLevel(level);
    }
    if (action === "next") {
      const level = (lastOutcome?.level ?? run?.level) + 1;
      dialog = null;
      return startLevel(level);
    }
    return false;
  }

  function handleIntent(intent) {
    if (!intent || typeof intent.type !== "string") return "ignored";
    if (intent.type === "dialogAction") return handleDialogAction(intent.action);
    if (intent.type === "notice:clear") {
      notice = null;
      return true;
    }
    if (intent.type === "scene") return toScene(intent.scene);
    if (intent.type === "startLevel") return startLevel(intent.level);
    if (intent.type === "move") return performMove(intent);
    if (intent.type === "item") return performItem(intent);
    if (intent.type === "buy") return buy(intent.kind);
    if (intent.type === "refillLives") return refill();
    if (intent.type === "setMuted") {
      store.commit({ muted: Boolean(intent.muted) }, "settings");
      return true;
    }
    if (intent.type === "setColorblind") {
      store.commit({ colorblind: Boolean(intent.colorblind) }, "settings");
      return true;
    }
    if (intent.type === "setNickname") return setNickname(intent.nickname);
    if (intent.type === "submitRank") return void submitRank();
    if (intent.type === "loadRank") return void loadRank();
    if (intent.type === "importSave") {
      const result = store.importFromText(intent.text);
      if (!result.ok) {
        dialog = {
          id: "import-failed",
          type: "info",
          lines: [line("导入失败", result.errors?.[0] ?? "存档不合法")],
          actions: ["close"],
        };
        return false;
      }
      dialog = null;
      toast("存档已导入");
      return true;
    }
    if (intent.type === "visibility") {
      try {
        presentation?.visibility?.(Boolean(intent.hidden));
      } catch (error) {
        logger?.warn?.("可见性回调失败", error);
      }
      return true;
    }
    logger?.warn?.(`未知输入意图：${intent.type}`);
    return "ignored";
  }

  function dispatch(intent) {
    if (destroyed) return "destroyed";
    if (dialog && intent?.type !== "dialogAction") return "dialog-open";
    if (locked && (intent?.type === "move" || intent?.type === "item")) {
      if (inputQueue.length >= QUEUE_LIMIT) inputQueue.shift();
      inputQueue.push(intent);
      emit({ type: "input:queued", size: inputQueue.length });
      return "queued";
    }
    return handleIntent(intent);
  }

  function view() {
    const save = store.get();
    const status = run ? statusOf(run) : null;
    const statusInfo = store.getStatus();
    return freezeView({
      scene,
      level: run?.level ?? lastOutcome?.level ?? null,
      board: run?.board ?? null,
      goals: status?.goals ?? [],
      score: status?.score ?? 0,
      movesLeft: status?.movesLeft ?? 0,
      starsPreview: status?.starsPreview ?? 1,
      starKeep: run?.cfg?.starKeep ?? null,
      canUseItem: status?.canUseItem ?? { shuffle: false, hammer: false, plus5: false },
      lives: save.lives,
      coins: save.coins,
      items: save.items,
      muted: save.muted,
      colorblind: save.colorblind,
      nickname: save.nickname,
      totalScore: save.totalScore,
      stars: save.stars,
      bestScores: save.bestScores,
      unlockedLevel: save.unlockedLevel,
      dialog,
      notice,
      saveMode: statusInfo.readonly ? "readonly" : "sync",
      audioAvailable,
      rank: {
        ...rankState,
        list: rankState.list,
      },
      inputLocked: locked,
      lastOutcome,
    });
  }

  function tick(now = nowOf(clock)) {
    if (destroyed) return;
    if (locked && now >= lockDeadline) {
      locked = false;
      emit({ type: "input:unlock", fallback: true });
      flushQueue();
    }
    if (now - lastLivesCheck >= 60_000) {
      lastLivesCheck = now;
      restoreLivesIfNeeded();
    }
    try {
      presentation?.tick?.(now);
    } catch (error) {
      logger?.warn?.("表现层 tick 失败", error);
    }
  }

  const offSave = store.subscribe("save:external", () => {
    setNotice(MESSAGES.external);
  });
  const offReadonly = store.subscribe("storage:readonly", () => {
    setNotice(MESSAGES.readonly);
  });

  if (store.getStatus().readonly) setNotice(MESSAGES.readonly);

  return {
    toScene,
    dispatch,
    view,
    tick,
    startLevel,
    submitRank,
    loadRank,
    exportSave: () => store.exportToText(),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      destroyed = true;
      offSave();
      offReadonly();
      listeners.clear();
    },
  };
}

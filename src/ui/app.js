/**
 * 表现层装配（M6/M7/M8 → M5）。
 *
 * 只做三件事：把 ViewState 渲染成 DOM/Canvas、把用户操作转成
 * InputIntent、把 M5 的动画事件交给 Renderer。场景与规则仍由 M5 决定。
 */

import { createAudioEngine } from "./audio.js";
import {
  chapterName,
  formatNumber,
  goalLabel,
  goalSummary,
  starText,
  sumStars,
} from "./format.js";
import { createBoardInput, attachGridKeyboard } from "./input.js";
import { createRenderer } from "./renderer.js";

const ITEM_LABELS = Object.freeze({ shuffle: "重排", hammer: "锤子", plus5: "加步" });
const ITEM_NOTES = Object.freeze({ shuffle: "重排全场", hammer: "敲碎一格", plus5: "+5 步" });
const ACTION_LABELS = Object.freeze({
  next: "下一关",
  replay: "再玩一次",
  retry: "重试",
  menu: "返回主菜单",
  refill: "用 200 金币补满",
  close: "知道了",
});
const DIALOG_TEXT = Object.freeze({
  win: { kicker: "对局结算", title: "这一关，收好了。" },
  fail: { kicker: "目标未完成", title: "还差一点。" },
  info: { kicker: "提示", title: "请留意" },
  confirm: { kicker: "确认", title: "确认操作" },
});
const TUTORIAL_KEY = "gemz.ui.tutorialDismissed";

function readStorage(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // 隐私模式下 localStorage 可能不可写，忽略即可。
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function focusables(layer) {
  if (!layer) return [];
  return Array.from(
    layer.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
}

function trapFocus(event, layer) {
  if (event.key !== "Tab") return;
  const items = focusables(layer);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * @param {{
 *   session: object,
 *   levels: object[],
 *   itemPrices?: Record<string, number>,
 *   storage?: Storage,
 *   messages?: object,
 *   audio?: object,
 *   root?: Document,
 *   reducedMotion?: boolean,
 *   debug?: boolean,
 * }} options
 */
export function createUi({
  session,
  levels = [],
  itemPrices = { shuffle: 100, hammer: 200, plus5: 300 },
  storage = globalThis.localStorage,
  messages = {},
  audio = createAudioEngine(),
  root = document,
  reducedMotion = false,
  debug = false,
} = {}) {
  if (!session || typeof session.view !== "function") {
    throw new TypeError("createUi 需要 M5 session");
  }

  const $ = (selector) => root.querySelector(selector);
  const scenes = new Map(
    Array.from(root.querySelectorAll("[data-scene]")).map((element) => [element.dataset.scene, element]),
  );
  const levelByNo = new Map(levels.map((level) => [level.level, level]));
  const viewRef = () => session.view();

  const canvas = $("#board");
  const live = $("#live");
  const saveBanner = $("#save-banner");
  const toast = $("#toast");
  const toastText = $("#toast-text");
  const debugEl = $("#debug");
  const dialogLayer = $("#dialog-layer");
  const dialogTitle = $("#dialog-title");
  const dialogKicker = $("#dialog-kicker");
  const dialogStars = $("#dialog-stars");
  const dialogLines = $("#dialog-lines");
  const dialogActions = $("#dialog-actions");
  const helpLayer = $("#help-layer");
  const helpGoals = $("#help-goals");
  const goalList = $("#play-goals");
  const levelChapters = $("#level-chapters");
  const profileLevels = $("#profile-levels");
  const shop = $("#shop");
  const nicknameInput = $("#profile-nickname");

  let currentScene = null;
  let firstScene = true;
  let dialogKey = null;
  let helpOpen = false;
  let tutorialDismissed = readStorage(storage, TUTORIAL_KEY) === "1";
  let toastTimer = 0;
  let lastNotice = null;
  let pendingProfileFocus = false;
  let goalSignature = null;
  let goalEls = [];
  let levelCardEls = [];
  let rankSignature = null;
  let profileLevelEls = [];
  let lastFpsAt = 0;
  let previousFocus = null;

  const renderer = createRenderer(canvas, {
    reducedMotion: reducedMotion || prefersReducedMotion(),
    onStats(stats) {
      if (!debug) return;
      const now = performance.now();
      if (now - lastFpsAt < 400) return;
      lastFpsAt = now;
      debugEl.hidden = false;
      debugEl.textContent = `FPS ${stats.fps} · ${stats.animating ? "动画" : "静止"}`;
      root.body.dataset.fps = String(stats.fps);
    },
  });

  const input = createBoardInput({
    canvas,
    getLayout: () => renderer.layoutInfo(),
    getView: () => viewRef(),
    onIntent: (intent) => session.dispatch(intent),
    onChange: (state) => renderer.setInteraction(state),
    announce,
    onHammerRequest: () => toggleHammer(),
  });

  function prefersReducedMotion() {
    return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  function announce(text) {
    if (!text || !live) return;
    live.textContent = "";
    globalThis.requestAnimationFrame?.(() => {
      live.textContent = text;
    });
  }

  function dispatch(intent) {
    return session.dispatch(intent);
  }

  /** 设置/购买等操作不一定触发 M5 事件，提交后主动重绘一次。 */
  function act(intent) {
    const result = session.dispatch(intent);
    render();
    return result;
  }

  function setSceneVisibility(scene) {
    for (const [name, element] of scenes) {
      element.hidden = name !== scene;
    }
    root.body.dataset.scene = scene;
  }

  function showScene(scene, { initial = false } = {}) {
    if (!scenes.has(scene)) return;
    const changed = currentScene !== scene;
    currentScene = scene;
    setSceneVisibility(scene);
    if (helpOpen) closeHelp({ restoreFocus: false });
    const view = viewRef();
    if (scene === "playing") {
      renderer.setPaused(false);
      if (changed) {
        input.resetView();
        renderer.syncBoard(view.board);
        renderer.resize();
      }
      input.setEnabled(!view.dialog && !helpOpen);
      if (!initial && !view.dialog) {
        globalThis.requestAnimationFrame?.(() => canvas.focus({ preventScroll: true }));
      }
    } else {
      input.setEnabled(false);
      if (!initial && changed) {
        globalThis.requestAnimationFrame?.(() => {
          const heading = scenes.get(scene)?.querySelector("h1");
          heading?.focus?.({ preventScroll: true });
        });
      }
    }
    if (changed && !initial) {
      globalThis.scrollTo?.({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
    if (scene === "rank" && pendingProfileFocus) {
      pendingProfileFocus = false;
      globalThis.requestAnimationFrame?.(() => $("#profile-title")?.focus?.({ preventScroll: true }));
    }
  }

  // ---------- 场景渲染 ----------

  function render() {
    const view = viewRef();
    renderer.setColorblind(view.colorblind);
    audio.setMuted(view.muted);
    setSceneVisibility(view.scene);
    renderSaveBanner(view);
    renderMenu(view);
    renderLevels(view);
    renderPlaying(view);
    renderRank(view);
    renderSettings(view);
    renderDialog(view);
    renderNotice(view);
    renderTutorial(view);
    if (view.scene === "playing" && !view.dialog && !helpOpen) input.sync();
    return view;
  }

  function renderSaveBanner(view) {
    if (!saveBanner) return;
    if (view.saveMode === "readonly") {
      saveBanner.textContent = messages.readonly ?? "当前浏览器环境无法保存进度，关闭页面后可能丢失";
      saveBanner.hidden = false;
    } else {
      saveBanner.hidden = true;
    }
  }

  function renderMenu(view) {
    const continueButton = $("#continue-level");
    if (continueButton) {
      continueButton.textContent = `继续第 ${view.unlockedLevel} 关`;
    }
    const facts = {
      lives: `${view.lives} / 5`,
      coins: formatNumber(view.coins),
      total: formatNumber(view.totalScore),
      unlocked: `第 ${view.unlockedLevel} 关`,
    };
    for (const [key, value] of Object.entries(facts)) {
      const node = root.querySelector(`[data-fact="${key}"]`);
      if (node) node.textContent = value;
    }
    const refill = $("#menu-refill");
    const hint = $("#menu-refill-hint");
    if (refill && hint) {
      const canAfford = view.coins >= 200;
      refill.hidden = view.lives >= 5;
      hint.hidden = view.lives >= 5 || canAfford;
      refill.disabled = !canAfford;
      refill.setAttribute("aria-disabled", String(!canAfford));
      if (!canAfford) hint.textContent = `金币不足，还差 ${200 - view.coins} 点`;
    }
  }

  function buildLevelChapters() {
    if (!levelChapters || levelChapters.childElementCount > 0) return;
    const groups = new Map();
    for (const level of levels) {
      if (!groups.has(level.segment)) groups.set(level.segment, []);
      groups.get(level.segment).push(level);
    }
    levelCardEls = [];
    for (const [segment, group] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
      const section = document.createElement("section");
      section.className = "chapter";
      section.setAttribute("aria-label", chapterName(segment));

      const head = document.createElement("div");
      head.className = "chapter-head";
      const title = document.createElement("h2");
      title.textContent = chapterName(segment);
      const range = document.createElement("span");
      range.textContent = `第 ${group[0].level}–${group[group.length - 1].level} 关`;
      head.append(title, range);

      const grid = document.createElement("div");
      grid.className = "level-grid";
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", `${chapterName(segment)}关卡`);

      for (const level of group) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "level-card";
        card.dataset.level = String(level.level);
        card.innerHTML = `
          <span class="level-no"></span>
          <span class="level-stars" aria-hidden="true"></span>
          <span class="level-best"></span>
          <span class="level-lock"></span>
          <span class="level-goal"></span>
        `;
        card.querySelector(".level-no").textContent = `第 ${String(level.level).padStart(2, "0")} 关`;
        card.querySelector(".level-goal").textContent = goalSummary(level);
        grid.append(card);
        levelCardEls.push(card);
      }

      section.append(head, grid);
      levelChapters.append(section);
    }
    attachGridKeyboard(levelChapters, ".level-card");
  }

  function renderLevels(view) {
    buildLevelChapters();
    const lives = $("#level-lives");
    const coins = $("#level-coins");
    const unlocked = $("#level-unlocked");
    if (lives) lives.textContent = `${view.lives} / 5`;
    if (coins) coins.textContent = formatNumber(view.coins);
    if (unlocked) unlocked.textContent = `第 ${view.unlockedLevel} 关`;

    for (const card of levelCardEls) {
      const number = Number(card.dataset.level);
      const unlockedFlag = number <= view.unlockedLevel;
      const stars = Number(view.stars?.[number]) || 0;
      const best = Number(view.bestScores?.[number]) || 0;
      card.classList.toggle("is-locked", !unlockedFlag);
      card.classList.toggle("is-unlocked", unlockedFlag);
      card.setAttribute("aria-disabled", String(!unlockedFlag));
      card.querySelector(".level-stars").textContent = starText(stars);
      card.querySelector(".level-stars").setAttribute("aria-label", `${stars} 星`);
      card.querySelector(".level-best").textContent = best > 0 ? `最高 ${formatNumber(best)}` : unlockedFlag ? "尚未挑战" : "锁定";
      card.querySelector(".level-lock").textContent = unlockedFlag ? "" : "未解锁";
      card.setAttribute(
        "aria-label",
        unlockedFlag
          ? `第 ${number} 关，已解锁，${stars} 星，最高分 ${best}，${goalSummary(levelByNo.get(number))}`
          : `第 ${number} 关，未解锁，先通过第 ${number - 1} 关`,
      );
      card.title = unlockedFlag ? `进入第 ${number} 关` : `先通过第 ${number - 1} 关`;
    }
  }

  function goalRow(goal) {
    const li = document.createElement("li");
    li.className = "goal";
    li.innerHTML = `
      <div class="goal-head"><span class="goal-label"></span><span class="goal-value"></span></div>
      <div class="goal-track"><i></i></div>
      <p class="goal-status"></p>
    `;
    return li;
  }

  function renderGoals(view) {
    const cfg = levelByNo.get(view.level);
    const signature = `${view.level}|${view.goals.length}|${goalList?.childElementCount ?? 0}`;
    if (signature !== goalSignature) {
      goalSignature = signature;
      if (goalList) {
        goalList.textContent = "";
        goalEls = view.goals.map(() => goalRow());
        for (const element of goalEls) goalList.append(element);
      }
    }
    view.goals.forEach((goal, index) => {
      const element = goalEls[index];
      if (!element) return;
      const label = goalLabel(goal, cfg);
      const percent = goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0;
      element.classList.toggle("is-done", goal.done);
      element.querySelector(".goal-label").textContent = label;
      element.querySelector(".goal-value").textContent = `${formatNumber(goal.current)} / ${formatNumber(goal.target)}`;
      element.querySelector(".goal-track i").style.width = `${percent}%`;
      element.querySelector(".goal-status").textContent = goal.done
        ? "已完成"
        : `还差 ${formatNumber(Math.max(0, goal.target - goal.current))}`;
    });
  }

  function renderPlaying(view) {
    const cfg = levelByNo.get(view.level);
    const title = $("#play-title");
    const segment = $("#play-segment");
    if (title) title.textContent = view.level ? `第 ${view.level} 关` : "对局";
    if (segment) segment.textContent = cfg ? `${chapterName(cfg.segment)} · ${cfg.moves} 步` : "对局";

    const score = $("#play-score");
    const moves = $("#play-moves");
    if (score) score.textContent = formatNumber(view.score);
    if (moves) moves.textContent = String(view.movesLeft);

    const stars = $("#play-stars");
    if (stars) {
      stars.textContent = starText(view.starsPreview);
      stars.setAttribute("aria-label", `当前完成可得 ${view.starsPreview} 星`);
    }
    const starTextNode = $("#play-star-text");
    if (starTextNode) {
      const keep = view.starKeep;
      starTextNode.textContent = keep
        ? `剩 ${keep.keep2} 步得 2★ · 剩 ${keep.keep3} 步得 3★`
        : "剩余步数越多，星级越高";
    }

    renderGoals(view);

    const hint = $("#play-hint");
    if (hint) {
      hint.textContent = view.inputLocked
        ? "动画播放中，操作会排队，最多保留 2 个。"
        : "目标全部完成即通关。方向键移动光标，空格选定。";
    }

    for (const button of root.querySelectorAll("[data-item]")) {
      const kind = button.dataset.item;
      const count = Number(view.items?.[kind]) || 0;
      const usable = Boolean(view.canUseItem?.[kind]);
      const disabled = !usable || count <= 0 || Boolean(view.dialog) || helpOpen;
      button.disabled = disabled;
      button.setAttribute("aria-disabled", String(disabled));
      const countEl = button.querySelector("[data-count]");
      const noteEl = button.querySelector("[data-note]");
      if (countEl) countEl.textContent = String(count);
      let note = ITEM_NOTES[kind] ?? "";
      if (!usable) note = "本关已用";
      else if (count <= 0) note = "库存 0";
      if (noteEl) noteEl.textContent = note;
      button.setAttribute(
        "aria-label",
        `${ITEM_LABELS[kind]}，库存 ${count}，${note}${disabled ? "，当前不可用" : ""}`,
      );
    }

    const mute = $("#mute-btn");
    if (mute) {
      mute.textContent = view.muted ? "音效：关" : "音效：开";
      mute.setAttribute("aria-pressed", String(view.muted));
    }

    const hammerOn = input.getState().hammer;
    const hammerBtn = root.querySelector('[data-item="hammer"]');
    if (hammerBtn) hammerBtn.classList.toggle("is-aiming", hammerOn);

    input.setEnabled(view.scene === "playing" && !view.dialog && !helpOpen);
    renderer.setPaused(helpOpen);
  }

  function renderRank(view) {
    const rank = view.rank ?? {};
    const source = $("#rank-source");
    const selfEntry = (rank.list ?? []).find((entry) => entry.self);
    if (source) {
      source.classList.remove("source-none", "source-remote", "source-local");
      if (rank.loading && (rank.list ?? []).length === 0) {
        source.textContent = "正在载入…";
        source.classList.add("source-none");
      } else if (rank.source === "remote") {
        source.textContent = "在线榜单";
        source.classList.add("source-remote");
      } else if (rank.source === "local") {
        source.textContent = "本地模拟数据 · 离线降级";
        source.classList.add("source-local");
      } else {
        source.textContent = "尚未载入";
        source.classList.add("source-none");
      }
      if (selfEntry) {
        source.textContent += ` · 我的名次：第 ${selfEntry.rank} 名`;
      } else if (view.nickname) {
        source.textContent += " · 我的成绩尚未入榜";
      }
    }

    const message = $("#rank-message");
    if (message) {
      const text =
        rank.source === "local"
          ? messages.offline ?? "网络不可用，排行榜暂不可用，单机游玩不受影响"
          : rank.message || "";
      message.textContent = text;
      message.hidden = !text;
    }

    const signature = [
      rank.source,
      rank.loading,
      rank.list?.length ?? 0,
      rank.list?.[0]?.nickname,
      rank.list?.[0]?.totalScore,
      selfEntry?.nickname,
      selfEntry?.totalScore,
      view.nickname,
      view.totalScore,
    ].join("|");
    const list = $("#rank-list");
    if (list && signature !== rankSignature) {
      rankSignature = signature;
      list.textContent = "";
      const entries = rank.list ?? [];
      if (entries.length === 0) {
        const empty = document.createElement("li");
        empty.className = "rank-empty";
        empty.textContent = rank.loading ? "正在载入榜单…" : "还没有榜单数据，点击“刷新”重试。";
        list.append(empty);
      } else {
        for (const entry of entries) {
          const li = document.createElement("li");
          li.className = "rank-row";
          if (entry.self) {
            li.classList.add("is-self");
            li.setAttribute("aria-current", "true");
          }
          li.innerHTML = `
            <span class="rank-no"></span>
            <span class="rank-name"></span>
            <span class="rank-score"></span>
          `;
          li.querySelector(".rank-no").textContent = String(entry.rank ?? "").padStart(2, "0");
          li.querySelector(".rank-name").textContent = entry.self ? `${entry.nickname}（我）` : entry.nickname;
          li.querySelector(".rank-score").textContent = formatNumber(entry.totalScore);
          list.append(li);
        }
      }
    }
    if (list) list.setAttribute("aria-busy", String(Boolean(rank.loading)));

    const submit = $("#rank-submit");
    if (submit) {
      submit.disabled = Boolean(rank.submitting);
      submit.textContent = rank.submitting ? "提交中…" : "提交我的成绩";
    }
    const refresh = $("#rank-refresh");
    if (refresh) {
      refresh.disabled = Boolean(rank.loading);
      refresh.textContent = rank.loading ? "载入中…" : "刷新";
    }

    const name = $("#profile-name");
    const total = $("#profile-total");
    const stars = $("#profile-stars");
    const unlocked = $("#profile-unlocked");
    if (name) name.textContent = view.nickname || "未设置";
    if (total) total.textContent = formatNumber(view.totalScore);
    if (stars) stars.textContent = `${sumStars(view.stars)} / 90`;
    if (unlocked) unlocked.textContent = `第 ${view.unlockedLevel} 关`;
    if (nicknameInput && document.activeElement !== nicknameInput) {
      nicknameInput.value = view.nickname ?? "";
    }

    if (profileLevelEls.length === 0 && profileLevels) {
      for (const level of levels) {
        const row = document.createElement("div");
        row.className = "level-row";
        row.innerHTML = '<span class="level-row-no"></span><span class="level-row-stars"></span><span class="level-row-best"></span>';
        profileLevels.append(row);
        profileLevelEls.push(row);
      }
    }
    profileLevelEls.forEach((row, index) => {
      const level = levels[index];
      if (!level) return;
      const stars = Number(view.stars?.[level.level]) || 0;
      const best = Number(view.bestScores?.[level.level]) || 0;
      row.querySelector(".level-row-no").textContent = `第 ${level.level} 关`;
      row.querySelector(".level-row-stars").textContent = starText(stars);
      row.querySelector(".level-row-stars").setAttribute("aria-label", `${stars} 星`);
      row.querySelector(".level-row-best").textContent = best > 0 ? formatNumber(best) : "—";
    });

    if (pendingProfileFocus) {
      pendingProfileFocus = false;
      globalThis.requestAnimationFrame?.(() => $("#profile-title")?.focus?.({ preventScroll: true }));
    }
  }

  function buildShop() {
    if (!shop || shop.childElementCount > 0) return;
    for (const kind of ["shuffle", "hammer", "plus5"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shop-btn";
      button.dataset.buy = kind;
      button.innerHTML = '<span class="shop-name"></span><span class="shop-price"></span>';
      button.querySelector(".shop-name").textContent = ITEM_LABELS[kind];
      shop.append(button);
    }
  }

  function renderSettings(view) {
    const mute = $("#mute-switch");
    const colorblind = $("#colorblind-switch");
    if (mute) {
      mute.setAttribute("aria-checked", String(!view.muted));
      mute.querySelector(".switch-state").textContent = view.muted ? "已关闭" : "已开启";
    }
    if (colorblind) {
      colorblind.setAttribute("aria-checked", String(Boolean(view.colorblind)));
      colorblind.querySelector(".switch-state").textContent = view.colorblind ? "已开启" : "已关闭";
    }
    const coins = $("#settings-coins");
    if (coins) coins.textContent = formatNumber(view.coins);

    buildShop();
    for (const button of root.querySelectorAll("[data-buy]")) {
      const kind = button.dataset.buy;
      const price = Number(itemPrices[kind]) || 0;
      const count = Number(view.items?.[kind]) || 0;
      const disabled = view.coins < price;
      button.disabled = disabled;
      button.setAttribute("aria-disabled", String(disabled));
      button.querySelector(".shop-name").textContent = `${ITEM_LABELS[kind]} · 库存 ${count}`;
      button.querySelector(".shop-price").textContent = disabled
        ? `还差 ${price - view.coins} 金币`
        : `购买 · ${price} 金币`;
      button.setAttribute(
        "aria-label",
        disabled
          ? `${ITEM_LABELS[kind]}，需要 ${price} 金币，还差 ${price - view.coins} 金币`
          : `购买${ITEM_LABELS[kind]}，${price} 金币`,
      );
    }

    const audioState = $("#audio-state");
    if (audioState) {
      if (!view.audioAvailable) audioState.textContent = "音频不可用，已静音运行。";
      else if (audio.unlocked) audioState.textContent = "音频可用，音效与背景声已启用。";
      else audioState.textContent = "音频可用，首次操作后启用。";
    }

    updateImportButton();
  }

  function renderDialog(view) {
    if (!dialogLayer) return;
    const dialog = view.dialog;
    if (!dialog) {
      if (!dialogLayer.hidden) {
        dialogLayer.hidden = true;
        root.body.classList.remove("is-locked");
        if (previousFocus && typeof previousFocus.focus === "function") {
          previousFocus.focus({ preventScroll: true });
        }
        previousFocus = null;
      }
      dialogKey = null;
      return;
    }

    // 让结算动画先播完，再盖上弹窗。
    if (renderer.isPlaying) {
      dialogLayer.hidden = true;
      dialogKey = null;
      return;
    }

    const key = `${dialog.id}|${dialog.type}|${dialog.actions.join(",")}`;
    if (key === dialogKey) return;
    dialogKey = key;
    if (helpOpen) closeHelp({ restoreFocus: false });
    previousFocus = document.activeElement;

    const text = DIALOG_TEXT[dialog.type] ?? DIALOG_TEXT.info;
    dialogKicker.textContent = text.kicker;
    dialogTitle.textContent = text.title;
    dialogLines.textContent = "";
    for (const line of dialog.lines ?? []) {
      const wrapper = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = line.label;
      dd.textContent = line.value;
      wrapper.append(dt, dd);
      dialogLines.append(wrapper);
    }

    const starLine = (dialog.lines ?? []).find((line) => line.label === "星级");
    const starCount = starLine ? (String(starLine.value).match(/★/g) ?? []).length : 0;
    if (dialog.type === "win" && starCount > 0) {
      dialogStars.hidden = false;
      dialogStars.textContent = starText(starCount);
      dialogStars.setAttribute("aria-label", `${starCount} 星`);
    } else {
      dialogStars.hidden = true;
      dialogStars.textContent = "";
    }

    dialogActions.textContent = "";
    dialog.actions.forEach((action, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === 0 ? "btn btn-primary" : "btn btn-quiet";
      button.dataset.dialogAction = action;
      button.textContent = ACTION_LABELS[action] ?? action;
      dialogActions.append(button);
    });

    dialogLayer.hidden = false;
    root.body.classList.add("is-locked");
    globalThis.requestAnimationFrame?.(() => {
      focusables(dialogLayer)[0]?.focus?.({ preventScroll: true });
    });
    announce(`${text.title} ${(dialog.lines ?? []).map((line) => `${line.label} ${line.value}`).join("，")}`);
  }

  function renderNotice(view) {
    if (view.notice === messages.readonly) {
      lastNotice = view.notice;
      return;
    }
    if (!view.notice) {
      lastNotice = null;
      return;
    }
    if (view.notice !== lastNotice) {
      lastNotice = view.notice;
      showToast(view.notice);
    }
  }

  function showToast(text) {
    if (!toast || !toastText) return;
    toastText.textContent = text;
    toast.hidden = false;
    if (toastTimer) globalThis.clearTimeout?.(toastTimer);
    toastTimer = globalThis.setTimeout?.(() => hideToast(true), 5200) ?? 0;
  }

  function hideToast(clearSession = false) {
    if (toast) toast.hidden = true;
    if (toastTimer) globalThis.clearTimeout?.(toastTimer);
    toastTimer = 0;
    if (clearSession && viewRef().notice && !viewRef().dialog) {
      dispatch({ type: "notice:clear" });
      lastNotice = null;
    }
  }

  function renderTutorial(view) {
    const tutorial = $("#tutorial");
    if (!tutorial) return;
    tutorial.hidden = tutorialDismissed || view.scene !== "playing";
  }

  function openHelp() {
    if (helpOpen || viewRef().scene !== "playing") return;
    helpOpen = true;
    const view = viewRef();
    const cfg = levelByNo.get(view.level);
    if (helpGoals) {
      helpGoals.textContent = "";
      const list = document.createElement("ul");
      list.className = "goal-list";
      for (const goal of view.goals) {
        const li = document.createElement("li");
        li.className = "goal";
        const percent = goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0;
        li.innerHTML = `
          <div class="goal-head"><span class="goal-label"></span><span class="goal-value"></span></div>
          <div class="goal-track"><i></i></div>
        `;
        li.querySelector(".goal-label").textContent = goalLabel(goal, cfg);
        li.querySelector(".goal-value").textContent = `${formatNumber(goal.current)} / ${formatNumber(goal.target)}`;
        li.querySelector(".goal-track i").style.width = `${percent}%`;
        list.append(li);
      }
      helpGoals.append(list);
    }
    helpLayer.hidden = false;
    root.body.classList.add("is-locked");
    renderer.setPaused(true);
    input.setEnabled(false);
    globalThis.requestAnimationFrame?.(() => focusables(helpLayer)[0]?.focus?.({ preventScroll: true }));
  }

  function closeHelp({ restoreFocus = true } = {}) {
    if (!helpOpen) return;
    helpOpen = false;
    helpLayer.hidden = true;
    root.body.classList.remove("is-locked");
    if (viewRef().scene === "playing") {
      renderer.setPaused(false);
      input.setEnabled(!viewRef().dialog);
      if (restoreFocus) canvas.focus({ preventScroll: true });
    }
  }

  function toggleHammer() {
    const view = viewRef();
    if (view.scene !== "playing" || view.dialog) return;
    if (!view.canUseItem?.hammer || (view.items?.hammer ?? 0) <= 0) {
      announce("锤子当前不可用。");
      return;
    }
    input.setHammerMode(!input.getState().hammer);
    render();
  }

  function exportSave() {
    const text = session.exportSave();
    const field = $("#save-text");
    if (field) field.value = text;
    try {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gemz-save-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      globalThis.setTimeout?.(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // 下载失败时，文本框里仍有可复制的存档。
    }
    announce("存档已导出，可复制文本框内容或使用下载文件。");
  }

  function updateImportButton() {
    const button = $("#import-save");
    const field = $("#import-text");
    const confirm = $("#import-confirm");
    if (!button) return;
    const ready = Boolean(confirm?.checked) && Boolean(field?.value.trim());
    button.disabled = !ready;
    button.setAttribute("aria-disabled", String(!ready));
  }

  function importSave() {
    const field = $("#import-text");
    const confirm = $("#import-confirm");
    if (!field || !confirm?.checked) return;
    const text = field.value.trim();
    if (!text) return;
    const ok = dispatch({ type: "importSave", text });
    if (ok) {
      confirm.checked = false;
      updateImportButton();
      announce("存档已导入。");
    }
    render();
  }

  function navigate(name) {
    if (name === "profile") {
      const view = viewRef();
      if (view.scene === "rank") {
        $("#profile-title")?.focus?.({ preventScroll: true });
        $("#profile-panel")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      } else {
        pendingProfileFocus = true;
        dispatch({ type: "scene", scene: "rank" });
      }
      return;
    }
    dispatch({ type: "scene", scene: name });
  }

  // ---------- 事件 ----------

  function onDocumentClick(event) {
    const target = event.target.closest?.(
      "[data-action],[data-nav],[data-item],[data-level],[data-buy],[data-dialog-action]",
    );
    if (!target) return;

    if (target.dataset.dialogAction) {
      act({ type: "dialogAction", action: target.dataset.dialogAction });
      return;
    }
    if (target.dataset.nav) {
      navigate(target.dataset.nav);
      return;
    }
    if (target.dataset.level) {
      act({ type: "startLevel", level: Number(target.dataset.level) });
      return;
    }
    if (target.dataset.item) {
      const kind = target.dataset.item;
      if (kind === "hammer") {
        toggleHammer();
      } else {
        act({ type: "item", kind });
      }
      return;
    }
    if (target.dataset.buy) {
      act({ type: "buy", kind: target.dataset.buy });
      return;
    }

    switch (target.dataset.action) {
      case "continue": {
        const view = viewRef();
        act({ type: "startLevel", level: view.unlockedLevel });
        break;
      }
      case "mute": {
        const view = viewRef();
        act({ type: "setMuted", muted: !view.muted });
        break;
      }
      case "help":
        openHelp();
        break;
      case "close-help":
        closeHelp();
        break;
      case "dismiss-toast":
        hideToast(true);
        break;
      case "refill":
        act({ type: "refillLives" });
        break;
      case "submit-rank": {
        const view = viewRef();
        if (!view.nickname) {
          announce("请先在个人主页设置 3–12 个中英文、数字或下划线的昵称。");
          $("#profile-title")?.focus?.({ preventScroll: true });
          $("#profile-panel")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
          nicknameInput?.focus?.({ preventScroll: true });
          return;
        }
        act({ type: "submitRank" });
        break;
      }
      case "refresh-rank":
        act({ type: "loadRank" });
        break;
      case "export-save":
        exportSave();
        break;
      case "import-save":
        importSave();
        break;
      case "dismiss-tutorial":
        tutorialDismissed = true;
        writeStorage(storage, TUTORIAL_KEY, "1");
        render();
        canvas.focus({ preventScroll: true });
        break;
      case "dialog-scrim": {
        const view = viewRef();
        if (view.dialog?.actions?.includes("close")) {
          act({ type: "dialogAction", action: "close" });
        }
        break;
      }
      default:
        break;
    }
  }

  function onDocumentKeyDown(event) {
    if (event.defaultPrevented) return;
    const dialogOpen = !dialogLayer?.hidden;
    if (dialogOpen) {
      if (event.key === "Escape") {
        const view = viewRef();
        if (view.dialog?.actions?.includes("close")) {
          event.preventDefault();
          dispatch({ type: "dialogAction", action: "close" });
        }
        return;
      }
      trapFocus(event, dialogLayer);
      return;
    }

    if (helpOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHelp();
        return;
      }
      trapFocus(event, helpLayer);
      return;
    }

    if (isTypingTarget(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const view = viewRef();
    if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      act({ type: "setMuted", muted: !view.muted });
      return;
    }
    if (view.scene === "playing") {
      if (event.key === "?" || event.key === "p" || event.key === "P") {
        event.preventDefault();
        openHelp();
      }
      return;
    }
    if (event.key === "Escape" && ["levelSelect", "rank", "settings"].includes(view.scene)) {
      event.preventDefault();
      navigate("menu");
    }
  }

  function onVisibilityChange() {
    const hidden = document.visibilityState === "hidden";
    dispatch({ type: "visibility", hidden });
  }

  function onProfileSubmit(event) {
    event.preventDefault();
    if (!nicknameInput) return;
    const ok = dispatch({ type: "setNickname", nickname: nicknameInput.value });
    if (ok) {
      announce("昵称已保存。");
      render();
    }
  }

  function onImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        const field = $("#import-text");
        if (field) field.value = text;
        updateImportButton();
        announce(`已读取 ${file.name}，勾选确认后即可导入。`);
      })
      .catch(() => announce("文件读取失败，可以直接粘贴存档文本。"));
  }

  function onImportInput() {
    updateImportButton();
  }

  // ---------- 启动 / 销毁 ----------

  const clickHandler = (event) => onDocumentClick(event);
  const keyHandler = (event) => onDocumentKeyDown(event);
  const visibilityHandler = () => onVisibilityChange();

  root.addEventListener("click", clickHandler);
  root.addEventListener("keydown", keyHandler);
  document.addEventListener("visibilitychange", visibilityHandler);
  globalThis.addEventListener?.("pointerdown", unlockAudio, { passive: true });
  globalThis.addEventListener?.("keydown", unlockAudio);

  function unlockAudio() {
    audio.unlock();
    globalThis.removeEventListener?.("pointerdown", unlockAudio);
    globalThis.removeEventListener?.("keydown", unlockAudio);
  }

  const form = $("#profile-form");
  form?.addEventListener("submit", onProfileSubmit);

  const muteSwitch = $("#mute-switch");
  const colorblindSwitch = $("#colorblind-switch");
  const onMuteSwitch = () => act({ type: "setMuted", muted: !viewRef().muted });
  const onColorblindSwitch = () => act({ type: "setColorblind", colorblind: !viewRef().colorblind });
  muteSwitch?.addEventListener("click", onMuteSwitch);
  colorblindSwitch?.addEventListener("click", onColorblindSwitch);

  const importFile = $("#import-file");
  importFile?.addEventListener("change", onImportFile);
  const importText = $("#import-text");
  importText?.addEventListener("input", onImportInput);
  const importConfirm = $("#import-confirm");
  importConfirm?.addEventListener("change", updateImportButton);

  const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  const onMotionChange = () => renderer.setReducedMotion(Boolean(motionQuery?.matches));
  motionQuery?.addEventListener?.("change", onMotionChange);

  const offSession = session.subscribe((event) => {
    switch (event.type) {
      case "move:rejected":
        renderer.shake();
        try {
          audio.play("swap");
        } catch {
          // 音频不可用时由 M5 统一提示，这里不再重复。
        }
        announce("没有形成三连，棋盘没有变化。");
        break;
      case "input:queued":
        announce("动画播放中，操作已排队。");
        break;
      case "input:unlock":
        if (!renderer.isPlaying) renderer.syncBoard(viewRef().board);
        break;
      case "level:started":
        renderer.syncBoard(viewRef().board);
        break;
      case "item:rejected":
        announce("这个道具现在不能用。");
        break;
      case "lives:restored":
        announce(`恢复了 ${event.gained} 点生命。`);
        break;
      case "rank:submit-failed":
        announce("排行榜暂时不可用，单机进度不受影响。");
        break;
      case "run:clear":
        announce(`第 ${event.level} 关通关，${event.stars} 星。`);
        break;
      case "run:fail":
        announce("目标没有全部完成，本局结束。");
        break;
      default:
        break;
    }
    render();
  });

  let timer = 0;

  function start() {
    renderer.start();
    const view = render();
    showScene(view.scene, { initial: true });
    render();
    timer = globalThis.setInterval?.(() => session.tick(Date.now()), 500) ?? 0;
    return view;
  }

  function play(events, meta = null) {
    const list = Array.isArray(events) ? events : [];
    const settled = list.find((event) => event.type === "board:settled");
    const steps = settled?.steps ?? [];
    if (list.some((event) => event.type === "deadlock:shuffled")) {
      showToast(messages.deadlock ?? "无可消除组合，已自动重排");
    }
    const view = viewRef();
    if (steps.length === 0) {
      renderer.syncBoard(view.board);
      render();
      return Promise.resolve();
    }
    return renderer.play(steps, view.board, meta?.move ?? null).then(() => {
      renderer.syncBoard(viewRef().board);
      render();
    });
  }

  function visibility(hidden) {
    audio.setHidden(Boolean(hidden));
  }

  function tick() {
    // M5 的兜底检查已经通过 session.tick 驱动；这里保留接口。
  }

  function destroy() {
    if (timer) globalThis.clearInterval?.(timer);
    offSession?.();
    input.destroy();
    renderer.destroy();
    audio.dispose();
    root.removeEventListener("click", clickHandler);
    root.removeEventListener("keydown", keyHandler);
    document.removeEventListener("visibilitychange", visibilityHandler);
    form?.removeEventListener("submit", onProfileSubmit);
    muteSwitch?.removeEventListener("click", onMuteSwitch);
    colorblindSwitch?.removeEventListener("click", onColorblindSwitch);
    importFile?.removeEventListener("change", onImportFile);
    importText?.removeEventListener("input", onImportInput);
    importConfirm?.removeEventListener("change", updateImportButton);
    motionQuery?.removeEventListener?.("change", onMotionChange);
    globalThis.removeEventListener?.("pointerdown", unlockAudio);
    globalThis.removeEventListener?.("keydown", unlockAudio);
  }

  return {
    start,
    render,
    showScene,
    play,
    audio: (effect, chain) => audio.play(effect, chain),
    visibility,
    tick,
    destroy,
    focusProfile() {
      pendingProfileFocus = true;
      render();
    },
    get renderer() {
      return renderer;
    },
    get input() {
      return input;
    },
    get audioEngine() {
      return audio;
    },
  };
}

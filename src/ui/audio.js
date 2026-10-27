/**
 * M7 音频与视效（I-30、FR-26/FR-27、FL-07）。
 *
 * Web Audio 合成 5 类音效与一段很轻的背景铺底；首次用户交互后才
 * 创建 AudioContext，静音与页面可见性都只改增益/上下文状态，不参与
 * 任何游戏规则。上下文不可用时由 M5 捕获并静默降级（FM-09）。
 */

export const EFFECTS = Object.freeze(["clear", "swap", "item", "win", "fail"]);

const EFFECT_BASE = Object.freeze({
  clear: Object.freeze({ freq: 523.25, dur: 0.16, type: "triangle", gain: 0.16 }),
  swap: Object.freeze({ freq: 349.23, dur: 0.09, type: "sine", gain: 0.12 }),
  item: Object.freeze({ freq: 440, dur: 0.14, type: "triangle", gain: 0.14 }),
});

function clampChain(chain) {
  const value = Math.trunc(Number(chain) || 1);
  return Math.min(8, Math.max(1, value));
}

/**
 * 音效音高计划（纯函数，便于单测）。
 *
 * clear 随连锁升高半音；win/fail 用小段三音/两音动机。
 * 返回 {freq, at, dur, type, gain} 数组，at 为相对秒数。
 */
export function effectPlan(effect, chain = 1) {
  const safeChain = clampChain(chain);
  if (effect === "win") {
    return [523.25, 659.25, 783.99].map((freq, index) => ({
      freq,
      at: index * 0.09,
      dur: 0.24,
      type: "triangle",
      gain: 0.15,
    }));
  }
  if (effect === "fail") {
    return [392, 311.13].map((freq, index) => ({
      freq,
      at: index * 0.12,
      dur: 0.22,
      type: "sine",
      gain: 0.14,
    }));
  }
  if (effect === "item") {
    return [440, 587.33].map((freq, index) => ({
      freq,
      at: index * 0.07,
      dur: 0.13,
      type: "triangle",
      gain: 0.13,
    }));
  }
  const base = EFFECT_BASE[effect] ?? EFFECT_BASE.swap;
  const semitones = effect === "clear" ? safeChain - 1 : 0;
  return [
    {
      freq: base.freq * 2 ** (semitones / 12),
      at: 0,
      dur: base.dur,
      type: base.type,
      gain: base.gain,
    },
  ];
}

/**
 * 创建音频引擎。`play` 只在已解锁且未静音/未隐藏时发声；
 * 任何异常都向上抛，让 M5 把 `audioAvailable` 置 false。
 */
export function createAudioEngine({ logger = null } = {}) {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let musicNodes = [];
  let muted = false;
  let hidden = false;
  let unlocked = false;
  let available = true;
  let disposed = false;

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) {
      available = false;
      throw new Error("Web Audio 不可用");
    }
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      return ctx;
    } catch (error) {
      available = false;
      logger?.warn?.("AudioContext 创建失败", error);
      throw error;
    }
  }

  function buildMusic() {
    if (!ctx || musicGain || disposed) return;
    musicGain = ctx.createGain();
    musicGain.gain.value = muted ? 0 : 0.035;
    musicGain.connect(master);

    const padA = ctx.createOscillator();
    padA.type = "sine";
    padA.frequency.value = 110;
    const padB = ctx.createOscillator();
    padB.type = "triangle";
    padB.frequency.value = 164.81;
    const gainA = ctx.createGain();
    gainA.gain.value = 0.5;
    const gainB = ctx.createGain();
    gainB.gain.value = 0.28;

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain);
    lfoGain.connect(musicGain.gain);

    padA.connect(gainA).connect(musicGain);
    padB.connect(gainB).connect(musicGain);
    padA.start();
    padB.start();
    lfo.start();
    musicNodes = [padA, padB, lfo];
  }

  function unlock() {
    if (disposed || unlocked) return;
    try {
      const context = ensureContext();
      if (context.state === "suspended") void context.resume();
      unlocked = true;
      buildMusic();
    } catch (error) {
      available = false;
      logger?.warn?.("音频解锁失败，已静默运行", error);
    }
  }

  function play(effect, chain = 1) {
    if (disposed) return;
    if (!available) throw new Error("音频不可用");
    // 音效总是由用户操作触发；首次播放时惰性解锁，避免第一次交换静音。
    if (!unlocked) unlock();
    if (!unlocked || muted || hidden) return;
    const context = ensureContext();
    if (context.state !== "running") return;
    const startAt = context.currentTime + 0.005;
    for (const tone of effectPlan(effect, chain)) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = tone.type;
      oscillator.frequency.value = tone.freq;
      const begin = startAt + tone.at;
      envelope.gain.setValueAtTime(0, begin);
      envelope.gain.linearRampToValueAtTime(tone.gain, begin + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, begin + tone.dur);
      oscillator.connect(envelope).connect(master);
      oscillator.start(begin);
      oscillator.stop(begin + tone.dur + 0.02);
      oscillator.addEventListener?.("ended", () => {
        envelope.disconnect();
      });
    }
  }

  function setMuted(next) {
    muted = Boolean(next);
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
    }
    if (musicGain && ctx) {
      musicGain.gain.setTargetAtTime(muted || hidden ? 0 : 0.035, ctx.currentTime, 0.05);
    }
    if (!muted && !hidden && unlocked && ctx?.state === "suspended") {
      void ctx.resume?.();
    }
  }

  function setHidden(next) {
    hidden = Boolean(next);
    if (!ctx) return;
    if (musicGain) {
      musicGain.gain.setTargetAtTime(hidden || muted ? 0 : 0.035, ctx.currentTime, 0.05);
    }
    if (hidden) {
      void ctx.suspend?.();
    } else if (unlocked && !muted) {
      void ctx.resume?.();
    }
  }

  function dispose() {
    disposed = true;
    for (const node of musicNodes) {
      try {
        node.stop();
      } catch {
        // 已停止的振荡器无需处理。
      }
    }
    musicNodes = [];
    if (ctx) {
      try {
        void ctx.close();
      } catch {
        // 关闭失败不影响退出。
      }
    }
    ctx = null;
    master = null;
    musicGain = null;
  }

  return {
    unlock,
    play,
    setMuted,
    setHidden,
    dispose,
    get available() {
      return available;
    },
    get unlocked() {
      return unlocked;
    },
    get state() {
      return ctx?.state ?? "closed";
    },
  };
}

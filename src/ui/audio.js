/**
 * M7 音频与视效（I-30、FR-26/FR-27、FL-07）。
 *
 * 全部用 Web Audio API 实时合成，不依赖采样文件：
 * - clear：五声音阶风铃；
 * - ice：高频噪声扫频 + 随机玻璃颗粒；
 * - swap：带通噪声拍击 + 低频下滑；
 * - item：三和弦闪光；
 * - win：上升琶音 + 和弦 + 钟琴分音；
 * - fail：低频冲击。
 *
 * 所有声音统一经过 DynamicsCompressor，避免连锁时叠加爆音。首次用户
 * 交互后才创建 AudioContext；静音/页面隐藏只改增益或挂起上下文。
 */

export const EFFECTS = Object.freeze(["clear", "swap", "item", "ice", "win", "fail"]);

const EFFECT_BASE = Object.freeze({
  clear: Object.freeze({ freq: 523.25, dur: 0.16, type: "triangle", gain: 0.16 }),
  swap: Object.freeze({ freq: 349.23, dur: 0.09, type: "sine", gain: 0.12 }),
  item: Object.freeze({ freq: 440, dur: 0.14, type: "triangle", gain: 0.14 }),
  ice: Object.freeze({ freq: 880, dur: 0.12, type: "sine", gain: 0.12 }),
});

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;
const A6 = 1760;
const C7 = 2093;
const D7 = 2349.32;

function clampChain(chain) {
  const value = Math.trunc(Number(chain) || 1);
  return Math.min(8, Math.max(1, value));
}

/**
 * 兼容旧 UI/测试的音高计划；实际播放由下方合成配方负责。
 * clear 随连锁升高半音；win/fail 用小段三音/两音动机。
 */
export function effectPlan(effect, chain = 1) {
  const safeChain = clampChain(chain);
  if (effect === "win") {
    return [C5, E5, G5].map((freq, index) => ({
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

export function createAudioEngine({ logger = null } = {}) {
  let ctx = null;
  let master = null;
  let compressor = null;
  let noiseBuffer = null;
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
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 20;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(compressor).connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 1.2), ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return ctx;
    } catch (error) {
      available = false;
      logger?.warn?.("AudioContext 创建失败", error);
      throw error;
    }
  }

  function connect(node, pan = 0) {
    if (pan && typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(panner).connect(master);
      return panner;
    }
    node.connect(master);
    return null;
  }

  function tone({
    freq,
    endFreq = null,
    type = "sine",
    dur,
    gain,
    attack = 0.003,
    at,
    pan = 0,
  }) {
    const begin = at;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, begin);
    if (Number.isFinite(endFreq)) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), begin + dur);
    }
    envelope.gain.setValueAtTime(0.0001, begin);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), begin + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, begin + dur);
    oscillator.connect(envelope);
    connect(envelope, pan);
    oscillator.start(begin);
    oscillator.stop(begin + dur + 0.03);
    oscillator.addEventListener?.("ended", () => {
      envelope.disconnect();
      oscillator.disconnect();
    });
  }

  function noise({
    dur,
    gain,
    filter = "bandpass",
    freq = 1800,
    endFreq = null,
    q = 0.8,
    attack = 0.003,
    at,
    pan = 0,
  }) {
    const begin = at;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.frequency.setValueAtTime(freq, begin);
    if (Number.isFinite(endFreq)) {
      biquad.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), begin + dur);
    }
    if (Number.isFinite(q)) biquad.Q.value = q;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, begin);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), begin + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, begin + dur);
    source.connect(biquad).connect(envelope);
    connect(envelope, pan);
    source.start(begin);
    source.stop(begin + dur + 0.03);
    source.addEventListener?.("ended", () => {
      envelope.disconnect();
      biquad.disconnect();
      source.disconnect();
    });
  }

  // 1. 上升琶音
  function arpeggio(at) {
    [C5, E5, G5, C6].forEach((freq, index) => {
      tone({ freq, type: "triangle", dur: 0.2, gain: 0.22, attack: 0.003, at: at + index * 0.045 });
    });
  }

  // 2. 拍击
  function slap(at) {
    noise({ dur: 0.13, gain: 0.3, filter: "bandpass", freq: 1800, q: 0.8, at });
    tone({ freq: 200, endFreq: 70, type: "sine", dur: 0.11, gain: 0.24, attack: 0.003, at });
  }

  // 3. 和弦闪光
  function chord(at) {
    [C5, E5, G5].forEach((freq) => {
      tone({ freq, type: "triangle", dur: 0.32, gain: 0.16, attack: 0.002, at });
    });
  }

  // 4. 风铃：E6-G6-A6-C7-D7，声像 -0.7 → +0.7
  function windChime(at, { pitch = 0, panOffset = 0, gain = 0.12 } = {}) {
    const ratio = 2 ** (pitch / 12);
    [E6, G6, A6, C7, D7].forEach((freq, index) => {
      tone({
        freq: freq * ratio,
        type: "sine",
        dur: 0.85,
        gain,
        attack: 0.003,
        at: at + index * 0.07,
        pan: -0.7 + (index / 4) * 1.4 + panOffset,
      });
    });
  }

  // 5. 低音冲击
  function bassImpact(at) {
    tone({ freq: 190, endFreq: 38, type: "sine", dur: 0.36, gain: 0.5, attack: 0.003, at });
    noise({ dur: 0.1, gain: 0.14, filter: "lowpass", freq: 650, q: 0.7, at });
  }

  // 6. 玻璃碎响
  function glassShatter(at) {
    noise({ dur: 0.32, gain: 0.3, filter: "highpass", freq: 2800, endFreq: 7000, q: 0.8, at });
    for (let i = 0; i < 6; i += 1) {
      tone({
        freq: 2200 + Math.random() * 3200,
        type: "sine",
        dur: 0.09,
        gain: 0.07,
        attack: 0.001,
        at: at + Math.random() * 0.14,
        pan: Math.random() * 1.6 - 0.8,
      });
    }
  }

  // 7. 钟琴：基频 1046.5Hz，非整数泛音比 [1, 2, 2.76, 5.4]
  function glockenspiel(at) {
    [1, 2, 2.76, 5.4].forEach((ratio, index) => {
      tone({
        freq: C6 * ratio,
        type: "sine",
        dur: 0.95 / (index + 1),
        gain: 0.22 / (index + 1),
        attack: 0.002,
        at,
      });
    });
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
    if (!unlocked) unlock();
    if (!unlocked || muted || hidden) return;
    const context = ensureContext();
    if (context.state !== "running") return;
    const at = context.currentTime + 0.005;
    switch (effect) {
      case "swap":
        slap(at);
        break;
      case "ice":
        glassShatter(at);
        break;
      case "item":
        chord(at);
        glockenspiel(at + 0.02);
        break;
      case "win":
        arpeggio(at);
        chord(at + 0.16);
        glockenspiel(at + 0.28);
        break;
      case "fail":
        bassImpact(at);
        break;
      case "clear":
      default: {
        // 每一段连锁都有自己的风铃：音高上行、声像交替，间隔 140ms 制造紧迫感。
        const count = clampChain(chain);
        for (let i = 0; i < count; i += 1) {
          const stepAt = at + i * 0.14;
          windChime(stepAt, {
            pitch: i * 2,
            panOffset: i % 2 === 0 ? -0.12 : 0.12,
            gain: i === 0 ? 0.12 : 0.1,
          });
          if (i > 0) {
            noise({
              dur: 0.035,
              gain: 0.055,
              filter: "bandpass",
              freq: 3000,
              q: 1.4,
              at: stepAt,
              pan: i % 2 === 0 ? -0.25 : 0.25,
            });
          }
        }
        if (count >= 3) chord(at + (count - 1) * 0.14 + 0.02);
        break;
      }
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
    compressor = null;
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

/* eslint-disable no-bitwise */
/**
 * 特效试验台：6 个 WebGL fragment shader 预设。
 *
 * 独立的视觉实验页，不参与游戏规则；用于挑选后可移植到 M6 的
 * Canvas/WebGL 渲染层。无外部依赖。
 */

const canvas = document.querySelector("#fx");
const gl = canvas.getContext("webgl", { antialias: true, alpha: false });

const VERTEX = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;

uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_origin;
uniform float u_trigger;
uniform int u_mode;

#define PI 3.14159265359
#define TAU 6.28318530718

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float ring(float d, float radius, float width) {
  return smoothstep(width, 0.0, abs(d - radius));
}

vec3 backdrop(vec2 uv, float time) {
  float n = noise(uv * 2.2 + vec2(time * 0.03, -time * 0.02));
  vec3 base = mix(vec3(0.012, 0.018, 0.035), vec3(0.035, 0.05, 0.095), n);
  vec2 grid = floor(uv * 140.0);
  float star = pow(hash(grid), 55.0) * (0.6 + 0.4 * sin(time + hash(grid + 7.0) * 20.0));
  return base + vec3(0.55, 0.7, 1.0) * star * 0.55;
}

vec3 effectShock(vec2 uv, vec2 p, float t) {
  float d = length(p);
  float wave = sin(d * 34.0 - t * 14.0) * exp(-d * 2.8) * exp(-t * 1.9);
  float r1 = ring(d, t * 1.15, 0.035);
  float r2 = ring(d, t * 0.72, 0.02);
  float angle = atan(p.y, p.x);
  float streak = pow(max(0.0, cos(angle * 18.0 + t * 2.0)), 24.0) * exp(-d * 3.2) * exp(-t * 0.8);
  vec3 col = backdrop(uv, u_time);
  col += vec3(1.0, 0.5, 0.16) * r1 * 1.8;
  col += vec3(0.35, 0.85, 1.0) * r2 * 1.05;
  col += vec3(1.0, 0.75, 0.35) * max(wave, 0.0) * 0.32;
  col += vec3(1.0, 0.82, 0.46) * streak * 0.85;
  return col;
}

vec3 effectPrism(vec2 uv, vec2 p, float t) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float hue = fract(a / TAU + r * 0.55 - u_time * 0.07);
  vec3 col = backdrop(uv, u_time);
  float petals = 0.55 + 0.45 * sin(a * 8.0 + r * 16.0 - t * 3.0);
  col += hsv2rgb(vec3(hue, 0.72, 1.0)) * exp(-r * 1.35) * petals * 0.95;
  col += hsv2rgb(vec3(fract(hue + 0.42), 0.65, 1.0)) * ring(r, t * 0.95, 0.025) * 0.75;
  float sparkle = pow(hash(floor(p * 70.0 + t * 2.0)), 48.0) * exp(-r * 0.8);
  col += vec3(1.0) * sparkle * 0.8;
  return col;
}

vec3 effectVortex(vec2 uv, vec2 p, float t) {
  float r = length(p);
  float a = atan(p.y, p.x) + u_time * 0.55 + r * 1.45;
  vec2 q = vec2(cos(a), sin(a)) * r;
  float n = noise(q * 3.0 + vec2(u_time * 0.2, -u_time * 0.15));
  float swirl = smoothstep(0.95, 0.0, r) * (0.5 + 0.5 * sin(a * 6.0 + r * 12.0 - u_time * 3.0));
  vec3 col = backdrop(uv, u_time);
  col += hsv2rgb(vec3(fract(r * 0.42 + u_time * 0.08), 0.72, 0.95)) * swirl * (0.55 + n * 0.4);
  float dust = pow(hash(floor(q * 22.0)), 34.0) * smoothstep(1.05, 0.0, r);
  col += vec3(1.0, 0.9, 0.72) * dust * 0.9;
  col += vec3(0.4, 0.95, 1.0) * ring(r, t * 0.85, 0.018) * 0.45;
  return col;
}

vec3 effectFrost(vec2 uv, vec2 p, float t) {
  vec2 g = p * 3.2;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float nearest = 2.0;
  vec2 nearestId = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 point = hash2(cell + offset);
      float d = length(offset + point - f);
      if (d < nearest) {
        nearest = d;
        nearestId = cell + offset;
      }
    }
  }
  float edge = smoothstep(0.045, 0.0, abs(nearest - 0.1));
  float seed = smoothstep(0.035, 0.0, nearest);
  float angle = atan(p.y, p.x);
  float spike = pow(max(0.0, cos(angle * 10.0 + t * 1.5)), 36.0) * exp(-length(p) * 2.6);
  float shard = smoothstep(0.97, 1.0, abs(sin(angle * 6.0 + floor(length(p) * 5.0) * 1.7 + t * 0.3)));
  vec3 col = backdrop(uv, u_time);
  col += vec3(0.16, 0.52, 0.82) * edge * (0.28 + 0.12 * sin(t * 3.0 + nearestId.x));
  col += vec3(0.55, 0.9, 1.0) * seed * 0.5;
  col += vec3(0.4, 0.82, 1.0) * spike * 0.75;
  col += vec3(0.25, 0.6, 0.9) * shard * smoothstep(1.0, 0.0, length(p)) * 0.18;
  col += vec3(0.75, 0.95, 1.0) * ring(length(p), t * 0.9, 0.018) * 0.35;
  return col;
}

vec3 effectNova(vec2 uv, vec2 p, float t) {
  float d = length(p);
  float angle = atan(p.y, p.x);
  float core = exp(-d * 9.0) * (1.0 + 0.8 * exp(-t * 2.2));
  float rays = pow(max(0.0, cos(angle * 14.0 + t * 3.0)), 42.0) * exp(-d * 2.8);
  float ring1 = ring(d, t * 1.25, 0.04);
  float ring2 = ring(d, t * 0.65, 0.025);
  vec3 col = backdrop(uv, u_time);
  col += vec3(1.0, 0.85, 0.55) * core * 2.2;
  col += vec3(1.0, 0.52, 0.2) * rays * 1.1;
  col += vec3(1.0, 0.62, 0.24) * ring1 * 1.35;
  col += vec3(0.55, 0.82, 1.0) * ring2 * 0.95;
  return col;
}

vec3 effectArc(vec2 uv, vec2 p, float t) {
  float d = length(p);
  float angle = atan(p.y, p.x);
  float arc = abs(sin(angle * 5.0 + sin(d * 12.0 - t * 8.0) * 2.4 + t * 1.8));
  float bolt = smoothstep(0.965, 1.0, arc) * smoothstep(1.15, 0.0, d);
  float fork = smoothstep(0.035, 0.0, abs(p.y - sin(p.x * 11.0 + t * 6.0) * 0.14)) * exp(-abs(p.x) * 3.5);
  float core = exp(-d * 16.0);
  vec3 col = backdrop(uv, u_time);
  col += vec3(0.35, 0.62, 1.0) * bolt * 1.8;
  col += vec3(0.72, 0.4, 1.0) * fork * 0.9;
  col += vec3(0.8, 0.95, 1.0) * core * 1.6;
  col += vec3(0.25, 0.45, 1.0) * ring(d, t * 1.0, 0.018) * 0.55;
  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  vec2 p = uv - u_origin;
  float t = min(u_trigger, 3.2);
  vec3 col;
  if (u_mode == 0) col = effectShock(uv, p, t);
  else if (u_mode == 1) col = effectPrism(uv, p, t);
  else if (u_mode == 2) col = effectVortex(uv, p, t);
  else if (u_mode == 3) col = effectFrost(uv, p, t);
  else if (u_mode == 4) col = effectNova(uv, p, t);
  else col = effectArc(uv, p, t);

  col = pow(max(col, vec3(0.0)), vec3(0.86));
  col *= 1.0 - 0.2 * length(uv * vec2(0.55, 0.8));
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  }
  return shader;
}

let program;
try {
  if (!gl) throw new Error("当前浏览器不支持 WebGL");
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
  }
} catch (error) {
  const message = document.createElement("p");
  message.style.cssText = "position:fixed;inset:40% 10% auto;color:#f4f1e8;text-align:center";
  message.textContent = `特效试验台无法启动：${error.message}`;
  document.body.append(message);
  throw error;
}

gl.useProgram(program);
const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const position = gl.getAttribLocation(program, "a_pos");
gl.enableVertexAttribArray(position);
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

const uniforms = {
  res: gl.getUniformLocation(program, "u_res"),
  time: gl.getUniformLocation(program, "u_time"),
  origin: gl.getUniformLocation(program, "u_origin"),
  trigger: gl.getUniformLocation(program, "u_trigger"),
  mode: gl.getUniformLocation(program, "u_mode"),
};

let mode = 0;
let origin = [0, 0];
let triggeredAt = performance.now() - 4000;
let lastAuto = performance.now();
const buttons = Array.from(document.querySelectorAll("[data-mode]"));

function setMode(next) {
  mode = next;
  buttons.forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.mode) === mode));
  });
  trigger([0, 0]);
}
function trigger(point) {
  origin = point ?? origin;
  triggeredAt = performance.now();
  lastAuto = triggeredAt;
}

function resize() {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(320, canvas.clientWidth);
  const height = Math.max(320, canvas.clientHeight);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function toShaderPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const min = Math.min(rect.width, rect.height);
  return [
    ((event.clientX - rect.left) * 2 - rect.width) / min,
    (rect.height - (event.clientY - rect.top) * 2) / min,
  ];
}

canvas.addEventListener("pointerdown", (event) => {
  trigger(toShaderPoint(event));
});
buttons.forEach((button) => {
  button.addEventListener("click", () => setMode(Number(button.dataset.mode)));
});
globalThis.addEventListener("keydown", (event) => {
  if (event.key >= "1" && event.key <= "6") setMode(Number(event.key) - 1);
  if (event.code === "Space") {
    event.preventDefault();
    trigger([0, 0]);
  }
});
globalThis.addEventListener("resize", resize);
resize();
setMode(0);

function frame(now) {
  const elapsed = now / 1000;
  if (now - lastAuto > 2600) trigger([0, 0]);
  gl.uniform2f(uniforms.res, canvas.width, canvas.height);
  gl.uniform1f(uniforms.time, elapsed);
  gl.uniform2f(uniforms.origin, origin[0], origin[1]);
  gl.uniform1f(uniforms.trigger, Math.max(0, (now - triggeredAt) / 1000));
  gl.uniform1i(uniforms.mode, mode);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

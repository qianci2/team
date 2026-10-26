# 会话编排（P6 / M5）

本文是 M5 的实现口径，也是给 P5（M6/M7/M8，54dxx）的接入契约。P6 只实现应用层编排；Canvas、输入监听、Web Audio 仍由 P5 负责，本仓库不会用 DOM/Canvas 代码冒充 P5 交付。

需求依据：`docs/baseline/02-design-v1.0.md` §4.3、§4.4、§6.2.6、FL-02/FL-03/FL-06/FL-07；需求 FR-08、FR-09、FR-12、FR-14、FR-19、FR-22、FR-23、FR-25~FR-30、FM-01/03/07/09/13。

## 1. 文件

| 文件 | 职责 |
| --- | --- |
| `src/app/session.js` | M5 场景状态机、对局生命周期、弹窗、生命恢复、购买/道具、排行榜编排 |
| `src/app/bootstrap.js` | 启动装配：M11 配置 → M10 仓库 → M9 客户端 → M5 会话 |
| `src/app/messages.js` | 12 类用户提示的统一文案 |
| `test/session.test.mjs` | 用无 DOM 的测试替身覆盖主流程与异常路径 |

## 2. 场景与输入

场景固定为 `menu` / `levelSelect` / `playing` / `rank` / `settings`。合法转移：

```text
menu ↔ levelSelect, menu ↔ rank, menu ↔ settings
levelSelect → playing（startLevel）
playing → levelSelect/menu 只能通过结算弹窗动作
```

对局中没有常驻“退出”入口；`toScene` 会拒绝非法转移并记日志（I-25）。

`session.dispatch(intent)` 是唯一输入入口，支持：

| `type` | 载荷 | 行为 |
| --- | --- | --- |
| `scene` | `scene` | 场景切换 |
| `startLevel` | `level` | 恢复生命 → 校验解锁/生命/配置 → 建局 |
| `move` | `from`, `to` | 交换；失败/终态分别处理 |
| `item` | `kind`, `target?` | 扣库存、结算道具、写盘 |
| `buy` | `kind` | 购买道具；不足时弹差额 |
| `refillLives` | — | 200 金币补满 |
| `setMuted` / `setColorblind` | 布尔值 | 设置立即写盘 |
| `setNickname` | `nickname` | 白名单校验；空串允许清空 |
| `submitRank` / `loadRank` | — | 排行榜提交/拉取 |
| `importSave` / `exportSave` | `text` / — | 存档导入/导出 |
| `dialogAction` | `next`/`replay`/`retry`/`menu`/`close`/`refill` | 弹窗动作 |
| `visibility` | `hidden` | 转给 M7 暂停/恢复音频 |

动画期间（`inputLocked=true`）的 `move`/`item` 进入容量 2 的队列，超出丢最旧；动画完成或 2.4s 兜底后释放并依次重放（FR-25、FM-08）。队列中的意图在重放时重新校验。

## 3. 给 P5 的注入契约

M5 不 import 任何 DOM/Canvas/Audio。P5 在 `bootstrapSession({ presentation })` 传入：

```js
const presentation = {
  onScene(scene) {},             // 场景切换：重绘/切页
  play(events) {},               // 返回 Promise；完成表示本批动画结束
  audio(effect, chain) {},       // effect: clear/swap/item/win/fail
  visibility(hidden) {},         // 页面可见性：暂停/恢复音乐
  tick(now) {},                  // 每帧/定时器推进动画兜底
};
```

`session.view()` 返回冻结的 `ViewState`：场景、棋盘、目标、分数、步数、星级预告、生命/金币/道具、设置、弹窗、提示、排行榜状态、`saveMode`、`inputLocked`。M6 只读该对象，不得回写；M8 只向 `dispatch` 提交语义化意图。

`presentation.play` 的 Promise 必须最终 settle（成功/失败都行）；即使 P5 的渲染回调被节流，M5 的 2.4s 兜底也会释放输入锁。P5 不需要在 M5 里写任何规则判断。

## 4. 生命周期与写盘

- `startLevel`：先 `restoreLives`（惰性恢复），再校验 `unlockedLevel`、`lives>0`、配置存在；然后 `createRun`。**不在进入时扣生命**；失败才扣 1（FR-14）。
- 对局中步数/得分/目标进度只在内存；不写盘（FL-03）。
- 通关：`settleLevel` 计算星级/金币/最高分/解锁/总积分 → `store.commit(..., "settle")` → 弹胜利窗 → 若昵称合法则异步自动提交排行榜。
- 失败：先恢复离线生命，再 `consumeLife` → `store.commit(..., "fail")` → 弹失败窗，列出未完成目标与差值。
- 购买/道具/设置/昵称：立即写盘。写失败时 `store` 进入 readonly，M5 继续本局并在 `view().saveMode` 暴露 `readonly`（FM-01）。
- `tick(now)`：每 60s 检查生命恢复；动画锁超时兜底。

## 5. 异常路径

| 场景 | 行为 |
| --- | --- |
| 生命为 0 | 阻止进入，弹窗提供 `refill`/`close` |
| 关卡未解锁 | 停留原场景，提示“先通过第 n−1 关” |
| 配置缺失 | 弹“关卡数据异常”，不建局 |
| 存储只读 | 本局继续，`saveMode=readonly`，顶部提示由 P5 渲染 |
| 外部标签页更新 | 订阅 `save:external`，显示“进度已从其他标签页更新”，对局不中断 |
| 昵称/分数非法 | 本地拒绝，不发起排行榜请求 |
| 排行榜超时/5xx | M9 返回 `source:'local'`，M5 显示降级文案 |
| 音频异常 | 捕获后 `audioAvailable=false`，静默降级（FM-09） |

## 6. 已知缺口

- **P5 未实现**：`web/` 仍是状态页；M6/M7/M8 的真实渲染、指针/键盘输入、Web Audio 由 54dxx 的 #7 交付。P6 的验收“端到端可玩”必须等 P5 合入后做真机联调，当前只用测试替身验证编排。
- `gemz_diag_config` 的配置异常日志尚未接入；`bootstrap` 只把 `levelsReport` 返回给调用方。
- 排行榜不轮询；进入页面拉取一次，10s 内复用缓存。

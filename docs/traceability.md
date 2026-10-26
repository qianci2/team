# 实现追溯矩阵（FR / NFR / BR → 代码 / 测试）

> 更新日期：2026-10-26（P5 合入）· 维护者：qianci2（组长）· P5 证据补充：54dxx
> 说明：本表把需求基线的 56 条需求映射到仓库中的实现与测试。状态只按已有证据填写；界面项以 headless Edge 实测与截图为证据，真实设备/人工可用性仍标“待实测”。

## 1. 功能需求（FR-01~FR-32）

| 需求 | 优先级 | 实现 | 测试 / 证据 | 状态 |
| --- | :--: | --- | --- | --- |
| FR-01 生成必有解棋盘 | H | `src/lib/board.js` `createBoard` | `test/board.test.mjs` 1000 次 | 已实现 |
| FR-02 交换/无效回弹 | H | `board.js` `settle`、`session.js` 拒绝/队列、`ui/renderer.js` 回弹与音效 | `board/session.test`、`test/ui.test`、浏览器验收 | 已实现 |
| FR-03 消除/下落/补充/连锁 | H | `board.js` `runCascade`、`ui/animation.js` 逐步重建 | `board.test` 横/纵/L/T/连锁；`ui.test` 与结算逐格对照 + 固定快照 | 已实现 |
| FR-04 连锁系数 | M | `score.js` `chainFactor` | `score.test` 1/1.5/2/2.5 | 已实现 |
| FR-05 死局洗牌/重建 | H | `board.js` `isDeadlock`/`shuffleBoard`、`run.js` `ensurePlayable`、`ui/app.js` 提示 | `board/run.test`、浏览器验收 | 已实现 |
| FR-06 特殊元素 | M | `board.js` `planSpawns`/`expandClears`、`ui/renderer.js` 绘制 | `board.test` 4/5 连、3×3、全屏同色 | 已实现 |
| FR-07 三类目标/冰层 | H | `run.js` `goalStatuses`、`levels.js`、`ui/app.js` 目标面板 | `run.test`、`levels.test` | 已实现 |
| FR-08 失败判定 | H | `run.js` `computeStatus`、`session.js` 失败结算、UI-4 弹窗 | `run/session.test`、浏览器验收 | 已实现 |
| FR-09 立即结算/星级 | H | `run.js`、`economy.js` `settleLevel`、UI-4 星级 | `run/economy/session.test`、浏览器验收 | 已实现 |
| FR-10 星级预告 | M | `score.js` `starsPreview`、`run.js` `statusOf`、`ui/app.js` HUD | `score/run.test`、浏览器验收 | 已实现 |
| FR-11 解锁 | H | `economy.js` `recordResult`/`unlockAfter`、`session.js`、UI-2 锁定态 | `economy/session.test`、浏览器验收 30 卡 | 已实现 |
| FR-12 进度持久化 | H | `save-schema.js`、`store.js`、`session.js`、UI 写入 | `save/store/session.test`；浏览器多次导航后进度保留 | 已实现 |
| FR-13 导入/导出 | L | `save-schema.js`、`store.js`、`session.js`、UI-7 文件/文本导入导出 | `save/store/session.test`、浏览器验收导出→导入 | 已实现 |
| FR-14 生命值 | M | `economy.js` `restoreLives`/`consumeLife`/`refillLives`、UI 生命显示与补满按钮 | `economy/session.test`、浏览器验收 | 已实现 |
| FR-15 存档兼容 | M | `save-schema.js` 迁移/归一化、`store.js` 损坏备份 | `save/store.test` | 已实现 |
| FR-16 得分构成 | H | `score.js` `scoreEvent`、UI-4 明细 | `score.test` 手算对照 | 已实现 |
| FR-17 总积分 | M | `save-schema.js` `sumBestScores`、`economy.js`、UI-6 | `economy/save.test` | 已实现 |
| FR-18 排行榜 | M | `rank.js`、`scripts/mock-rank-server.mjs`、UI-5 | `rank.test`、`session.test`、浏览器降级展示 | 部分（真实服务未部署，mock 仅契约） |
| FR-19 昵称白名单 | M | `save-schema.js`、`rank.js`、`mock-rank-server.mjs`、UI-6 表单 | `save/rank.test`、浏览器验收 | 已实现 |
| FR-20 排行榜降级 | M | `rank.js` 超时/本地榜单、`session.js` 状态、UI 明确标注“本地模拟数据” | `rank/session.test`、浏览器验收 | 已实现 |
| FR-21 名次一致性 | M | mock 自增序号/10s 节流、UI 名次 | `rank.test` | 部分（真实服务/多轮查询未实测） |
| FR-22 道具 | M | `run.js` `useItem`、`session.js` 库存/限用、UI 道具栏与锤子瞄准 | `run/session.test`、浏览器验收 | 已实现 |
| FR-23 金币/购买 | M | `economy.js` `settleCoins`/`buyItem`、UI-7 小铺 | `economy/session.test`、浏览器验收价格/禁用 | 已实现 |
| FR-24 无付费入口 | H | 代码中无支付 SDK/入口；七个界面走查 | 浏览器验收 + 截图 | 已实现 |
| FR-25 动画/输入队列 | H | `session.js` 队列/2.4s 兜底、`ui/renderer.js` 逐步骤动画 | `session.test`、`ui.test`；浏览器探针 60 FPS、746ms 收尾 | 已实现 |
| FR-26 音效/静音 | H | `ui/audio.js` 5 类合成音效与背景铺底、设置写盘 | `ui.test` 音效计划；浏览器静音写盘/可见性探针 | 已实现 |
| FR-27 可见性暂停 | M | `ui/audio.js` `setHidden` + `session.js` `visibility` 转发 | 浏览器探针：隐藏 suspended、恢复 running | 已实现 |
| FR-28 响应式/滑动 | M | `web/style.css` 断点、`ui/input.js` 0.3 格滑动 | 360–1440px 布局审计、浏览器滑动验收 | 已实现 |
| FR-29 键盘可达 | L | `ui/input.js` 方向键/空格/Esc/H；`ui/app.js` 焦点管理与陷阱 | 浏览器键盘路径、`ui.test` 光标/点击语义 | 已实现 |
| FR-30 色盲模式 | L | `ui/palette.js` 5 种唯一形状、设置开关、Canvas 高对比绘制 | `ui.test` 形状唯一；窄屏截图开启色觉辅助 | 已实现 |
| FR-31 新手引导/反馈 | M | UI 引导条、选中/无效/Combo/死局/金币不足提示 | 浏览器验收、截图 | 已实现 |
| FR-32 弹窗信息 | H | `session.js` lines/actions、UI-4 星级/明细/焦点 | `session.test`、浏览器通关/失败弹窗 | 已实现 |

## 2. 非功能需求（NFR-01~NFR-14）

| 需求 | 实现 / 证据 | 状态 |
| --- | --- | --- |
| NFR-01 首屏 ≤5s | headless Edge：FCP 32ms、DOMContentLoaded 43ms、load 43ms | 已实测（真实设备待 P7） |
| NFR-02 ≥30 FPS | headless Edge：空闲 60 FPS、动画期间 61 FPS | 已实测（真实设备待 P7） |
| NFR-03 资源 ≤5MB | 27 个请求、传输 268KB；无图片/音频/字体/第三方库 | 已实现 |
| NFR-04 浏览器兼容 | Chromium/Edge 实测；领域层无浏览器 API（`domain-boundaries.test`） | 部分（Safari/Firefox 待 P7） |
| NFR-05 易用性 | 引导条、1 次点击继续、≤2 次点击开局 | 部分（5 人可用性测试待 P7） |
| NFR-06 路径 ≤2 次点击 | 主菜单“继续”1 次进入；选关 2 次 | 已实现 |
| NFR-07 保存失败不崩溃 | `store.js` readonly + 顶部常驻提示条 | 已实现 |
| NFR-08 校验/上限 | `score.js` `S_MAX/TOTAL_MAX`、`rank.js`、mock 校验 | 已实现 |
| NFR-09 架构约束 | `domain-boundaries.test`、`ui` 只读 ViewState | 已实现 |
| NFR-10 配置驱动 | `levels.json`、`levels.js`、30 关测试 | 已实现 |
| NFR-11 素材合规 | 全自绘/合成，无外部素材文件；`assets/README.md` 登记 | 已实现 |
| NFR-12 长会话稳定 | 需浏览器 30 分钟采样 | 待实测 |
| NFR-13 可访问性 | 对比度自动审计、键盘全流程、焦点可见、色觉形状、减少动态效果 | 部分（人工走查待 P7） |
| NFR-14 中断可恢复 | `store.js` 写盘时机 + 浏览器多次导航后进度保留 | 已实现（强关/真实刷新待 P7） |

## 3. 业务规则（BR-01~BR-10）

| 规则 | 实现 | 测试 | 状态 |
| --- | --- | --- | --- |
| BR-01 8×8/5 色 | `board.js`、`levels.js` | `board/levels.test` | 已实现 |
| BR-02 段 1 数值 | `levels.js`/`levels.json` | `levels.test` | 已实现 |
| BR-03 段 2 数值 | 同上 | `levels.test` | 已实现 |
| BR-04 段 3 数值 | 同上，K-05 取整 | `levels.test` | 已实现 |
| BR-05 难度验收 | 代理求解器未实现 | 无 | 待补 |
| BR-06 冰层加权 | `run.js` `placeIce`、`ui/renderer.js` 冰层绘制 | `run.test` | 已实现 |
| BR-07 星级 | `economy.js` `evaluateStars`，`starKeep` 预置 | `economy.test` | 部分（阈值待标定） |
| BR-08 金币产出 | `economy.js` `settleCoins` | `economy.test` | 已实现 |
| BR-09 生命 | `economy.js` | `economy.test` | 已实现 |
| BR-10 特殊组合 | `board.js` `comboEffect` | `board.test` | 已实现 |

## 4. 追溯缺口

- **NFR-05、NFR-12** 需要真实用户与 30 分钟长会话采样，P5 的自动验收不能替代。
- **NFR-04** 只在 Chromium/Edge 实测；Safari/Firefox 与真实手机仍待 P7。
- **NFR-13** 的自动对比度、键盘与焦点已覆盖，但仍欠人工逐页走查与色觉障碍者试用。
- **TC-39/TC-40** 的代理求解器标定尚未执行；`starKeep` 仍是设计预置值。
- 真实排行榜服务未交付，FR-18/FR-21 只有客户端 + mock 证据；`/api/rank`、`/api/score` 的 404 是预期降级路径。
- UI-6 作为排行榜页的个人面板实现（M5 场景集没有 `profile`），入口与信息完整，但不是独立场景。

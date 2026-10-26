# 实现追溯矩阵（FR / NFR / BR → 代码 / 测试）

> 更新日期：2026-10-26 · 维护者：qianci2（组长）
> 说明：本表把需求基线的 56 条需求映射到仓库中的实现与测试。状态只按已有证据填写；P5（M6/M7/M8）未交付的界面项不标“已实现”。

## 1. 功能需求（FR-01~FR-32）

| 需求 | 优先级 | 实现 | 测试 / 证据 | 状态 |
| --- | :--: | --- | --- | --- |
| FR-01 生成必有解棋盘 | H | `src/lib/board.js` `createBoard` | `test/board.test.mjs` 1000 次 | 已实现 |
| FR-02 交换/无效回弹 | H | `board.js` `settle`、`session.js` 拒绝/队列 | `board.test`、`session.test`（动画待 P5） | 部分 |
| FR-03 消除/下落/补充/连锁 | H | `board.js` `runCascade` | `board.test` 横/纵/L/T/连锁 | 已实现（逐格快照未穷举） |
| FR-04 连锁系数 | M | `score.js` `chainFactor` | `score.test` 1/1.5/2/2.5 | 已实现 |
| FR-05 死局洗牌/重建 | H | `board.js` `isDeadlock`/`shuffleBoard`、`run.js` `ensurePlayable` | `board/run.test` | 部分（提示待 P5） |
| FR-06 特殊元素 | M | `board.js` `planSpawns`/`expandClears` | `board.test` 4/5 连、3×3、全屏同色 | 已实现 |
| FR-07 三类目标/冰层 | H | `run.js` `goalStatuses`、`levels.js` | `run.test`、`levels.test` | 已实现 |
| FR-08 失败判定 | H | `run.js` `computeStatus`、`session.js` 失败结算 | `run.test`、`session.test` | 部分（弹窗渲染待 P5） |
| FR-09 立即结算/星级 | H | `run.js`、`economy.js` `settleLevel` | `run/economy/session.test` | 已实现 |
| FR-10 星级预告 | M | `score.js` `starsPreview`、`run.js` `statusOf` | `score/run.test` | 部分（HUD 待 P5） |
| FR-11 解锁 | H | `economy.js` `recordResult`/`unlockAfter`、`session.js` | `economy/session.test` | 已实现 |
| FR-12 进度持久化 | H | `save-schema.js`、`store.js`、`session.js` | `save/store/session.test` | 已实现（浏览器刷新待 P5 联调） |
| FR-13 导入/导出 | L | `save-schema.js`、`store.js`、`session.js` | `save/store/session.test` | 部分（文件选择/下载 UI 待 P5） |
| FR-14 生命值 | M | `economy.js` `restoreLives`/`consumeLife`/`refillLives`、`session.js` | `economy/session.test` | 部分（按钮置灰待 P5） |
| FR-15 存档兼容 | M | `save-schema.js` 迁移/归一化、`store.js` 损坏备份 | `save/store.test` | 已实现 |
| FR-16 得分构成 | H | `score.js` `scoreEvent` | `score.test` 手算对照 | 已实现 |
| FR-17 总积分 | M | `save-schema.js` `sumBestScores`、`economy.js` | `economy/save.test` | 已实现 |
| FR-18 排行榜 | M | `rank.js`、`scripts/mock-rank-server.mjs` | `rank.test`、`session.test` | 部分（真实服务未部署，mock 仅契约） |
| FR-19 昵称白名单 | M | `save-schema.js`、`rank.js`、`mock-rank-server.mjs` | `save/rank.test` | 已实现 |
| FR-20 排行榜降级 | M | `rank.js` 超时/本地榜单、`session.js` 状态 | `rank/session.test` | 部分（页面标注待 P5） |
| FR-21 名次一致性 | M | mock 自增序号/10s 节流 | `rank.test` | 部分（真实服务/多轮查询未实测） |
| FR-22 道具 | M | `run.js` `useItem`、`session.js` 库存/限用 | `run/session.test` | 部分（按钮待 P5） |
| FR-23 金币/购买 | M | `economy.js` `settleCoins`/`buyItem`、`session.js` | `economy/session.test` | 已实现 |
| FR-24 无付费入口 | H | 代码中无支付 SDK/入口 | 需 P5 后全界面走查 | 待 P5 |
| FR-25 动画/输入队列 | H | `session.js` 队列/2.4s 兜底；M6 接口 | `session.test` | 部分（动画时长/FPS 待 P5） |
| FR-26 音效/静音 | H | `session.js` `presentation.audio`、设置写盘 | 需 M7 | 待 P5 |
| FR-27 可见性暂停 | M | `session.js` `visibility` 转发 | 需 M7 | 待 P5 |
| FR-28 响应式/滑动 | M | 无 CSS/输入实现 | 需 M6/M8 | 待 P5 |
| FR-29 键盘可达 | L | 无输入实现 | 需 M8 | 待 P5 |
| FR-30 色盲模式 | L | 设置持久化已实现 | 图形符号需 M6 | 部分（仅设置） |
| FR-31 新手引导/反馈 | M | 无界面 | 需 M6/M7 | 待 P5 |
| FR-32 弹窗信息 | H | `session.js` 胜利/失败 lines/actions | `session.test` | 部分（真实弹窗待 P5） |

## 2. 非功能需求（NFR-01~NFR-14）

| 需求 | 实现 / 证据 | 状态 |
| --- | --- | --- |
| NFR-01 首屏 ≤5s | 需 P5 页面 + Lighthouse | 待实测 |
| NFR-02 ≥30 FPS | 需 P5 渲染 + Performance | 待实测 |
| NFR-03 资源 ≤5MB | 无图片/音频/字体/第三方库；体积待打包测量 | 部分 |
| NFR-04 浏览器兼容 | 领域层无浏览器 API（`domain-boundaries.test`）；真实浏览器未测 | 部分 |
| NFR-05 易用性 | 需 5 人可用性测试 | 待 P5 |
| NFR-06 路径 ≤2 次点击 | `session.js` 场景状态机；界面走查待 P5 | 部分 |
| NFR-07 保存失败不崩溃 | `store.js` readonly + `session.test` 注入异常 | 已实现（提示条待 P5） |
| NFR-08 校验/上限 | `score.js` `S_MAX/TOTAL_MAX`、`rank.js`、mock 校验 | 已实现 |
| NFR-09 架构约束 | `domain-boundaries.test`、`docs/baseline` K-06 | 已实现 |
| NFR-10 配置驱动 | `levels.json`、`levels.js`、30 关测试 | 已实现 |
| NFR-11 素材合规 | 全自绘/合成，无外部素材文件 | 已实现 |
| NFR-12 长会话稳定 | 需浏览器 30 分钟采样 | 待实测 |
| NFR-13 可访问性 | 需 P5 对比度/焦点/键盘 | 待 P5 |
| NFR-14 中断可恢复 | `store.js` 写盘时机 + `store.test` 重载 20 次 | 已实现（真实强关待 P5） |

## 3. 业务规则（BR-01~BR-10）

| 规则 | 实现 | 测试 | 状态 |
| --- | --- | --- | --- |
| BR-01 8×8/5 色 | `board.js`、`levels.js` | `board/levels.test` | 已实现 |
| BR-02 段 1 数值 | `levels.js`/`levels.json` | `levels.test` | 已实现 |
| BR-03 段 2 数值 | 同上 | `levels.test` | 已实现 |
| BR-04 段 3 数值 | 同上，K-05 取整 | `levels.test` | 已实现 |
| BR-05 难度验收 | 代理求解器未实现 | 无 | 待补 |
| BR-06 冰层加权 | `run.js` `placeIce` | `run.test` | 已实现 |
| BR-07 星级 | `economy.js` `evaluateStars`，`starKeep` 预置 | `economy.test` | 部分（阈值待标定） |
| BR-08 金币产出 | `economy.js` `settleCoins` | `economy.test` | 已实现 |
| BR-09 生命 | `economy.js` | `economy.test` | 已实现 |
| BR-10 特殊组合 | `board.js` `comboEffect` | `board.test` | 已实现 |

## 4. 追溯缺口

- P5 的 FR-24、FR-26~FR-31、NFR-01/02/05/12/13 没有实现证据，不能因本表存在就判通过。
- TC-39/TC-40 的代理求解器标定尚未执行；`starKeep` 仍是设计预置值。
- 真实排行榜服务未交付，FR-18/20/21 只有客户端 + mock 证据。

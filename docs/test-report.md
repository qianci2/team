# 测试与验收报告（P7）

> 生成日期：2026-10-26 · 维护者：qianci2（组长）
> 环境：Windows 10 x64 · Node.js v22.19.0 · 无运行时依赖
> 结论口径：只把已经由脚本/测试证明的项标为“已自动化”；界面、浏览器性能、代理求解器标定未完成的部分如实标“待 P5 / 待实测 / 待补”。

## 1. 汇总

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 仓库结构校验 | 通过：60 个必需文件、3 组基线标记 | `npm run check` |
| 单元/集成测试 | **139 个通过，0 失败** | `npm test` |
| 行覆盖率 | **95.59%**（新增测试后复跑；见 §4） | `node --experimental-test-coverage --test` |
| 分支覆盖率 | **83.89%** | 同上 |
| 函数覆盖率 | **95.45%** | 同上 |
| 领域层微基准 | `createBoard` 0.063ms/次、`settle` 0.064ms/次、`applyMove` 0.082ms/次 | `node scripts/bench.mjs` |
| CI | `.github/workflows/ci.yml` 跑 `npm run check` + `npm test` | GitHub Actions `validate` |
| P5 界面 | **未实现**（54dxx #7） | `web/` 仍为状态页 |
| 真实浏览器性能/可访问性 | **未实测** | 依赖 P5 |

复跑命令：

```bash
npm run check
npm test
node --experimental-test-coverage --test
node scripts/bench.mjs
```

## 2. 测试分层与覆盖

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| 领域层 | `test/board.test.mjs`、`test/score.test.mjs`、`test/run.test.mjs`、`test/economy.test.mjs`、`test/levels.test.mjs` | 棋盘生成/交换/连锁/特殊元素/死局/冰层、计分与上限、目标/星级/经济/生命、DS-2 校验与回落 |
| 应用层 | `test/save.test.mjs`、`test/store.test.mjs`、`test/rank.test.mjs`、`test/session.test.mjs`、`test/bootstrap.test.mjs` | DS-1/INV/迁移/合并、M10 写盘与只读、M9 超时降级/mock 契约、M5 场景与生命周期、启动装配 |
| 架构 | `test/domain-boundaries.test.mjs` | AC-A1 静态检索、AC-A3 import 图、M11 纯函数 |
| 仓库 | `test/repo.test.mjs`、`test/server.test.mjs` | 必需文件/基线标记、静态服务器与路径穿越 |

## 3. TC-01~TC-42 映射

状态说明：**已自动化**=逻辑由脚本断言；**部分**=核心逻辑已测，但动画/真实界面/浏览器事件仍需 P5 联调；**待 P5**=必须等界面；**待实测**=浏览器性能/人工可用性；**待补**=代理求解器标定。

| 用例 | 状态 | 证据 / 缺口 |
| --- | --- | --- |
| TC-01 | 已自动化 | `board.test`：1000 次生成无初始三连且非死局 |
| TC-02 | 部分 | `board.test` 无消除交换不变；`session.test` 队列/拒绝；回弹动画待 P5 |
| TC-03 | 部分 | `board.test` 横向/纵向/L/T/连锁步骤；逐格下落与补充快照未穷举 |
| TC-04 | 部分 | `score.test` 连锁系数 1/1.5/2/2.5；未构造 1/2/3/4 段实际棋盘比值 |
| TC-05 | 部分 | `board/run.test` 死局洗牌与重建；2 秒内提示待 P5 |
| TC-06 | 已自动化 | `board.test` 4 连炸弹中点、5 连彩虹、3×3/全屏同色 |
| TC-07 | 已自动化 | `run.test` 分数/收集/冰层目标的达成与未达成 |
| TC-08 | 已自动化 | `board/run.test` 双层冰 2→1 不计、1→0 计入 |
| TC-09 | 部分 | `session.test` 失败弹窗类型/未完成差值/动作；视觉弹窗待 P5 |
| TC-10 | 已自动化 | `economy.test` keep2/keep3 及 ±1 |
| TC-11 | 已自动化 | `run.test` 达成即 clear、剩余步数保留 |
| TC-12 | 部分 | `score.test` starsPreview 阈值/±1；HUD 显示待 P5 |
| TC-13 | 已自动化 | `session.test` 未解锁拒绝、解锁后可进入 |
| TC-14 | 部分 | `store.test` 同存储重载 20 次字段一致；真实刷新/浏览器待 P5 |
| TC-15 | 已自动化 | `save/store/session.test` 导出→导入一致、非法 JSON 不改档 |
| TC-16 | 已自动化 | `economy.test` 15/30/45 分钟、回拨/前拨、200 金币补满；界面待 P5 |
| TC-17 | 已自动化 | `save/store.test` 缺字段补齐、损坏备份并启动 |
| TC-18 | 已自动化 | `score.test` 公式与手算、容差 0 |
| TC-19 | 已自动化 | `economy.test` 低于历史最高分时 totalScore 不降 |
| TC-20 | 部分 | `rank.test` mock 两名玩家降序/同分 id；10 秒内多轮查询未全量模拟 |
| TC-21 | 部分 | `rank.test` 同分排序与节流；10 次查询稳定性未逐次断言 |
| TC-22 | 已自动化 | `rank.test` 脚本片段/长度 2/长度 13 拒绝与文案 |
| TC-23 | 部分 | `rank/session.test` 超时/5xx 降级 `source:'local'`；页面标注待 P5 |
| TC-24 | 部分 | `run/session.test` 每关限用、库存扣减、双层冰；真实按钮置灰待 P5 |
| TC-25 | 已自动化 | `economy.test` +120/+60/+25/补发 70、购买 −200 且 +1 |
| TC-26 | 待 P5 | 需要实际界面走查，当前无付费入口代码可查但不能替代走查 |
| TC-27 | 部分 | `session.test` 动画锁/队列容量 2/兜底；动画时长与 Performance 面板待 P5 |
| TC-28 | 待 P5 | 5 类音效与静音持久化需 M7 |
| TC-29 | 待 P5 | Page Visibility 音频暂停需 M7 |
| TC-30 | 待 P5 | 1280×720 / 360px 布局与 0.3 格滑动需 M6/M8 |
| TC-31 | 待 P5 | Tab/方向键/空格完整交换需 M8 |
| TC-32 | 待 P5 | 色盲 5 形状与截图需 M6 |
| TC-33 | 待 P5 | 5 名新玩家可用性测试依赖界面 |
| TC-34 | 部分 | `session.test` 胜利/失败弹窗字段与动作；真实弹窗渲染待 P5 |
| TC-35 | 待实测 | Lighthouse/4G 冷缓存，依赖 P5 页面 |
| TC-36 | 待实测 | Performance 3 段连锁 FPS，依赖 P5 渲染 |
| TC-37 | 部分 | `store.test` 注入抛异常存储进入 readonly；顶部提示条待 P5 |
| TC-38 | 已自动化 | `rank.test` + mock：2,150,000 拒绝、2,149,999 接受（K-08） |
| TC-39 | 待补 | 每关 200 次代理求解器与 Wilson 区间，尚未实现 |
| TC-40 | 待补 | 星级分布与最不利关卡标定，尚未实现 |
| TC-41 | 部分 | `store.test` 两 store 模拟双标签页合并；真实 `storage` 事件待 P5/浏览器 |
| TC-42 | 已自动化 | `economy/session.test` 金币 100 时补满/购买失败且状态不变 |

**统计（按 42 行逐条计数）：** 已自动化 16 条、部分 15 条、待 P5 7 条、待实测 2 条、待补 2 条，合计 42 条。**“部分”不视为通过**，只表示逻辑层已有证据；界面相关项必须等 P5 合入后复测。

## 4. 覆盖率

`node --experimental-test-coverage --test` 摘要（文件级明细以命令输出为准）：

| 范围 | 行 % | 分支 % | 函数 % |
| --- | ---: | ---: | ---: |
| 全部文件 | 95.59 | 83.89 | 95.45 |
| `src/lib` | 91.67~100 | 62.34~95.00 | 95~100 |
| `src/app` | 86.71~100 | 70.97~80.56 | 50~100 |

未覆盖主要集中在：`session.js` 的防御性分支（未知意图、表现层回调异常）、`save-schema.js` 的非法键/日期边界、`store.js` 的极端存储异常。它们不是主流程缺口。

## 5. 微基准（Node，非浏览器）

`node scripts/bench.mjs` 于 2026-10-26 运行：

| 操作 | 次数 | 每次耗时 | 吞吐 |
| --- | ---: | ---: | ---: |
| `createBoard` | 1000 | 0.063ms | 15,886/s |
| `settle`（固定有效交换） | 1000 | 0.064ms | 15,531/s |
| `applyMove` | 1000 | 0.082ms | 12,167/s |
| `scoreEvent` | 10000 | 0.0003ms | 3,389,486/s |
| `normalizeSave` | 10000 | 0.0058ms | 171,116/s |
| `mergeSave` | 10000 | 0.0027ms | 365,237/s |
| `localBoard(100)` | 1000 | 0.0163ms | 61,183/s |

这些数字只说明纯逻辑开销远低于设计预算（单次结算 ≤50ms），**不能替代** TC-35/TC-36 的浏览器首屏与 FPS 验收。

## 6. 已知限制与未完成项

1. **P5 未实现**：`web/` 仍是状态页；7 个界面、Canvas、输入、音效、无障碍均未交付。所有界面相关 TC 不能判通过。
2. **真实排行榜服务未交付**：只交付 mock 契约；真实 SQLite 服务按设计为可选组件，不能声称已部署。
3. **难度/星级标定未执行**：TC-39/TC-40 需要代理求解器每关 200 次模拟；`starKeep` 仍是设计预置值。
4. **浏览器兼容/性能未实测**：TC-35/TC-36 需要 P5 合入后的真实浏览器。
5. **I-22 的 16ms 合并写**未实现；当前每次 commit 同步写。
6. **`gemz_diag_config`** 尚未接入；`bootstrap` 只返回配置报告。

## 7. 结论

组长负责的 P4（存档/排行榜）与 P6（会话编排）已达到“逻辑层可验收、CI 全绿”；P1–P3 的领域层测试继续全绿。项目整体**尚未达到 v1.0.0**，阻塞项是 P5 界面与 TC-39/TC-40 标定。本报告不把“部分”或“待 P5”写成通过。

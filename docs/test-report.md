# 测试与验收报告（P7）

> 生成日期：2026-10-26 · 维护者：qianci2（组长）· P5 验收补充：54dxx
> 环境：Windows 10 x64 · Node.js v22.23.2 · Microsoft Edge（headless Chromium）· 无运行时依赖
> 结论口径：只把已经由脚本/测试证明的项标为“已自动化”；真实设备、5 人可用性、代理求解器标定未完成的部分如实标“待实测 / 待补”。

## 1. 汇总

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 仓库结构校验 | 通过：75 个必需文件、3 组基线标记 | `npm run check` |
| 单元/集成测试 | **151 个通过，0 失败** | `npm test` |
| 行覆盖率 | **93.74%**（P5 新增纯逻辑后复跑；见 §4） | `node --experimental-test-coverage --test` |
| 分支覆盖率 | **82.99%** | 同上 |
| 函数覆盖率 | **95.35%** | 同上 |
| 领域层微基准 | `createBoard` 0.063ms/次、`settle` 0.064ms/次、`applyMove` 0.082ms/次 | `node scripts/bench.mjs` |
| CI | `.github/workflows/ci.yml` 跑 `npm run check` + `npm test` | GitHub Actions `validate` |
| P5 界面 | **已实现**（#7） | `web/`、`src/ui/`、`docs/ui.md`、`docs/screenshots/` |
| 浏览器交互验收 | **43 项通过，0 失败** | headless Edge + DevTools Protocol |
| 浏览器性能/可见性探针 | **9 项通过，0 失败**；空闲 60 FPS、动画 61 FPS | 同上 |
| 首屏与资源 | FCP 32ms、DCL 43ms、27 请求、传输 268KB | Performance Timeline |

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
| 表现层纯逻辑 | `test/ui.test.mjs` | 布局/命中、0.3 格滑动、键盘光标、点击语义、5 色形状与对比度、`CascadeStep` 逐格重建与固定快照、音效计划、界面文案 |
| 架构 | `test/domain-boundaries.test.mjs` | AC-A1 静态检索、AC-A3 import 图、M11 纯函数 |
| 仓库 | `test/repo.test.mjs`、`test/server.test.mjs` | 必需文件/基线标记、静态服务器与路径穿越 |
| 浏览器（非 CI） | `docs/ui.md` 记录的 CDP 验收 | 7 个界面、指针/键盘/滑动、结算/失败弹窗、排行榜降级、导入导出、360–1440px 布局、FPS/可见性 |

## 3. TC-01~TC-42 映射

状态说明：**已自动化**=逻辑由脚本断言；**已实测**=headless Edge 实际渲染/交互/性能采样；**部分**=核心逻辑已测，但仍有逐帧动画、异常注入或人工走查缺口；**待实测**=真实设备或人工可用性；**待补**=代理求解器标定。

| 用例 | 状态 | 证据 / 缺口 |
| --- | --- | --- |
| TC-01 | 已自动化 | `board.test`：1000 次生成无初始三连且非死局 |
| TC-02 | 部分 | `board/session.test` 无消除交换不变与拒绝；浏览器指针交换通过；回弹动画未逐帧断言 |
| TC-03 | 部分 | `board.test` 横向/纵向/L/T/连锁步骤；`ui.test` 与 M1 结算逐格对照 + 固定快照；仍未穷举所有连锁形态 |
| TC-04 | 部分 | `score.test` 连锁系数 1/1.5/2/2.5；未构造 1/2/3/4 段实际棋盘比值 |
| TC-05 | 部分 | `board/run.test` 死局洗牌与重建；UI 提示已实现，但未在浏览器构造死局截图 |
| TC-06 | 已自动化 | `board.test` 4 连炸弹中点、5 连彩虹、3×3/全屏同色 |
| TC-07 | 已自动化 | `run.test` 分数/收集/冰层目标的达成与未达成 |
| TC-08 | 已自动化 | `board/run.test` 双层冰 2→1 不计、1→0 计入 |
| TC-09 | 已自动化 | `session.test` 失败弹窗字段/差值/动作；浏览器实际渲染失败弹窗 |
| TC-10 | 已自动化 | `economy.test` keep2/keep3 及 ±1 |
| TC-11 | 已自动化 | `run.test` 达成即 clear、剩余步数保留 |
| TC-12 | 部分 | `score.test` starsPreview 阈值/±1；HUD 已显示星级，未逐阈值截图断言 |
| TC-13 | 已自动化 | `session.test` 未解锁拒绝、解锁后可进入；选关页锁定态 29 张 |
| TC-14 | 已自动化 | `store.test` 同存储重载 20 次；浏览器多次导航后进度保留 |
| TC-15 | 已自动化 | `save/store/session.test` 导出→导入一致、非法 JSON 不改档；浏览器导出/导入通过 |
| TC-16 | 部分 | `economy.test` 15/30/45 分钟、回拨/前拨、200 金币补满；补满按钮未逐项点击 |
| TC-17 | 已自动化 | `save/store.test` 缺字段补齐、损坏备份并启动 |
| TC-18 | 已自动化 | `score.test` 公式与手算、容差 0 |
| TC-19 | 已自动化 | `economy.test` 低于历史最高分时 totalScore 不降 |
| TC-20 | 部分 | `rank.test` mock 两名玩家降序/同分 id；10 秒内多轮查询未全量模拟 |
| TC-21 | 部分 | `rank.test` 同分排序与节流；10 次查询稳定性未逐次断言 |
| TC-22 | 已自动化 | `rank.test` 脚本片段/长度 2/长度 13 拒绝与文案 |
| TC-23 | 已自动化 | `rank/session.test` 超时/5xx 降级；浏览器榜单标注“本地模拟数据 · 离线降级” |
| TC-24 | 部分 | `run/session.test` 每关限用、库存扣减；浏览器道具栏/小铺禁用态通过；“已用”态未截图 |
| TC-25 | 已自动化 | `economy.test` +120/+60/+25/补发 70、购买 −200 且 +1 |
| TC-26 | 已自动化 | 七个界面走查与截图无支付 SDK/入口 |
| TC-27 | 已自动化 | `session.test` 队列/兜底；浏览器探针 746ms 收尾、动画 61 FPS、锁后解锁 |
| TC-28 | 已自动化 | `ui.test` 5 类音效计划；浏览器静音写盘与按钮状态 |
| TC-29 | 已自动化 | 浏览器探针：隐藏 suspended、恢复 running |
| TC-30 | 已自动化 | 360/390/768/1024/1440 布局审计无横向滚动；0.45 格滑动交换通过 |
| TC-31 | 已自动化 | 浏览器键盘路径：方向键光标、空格选格、Esc 取消 |
| TC-32 | 已自动化 | `ui.test` 5 形状唯一；窄屏截图开启色觉辅助 |
| TC-33 | 待实测 | 5 名新玩家可用性测试，需真实用户 |
| TC-34 | 已自动化 | 浏览器通关弹窗：星级、明细、动作、焦点 |
| TC-35 | 已实测 | 本地开发服务器 FCP 32ms、DCL 43ms；Lighthouse/4G 冷缓存待 P8 |
| TC-36 | 已实测 | 空闲 60 FPS、动画 61 FPS（headless Edge）；真实设备待 P7 |
| TC-37 | 部分 | `store.test` readonly 逻辑；顶部常驻提示条已实现，浏览器未注入写盘失败 |
| TC-38 | 已自动化 | `rank.test` + mock：2,150,000 拒绝、2,149,999 接受（K-08） |
| TC-39 | 待补 | 每关 200 次代理求解器与 Wilson 区间，尚未实现 |
| TC-40 | 待补 | 星级分布与最不利关卡标定，尚未实现 |
| TC-41 | 部分 | `store.test` 两 store 模拟双标签页合并；真实 `storage` 事件未做双标签页实测 |
| TC-42 | 已自动化 | `economy/session.test` 金币 100 时补满/购买失败且状态不变 |

**统计（按 42 行逐条计数）：** 已自动化 26 条、已实测 2 条、部分 11 条、待实测 1 条、待补 2 条，合计 42 条。**“部分/待实测/待补”不视为通过**；界面相关项已有浏览器证据，但逐帧动画、真实设备与人工可用性仍需 P7/P8 补齐。

## 4. 覆盖率

`node --experimental-test-coverage --test` 摘要（文件级明细以命令输出为准）：

| 范围 | 行 % | 分支 % | 函数 % |
| --- | ---: | ---: | ---: |
| 全部文件 | 93.74 | 82.99 | 95.35 |
| `src/lib` | 85.71~100 | 62.34~95.00 | 95~100 |
| `src/app` | 88.26~100 | 71.81~80.56 | 50~100 |
| `src/ui`（纯逻辑） | 30.58~100 | 57.38~91.30 | 83.33~100 |

未覆盖主要集中在：`src/ui/audio.js` 的 `AudioContext`/DOM 分支（Node 无法执行，行覆盖 30.58%）、`session.js` 的防御性分支、`save-schema.js` 的非法键/日期边界、`store.js` 的极端存储异常。音频的静音、可见性与音效播放在浏览器探针中验证；其余不是主流程缺口。

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

这些数字只说明纯逻辑开销远低于设计预算（单次结算 ≤50ms），**不能替代**下方浏览器首屏与 FPS 验收。

## 6. 浏览器验收（P5，非 CI）

使用 Microsoft Edge headless（Chromium + DevTools Protocol）在 `http://127.0.0.1:5173` 实际渲染页面、发送真实鼠标/键盘事件并读取 DOM/Canvas。脚本为一次性本地探针，结果记录在 `docs/ui.md` §10，未加入 CI（CI 环境无 GUI 浏览器）。

| 项目 | 结果 |
| --- | --- |
| 交互验收 | **43/43 通过**：七个界面导航、30 张关卡卡、指针选中/交换、键盘光标/空格/Esc、锤子瞄准、静音写盘、通关/失败弹窗与焦点、排行榜降级、昵称、小铺、色觉开关、导出/导入、窄屏两列 |
| 性能/可见性探针 | **9/9 通过**：静态资源无 404（排行榜 API 除外）、空闲 60 FPS、动画 61 FPS、746ms 收尾并解锁、0.45 格滑动交换、隐藏时音频 suspended/恢复 running、减少动态效果立即收尾 |
| 页面异常 | 未捕获异常 0；控制台仅排行榜 API 的预期 404 |
| 首屏 | FCP 32ms、DOMContentLoaded 43ms、load 43ms（本地开发服务器） |
| 资源 | 27 个请求、传输 268KB、解码 260KB；无图片/音频/字体文件 |
| 布局 | 1440/1024/768/390/360 × 七个界面：无横向滚动、无文字截断（脚本误报视觉隐藏文本与原生复选框除外） |
| 截图 | `docs/screenshots/`：桌面主菜单、选关、对局、通关弹窗、排行榜、设置；窄屏主菜单、选关、对局 |

排行榜 API 的 `/api/rank`、`/api/score` 返回 404 属于“无真实后端”的降级路径，浏览器会记录网络错误；界面已明确标注本地模拟数据。

## 7. 已知限制与未完成项

1. **真实设备与跨浏览器未测**：只在 Windows + headless Edge 采样；手机触屏、Safari、Firefox 待 P7。
2. **5 人可用性测试未做**：NFR-05/TC-33 仍需真实用户。
3. **30 分钟长会话未采样**：NFR-12 待 P7。
4. **真实排行榜服务未交付**：只交付 mock 契约；真实 SQLite 服务按设计为可选组件，不能声称已部署。
5. **难度/星级标定未执行**：TC-39/TC-40 需要代理求解器每关 200 次模拟；`starKeep` 仍是设计预置值。
6. **I-22 的 16ms 合并写**未实现；当前每次 commit 同步写。
7. **`gemz_diag_config`** 尚未接入；`bootstrap` 只返回配置报告。
8. **UI-6 是排行榜页内的个人面板**：M5 场景集没有 `profile`；入口与信息完整，但不是独立场景。

## 8. 结论

P0–P6 已完成：P1–P3 领域逻辑、P4 存档/排行榜、P5 界面与无障碍、P6 会话编排均有自动化或浏览器证据，CI 维持 `npm run check` + `npm test` 全绿。P7 剩余的阻塞项是真实设备/跨浏览器、5 人可用性、30 分钟长会话与 TC-39/TC-40 标定；项目整体**尚未达到 v1.0.0**。本报告不把“部分/待实测/待补”写成通过，也不把无头浏览器结果当成真机结论。

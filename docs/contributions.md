# 贡献索引（v1.0.0）

> 更新：2026-11-01 · 维护者：qianci2（组长）
> 用途：给评审老师/新成员快速定位“谁负责什么、在哪个 PR、有哪些代码与测试证据”。
> 统计口径：`develop` 分支普通提交（`--no-merges`），不含合并提交；合并提交属于集成动作，不代表个人代码量。

## 1. 总览

| 成员 | GitHub | 普通提交 | 主要阶段 | 主要模块 |
| --- | --- | ---: | --- | --- |
| 於志杰 | [@qianci2](https://github.com/qianci2) | 24 | P0、P4、P6、P7、P8 | M5/M9/M10、领域边界、CI、发布、文档 |
| Xiao Jiale | [@2863820752](https://github.com/2863820752) | 10 | P1、P2、P3 | M1/M2/M3/M4/M11 |
| 54dxx | [@54dxx](https://github.com/54dxx) | 9 | P5 | M6/M7/M8、UI-1~UI-7、无障碍 |

`develop` 共 56 个提交（含 13 个合并提交）。统计命令：

```bash
git shortlog -sn --no-merges origin/develop
```

## 2. 按成员

### 2.1 於志杰（@qianci2）— 组长 / 架构与集成

| 项目 | 证据 |
| --- | --- |
| P0 工程骨架、平台工具、CI、分支规范 | PR #11；`src/lib/platform.js`、`scripts/check-repo.mjs`、`.github/workflows/ci.yml` |
| #15 领域边界收敛（K-06） | PR #19；`src/app/levels-loader.js`、`test/domain-boundaries.test.mjs` |
| P4 存档、多标签页、排行榜降级 | PR #20；`src/app/save-schema.js`、`store.js`、`rank.js`、`scripts/mock-rank-server.mjs` |
| P6 会话编排、异常路径 | PR #21；`src/app/session.js`、`bootstrap.js`、`docs/session.md` |
| P7 测试报告、追溯矩阵、覆盖率/微基准 | PR #22；`docs/test-report.md`、`docs/traceability.md`、`scripts/bench.mjs` |
| P7 代理求解器标定（TC-39/40） | PR #24；`scripts/calibrate.mjs`、`docs/calibration.json` |
| P8 文档、release、v1.0.0 | 本 PR；`docs/contributions.md`、`docs/user-guide.md`、`docs/demo.md`、`CHANGELOG.md` |

### 2.2 Xiao Jiale（@2863820752）— 核心玩法

| 项目 | 证据 |
| --- | --- |
| P1 30 关配置与 M11 校验 | PR #12；`src/lib/levels.json`、`levels.js`、`test/levels.test.mjs` |
| P2 棋盘核心与计分（M1/M2） | PR #13；`src/lib/board.js`、`score.js`、`test/board.test.mjs`、`test/score.test.mjs` |
| P3 流程、星级、经济与生命（M3/M4） | PR #14；`src/lib/run.js`、`economy.js`、`test/run.test.mjs`、`test/economy.test.mjs` |
| 特殊元素组合、冰层、死局处理 | 上述 PR；`BR-06/BR-10` 相关单测 |

### 2.3 54dxx — 数据与表现（P5）

| 项目 | 证据 |
| --- | --- |
| Canvas 渲染、布局、配色与 5 种色觉形状 | PR #23；`src/ui/layout.js`、`palette.js`、`renderer.js` |
| 连锁动画、粒子、减少动态效果 | `src/ui/animation.js`、`renderer.js`；`test/ui.test.mjs` |
| 指针/触屏/键盘输入、0.3 格滑动、锤子瞄准 | `src/ui/input.js`；`test/ui.test.mjs` |
| Web Audio 5 类音效、静音、后台暂停 | `src/ui/audio.js`；`docs/ui.md` §5 |
| UI-1~UI-7、响应式与无障碍 | `web/`、`src/ui/app.js`；`docs/ui.md`、`docs/screenshots/` |

## 3. 按交付物

| 交付物 | 位置 | 主要负责人 |
| --- | --- | --- |
| 需求/设计基线 | `docs/baseline/` | qianci2（作者）/ 全组评审 |
| 30 关配置 | `src/lib/levels.json` | 2863820752 |
| 棋盘/计分/流程/经济 | `src/lib/board.js`、`score.js`、`run.js`、`economy.js` | 2863820752 |
| 存档/排行榜/会话 | `src/app/` | qianci2 |
| 渲染/输入/音效/界面 | `src/ui/`、`web/` | 54dxx |
| 测试与追溯 | `test/`、`docs/test-report.md`、`docs/traceability.md` | qianci2 收口，各模块作者补测 |
| 关卡标定 | `docs/calibration.json`、`scripts/calibrate.mjs` | qianci2 |
| 截图/演示 | `docs/screenshots/`、`docs/demo.md` | 54dxx / qianci2 |

## 4. 怎么复核

1. 切到 `develop`（`main` 只保留发布版本）：`git switch develop && git pull`。
2. 看某个人的提交：`git log --no-merges --author=54dxx --oneline`。
3. 看某个 PR 的实际改动：GitHub PR → **Files changed**。
4. 看需求到代码的映射：`docs/traceability.md`；看测试证据：`docs/test-report.md`。
5. 看界面证据：`docs/ui.md` 与 `docs/screenshots/`；跑 `npm run dev` 实际游玩。

# AGENTS.md — 《星消乐》最终项目接手说明

> 给接手本仓库的 AI agent / 新 harness 的第一份文件。读完应能直接继续开发，不需要旧对话记忆。
> 最后更新：2026-10-26 · 维护者：qianci2（组长）

## 0. 一句话现状

- 仓库：<https://github.com/qianci2/team>（公开）
- 当前集成分支：`develop`；远端最新 `192a3ae`；CI 全绿
- 已完成：P0 工程骨架、P1 30 关配置、P2 棋盘/计分、P3 流程/经济；85 个 `node:test` 用例
- 未完成：P4 存档/排行榜、P5 界面、P6 会话集成、P7 测试/验收、P8 交付
- `main` 仍停在 `v0.1.0`（P0 骨架）；P1–P3 已进 `develop`
- 本地/远端 SHA 可能不同（历史曾通过 GitHub API 重建）；以 tree 内容为准，网络恢复后 `git fetch` + `git reset --hard origin/develop`

## 1. 项目与基线

《星消乐》轻量级益智消除网页游戏：8×8 棋盘、5 种颜色、30 关、纯浏览器运行、localStorage 存档、可选排行榜。无运行时依赖；Node 22 仅用于开发/测试。

需求与设计是冻结基线：

- `docs/baseline/01-requirements-v2.1.md`：FR-01~32、NFR-01~14、FM-01~14、BR-01~10、TC-01~42。
- `docs/baseline/02-design-v1.0.md`：M1~M12、I-01~I-35、DS-1~DS-4、FL-01~FL-07、UI-1~7、D-01~12、K-01~04。
- `docs/baseline/README.md`：编号、K-03 的 2,140,200、变更规则。

不要改编号或悄悄改需求；改动需新增 K-xx 记录。设计中的接口/数据不是已实现声明；README 不能声称未实现的功能。

## 2. 团队

| 角色 | 成员 | GitHub | 负责 |
| --- | --- | --- | --- |
| 组长 / 架构与集成 | 於志杰 | [@qianci2](https://github.com/qianci2) | 工程骨架、存档/排行榜、会话编排、CI、评审、发布、文档收口 |
| 核心玩法 | Xiao Jiale | [@2863820752](https://github.com/2863820752) | P1/P2/P3（已完成） |
| 数据与表现 | 54dxx | [@54dxx](https://github.com/54dxx) | P5 渲染、输入、音效、界面与无障碍 |

三人都是 repo collaborator。每人用自己的 GitHub 身份提交；不要代提交或伪造贡献。

## 3. GitHub 状态（接手时）

- `develop` = `192a3ae`；`main` = `276d1f0`；`v0.1.0` → `276d1f0`。
- 已合并 PR：#11 P0、#12 P1、#13 P2、#14 P3；接手时无 open PR。
- 分支保护：`main`/`develop` 需要 `validate` + 1 评审；`main` 管理员也受约束；`develop` 管理员可应急绕过。
- CI：`.github/workflows/ci.yml` 跑 `npm run check` + `npm test`。
- Open issues：P4 #6、P5 #7、P6 #8、P7 #9、P8 #10；follow-up #15/#16/#17。

## 4. 已实现模块

| 模块 | 文件 | 内容 |
| --- | --- | --- |
| M11 | `src/lib/levels.json`、`levels.js` | 30 关 DS-2、加载、逐条校验、内置默认回落 |
| M1 | `src/lib/board.js` | 生成、交换、匹配、连锁、特殊元素、死局、洗牌、冰层 |
| M2 | `src/lib/score.js` | 得分构成、`S_MAX=3480`、`TOTAL_MAX=2,140,200` |
| M3 | `src/lib/run.js` | 目标进度、立即结算、失败判定、道具限用、死局处理 |
| M4 | `src/lib/economy.js` | 星级、金币、道具购买、生命恢复与补满 |
| M12 | `src/lib/random.js`、`clock.js`、`logger.js`、`platform.js` | 随机数、时钟、日志 |
| P0 | `web/`、`scripts/serve.mjs`、`test/` | 状态页、静态服务器、测试脚手架 |

验证：

- `npm run check`：44 个必需文件 + 3 组基线标记。
- `npm test`：85 个用例通过。
- `npm run dev`：<http://127.0.0.1:5173>（状态页）。

## 5. 必须先处理（P4 前）

### #15 领域层模块边界（最高优先）

- `board.js`（M1）import `scoreEvent`（M2）并产出 `ScoreBreakdown`；`run.js`（M3）直接 import M1/M2；`economy.js`（M4）import M2 `starsPreview`；`levels.js`（M11）直接使用 `fetch`/`AbortController`/`setTimeout`。
- 设计 AC-A3 要求领域层模块之间无相互 import；M1 明确“不计分”；M4 依赖“无”；M11 纯函数。设计 `SettleResult` 又包含 score，基线内部矛盾。
- 处理方式（二选一，记录在 #15）：
  - A. 按设计重构：M1 只返回 `ScoreEvent`/消除步骤，M3 调 M2；M3/M4/M11 注入依赖或保持纯函数。
  - B. 修订设计：允许 M1 调 M2 产出 `ScoreBreakdown`，放宽 import 规则，并补 K-xx。
- 在选定前不要继续扩展 M1/M3 的接口，也不要基于旧接口写 P5 UI。

### #16 K-05 冰层取整

- BR-04 写 `I(n) = 7 + ⌊(n−16)/5⌋`（7~9），设计 §7.3.2 表用 `7 + round((n−16)/5)`（29/30 关为 10）。代码跟设计表。补 K-05 或改回 floor，并同步测试/文档。

### #17 S_MAX 特殊奖励

- `scoreEvent` 未限制 specialBonus ≤ 600；`S_MAX=3480` 依赖该前提；一手结算触发 7+ 个特殊元素时可能突破。补不变量测试、钳制或设计修正。

低优先级：`createBoard` 50 次失败无 `board:generate_fallback` 日志；`ensurePlayable` 重建后未复核死局；P6 集成需先 `restoreLives` 再 `consumeLife`。

## 6. 下一阶段

- P4 #6（组长）：DS-1 存档/迁移/多标签页、M9 排行榜 3s 超时与降级、mock server。
- P5 #7（54dxx）：M6/M7/M8、UI-1~7、无障碍。
- P6 #8（组长）：M5 会话编排、FL-07。
- P7 #9、P8 #10。
- 建议顺序：#15 → P4/P5 并行 → P6 → P7 → P8。

## 7. 工作流

- 分支：`feature/<module>-<initials>`、`fix/<topic>-<initials>`、`docs/<topic>-<initials>`，从 `develop` 切出。
- 提交：Conventional Commits；一个提交只做一件事；带测试；提交前看 `git diff --staged`，不要盲 `git add -A`。
- PR：目标 `develop`；至少 1 人评审；CI 通过；落后时 update branch；使用 merge commit（`--no-ff`），**不要 squash/rebase 合并**；合并后删分支、关 issue。
- 组长可评审组员 PR；组长的 PR 需要队友评审，或仅在文档/引导性改动上由管理员合并并说明。
- 发布：`develop` → `main` release PR；打 tag；当前 main 只有 `v0.1.0`；`v0.2.0` 计划在 P5 有界面后。
- 过程：提交按天分散；不要最后集中补；不要回填时间。每个提交保持聚焦，避免一次性上传。

## 8. 运行与验证

```bash
node -v          # 22+
npm run check    # 44 files / 3 marker groups
npm test         # 85 tests
npm run dev      # http://127.0.0.1:5173
```

无需 `npm install`（零运行时依赖）。浏览器里目前是状态页；游戏界面在 P5。

## 9. 关键约束

- 不在任何文件/提交中写学号、token、密钥、个人隐私；当前分支已清理，不要加回。
- 不提交 `node_modules/`、`dist/`、旧原型、`.env`。
- 不使用 `github-push` MCP：服务端无 git、提交作者硬编码为 Claude、没有 PR 工具。用本地 git + GitHub API。
- 不复制仓库外的旧原型（`game-impl`/队友上传分支）进主线；它们只作参考。
- 不声称未实现功能已实现；设计基线不是代码。
- 不直接 push `main`/`develop`；走 PR。不要删除 `docs/baseline` 或改编号。
- 本机环境/凭据/网络信息见仓库根 `HANDOFF-LOCAL.md`（若存在；本地忽略、不提交）。不要把该文件提交。

## 10. 工作区推荐

- **推荐**：`E:\repos\team`（纯 ASCII 路径），把仓库根作为唯一 workspace root；新 harness 打开这个目录。
- 当前工作副本可在 `E:\repos\软件工程\team`；路径含中文，能用但部分工具可能有编码问题；新环境建议 ASCII。
- 不要把 `E:\repos\软件工程\game` 当作最终项目工作区——那是实验一/二仓库，`AGENTS.md`/`game-impl` 是另一套内容。
- 不要同时把父目录或多个仓库加进 workspace；只加 `team` 仓库根（含 `.git`、`AGENTS.md`、`README.md`、`src/`、`docs/`）。
- 新环境 fresh clone：

  ```bash
  git clone https://github.com/qianci2/team.git E:\repos\team
  cd E:\repos\team
  npm run check
  npm test
  ```

  然后按第 7 节开分支；token/凭据不要写进仓库。

## 11. 接手前 30 分钟检查

1. `git status` / `git log --oneline -10`；确认在 `develop`。
2. `npm run check`（44）和 `npm test`（85）。
3. 读 `README.md`、`CONTRIBUTING.md`、`docs/roadmap.md`、`docs/baseline/README.md`。
4. 打开 #15/#16/#17/#6；先定 #15 方案。
5. `git remote -v`；测试 `git ls-remote`；失败则用 GitHub API（见 `HANDOFF-LOCAL.md`）。
6. 不要先写代码：先确认 #15 的接口决策，再开 P4/P5 分支。

## 12. 文档索引

- `README.md`：项目、团队、快速开始、路线图。
- `CONTRIBUTING.md`：分支、提交、PR、评审、合并规则。
- `docs/roadmap.md`：P0–P8 阶段与三人分工。
- `docs/project-brief.md`：课程最终项目要求与评分口径。
- `docs/baseline/README.md`：需求/设计基线、编号、K-01~K-04、变更规则。
- `docs/levels.md`：关卡字段、校验口径、星级标定待办。
- Issues：#6–#10（阶段任务）、#15–#17（审查 follow-up）。

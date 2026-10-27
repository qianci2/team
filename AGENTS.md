# AGENTS.md — 《星消乐》最终项目接手说明

> 给接手本仓库的 AI agent / 新 harness 的第一份文件。读完应能直接继续开发，不需要旧对话记忆。
> 最后更新：2026-10-26（P5 合入）· 维护者：qianci2（组长）· P5 部分：54dxx

## 0. 一句话现状

- 仓库：<https://github.com/qianci2/team>（公开）
- 集成分支：`develop`；P0–P6 已完成并合入；P5 交付在 `feature/ui-54dxx`（PR 评审后进入 `develop`）
- 测试：**151 个 `node:test` 用例**、仓库校验 75 个必需文件
- 浏览器：`npm run dev` 后打开 <http://127.0.0.1:5173> 即为可玩版本；P5 验收记录见 `docs/ui.md`、截图见 `docs/screenshots/`
- 未完成：P7 的真实设备/跨浏览器、5 人可用性、30 分钟长会话、难度标定；P8 交付
- `main` 仍停在 `v0.1.0`（P0 骨架）；P1–P6 在 `develop`
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

## 3. GitHub 状态（P5 合入时）

- `main` = `276d1f0`（`v0.1.0`）；`develop` 含 P4/P6/P7 基线提交。
- 已合并 PR：#11 P0、#12 P1、#13 P2、#14 P3、#19 领域边界、#20 P4、#21 P6、#22 P7 测试基线。
- P5：`feature/ui-54dxx` → `develop` 的 PR（#7）；作者 54dxx 不能自批，需要组长或另一位队友评审。
- 分支保护：`main`/`develop` 需要 `validate` + 1 评审；`main` 管理员也受约束；`develop` 管理员可应急绕过。
- CI：`.github/workflows/ci.yml` 跑 `npm run check` + `npm test`（不含 GUI 浏览器）。
- Open issues：#7 P5（PR 中）、#9 P7、#10 P8、#15/#16/#17 follow-up。

## 4. 已实现模块

| 模块 | 文件 | 内容 |
| --- | --- | --- |
| M11 | `src/lib/levels.json`、`levels.js` | 30 关 DS-2、加载、逐条校验、内置默认回落 |
| M1 | `src/lib/board.js` | 生成、交换、匹配、连锁、特殊元素、死局、洗牌、冰层 |
| M2 | `src/lib/score.js` | 得分构成、`S_MAX=3480`、`TOTAL_MAX=2,140,200` |
| M3 | `src/lib/run.js` | 目标进度、立即结算、失败判定、道具限用、死局处理 |
| M4 | `src/lib/economy.js` | 星级、金币、道具购买、生命恢复与补满 |
| M12 | `src/lib/random.js`、`clock.js`、`logger.js`、`platform.js` | 随机数、时钟、日志 |
| M5 | `src/app/session.js`、`bootstrap.js` | 场景状态机、对局生命周期、弹窗、队列、生命恢复 |
| M9/M10 | `src/app/rank.js`、`store.js`、`save-schema.js` | 排行榜客户端/降级、DS-1 存档、迁移、多标签页 |
| M6 | `src/ui/layout.js`、`palette.js`、`animation.js`、`renderer.js` | 布局、配色/形状、CascadeStep 回放、Canvas 绘制 |
| M7 | `src/ui/audio.js` | 5 类合成音效、背景铺底、静音、可见性暂停 |
| M8 | `src/ui/input.js` | 指针/触屏/键盘、0.3 格滑动、锤子瞄准 |
| UI 装配 | `src/ui/app.js`、`format.js`、`web/` | 七个界面、HUD/弹窗、设置、排行榜、导入导出 |
| P0 | `scripts/serve.mjs`、`test/` | 静态服务器、测试脚手架、仓库校验 |

验证：

- `npm run check`：75 个必需文件 + 3 组基线标记。
- `npm test`：151 个用例通过；覆盖率行 93.74% / 分支 82.99% / 函数 95.35%。
- `npm run dev`：<http://127.0.0.1:5173>（可玩）。

## 5. 已解决的 follow-up

- **#15 领域边界**：按方案 B 收敛为 `M3 → M1 → M2` 与 `M3 → M2`，M4/M11 不 import 其他领域模块；记录为 K-06，并由 `test/domain-boundaries.test.mjs` 静态检查。
- **#16 K-05 冰层取整**：维持设计 §7.3.2 的 `round` 口径（7~10），已写入基线 K-05，`levels.json` 与测试一致。
- **#17 S_MAX**：`scoreEvent` 把 `specialBonus` 钳到 600（K-07），新增 7+ 特殊元素与 `stepTotal ≤ S_MAX` 不变量测试。
- **低优先级**：`createBoard` 50 次失败日志、`ensurePlayable` 重建后复核死局、P6 的 `restoreLives` → `consumeLife` 顺序均已处理或不再阻塞；若发现回归，新开 issue 并补测试。

## 6. 下一阶段

- P5 #7 已交付到 `feature/ui-54dxx`，等评审合入；验收记录在 `docs/ui.md`。
- P7 #9 剩余：真实手机与 Safari/Firefox、5 人可用性、30 分钟长会话、TC-39/TC-40 代理求解器标定、`starKeep` 阈值。
- P8 #10：`develop` → `main` release PR、`v0.3.0`/`v1.0.0` tag、演示材料、最终追溯矩阵。
- 排行榜仍只有客户端 + mock + 降级；不要声称已部署真实服务。

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
npm run check    # 75 files / 3 marker groups
npm test         # 151 tests
npm run dev      # http://127.0.0.1:5173
```

无需 `npm install`（零运行时依赖）。浏览器里是完整游戏；`?debug=1` 显示 FPS，`?level=5` 可直接进入已解锁关卡。浏览器验收不在 CI 中执行，记录见 `docs/ui.md` §10。

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
- 当前 P5 工作副本：`E:\Zcode工作目录\软件工程\team`；路径含中文，能用但部分工具可能有编码问题；新环境建议 ASCII。
- 不要把 `E:\Zcode工作目录\软件工程\game` 当作最终项目工作区——那是实验一/二仓库，`AGENTS.md`/`game-impl` 是另一套内容。
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

1. `git status` / `git log --oneline -10`；确认在 `develop` 或 P5 功能分支。
2. `npm run check`（75）和 `npm test`（151）。
3. 读 `README.md`、`CONTRIBUTING.md`、`docs/roadmap.md`、`docs/ui.md`、`docs/baseline/README.md`。
4. 打开 #7/#9/#10；确认 P5 PR 状态与剩余 P7 项。
5. `npm run dev` 实际走一遍主流程：主菜单 → 选关 → 交换 → 结算/失败 → 排行榜 → 设置。
6. `git remote -v`；测试 `git ls-remote`；失败则用 GitHub API（见 `HANDOFF-LOCAL.md`）。

## 12. 文档索引

- `README.md`：项目、团队、快速开始、路线图。
- `CONTRIBUTING.md`：分支、提交、PR、评审、合并规则。
- `docs/roadmap.md`：P0–P8 阶段与三人分工。
- `docs/project-brief.md`：课程最终项目要求与评分口径。
- `docs/baseline/README.md`：需求/设计基线、编号、K-01~K-04、变更规则。
- `docs/levels.md`：关卡字段、校验口径、星级标定待办。
- `docs/ui.md`：P5 界面、操作、契约、无障碍、响应式与浏览器验收。
- `docs/screenshots/`：桌面与窄屏验收截图及说明。
- `docs/test-report.md`、`docs/traceability.md`：测试结果、TC 映射与实现追溯。
- Issues：#7 P5、#9 P7、#10 P8、#15–#17 follow-up（均已处理，见 §5）。

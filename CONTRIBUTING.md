# 协作规范（CONTRIBUTING）

本文件是团队协作的硬约定。提交前请先读完；PR 评审会按这里的条款逐项检查。

## 1. 本地准备

```bash
git clone https://github.com/qianci2/team.git
cd team
git config user.name "你的名字"
git config user.email "你的 GitHub 邮箱"
npm run check
npm test
```

- **每个人用自己的 GitHub 账号提交**。不要用别人的身份，也不要让组长代提交你的模块。
- 邮箱必须是 GitHub 账号已关联的邮箱（或 `用户名@users.noreply.github.com`），否则贡献图不会记到你名下。
- 开始前先读 [`docs/baseline/README.md`](docs/baseline/README.md) 与 [`docs/roadmap.md`](docs/roadmap.md)，从 issue 列表认领任务。

## 2. 分支模型

| 分支 | 用途 | 保护规则 |
| --- | --- | --- |
| `main` | 可发布版本，只接受 release PR | 禁止直接 push；1 人评审；CI 通过 |
| `develop` | 集成分支，日常合并目标 | 禁止直接 push；1 人评审；CI 通过 |
| `feature/<模块>-<缩写>` | 新功能 | 从 `develop` 切出，合并后删除 |
| `fix/<主题>-<缩写>` | 缺陷修复 | 从 `develop` 切出，合并后删除 |
| `docs/<主题>-<缩写>` | 文档 | 从 `develop` 切出，合并后删除 |
| `chore/<主题>-<缩写>` | 构建、CI、工具链 | 从 `develop` 切出，合并后删除 |

示例：`feature/board-xjl`、`feature/ui-<缩写>`、`docs/roadmap-zyj`、`fix/storage-multitab-zyj`。

分支名用小写字母、数字和连字符；不要用中文、空格或下划线。

## 3. 提交规范

### 3.1 格式

```text
<type>(<scope>): <subject>

<body>

<footer>
```

- `type` 必填，取下列之一：`feat`、`fix`、`docs`、`test`、`refactor`、`perf`、`chore`、`ci`、`build`。
- `scope` 必填，使用模块名：`board`、`score`、`levels`、`economy`、`storage`、`rank`、`ui`、`audio`、`input`、`session`、`test`、`docs`、`ci`、`chore`。
- `subject` 用中文，祈使句，不超过 50 字，结尾不加句号。
- `body` 说明**目的、实现要点、验证方式**；涉及需求时写 `Refs #issue` 或需求编号。
- 一个提交只做一件事。格式化、重命名、逻辑修改不要混在同一个提交里。

### 3.2 示例

```text
feat(board): 实现三消检测与交换合法性判定

目的：为对局循环提供可复用的棋盘动作。
实现：M1 纯函数，输入 Board/Move，输出新 Board 与 MatchGroup。
验证：npm test -- board；新增 6 个用例覆盖横向、纵向、L/T 型。
Refs #12
```

```text
test(storage): 覆盖多标签页合并与较高星级保留

目的：验证 FM-13 的合并策略。
验证：npm test -- storage；模拟两个标签页交替写入。
Refs #18
```

### 3.3 禁止事项

- 禁止一次提交几十个文件、把整个模块“上传”进仓库。
- 禁止 `git add -A` 后不检查就提交；提交前先看 `git status` 与 `git diff --staged`。
- 禁止提交 `node_modules/`、`dist/`、`.env`、密钥、个人 IDE 配置、系统临时文件。
- 禁止把别人的代码或提交记录算到自己名下；也禁止替别人提交。
- 禁止回填或伪造提交时间。

## 4. PR 流程

1. 从最新 `develop` 切出功能分支。
2. 按第 3 节提交；每个提交都应能通过 `npm test`。
3. push 分支，向 `develop` 开 PR，填写 PR 模板。
4. 至少 1 人评审；作者不能自己批准自己的 PR。
5. CI 必须通过；所有 review conversation 必须解决。
6. 由评审人合并，使用 **merge commit**（`--no-ff`），不要 squash、不要 rebase 合并。
7. 合并后删除功能分支。

PR 标题与提交标题同格式，例如 `feat(board): 实现三消检测与交换合法性判定`。

### 4.1 PR 检查清单

- [ ] 一个 PR 只做一件事，改动范围可解释；
- [ ] 关联了 issue 或需求编号（FR/NFR/BR）；
- [ ] 新增/修改的逻辑有单测，测试能在本地跑通；
- [ ] 异常路径有处理，不只是主路径；
- [ ] 涉及界面时附截图或录屏，并检查键盘操作与色觉障碍要点；
- [ ] 没有提交密钥、构建产物、旧原型文件；
- [ ] 文档随代码更新（接口、数据格式、行为变化）。

## 5. 评审要求

评审人至少检查：

1. **需求对应**：改动能否定位到 FR/NFR/BR 编号；
2. **模块边界**：领域层是否保持纯函数，是否混入 DOM/存储/网络；
3. **数据与接口**：字段、错误码、超时与降级是否与设计文档一致；
4. **异常路径**：失败、超时、存储不可用、重复提交是否有恢复策略；
5. **可测试性**：随机数、时钟、存储、网络是否可注入；
6. **可读性**：命名、注释密度与周边代码一致；
7. **安全与隐私**：无密钥、无用户数据泄漏、昵称等输入有校验。

## 6. 合并与发布

- 功能 PR → `develop`：merge commit，保留每个作者的提交。
- 阶段结束：`develop` → `main` 的 release PR，更新 `CHANGELOG.md`，打 annotated tag（`v0.2.0`、`v0.3.0`、`v1.0.0`）。
- 发布后由组长在 GitHub Releases 写变更摘要，附演示链接或截图。

## 7. 完成定义（Definition of Done）

一个任务算完成，必须同时满足：

1. 代码实现并通过 `npm run check` 与 `npm test`；
2. 新增行为有单测；UI 行为有手工验收记录或截图；
3. 相关文档已更新（README/接口/数据/路线图）；
4. PR 关联 issue，说明验证方式；
5. 评审通过并合并到 `develop`；
6. 需求编号能在测试或代码注释中定位。

## 8. 代码与文档约定

- 浏览器端使用原生 ES Modules；不引入运行时依赖前需在 PR 中说明理由。
- 领域层（棋盘、计分、流程、经济）保持纯函数，不直接访问 DOM、localStorage、网络。
- 随机数、时钟、存储、网络通过参数注入，便于测试与求解器复用。
- 文件命名用 kebab-case；模块导出用命名导出。
- 文档用中文，代码标识符用英文；术语与 `docs/baseline/02-design-v1.0.md` 附录 C 保持一致。
- 不提交二进制素材，除非在 `assets/README.md` 登记来源与许可。

## 9. 安全

- 不要把 token、PAT、密码写进代码、文档、issue 或 PR。
- 发现密钥泄漏，立即在 GitHub 设置中吊销，并通知组长。
- 外部接口必须设置超时、错误码与降级路径；不得假设第三方一定可用。

## 10. 三人协作节奏

- 每人每周至少 2–3 次提交，分布在项目周期内；不要最后一周集中补。
- 每天在 issue 或 PR 里同步一次进展；阻塞超过半天要在群里说明。
- 组长负责拆 issue、评审、合并与发版；组员对自己的模块负全责，包括测试与文档。
- 阶段结束做一次 15 分钟复盘：完成了什么、卡在哪里、下阶段怎么改。

## 11. 常见错误

| 错误 | 后果 | 正确做法 |
| --- | --- | --- |
| 一次性上传整个模块 | 提交历史无法体现过程与分工 | 按功能拆成 3–8 个小提交，逐个 PR |
| 用 squash 合并 | 个人提交被压成一条，贡献不可见 | 使用 merge commit（`--no-ff`） |
| 直接 push `main`/`develop` | 绕过评审与 CI | 一律走 PR |
| 提交 `dist/`、`node_modules/` | 仓库膨胀、评审噪声 | 依赖 `.gitignore`，提交前检查 |
| 把 token 写进配置 | 泄漏后难以彻底清除 | 用环境变量或本地凭据管理器 |
| 最后一天补全部提交 | 时间戳集中，过程不可信 | 按阶段持续提交 |

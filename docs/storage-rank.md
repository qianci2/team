# 存档与排行榜（P4 / M10 / M9）

本文记录 P4 的实现边界、可调用接口、写盘与合并口径，以及排行榜降级方式。需求依据：`docs/baseline/01-requirements-v2.1.md` FR-12~FR-21、FM-01/FM-03~FM-06/FM-10/FM-13；设计依据：`docs/baseline/02-design-v1.0.md` FL-03/FL-04/FL-05、DS-1、I-21~I-24、I-33~I-35。

## 1. 文件与职责

| 文件 | 层 | 职责 |
| --- | --- | --- |
| `src/app/save-schema.js` | 应用层数据 | DS-1 默认值、字段归一化、迁移入口、多标签页合并、导入校验、序列化 |
| `src/app/store.js` | M10 | 内存唯一事实源、`localStorage` 适配、写盘、订阅、`storage` 事件合并 |
| `src/app/rank.js` | M9 | 提交/查询、3s 超时、客户端校验、本地模拟榜单 |
| `scripts/mock-rank-server.mjs` | 测试/联调 | HTTP-1/HTTP-2 契约 mock；内存数据，不代表真实后端 |
| `test/save.test.mjs` | 测试 | DS-1、INV、迁移、合并、导入导出 |
| `test/store.test.mjs` | 测试 | 写盘、只读降级、损坏恢复、`storage` 事件 |
| `test/rank.test.mjs` | 测试 | 校验、超时、降级、mock 契约 |

## 2. M10 存档接口

```js
const store = createStore({ storage, clock, logger });

store.get();                 // 冻结的 DS-1 快照
store.commit(patch, reason); // {saved, mode, reason, save}
store.subscribe("save:changed", fn);
store.mergeExternal(raw);
store.attachStorage(window); // 返回取消函数
store.importFromText(text);  // FR-13
store.exportToText();
```

`reason` 取值为 `settle`/`fail`/`lives`/`purchase`/`item`/`settings`/`import`。`commit` 永不抛存储异常：失败返回 `{saved:false, mode:"readonly"}`，内存状态继续有效（FM-01）。

写盘时机与设计 FL-03 一致：结算、失败、生命、购买、道具消耗、设置、昵称立即写；对局内步数/得分/目标进度不写。`store` 的 `updatedAt` 在同一毫秒内也保持单调递增，避免多标签页冲突判定出现相同时间戳。

## 3. DS-1 与不变式

字段与默认值见 `src/app/save-schema.js` 的 `createDefaultSave`。归一化执行以下规则：

- `unlockedLevel` 钳到 1–30；`stars`/`rewardPaidStars` 只保留 1–3；`bestScores` 非负。
- `totalScore` 始终按 `Σ bestScores` 重算，不信任存档里的值（INV-3）。
- `lives` 钳到 0–5，`livesRestored` 钳到 0–5；`coins`/`items` 非负。
- 昵称必须是空串或 3–12 个中英文/数字/下划线，否则清空。
- 时间字段不可解析时用注入的 `now`；`version > 1` 按不可用存档回落默认。
- 损坏 JSON 备份到 `gemz_save_v1.corrupt.<时间戳>` 后以默认存档启动（FM-10）。

## 4. 多标签页合并（FL-04）

`mergeSave(a, b)` 以 `updatedAt` 较新者为“较新一方”：

| 字段 | 规则 |
| --- | --- |
| `unlockedLevel` | 取较大值 |
| `stars` / `bestScores` / `rewardPaidStars` | 逐关取较大值 |
| `totalScore` | 按合并后的 `bestScores` 重算 |
| `coins` / `items` / `lives` / `livesUpdatedAt` / `livesRestored` | 取较新一方（不累加、不取大） |
| `muted` / `colorblind` / `nickname` | 取较新一方 |
| 时间戳相同 | 以传入的 `a` 为较新一方，资源不凭空增加 |

`commit` 写前会读取 storage；若外部 `updatedAt` 更新，先合并再写。`storage` 事件走 `mergeExternal`，只更新内存并广播 `save:external`，不回写以避免事件回声。

## 5. M9 排行榜

```js
const rank = createRankClient({ fetchImpl, baseUrl, clock, saveProvider });

await rank.submit({ nickname, totalScore });
// 成功：{ok:true, code:0, rank}
// 失败：{ok:false, code:1001|1002|5000|'offline'|'busy', message}

await rank.fetch(100);
// 远端：{ok:true, source:'remote', list}
// 降级：{ok:false, source:'local', list, code, message}
```

- 客户端校验与 mock 使用同一昵称正则；分数上限用 M2 的 `TOTAL_MAX = 2,140,200`，服务端拒绝阈值仍是 2,150,000（K-03）。
- 超时 3s；网络失败、HTTP 5xx、`code` 非 0 都降级为本地模拟榜单，`source:'local'`，界面必须标注“本地模拟数据”。
- `localBoard` 固定 100 条、确定性；玩家已设置合法昵称时按总积分插入。
- 同一时刻只允许一个提交；进行中再次提交返回 `busy`，不排队、不重复发送。

## 6. Mock server

```bash
node scripts/mock-rank-server.mjs   # http://127.0.0.1:8787
```

仅用于契约测试/本地联调：内存 `Map`，无 SQLite、无持久化、无账号、无真实反作弊。它实现 HTTP-1/HTTP-2 的请求响应、昵称/分数校验、同分按自增序号排序、同一昵称 10 秒写入节流。真实排行榜服务仍按设计 §7.4 作为可选组件，不因 mock 存在而声称已部署后端。

## 7. 已知限制

- `gemz_diag_config` 的配置异常日志尚未接入 M10；P6 在启动流程中补。
- `store` 尚未实现同一 `reason` 16ms 内合并写（I-22 的优化项）；当前每次 commit 同步写，优先保证 NFR-14 的落盘时机。
- 排行榜没有轮询；进入页面拉取一次，10 秒内复用缓存。

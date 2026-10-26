# 关卡配置说明（DS-2 / M11）

本文记录 `src/lib/levels.json` 的字段口径、加载与校验行为，以及发布前仍需完成的标定工作。需求与设计依据：`docs/baseline/01-requirements-v2.1.md` §3.6.4、§7.2~§7.4，`docs/baseline/02-design-v1.0.md` §7.3。

## 1. 文件与职责

| 文件 | 内容 | 说明 |
| --- | --- | --- |
| `src/lib/levels.json` | 30 关配置（DS-2） | 构建期静态资源，字段与设计 §7.3.2 全表一致 |
| `src/lib/levels.js` | M11 加载与校验 | 纯函数；内置默认配置、逐条校验、自检报告、URL 加载回落 |
| `test/levels.test.mjs` | 配置与校验单测 | 覆盖 30 关基线、非法配置、缺失/损坏回落 |

`DEFAULT_LEVELS_DOC` 是内置默认配置，由 BR-02~BR-04 公式与 §7.3.2 的星级阈值预置表生成；单测断言它与 `levels.json` 完全一致，避免两份数据漂移。

## 2. 字段定义

```json
{
  "version": 1,
  "levels": [
    {
      "level": 16,
      "segment": 3,
      "rows": 8,
      "cols": 8,
      "colors": 5,
      "moves": 25,
      "goals": {
        "score": 1900,
        "collect": { "color": 2, "count": 14 },
        "ice": { "total": 7, "doubleRatio": 0.15 }
      },
      "starKeep": { "keep2": 6, "keep3": 11 }
    }
  ]
}
```

| 字段 | 类型 | 约束 | 校验失败时的行为 |
| --- | --- | --- | --- |
| `version` | int | ≥ 1 | 整份配置非法，回落内置默认 |
| `level` | int | 1–30 且不重复 | 该条非法，用该关默认配置替换 |
| `segment` | int | 1–3，且与关号所属分段一致 | 同上 |
| `rows` / `cols` | int | 8 / 8（BR-01） | 同上 |
| `colors` | int | 5（BR-01） | 同上 |
| `moves` | int | 16–25 | 同上 |
| `goals.score` | int | 1000–2740 | 同上 |
| `goals.collect.color` | int | 0–4 | 忽略该收集目标，其余目标保留 |
| `goals.collect.count` | int | 1–64（基线业务值 10–28） | 忽略该收集目标 |
| `goals.ice.total` | int | 0–64 | 越界时该条非法 |
| `goals.ice.doubleRatio` | number | 0–1 | 越界时取 0（全部单层冰） |
| `starKeep.keep2` / `keep3` | int | `0 ≤ keep2 < keep3 ≤ moves` | 保守值 `keep2 = 0`、`keep3 = moves`，并记录警告 |

补充说明：

- 收集目标与冰层目标都是可选项；只有分数目标必填。这样自定义关卡（NFR-10）可以只配置分数目标。
- 段 1/2 的基线配置没有冰层，段 3 的 `doubleRatio` 统一为 0.15。
- 冰层是格子属性（覆盖层模型），不阻止元素交换；元素被消除时减 1 层，减到 0 才计入冰层目标（FR-07 / C-01）。

## 3. 加载与回落

`loadLevels(input, { logger })` 接受已解析对象或 JSON 文本，返回：

```js
{
  source: "external" | "recovered" | "default",
  ok: boolean,
  levels: LevelConfig[30],
  errors: string[],
  warnings: string[],
  recovered: number[]
}
```

| 情形 | 处理 | `source` |
| --- | --- | --- |
| 30 关全部合法 | 直接使用 | `external` |
| 单条字段非法或缺失 | 该关回落默认，其余保留；错误/警告写入报告 | `recovered` |
| 重复关号 | 保留首次出现，后续重复项报错 | `recovered` |
| 收集颜色/数量非法 | 忽略该收集目标，关卡仍可用 | `external`（有警告） |
| 星级阈值非法 | 用保守阈值并警告，关卡仍可用 | `external`（有警告） |
| `version` 非法、缺 `levels`、JSON 损坏、无任何可用条目 | 整份回落内置默认 | `default` |

内置日志键 `gemz_diag_config` 的写入与“最多保留 10 条”由应用层（M5/M10）负责；M11 只通过注入的 `logger` 输出可读原因，不直接访问 localStorage。

浏览器端入口：

```js
import { loadLevelsFromUrl } from "./lib/levels.js";

const levels = await loadLevelsFromUrl("/data/levels.json");
```

网络失败、超时（默认 3s）、非 2xx 或 JSON 解析失败都回落内置默认，不抛异常。

## 4. 30 关数值基线

```text
段 1（1–5）：   M(n) = 20 − (n − 1)              T(n) = 1000 + 300 × (n − 1)
段 2（6–15）：  M(n) = 20 − ⌊(n − 6) / 2⌋        T(n) = 1400 + 100 × (n − 6)
                C(n) = 10 + (n − 6)  C 为收集数，颜色按 (n + 1) mod 5 轮换
段 3（16–30）： M(n) = 25 − ⌊(n − 16) / 3⌋       T(n) = 1900 + 60 × (n − 16)
                C(n) = 14 + (n − 16)  冰层 I(n) = 7 + round((n − 16) / 5)
```

可复核值：`ΣM(n) = 615`（段 1 为 90、段 2 为 180、段 3 为 345）；单关上限区间 `[55,680, 87,000]`；总积分硬上限 `615 × 3480 = 2,140,200`（设计文档 K-03 已修正需求文档 NFR-08 中的笔误）。

## 5. 星级阈值标定待办

`starKeep` 当前使用设计 §7.3.2 的**预置值**，只保证关卡可玩，不是最终标定结果。正式发布前必须：

1. 用普通玩家代理求解器（需求文档附录 B.1）每关模拟 200 次；
2. 取该关“完成时剩余步数”分布的 p70 作为 `keep3`、p35 作为 `keep2`；
3. 回写 `src/lib/levels.json` 与 `DEFAULT_LEVELS_DOC`，并同步更新 `test/levels.test.mjs` 的阈值表；
4. 按 BR-07 验收：星级分布 1★ ≤ 50%、2★ ≥ 25%、3★ ≥ 5%，最不利关卡 2★ 达标率 ≥ 45%；
5. 同步执行 BR-05 难度验收：单关通过率 Wilson 95% 置信区间下限 ≥ 60%，三段平均通过率依次递减。

在该工作完成前，README 不应声称关卡难度已按真实玩家数据验收。

## 6. 冰层布置

`src/lib/run.js` 的 `placeIce` 按设计 §7.3.3 实现：

```text
行权重 w = [12, 12, 12, 10, 8, 6, 4, 0]（合计 64，底行权重为 0）
无放回加权抽样 I(n) 个格；双层数量 = round(I(n) × doubleRatio)
同一种子可复现；重试进入新对局时重新布置
```

底行权重为 0 是 BR-06 / V-14 统计结论的直接编码：第 7 行被消除频率仅 4.4%，均匀布置会让约 1/4 冰格几乎不可达。

## 7. 测试与需求映射

| 测试 | 覆盖 |
| --- | --- |
| `30 关字段完整且与设计基线公式一致` | FR-07、BR-02~BR-04、NFR-10 |
| `星级阈值与设计文档 §7.3.2 的预置表一致` | FR-09、BR-07（预置值） |
| `版本号非法 / JSON 损坏 / 缺失配置回落` | FM-12、NFR-10 |
| `单条非法配置、重复关号、收集/冰层/阈值边界` | FM-12、FR-07 |
| `loadLevelsFromUrl` 成功/失败路径 | FR-20 式降级思路、NFR-09 |

## 8. 仍待确认的口径

- **收集颜色可达性**：段 2/3 的颜色按 `(n + 1) mod 5` 轮换，设计要求生产前由代理求解器复核该颜色在当前关的出现频率；本阶段未执行。
- **冰层数量分档**：需求 BR-04 写作 `7 + ⌊(n − 16) / 5⌋`（7~9），设计 §7.3.2 表为 `7 + round((n − 16) / 5)`（7~10，29/30 关为 10）。本实现以设计表为准，差异已在此记录。
- **总积分上限**：需求 NFR-08 的 `2,147,160` 为笔误，设计 K-03 修正为 `2,140,200`；代码使用后者。
- **配置日志落盘**：`gemz_diag_config` 属于应用层职责，P4 接入 M10 时补齐。

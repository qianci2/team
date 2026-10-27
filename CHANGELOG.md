# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- P0 工程骨架：`src/lib`、`src/app`、`src/ui`、`web/` 目录与静态开发服务器。
- M12 平台工具：可注入种子的随机数、时钟抽象与分级日志。
- 平台工具与开发服务器的 node:test 用例；仓库校验脚本同步覆盖 P0 文件。
- P1 关卡配置：`src/lib/levels.json` 30 关数据、M11 加载/逐条校验、内置默认回落与 `docs/levels.md`。
- P2 棋盘与计分：M1 生成/交换/匹配/连锁/特殊元素/死局洗牌，M2 得分构成与 `S_MAX`/`TOTAL_MAX` 常量。
- P3 流程与经济：M3 目标进度/立即结算/失败判定/道具限用，M4 星级/金币/道具购买/生命恢复与补满。
- 领域层单测覆盖 FR-01~FR-11、FR-14、FR-16、FR-22/23 与 FM-07/FM-12/FM-14 的关键边界。
- P4 存档与排行榜：DS-1/迁移/多标签页合并、M10 只读降级、M9 超时与本地模拟榜单、mock 契约。
- P5 界面：Organic 页面壳、UI-1~UI-7、Canvas 渲染与连锁动画、指针/键盘/0.3 格滑动、Web Audio 音效与静音、色觉形状、新手引导、存档导入导出、小铺与响应式布局。
- P5 无障碍与验收：对比度审计、焦点管理与弹窗焦点陷阱、减少动态效果、桌面/窄屏截图与无头浏览器验收脚本记录。
- P6 会话：M5 场景状态机、对局生命周期、弹窗、输入队列、生命恢复与异常路径。
- P7 测试基线：覆盖率与领域微基准脚本、TC-01~TC-42 映射、实现追溯矩阵。

### Changed

- `presentation.play(events, meta)` 增加只读 `meta`，向表现层透传本步交换/道具信息，保证连锁动画从正确棋盘开始。
- README、路线图与测试报告更新为 P0–P6 已完成、P7 进行中；新增 `docs/ui.md` 与截图索引。

### Planned

- P7 剩余项：难度/星级代理求解器标定、真实设备与跨浏览器性能、5 人可用性测试
- P8 文档、演示与最终交付

## [0.1.0] - 2026-10-19

### Added

- 初始化仓库骨架：README、MIT 许可、编辑器与 Git 属性配置。
- 协作规范：分支模型、Conventional Commits、PR 模板、issue 模板、评审与合并规则。
- 需求 v2.1 与设计 v1.0 基线文档，以及 K-01~K-04 修正记录。
- 仓库校验脚本与 Node 单元测试；GitHub Actions CI。

[Unreleased]: https://github.com/qianci2/team/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/qianci2/team/releases/tag/v0.1.0

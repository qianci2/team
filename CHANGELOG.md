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

### Planned

- P4 存档、多标签页与排行榜降级
- P5 渲染、输入、音效与界面
- P6 会话编排与异常路径集成
- P7 自动化测试、性能与验收映射
- P8 文档、演示与最终交付

## [0.1.0] - 2026-10-19

### Added

- 初始化仓库骨架：README、MIT 许可、编辑器与 Git 属性配置。
- 协作规范：分支模型、Conventional Commits、PR 模板、issue 模板、评审与合并规则。
- 需求 v2.1 与设计 v1.0 基线文档，以及 K-01~K-04 修正记录。
- 仓库校验脚本与 Node 单元测试；GitHub Actions CI。

[Unreleased]: https://github.com/qianci2/team/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/qianci2/team/releases/tag/v0.1.0

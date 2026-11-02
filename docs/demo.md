# 演示与验收指引（v1.0.0）

## 1. 3 分钟演示流程

1. `npm run dev`，打开 <http://127.0.0.1:5173>。
2. 主菜单：展示“继续第 N 关”、生命/金币/总积分与“完成目标”说明。
3. 选关：30 张卡片分三程，展示星级、最高分、锁定态。
4. 对局：点击/滑动交换；展示连锁、特殊元素（炸弹/彩虹）、冰层、目标面板、星级预告与道具。
5. 结算：通关弹窗展示得分、星级、金币与“下一关/重玩/返回主菜单”；失败弹窗展示未完成目标与差值。
6. 排行榜：展示空榜与“提交我的成绩”入口；提交后显示本机记录；设置页展示昵称、静音、色觉辅助、小铺、导入导出。
7. 键盘路径：Tab 到棋盘 → 方向键 → 空格交换 → Esc 取消。

## 2. 截图

| 界面 | 文件 |
| --- | --- |
| 桌面主菜单 | [`screenshots/desktop-menu.jpg`](screenshots/desktop-menu.jpg) |
| 桌面选关 | [`screenshots/desktop-levels.jpg`](screenshots/desktop-levels.jpg) |
| 桌面对局 | [`screenshots/desktop-playing.jpg`](screenshots/desktop-playing.jpg) |
| 通关弹窗 | [`screenshots/desktop-win-dialog.jpg`](screenshots/desktop-win-dialog.jpg) |
| 排行榜/个人主页 | [`screenshots/desktop-rank.jpg`](screenshots/desktop-rank.jpg) |
| 设置 | [`screenshots/desktop-settings.jpg`](screenshots/desktop-settings.jpg) |
| 窄屏主菜单 | [`screenshots/narrow-menu.jpg`](screenshots/narrow-menu.jpg) |
| 窄屏选关 | [`screenshots/narrow-levels.jpg`](screenshots/narrow-levels.jpg) |
| 窄屏对局（色觉辅助） | [`screenshots/narrow-playing.jpg`](screenshots/narrow-playing.jpg) |

## 3. 复跑证据

```bash
npm run check                         # 77 文件 / 3 组基线标记
npm test                              # 151 用例
node --experimental-test-coverage --test
node scripts/bench.mjs                # 领域层微基准
npm run calibrate                     # 30 关 × 200 次，写 docs/calibration.json
```

浏览器证据与限制见 [`ui.md`](ui.md) §10、[`test-report.md`](test-report.md) §6。

## 4. 演示深链

- `?level=5`：直接进入第 5 关（仍走 M5 的解锁/生命/配置校验）。
- `?scene=rank`：直接进入排行榜。
- `?debug=1`：右下角显示 FPS。

v1.0.1 起，对局左上角“菜单”可确认退出本局；主菜单导航为整行 4 等分，不再位于右上角。

这些参数只用于演示与截图，不绕过游戏规则。

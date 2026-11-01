# 素材登记

本目录用于登记游戏运行时素材的来源与许可。当前项目没有引入第三方图片或字体；动作音效使用 CC0 采样，程序化背景铺底仍由 Web Audio 合成：

| 类别 | 现状 | 来源 / 许可 |
| --- | --- | --- |
| 星石、棋盘、冰层、粒子 | Canvas 程序化绘制 | 本项目自绘，MIT / CC0-1.0 |
| 动作音效 | `assets/audio/{swap,clear,item,win,fail}.ogg` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds)，CC0-1.0；原包 `License.txt` 见 `assets/audio/LICENSE.txt` |
| 背景铺底 | Web Audio 振荡器实时合成 | 本项目合成，MIT / CC0-1.0 |
| 字体 | 仅使用系统字体回退（Source Serif 4 / Instrument Sans / Georgia / 宋体） | 不打包、不下载 |
| 界面形状与纸纹 | CSS 与内联 SVG 噪声 | 本项目自绘，MIT / CC0-1.0 |
| 验收截图 | `docs/screenshots/*.jpg` | 本项目自截图，CC0-1.0；仅作文档证据，不参与运行时 |

`docs/screenshots/` 下的图片是验收证据，不是游戏素材；来源与生成方式见该目录的 README。若后续加入外部素材，必须在本表登记来源、作者与许可，并确认可用于课程交付。

Kenney 的 CC0 许可允许个人、教育与商业项目使用，署名非强制；本项目仍保留原始 `LICENSE.txt` 并在本表注明来源。

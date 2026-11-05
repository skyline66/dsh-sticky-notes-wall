# 便签墙 · DSH Sticky Notes

DeepSeek Harness（DSH）Web 与桌面端插件：左侧栏便签入口、瀑布流便签墙、粘贴图片与文本、到期提醒、完成状态、快捷键、可置顶的浮动便签窗、外观皮肤，以及可选的 **Windows 原生桌面置顶窗口**。

[English](README.md)

## 功能

- **左侧栏入口**：侧栏便签图标（带逾期角标），点击在中央打开便签墙。
- **便签置顶**：点便签上的图钉或在编辑器里勾选「置顶到浮窗」，便签会进入**悬浮在所有 Harness 面板之上**的浮窗，切换对话/设置都不消失。拖动标题栏移动（靠近边缘会自动吸附），可折叠、可隐藏。
- **浮窗速记**：浮窗内置记录框，输入后 `Ctrl/Cmd+Enter` 立即保存并置顶；浮窗里的便签可直接点文字就地编辑、勾选完成、查看到期与图片。
- **桌面置顶窗口（Windows）**：在桌面打开一个**原生置顶窗口**，浮在其它软件之上展示置顶便签。首次打开会自动编译随包附带的 C# 源码（约 10 秒），运行在 Windows 10/11 自带的 WebView2 运行时上。
- **粘贴图片与文本**：便签墙、编辑器、浮窗都支持 `Ctrl/Cmd+V` 粘贴截图、拖拽文件与选择图片；图片保存在插件数据目录。
- **到期提醒**：每条便签可设到期时间；到期时弹出提醒（查看 / 完成 / 稍后 10 分钟）、可开启系统通知，侧栏角标与「今天到期」筛选持续提示。
- **完成状态**：勾选完成，便签变淡、加删除线，并归入「已完成」筛选。
- **外观自定义**：便签配色（跟随主题 / 浅色纸面 / 深色纸面）、纸面质感（自动 / 实心 / 毛玻璃）、对比度、默认颜色、字体、字号、行高、圆角、密度。便签自己挑选纸面颜色，因此在浅色主题、深色主题和壁纸背景上都保持可读。
- **手动排序**：把墙面切到「手动拖拽」即可拖动卡片调整顺序，顺序会保存到每条便签。
- **开机自启动**：可选写入 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，登录后自动启动 Harness，便签随开随用。
- **快捷键**

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl/Cmd + Shift + N` | 任意页面打开便签墙并新建 |
| `Ctrl/Cmd + Shift + P` | 显示 / 隐藏置顶浮窗 |
| `N` | 便签墙内新建 |
| `Ctrl/Cmd + Enter` | 保存（编辑器、速记框、浮窗内联编辑） |
| `/` | 聚焦搜索 |
| `?` | 快捷键说明 |
| `Esc` | 关闭编辑器 / 取消内联编辑 / 关闭图片预览 |

## 安装

从插件市场安装（推荐）：

```bash
dsh plugin --profile web add github:skyline66/dsh-sticky-notes-wall
```

本地开发时把 profile 的 `package.json` 指到本目录：

```jsonc
"dsh-sticky-notes-wall": "link:C:/Users/you/plugins/dsh-plugins/sticky-notes"
```

刷新页面即可。左侧栏出现便签图标，设置页新增「便签墙」分区。

更新 Host 半（`index.js`）后请重启一次 Harness 以加载新的 JS 模块版本；浏览器半会通过客户端包监听自动热载。

## 设置页

`设置 → 便签墙` 汇总了所有外观与桌面选项：

- **外观**：配色、纸面质感、对比度、默认颜色、字体、字号、行高、圆角、密度与实时预览。
- **置顶浮窗**：宽度、不透明度、锁定位置、启动时自动显示、显示/隐藏。
- **桌面与排序**：桌面置顶窗口、开机自启动、排序方式。

## 桌面窗口说明

- 仅 Windows；需要 .NET Framework 编译器（`csc.exe`，Win10/11 自带）与 WebView2 运行时。
- 首次使用时编译进插件数据目录，包内只带源码。
- 标题栏拖动移动、双击折叠、右下角拖动调整大小，并记住窗口位置。
- 点击便签会把 Harness 窗口切到前台；托盘图标提供 显示 / 重新加载 / 退出；Harness 退出时窗口自动关闭。

## 数据位置

```
~/.dsh/sticky-notes/
  wall.json            便签、完成状态与提醒时间
  prefs.json           外观、浮窗与排序偏好
  attachments/         粘贴的图片
  desktop/             编译后的桌面程序、网页部件与载荷
  desktop-data/        桌面窗口位置、WebView2 配置、native.log
```

浮窗的显示状态、位置与置顶列表保存在浏览器 `localStorage`；外观偏好也会缓存在本地并同步到 `prefs.json`。

## 测试

```bash
npm test              # CSS、Host API 与偏好校验、Client 注册、编码检查
npm run test:desktop  # 编译并启动原生窗口后自动关闭（Windows）
```

## 目录

```
index.js              Host：便签存储、偏好、自启动、桌面窗口、/sticky-notes/api/*
client.js             Client：侧栏入口、便签墙、浮窗、设置页
native/StickyWidget.cs  置顶 WebView2 窗口
native/widget/          桌面窗口的 HTML/CSS/JS
native/sdk/             WebView2 SDK（微软，见 LICENSE.txt / NOTICE.txt）
```

## 许可

本插件 MIT。随包附带的 WebView2 SDK 二进制属于微软，按其许可再分发，见 `native/sdk/LICENSE.txt` 与 `native/sdk/NOTICE.txt`。
# Live2D 模型一键安装

**Live2D One-Click Install** — 一份 Live2D 模型，几步装进 Coo。

```text
选择目录 → 扫描 → 打包 → 安装
```

扫描、打包、安装一条线；卡片上还能改名字、一句话和身体参数。

- 作为 Coo 的 World 扩展运行，界面在 **高级模式 → Live2D 模型一键安装**
- 全程本地：读模型、出包、写 `figures/`，不联网，不经过对话
- 不需要额外的 Node 环境，也不用自己开浏览器

## 安装

在 Coo 的扩展目录里装：

```powershell
cd <Coo 安装目录>\data\extensions
npm install cortico-world-figure
```

装完重启 Coo，在扩展页确认状态为 `active`，然后去高级模式打开「Live2D 模型一键安装」。

## 三步

| 步骤 | 做什么 | 产出 |
|---|---|---|
| 扫描 | 读 `.model3.json`，报参数 / role / 未映射通道 | 无文件 |
| 打包 | 拆图、生成 `figure.json` / `profile.js`，量尺寸、拍封面 | `data/figure/builds/<id>-<ts>/` |
| 安装 | 复制到 `figures/`，同名先备份（留最近 2 份） | `figures/<id>/` |

三步各自触发，不会自动串跑。**打包不是打完就丢**：每份留一张卡片，可以装、可以改、可以删。

## 卡片

```text
[封面]  名字
        12.0 MB · 10-29 23:16
        已贴合
        [        安装        ]
        [  编辑  ] [  删除  ]
```

- **安装**：把这份复制进 `figures/`
- **编辑**：改名、改一句话、调身体幅度 / 动作风格；**不重新打包**，直接改 `figure.json` 和 `profile.js`，1 秒内生效。若这份已装过，要再点一次「安装」才同步
- **删除**：只删这一份打包，已安装的形象不受影响

「清空旧打包」保留最新一份，其余打包目录直接删除，点了会再确认一次。列表会自动清掉目录已经不在的记录。

## 导入模型包

点「导入」，可以：

- 选一个 **Live2D 模型目录**（含 `.model3.json`）：只打包，打完排进「已打包」，改名、调参数之后再安装
- 选一个 zip：里面是模型就打包，已经是打好的包（含 `figure.json`）就直接安装
- 直接把 zip 拖进弹层

选文件夹走系统那个文件夹窗口；大目录分块传，几十 MB 的模型也能直接选。zip 一次最多 32 MB。

## 加载中的样子

扫描、打包、安装、导入时，状态行换成转圈 + 计时（`打包… 12.4s`），下面走一条进度线；打包还没出结果时，卡片区先摆一张占位卡。

## 包格式

产出的包就是 Coo 的 figure pack：`figure.json` 描述形象，`figure.js` 导出 `createFigureBody`，
`models/` 放数据，`sdk/` 放 Live2D 运行时。

包里的 `figure.js` **不携带**渲染引擎，只调用宿主传进来的 `opts.kit.createBody`——和 Coo 自带的形象、
鲸鱼包、酒狐包用的是同一套公共 puppet 引擎。因此包只有几 MB，引擎升级跟着 Coo 走，不用重打包。

`workbench/vendor/coo-kit/` 里的 `body.js`、`rig.js` 只服务于工作台在浏览器里的单独预览，不进产物；
它们来自 Coopanion 的桌宠 World，许可为 AGPL-3.0-or-later，见 `NOTICE`。

## 封面与贴合

打包后会起一个临时本地服务，用系统里的 Chrome / Edge 无头打开渲染页：

```text
__l2dAutoFit()  → 量出取景，带着它重建一次包，写进 profile
__l2dCover()    → 512×512 主封面 + 128×128 选项小图
```

找不到浏览器、或设置里关掉了封面时，跳过这一步，打包照常成功，日志里写「封面跳过 · 原因」，卡片上标「封面 —」。

## 配置

三项高级设置都在 **设置 → Live2D 模型一键安装**：

```text
打包时拍封面          默认开。关掉就不启动无头浏览器，也不量尺寸
安装后删除打包产物     装完自动清掉那一份，省一半磁盘
安装目录（可留空）     留空 = Coo 自己的 figures
```

面板上只放模型目录和动作按钮，不重复这些开关；底部常显当前安装目标。

首次打开面板会显示「Live2D 核心组件」一栏：本扩展不附带 Core，点「同意并获取」后从 Live2D Inc. 的官方托管地址下载同一份文件并校验 SHA-256，就绪后这一栏变成绿色的「已校验」。想先读许可，点旁边的「Core 许可 / SDK 许可」。

## 开发

测试需要一份你自己的 Live2D 模型目录，通过环境变量给：

```powershell
$env:L2D_MODEL = 'D:\models\your_model'
node test/panel.mjs      # 扫描 / 打包 / 安装
node test/edit.mjs       # 编辑直接落盘
node test/nocover.mjs    # 关封面时的降级
node test/cover.mjs      # 单独跑封面
node test/api.mjs        # 安装后删除、备份
node test/import.mjs <打包产物的目录>   # zip 导入：解包 / 冲突 / 替换备份
```

没有设置 `L2D_MODEL` 时脚本直接跳过，不会碰你本机的模型。

## 路线

```text
已做     扫描 / 打包 / 安装、封面、自动贴合、卡片管理、编辑名字与调参
下一步   形象编辑（换部件、改配色）
未定     3D 导入
```

## 许可

本包以 AGPL-3.0-or-later 发布，完整文本见 `LICENSE`。

`workbench/` 里附带第三方组件，各自的边界与许可文本见 `NOTICE` 和 `workbench/pack/sdk/`：

- Live2D Cubism SDK for Web —— Live2D Open Software License
- Live2D Cubism Core —— Live2D Proprietary Software License（**不随包分发**，用户同意许可后从官方地址获取并校验 SHA-256）
- SoulLink Emotion Engine —— Apache-2.0
- Coopanion desktop-pet kit —— AGPL-3.0-or-later

Live2D 的 SDK / Core 不是 AGPL 代码，不因本项目的 AGPL 声明而改变许可。本包不包含任何 Live2D 模型、贴图或表情素材。

<p align="center">
  <img src="assets/icon.svg" alt="Coo" width="72" height="72" />
</p>

<h1 align="center">Live2D 模型一键安装</h1>

<p align="center">
  <strong>Live2D One-Click Install</strong><br />
  一份 Live2D 模型，几步装进 Coo。
</p>

<p align="center">
  Coo World 扩展 · 扫描与打包 · 封面与自动贴合 · SoulLink 连续表演
</p>

<p align="center">
  <a href="#安装">快速开始</a> ·
  <a href="#三步">使用流程</a> ·
  <a href="#soullink">SoulLink</a> ·
  <a href="#模型管理">模型管理</a> ·
  <a href="#配置">配置</a> ·
  <a href="#开发">开发</a> ·
  <a href="#许可">许可</a>
</p>

---

扫描、打包、安装一条线；打包后用卡片管理，还能修改名字、一句话和身体参数。

| 能力 | 说明 |
| --- | --- |
| **模型导入** | 读取含 `.model3.json` 的模型目录，也支持 zip 导入与拖拽 |
| **本地打包** | 生成 Coo figure pack，自动量取景、拍封面，再安装到 `figures/` |
| **卡片管理** | 编辑名称、简介与动作风格；安装同名形象时自动备份 |
| **连续表演** | 集成 SoulLink Emotion Engine，驱动连续情绪、表情与程序化微动 |

> **使用入口**：Coo 的 **高级模式 → Live2D 模型一键安装**。模型处理在本地完成，不经过对话；无需额外安装 Node 环境，也不用手动打开浏览器。首次使用需按提示获取 Live2D Cubism Core，详见[配置](#配置)。

## 安装

在 Coo 的扩展目录中安装：

```powershell
cd <Coo 安装目录>\data\extensions
npm install cortico-world-figure
```

装完重启 Coo，在扩展页确认状态为 `active`，然后去高级模式打开「Live2D 模型一键安装」。

## 三步

| 步骤 | 做什么 | 产出 |
| --- | --- | --- |
| **1 · 扫描** | 读取 `.model3.json`，报告参数、语义 role 与未映射通道 | 不生成文件 |
| **2 · 打包** | 拆图、生成 `figure.json` / `profile.js`，量尺寸、拍封面 | `data/figure/builds/<id>-<ts>/` |
| **3 · 安装** | 复制到 `figures/`，同名先备份，保留最近 2 份 | `figures/<id>/` |

三步各自触发，不会自动串跑。每份打包产物都会保留为一张卡片，可以安装、编辑或删除。

<a id="soullink"></a>

## SoulLink Emotion Engine：连续表演层

<p align="center">
  <a href="https://soullink.lynngnan.top">
    <img src="assets/soullink-emotion-banner.png" alt="SoulLink Emotion SDK — 连续情绪、表情与程序化动作" width="100%" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/nanlingyin/soullink-emotion-sdk"><strong>GitHub 仓库</strong></a> ·
  <a href="https://soullink.lynngnan.top"><strong>官方网站 / 在线体验</strong></a>
</p>

本扩展在生成的 Live2D figure pack 中集成了 [SoulLink Emotion SDK](https://github.com/nanlingyin/soullink-emotion-sdk) 的 **`@soullink-emotion/engine`**（随包版本 `0.2.0-beta.1`），作为角色的**连续情绪与程序化表演层**。

| 能力 | 在本项目中的作用 |
| --- | --- |
| **连续情绪与表情** | 将 Coo 的表情词映射到 VAD 预设，由 `SoullinkRuntime` 每帧更新情绪状态与 FACS/AU 参数；通用表情配方作为平滑叠加的风格层，减少固定表情之间的生硬切换 |
| **程序化细微动作** | 生成头部、身体、视线、呼吸与待机微动等表演信号，支持不同的动作风格与情绪反应配置 |
| **跨模型语义适配** | 经由 `profile.roles` 将引擎通道映射到模型实际 Cubism 参数；不存在的通道会跳过，非标准参数可能仍需人工校准 |
| **可配置与降级** | 通过 `profile.performance.tuning` 调整 `style`、`bodyGain`、`reactivity` 等参数；表演层加载失败或运行异常时，回退到离散表情配方 |

**与宿主的分工**：Coo Kit 继续负责行走、跑跳、坐下、拖拽与说话口型。本集成主动使用 `setLipSyncEnabled(false)`，避免双重口型驱动。当前未接入 SoulLink 的独立 LLM 情绪识别、TTS 或语音动作规划服务；这里使用的 Emotion Engine 为纯计算模块，无需额外的在线服务。

<details>
<summary><strong>查看数据流与实现位置</strong></summary>

| 阶段 | 输入与输出 |
| --- | --- |
| **Coo** | 提供 `happy`、`shy`、`sad` 等表情词 |
| **SoulLink Engine** | 连续更新 VAD 情绪状态，输出 FACS/AU 与 Idle 微动 |
| **本扩展适配层** | 将 FACS / 动作通道翻译为 `angleX`、`browY`、`mouthForm`、`eyeBallX` 等语义 role |
| **Live2D 渲染层** | 根据 `profile.roles` 将语义 role 映射到实际 Cubism 参数并渲染 |

- [SoulLink 表演层适配](workbench/pack/backends/soullink.js)：VAD 预设、FACS → role、强度与动作风格配置
- [Live2D 渲染接入](workbench/pack/backends/live2d.js)：逐帧调用、role → Cubism 参数及降级
- [模型转换脚本](workbench/tools/convert.mjs)：扫描 role、生成 `profile.performance`、随形象包复制引擎
- [随包 SoulLink 版本说明](workbench/pack/vendor/soullink/README.md)

</details>

SoulLink Emotion Engine 按 **Apache-2.0** 许可随包分发；上游仓库、版权及第三方许可边界见 [`NOTICE`](NOTICE) 与 [`workbench/NOTICE`](workbench/NOTICE)。

## 模型管理

### 打包卡片

每张卡片展示封面、名称、文件大小、打包时间与贴合状态。

| 操作 | 行为 |
| --- | --- |
| **安装** | 将当前打包产物复制到 `figures/` |
| **编辑** | 修改名称、一句话、身体幅度与动作风格；无需重新打包，直接更新 `figure.json` 和 `profile.js`，1 秒内生效 |
| **删除** | 只删除当前打包产物，已安装的形象不受影响 |

> 编辑已安装的形象后，需要再点一次「安装」，才会同步到安装目录。

「清空旧打包」会保留最新一份，删除其余打包目录，操作前会再次确认。列表会自动清理目录已不存在的记录。

### 导入模型包

点击「导入」，或将 zip 拖进弹层：

| 导入内容 | 处理方式 |
| --- | --- |
| **Live2D 模型目录**，含 `.model3.json` | 先打包并加入「已打包」列表，改名、调参后再安装 |
| **模型 zip** | 解包后进行打包 |
| **已打包的 zip**，含 `figure.json` | 直接安装 |

文件夹通过系统目录选择窗口打开，大目录分块传输，支持几十 MB 的模型；**zip 单次上限为 32 MB**。

### 加载反馈

扫描、打包、安装和导入时，状态行会显示旋转指示与计时（如 `打包… 12.4s`），下方显示进度线。打包尚未出结果时，卡片区会先显示占位卡。

## 封面与贴合

打包后会启动临时本地服务，通过系统中的 Chrome / Edge 无头渲染：

| 处理 | 结果 |
| --- | --- |
| `__l2dAutoFit()` | 测量取景，按结果重建一次包，并写入 profile |
| `__l2dCover()` | 生成 512 × 512 主封面与 128 × 128 选项小图 |

找不到浏览器，或设置中关闭封面时，会跳过这一步，打包仍可成功。日志显示「封面跳过 · 原因」，卡片标记为「封面 —」。

## 包格式

产出采用 Coo 的 figure pack 格式：

| 文件 / 目录 | 用途 |
| --- | --- |
| `figure.json` | 描述形象 |
| `figure.js` | 导出 `createFigureBody`，调用宿主的 `opts.kit.createBody` |
| `models/` | 存放模型数据与 profile |
| `sdk/` | 存放 Live2D 运行时 |

包里的 `figure.js` **不携带渲染引擎**，与 Coo 自带形象、鲸鱼包、酒狐包使用同一套公共 puppet 引擎。因此包只有几 MB，引擎升级跟随 Coo，无需重新打包。

`workbench/vendor/coo-kit/` 中的 `body.js`、`rig.js` 仅供工作台在浏览器中独立预览，不进入产物。它们来自 Coopanion 的桌宠 World，许可为 AGPL-3.0-or-later，见 [`NOTICE`](NOTICE)。

## 配置

三项高级设置位于 **设置 → Live2D 模型一键安装**：

| 设置 | 说明 |
| --- | --- |
| **打包时拍封面** | 默认开启；关闭后不启动无头浏览器，也不测量尺寸 |
| **安装后删除打包产物** | 安装完成后自动清理对应打包产物，节省磁盘空间 |
| **安装目录** | 可留空，默认使用 Coo 自己的 `figures/` |

面板只保留模型目录与操作按钮，不重复这些设置；底部常显当前安装目标。

首次打开面板会显示「Live2D 核心组件」一栏。**本扩展不附带 Cubism Core**：点击「同意并获取」后，从 Live2D Inc. 官方托管地址下载并校验 SHA-256，就绪后显示绿色「已校验」。可通过旁边的「Core 许可 / SDK 许可」先阅读许可。

## 开发

测试需要一份你自己的 Live2D 模型目录，通过环境变量指定：

```powershell
$env:L2D_MODEL = 'D:\models\your_model'
node test/panel.mjs      # 扫描 / 打包 / 安装
node test/edit.mjs       # 编辑直接落盘
node test/nocover.mjs    # 关封面时的降级
node test/cover.mjs      # 单独跑封面
node test/api.mjs        # 安装后删除、备份
node test/import.mjs <打包产物的目录>   # zip 导入：解包 / 冲突 / 替换备份
```

未设置 `L2D_MODEL` 时，脚本会直接跳过，不会操作本机模型。

## 路线

| 状态 | 内容 |
| --- | --- |
| **已完成** | 扫描、打包、安装、封面、自动贴合、卡片管理、编辑名称与调参 |
| **下一步** | 形象编辑：更换部件、调整配色 |
| **未定** | 3D 导入 |

## 许可

本包以 **AGPL-3.0-or-later** 发布，完整文本见 [`LICENSE`](LICENSE)。

`workbench/` 附带第三方组件，各自的边界与许可文本见 [`NOTICE`](NOTICE)、[`workbench/NOTICE`](workbench/NOTICE) 和 [`workbench/pack/sdk/`](workbench/pack/sdk/)：

| 组件 | 许可 |
| --- | --- |
| Live2D Cubism SDK for Web | Live2D Open Software License |
| Live2D Cubism Core | Live2D Proprietary Software License；**不随本包分发**，用户同意许可后从官方地址获取并校验 SHA-256 |
| SoulLink Emotion Engine | Apache-2.0 |
| Coopanion desktop-pet kit | AGPL-3.0-or-later |

Live2D 的 SDK / Core 不是 AGPL 代码，不因本项目的 AGPL 声明而改变许可。本包不包含任何 Live2D 模型、贴图或表情素材。

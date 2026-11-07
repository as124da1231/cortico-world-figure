# Live2D 转换工具与运行时

本目录是「Live2D 模型一键安装」扩展内置的模型转换、渲染和预览代码。日常使用从 Coo 扩展面板完成，无需单独启动工作台。

## 目录

| 路径 | 用途 |
|---|---|
| `tools/convert.mjs` | 读取模型，生成 Coo 形象包 |
| `tools/parameter-mapping.mjs` | 通用参数、VTS 配置与物理链识别 |
| `tools/shrink-textures.mjs` | 打包时按画质缩放超限 PNG |
| `tools/workbench/` | 独立开发预览资源 |
| `pack/` | 复制进形象包的入口、Live2D 后端及第三方运行组件 |
| `vendor/coo-kit/` | 独立预览使用的宿主组件副本，不复制进形象包 |

## 开发调用

在项目根目录运行，需要 Node.js 22 或更新版本。只扫描模型并输出适配结果：

```powershell
node workbench/tools/convert.mjs --model 'D:\models\example' --dry-run --json
```

生成形象包时，指定已同意许可、校验过的 Cubism Core：

```powershell
node workbench/tools/convert.mjs --model 'D:\models\example' --core 'D:\Coo-data\figure\sdk\live2dcubismcore.min.js' --out 'D:\builds\example'
```

输出目录非空时默认拒绝覆盖。开发者确定需要替换时才使用 `--force`。面板还会执行自动取景、封面生成、安装与记录保存，单独调用转换器不会替代这些步骤。

## 自动适配

转换器沿用通用动作与表情配方，识别标准参数及可确认的别名；结合对应的 VTS 配置和物理输入输出关系，避免驱动被物理系统覆盖的输出参数。循环、混合或方向不明确的关系不强行映射，结果写入适配说明。

默认转换使用通用表演。扩展的 AI 适配方案可以通过 overrides.native 把经过验证的原生 exp3、motion 和语义映射写入 profile，由 native-actions.js 播放；不直接启用整套 pose3。模型未制作的能力无法自动补出，未确认的通道继续使用通用表现。

运行时按实际裁剪遮罩数量分配缓冲；分配失败会自动尝试兼容模式，仍失败时明确报错。表演组件异常时回退到通用离散表情，保留可用的基础效果。

## 产物与许可

形象包包含 `figure.json`、`figure.js`、`models/`、`backends/` 和 `sdk/`。公共 puppet 引擎由 Coo 通过 `opts.kit` 提供，原生 `.moc3` 读取保留旧宿主的 Base64 回退。

扩展不附带 Cubism Core 二进制。用户从官方获取并校验后，打包会将 Core 复制进形象包，因此生成包仅供本机使用，请勿上传、分享或再次分发。模型素材与第三方组件分别遵循原许可，见 `NOTICE`、`pack/sdk/` 与 `pack/vendor/soullink/LICENSE`。

# 开发与验证

## 项目结构

| 目录 | 负责内容 |
| --- | --- |
| `src/` | Cortico World、导入与安装、模型适配、编排及语音服务 |
| `src/webui/` | 扩展面板、动作装扮编辑器与本机预览 |
| `workbench/` | 模型转换、形象运行代码及预览所需的第三方组件 |
| `dist/` | 由构建生成的浏览器产物 |
| `test/` | 导入、打包、面板、动作与语音回归 |

`npm run build:ui` 生成带内容摘要的界面文件名并更新 `package.json`。改动 UI 源码后重新构建，提交源码和对应产物。

## 本地验证

安装 Node.js 22 或更新版本。在仓库根目录运行 `npm ci`、`npm run build:ui`、`npm run check` 和 `npm test`。

常规回归可以在未安装 Coo 的环境中运行。真实模型集成测试需要自己的模型和已校验的 Live2D 缓存。`L2D_CORE` 指向 Core 文件，同目录需包含 `framework.js` 和 `shaders.js`。

```powershell
$env:L2D_MODEL = 'D:\models\your_model'
$env:L2D_CORE = 'D:\Coo-data\figure\sdk\live2dcubismcore.min.js'
npm test
```

## 扩展契约与验包

从目标版本的 Cortico 源码检出目录运行官方命令。

```powershell
pnpm describe:extension <Figure目录>
pnpm check:extension <Figure目录>
```

`describe.json` 记录工具、事件与提示词模板，随代码提交。用 `npm pack` 生成安装包并检查清单，确认包含运行入口、界面资源、依赖声明、自描述与许可证。Live2D 运行文件、模型素材、用户配置和本机数据留在本机。用 Coo 重启后的实际界面验证发布包。

[Cortico 扩展契约](https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/extensions.md) · [市场标签](https://github.com/Pal-AI-Lab/cortico-extensions/blob/main/TAGS.md) · [GitHub 发行页](https://github.com/as124da1231/cortico-world-figure/releases)

## 本机文件

扩展数据中的 `figure/builds/` 管理卡片产物，`figure/sdk/` 保存已获取的 Live2D 组件，`figure/state.json` 保存卡片记录和确认。自动化方案记录在 `figure/automation.json`。已安装形象和替换备份分别由 `figures/` 和 `figure-backups/` 管理。

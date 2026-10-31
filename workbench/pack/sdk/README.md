# Live2D Cubism 运行时（随包）

这个目录**包含**预览和运行所需的 Cubism 运行时，不属于 AGPL：

- `live2dcubismcore.min.js` — Cubism Core
  - **不随扩展分发**。首次使用前由扩展在你同意 Live2D 许可后，从 Live2D Inc. 的官方托管地址下载，校验 SHA-256 后落在本地缓存（`<工作目录>/sdk/`），打包时再拷进每个形象包。
  - 官方下载页：<https://www.live2d.com/en/sdk/download/web/>（「Cubism Core for Web — for hosting use」）
  - 许可：Live2D Proprietary Software License，完整文本见本目录 `LICENSE-live2d-core.txt`
- `framework.js`、`shaders.js` — Live2D Cubism SDK for Web 的预构建 / 内联着色器
  - Live2D Open Software License
  - 完整文本：本目录 `LICENSE-live2d-components.txt`

使用、复制、分发这些文件时，必须同时遵守 Live2D Inc. 的许可。完整第三方说明见根目录 `NOTICE`。
Core 的版本与完整性由扩展校验，不应以其他 SDK 文件直接覆盖缓存。

## 沙箱约束（Coo 侧）

```
sandbox allow-scripts; default-src 'none'; script-src 'self';
img-src 'self' data: blob:; style-src 'unsafe-inline'; connect-src 'none'
```

- `connect-src` 现在会按包放开到 `/packs/<id>/`（Coopanion 0.2.14+），moc3 可以原生 `fetch`
- 贴图可以正常 `loadImage`：figure-frame 响应带 `Access-Control-Allow-Origin: null`
- `script-src` 没有 `'wasm-unsafe-eval'` → **WASM 被禁**；Cubism Core 必须是纯 JS 版本（官方托管的那份带 asm.js 回退）

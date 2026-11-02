# 第三方组件与动作素材

运行库为 Three.js 0.180.0、@pixiv/three-vrm 3.4.2、@pixiv/three-vrm-animation 3.4.2，均按其 MIT 许可使用。
安装包内的原许可证保留；构建会把完整文本汇入 `.local/THIRD_PARTY_LICENSES.txt`，页面「关于预览」可查看。

`assets/animations/overte/` 中仅引入以下三段待机数据，未引入 Hanami 的聊天、数据存储、场景或行为代码：

| 文件 | 原始 Overte 素材 | Hanami 转换范围 |
| --- | --- | --- |
| idle.vrma | idle.fbx | 完整 10 秒 |
| idle-2.vrma | idle04.fbx | 0.033–30.067 秒 |
| idle-3.vrma | idle03.fbx | 4.833–18.167 秒子循环 |

原素材版权：High Fidelity, Inc.（2013–2019）、Vircadia contributors（2019–2021）、Overte e.V.（2022–2026）。
上游将以上 Overte 派生动画列为 Apache-2.0。Hanami 完成了骨架重定向、剪辑和重采样；本项目按原字节复制，
未对文件内容再加工。详细转换、来源与完整上游声明保存在 `UPSTREAM-NOTICE.md`；
Apache-2.0 全文、Hanami 根许可证和逐文件摘要一并保留在同目录。

固定来源提交：`Undi95/Hanami@5cf4afaac1ad8499d0890101a7c93762bf1dc8b0`。
来源 URL、Git blob SHA-1 和本地 SHA-256 见 `sources.json`，测试会验证摘要及动画不含外部缓冲或图像链接。

本项目原创的手势、备用待机曲线及互动规则位于 `src/clips.mjs`、`src/behavior.mjs`。
用户 VRM 模型不随本试验台分发，仍受各自素材许可约束。

# 第三方组件与动作素材

运行库为 Three.js 0.180.0、@pixiv/three-vrm 3.4.2、@pixiv/three-vrm-animation 3.4.2，均按其 MIT 许可使用。
安装包内的原许可证保留；构建会把完整文本汇入 `.local/THIRD_PARTY_LICENSES.txt`，页面「关于预览」可查看。

`assets/animations/overte/` 引入以下动画数据，未引入 Hanami 的聊天、数据存储、场景或行为代码：

| 文件 | 原始 Overte 素材 | Hanami 转换范围 |
| --- | --- | --- |
| idle.vrma | idle.fbx | 完整 10 秒 |
| idle-2.vrma | idle04.fbx | 0.033–30.067 秒 |
| idle-3.vrma | idle03.fbx | 4.833–18.167 秒子循环 |
| idle-talking.vrma | talk_armsdown.fbx | 0.033–7.133 秒 |
| think.vrma | idle_once_lookaround.fbx | 第一个环顾片段，3.37 秒 |
| world-walk-start.vrma | idle_to_walk.fbx | 0.40 秒 |
| world-walk-slow.vrma | walk_short_fwd.fbx | 1.30 秒循环，当前采用 |
| world-walk-stop-small.vrma | settle_to_idle_small.fbx | 1.27 秒，当前采用 |
| world-turn-left.vrma / world-turn-right.vrma | turn_left.fbx / turn_right.fbx | 1.10 / 1.00 秒 |
| world-walk.vrma / world-walk-stop.vrma | walk_fwd.fbx / settle_to_idle.fbx | 1.00 / 1.90 秒；对比后保留数据，不在运行时加载 |

原素材版权：High Fidelity, Inc.（2013–2019）、Vircadia contributors（2019–2021）、Overte e.V.（2022–2026）。
上游将以上 Overte 派生动画列为 Apache-2.0。Hanami 完成了骨架重定向、剪辑和重采样；本项目按原字节复制，
未对文件内容再加工。详细转换、来源与完整上游声明保存在 `UPSTREAM-NOTICE.md`；
Apache-2.0 全文、Hanami 根许可证和逐文件摘要一并保留在同目录。

固定来源提交：`Undi95/Hanami@5cf4afaac1ad8499d0890101a7c93762bf1dc8b0`。
来源 URL、Git blob SHA-1 和本地 SHA-256 见 `sources.json`，测试会验证摘要及动画不含外部缓冲或图像链接。

本项目原创的手势、备用待机曲线及互动规则位于 `src/clips.mjs`、`src/behavior.mjs`。
用户 VRM 模型不随本试验台分发，仍受各自素材许可约束。

## Quaternius Standard 动作

`assets/animations/quaternius/` 来自作者官方免费 Standard v3.0，共 43 段源动画，本轮选取 12 段。完整版本宣传的 120 多段不属于免费包。
官方入口：https://quaternius.itch.io/universal-animation-library 。按 CC0-1.0 使用，作者原始 License、README 与完整 CC0 文本随目录保存。
`tools/convert-quaternius.mjs` 对固定摘要的 T-pose／原地／根位移版进行离线转换，保留原作者动画，去除网格和皮肤，生成 VRMA，另记录原始根位移距离曲线。
逐文件摘要、源 GLB／压缩包摘要及修改范围见 `sources.json`。没有使用在线动作生成服务。

## 独立成品控制器参考

`controller-demo/` 为 norio/vrm-game-starter 固定提交的本机副本，代码 MIT，包含 BVHEcctrl（Erdong Chen）及其版权声明。
保留原 LICENSE、README 与 UPSTREAM.json；未包含上游两个模型和截图。
其 AnimationLibrary.glb 为上游由 Quaternius 动作制作的现成库，按 CC0；与上面的 12 段自行转换 VRMA 分开使用。
控制器直接复用，不参与 Live2D 扩展构建，运行依赖与父试验台分开。公开运行许可文本保存在 `controller-demo/public/THIRD-PARTY-LICENSES.txt`。
本机接入改动与验证边界见 `controller-demo/LOCAL.md`。

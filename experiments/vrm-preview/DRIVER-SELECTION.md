# 驱动方案比较与本轮采用范围

2026-11-02，按用户“哪里有问题搜哪里、比较多个参考”的要求，围绕动作质量、坐标、混合和接地核查。
以下结论基于对应提交的实际代码及许可；没有运行整个参考项目，不把 README 的效果描述当作实机验证。

| 参考 | 实际可用部分 | 本轮决定 |
| --- | --- | --- |
| pixiv three-vrm-animation 3.4.2 | VRMA 导入、标准人形轨道、VRM 0/1 四元数转换、按髋部高度缩放位移；MIT | 接为正式运行层，现成待机与自有手势均通过它映射 |
| Hanami / Overte | 已转为 VRMA 的待机库；另有 gaze、jointLimits、legIk 等场景代码 | 选取三个许可明确的待机文件；场景代码仅作参考，不整体复制 |
| pixiv ChatVRM | MIT 的表情、自动眨眼、注视及早期 VRMA 示例 | 参考职责分离；仓库已归档，采用当前官方动画包替代其旧自带解析器 |
| Amica | MIT 的角色动画、音频与交互示例；有 Mixamo 重定向 helper | 不接入整个应用。所查 helper 的 hipsPositionScale 为 0，不能原样作为通用位移适配 |
| Fano VRM Controller 0.0.4 | 可独立使用的面部、Mixamo 与程序动画封装 | 留作候选；peer 依赖要求 three ^0.184.0、three-vrm ^3.5.4，与当前固定依赖不同；许可为 Apache 基础加署名条款，不能标成纯 Apache-2.0 |

## 具体卡点怎样处理

- 动作缺少身体配合：引入 Overte 的 `idle.fbx`、`idle04.fbx`、`idle03.fbx` 经 Hanami 转换的 VRMA，实际套到本机模型测试。
- VRM 0.x 鞠躬方向错误：官方源码在目标为 0.x 时翻转四元数的 x/z 分量，并转换位移的 x/z。自有配方先统一到 VRMA 标准坐标，再交给官方映射。
- 幅度高时抬手越界：去掉对整个动画骨架偏离参考姿态的统一放大，只调叠加手势权重，保留原待机姿态。
- 固定轨道被注视逐帧累加：按 Three.js PropertyMixer 的缓存行为保存纯动画输出，下一帧先恢复，再施加注视和 IK。
- 互动规则：保留自己的小型调度层，负责注意力停留、冷却、手动优先和渐变；动画运行层和素材复用上游能力。
- 地面接触：本轮保留站立双腿 IK，实际检查标准骨架和渲染骨架；不扩大为完整行走、地形或物理人体模拟。

## 固定来源

- [官方 3.4.2 轨道映射](https://github.com/pixiv/three-vrm/blob/v3.4.2/packages/three-vrm-animation/src/createVRMAnimationClip.ts)
- [Hanami 动作来源与修改声明](https://github.com/Undi95/Hanami/blob/5cf4afaac1ad8499d0890101a7c93762bf1dc8b0/vrma/NOTICE.md)
- [Hanami 关节约束参考](https://github.com/Undi95/Hanami/blob/5cf4afaac1ad8499d0890101a7c93762bf1dc8b0/client/src/scene/jointLimits.ts)
- [Overte 原始许可](https://github.com/overte-org/overte/blob/master/LICENSE)
- [ChatVRM 动画示例](https://github.com/pixiv/ChatVRM/blob/b542aa00e19dccf9fc48ba340cf7eee011d2329a/src/features/vrmViewer/model.ts)
- [Amica 所查 Mixamo helper](https://github.com/semperai/amica/blob/ca2415c77d20ec41dd4fcf917dbb0e97961ddf08/src/lib/VRMAnimation/loadMixamoAnimation.ts)
- [Fano 依赖声明](https://github.com/Fano1/fano-vrm-controller/blob/cd4e52a2892a0921c4822325cc429aeea8439dad/package.json)、[许可](https://github.com/Fano1/fano-vrm-controller/blob/cd4e52a2892a0921c4822325cc429aeea8439dad/LICENSE)

该选择不意味“任意模型立即达到同样自然程度”。本轮最终结果以独立预览的录屏和验证记录为准；
VRM 1.0 完整模型、复杂服装碰撞、长时间运行和 Coo 形象沙箱仍需要各自验证。

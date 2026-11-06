# 性能依据与许可记录

核对日期：2026 年 11 月 3 日。下列性能为论文或作者报告，本轮没有在用户设备上运行这些框架。代码可访问、示例存在和满足目标实时预算是不同证据。

## 性能与配置

| 来源 | 可核对的信息 | 使用条件 |
| --- | --- | --- |
| [2013 肌肉双足全文实验段](https://www.cs.ubc.ca/~van/papers/2013-TOG-MuscleBasedBipeds/2013-TOG-MuscleBasedBipeds.pdf) | 物理步长 0.0003 秒；优化约 2 至 12 小时；优化后控制器可实时驱动 | 论文指定模板与任务；“标准 PC”不是当前统一硬件基准 |
| [FreeMusco 实验段](https://arxiv.org/html/2511.14205v1) | 控制 33Hz，每次控制对应 15 个物理子步；训练使用 RTX 4070 与 Ryzen 7 7800X3D 的四个核心 | 训练约一天、高层策略另训约半小时是该实验配置；不能当作浏览器帧时间 |
| [VRM 单肘关节 NMSS](https://pmc.ncbi.nlm.nih.gov/articles/PMC13310907/) | 关节数据更新 100Hz，头显显示 90Hz | 单自由度、真人肌电输入、LabVIEW 与 Unity 链路 |
| [官方 MuJoCo WASM](https://github.com/google-deepmind/mujoco/blob/main/wasm/README.md) | canonical JS/TS 绑定、单线程和多线程构建 | 多线程要求 SharedArrayBuffer 与跨源隔离；绑定有 WIP 和平台说明 |
| [mjswan](https://github.com/ttktjmt/mjswan) 与 [任务集](https://github.com/ttktjmt/mjswan_playground) | 作者列出客户端物理与策略闭环，包含 354 肌肉示例 | 示例列举不提供本机 P95 帧时间；资源、浏览器与硬件需固定 |
| [Hyfydy](https://hyfydy.com/) | 厂商报告相对 OpenSim 的约 100 倍性能比较 | 受模型、精度和比较配置约束；不能跨引擎直接套用倍率 |
| [MPC squared](https://lnsgroup.cc/research/MPC2) | 报告无需训练的近实时高维控制 | 在线规划仍有成本；要核对规划频率、模型与线程 |
| [Muscle SuperMimic](https://github.com/kaibohex/muscle-supermimic) | 提供多模型与训练、策略运行入口 | GPU 批量训练吞吐不能换算成单实例 CPU 推理延迟 |

### 必须分别计量的成本

1. 身体结构和参数的离线搜索。
2. 控制策略的训练与数据生成。
3. 在线任务规划。
4. 每次策略推理。
5. 每个物理子步的肌肉求值、动力学和接触求解。
6. 骨骼映射、二次运动和渲染。

60fps 对应约 16.67ms 的显示帧间隔，这是整个显示流程的预算，不是自动分配给神经肌肉求解的时间。控制可以低于或高于显示频率；物理子步也不必等于显示帧，但总吞吐、调度延迟和插值误差仍需满足目标。

### 建议的复现账目

每份结果记录代码提交、模型摘要、独立自由度、执行器和动态状态数量、物理步长、每控制步子步数、接触设置、控制辅助力、策略结构、硬件、线程、后端、热身时间和采样时长。至少报告实时因子、P50/P95/P99、内存、失败率；训练成本独立列出。

## 模型配置差异

[MuscleMimic 2026 论文摘要](https://arxiv.org/abs/2603.25544)给出的上身和全身配置为 126 与 416 肌肉；当前[浏览器任务清单](https://github.com/ttktjmt/mjswan_playground)使用 354 肌肉 MyoFullBody。必须保留版本与模型变体，不能把两个数字合并为一个固定规格。

MS-Human-700 的解剖节点和关节数量、独立动力学自由度、耦合关节及受约束自由度分别记录。完整模型、运动模型和操作模型也有不同结构。[Menagerie 模型目录](https://github.com/google-deepmind/mujoco_menagerie/tree/main/ms_human_700)

## 许可分层

| 资源 | 本轮取得的许可依据 | 复用前继续核对 |
| --- | --- | --- |
| [MyoSuite](https://raw.githubusercontent.com/MyoHub/myosuite/main/LICENSE) | 已读根 Apache-2.0 文本 | 模型、数据、权重与外部依赖 |
| [MyoSim](https://raw.githubusercontent.com/MyoHub/myo_sim/main/LICENSE) | 已读根 Apache-2.0 文本 | 来源模型与网格逐项声明 |
| [MyoGen](https://github.com/NsquaredLab/MyoGen/blob/main/LICENSE.md) | 仓库与 README 声明 AGPL-3.0 | 具体文件与集成方式；不等同宽松许可 |
| [FreeMusco](https://raw.githubusercontent.com/palkan21/FreeMusco/main/LICENSE) | 已读 BSD-3-Clause；声明继承 Control-VAE 来源 | 模型、依赖和示例资源 |
| [MASS](https://github.com/lsw9021/MASS) | 仓库标识 Apache-2.0 | 每项模型与动作资源 |
| [MuscleVAE](https://github.com/wangchek/MuscleVAE_) | 算法仓库许可本轮未明确；网站许可只覆盖网站内容 | 源码、二进制、权重与数据；未明确时先作为阅读参考 |
| [MuscleMimic](https://github.com/amathislab/musclemimic) | 代码仓库 Apache-2.0 标识 | 模型 NOTICE、非商业来源与训练数据 |
| [Muscle SuperMimic](https://github.com/kaibohex/muscle-supermimic) | README/NOTICE 记录代码与第三方来源 | AMASS/KIT 数据、模型包与权重条款 |
| [MS-Human-700 Menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/main/ms_human_700) | 目录 README 声明 Apache-2.0 | 指定提交的模型与资产目录 |
| [mjswan](https://github.com/ttktjmt/mjswan) | README 声明 Apache-2.0 | 应用导入的模型、策略与动作 |
| [mjswan playground](https://github.com/ttktjmt/mjswan_playground) | 应用 Apache-2.0，明确上游资产分别许可 | 每个任务的具体资产 |
| [OpenSim Core](https://github.com/opensim-org/opensim-core) | 仓库标识 Apache-2.0 | 模型包和实验数据 |
| [SCONE](https://scone.software/) 与 [Hyfydy](https://hyfydy.com/) | SCONE 为开源研究工具；Hyfydy 是单独授权引擎 | 精确版本、后端条款和模型 |
| [AMASS](https://amass.is.tue.mpg.de/license.html) | 已读自定义非商业研究等用途许可 | 商业训练、再分发与具体用途授权 |
| [LAFAN1](https://github.com/ubisoft/ubisoft-laforge-animation-dataset) | README 声明 CC BY-NC-ND 4.0 | 转换、改编、分发与最终用途 |
| [AddBiomechanics](https://www.addbiomechanics.org/faq.html) | FAQ 说明数据包各带 LICENSE 与贡献者信息 | 每份数据包，不能只看平台名称 |

读取论文、借鉴思想、自行实现方法、复制代码、使用人体模型、训练数据、分发权重和分发素材分别处理。网站页面的 CC 许可不自动覆盖作者算法仓库；根仓库的宽松许可也不自动覆盖所有上游资源。

本轮只保存链接和自行整理的阅读笔记，没有将第三方模型、动作、权重或全文复制进项目。


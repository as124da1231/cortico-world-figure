# VRM 特化神经肌肉机制笔记

以下把来源支持的机制与项目设计推论分开。公式是用于明确研究变量的通用表达，并非已经确定的新项目实现。

## 标准身体与物理身体

VRM humanoid 描述身体部位对应到哪些节点。VRM Animation 约束可交换的姿态动画；three-vrm normalized humanoid 是运行时用于姿态兼容的一层。三者应分别定义和测试，避免将库的便利接口当作文件包含了完整生理模型。[S01](SOURCES.md#s01-vrm-10-humanoid)、[S02](SOURCES.md#s02-vrm-animation-10)、[S07 原文](https://pixiv.github.io/three-vrm/docs/classes/three-vrm-core.VRMHumanoid.html)

55 个标准语义位置包含可选节点，不能要求每份 VRM 都有完整集合。标准不提供 upperArmTwist 或 upperLegTwist 人形节点；额外辅助骨可以存在。没有辅助扭转骨仍能表达骨段轴向旋转，但扭转沿网格的分布受骨架和蒙皮影响。

VRMA 禁止非 hips 的平移动画和人形骨骼缩放；它不能用来证明底层 glTF 节点没有平移能力。项目可明确约定固定骨长、关节旋转与根位移作为核心身体接口。[VRMA 原文](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md)

## 神经肌肉闭环的候选变量

一种用于研究的状态分解为：

- q：身体广义位置，包含根姿态和关节旋转。
- v：对应的速度；四元数存储维数与独立旋转自由度区分。
- a：驱动单元的激活状态。
- z：必要的局部反馈记忆、协调状态或策略记忆。
- c：接触模式及其相关状态。

高层目标 g 经过协调器产生激励 u；执行器由 u、a、长度及速度产生力 f。关节力矩通过姿态相关的力臂映射 R 得到。可用下面的形式讨论：

    da/dt = activation(u, a)
    f = force(a, length(q), lengthRate(q, v))
    tau_active = R(q) f
    M(q) dv/dt + h(q,v)
      = tau_active + tau_passive + J_contact(q)^T lambda + tau_external

M 是惯性矩阵，h 包含相应约定下的重力与运动项，lambda 是接触力。该表达来自一般多体与执行器建模思路；具体接触求解、激活模型和积分器还未选择。[MuJoCo 执行器与动力学](https://mujoco.readthedocs.io/en/stable/computation/index.html)

设计推论：神经部分可以是反馈网络、节律系统、优化器或学习到的策略。需要按功能定义它，不能仅用“神经网络”或“仿脑”的名称决定结构。

## 肌肉几何与可控能力

拉力驱动单元通常只能沿一个方向发力。某一姿态下，力臂矩阵有足够秩，不等于在非负激活、最大力量和长度范围约束下，已经能产生任务需要的所有力矩。必须检查实际可达的力矩集合、工作空间和奇异姿态。

若执行器来自虚拟长度函数 l(q)，力臂应与长度对姿态的导数保持一致，符号取决于力方向定义。这使机械功、驱动力与几何关系相容。任意独立拟合长度和力臂，可能破坏这种一致性。NMSM 的几何代理教程是可用的参考入口。[NMSM 几何代理](https://nmsm.rice.edu/guides-and-publications/tutorials/beginner-tutorials/surrogate-tutorial/)

2013 年的肌肉双足工作从近似模板出发，优化路径与属性；2021 年的重定向工作关注跨体型保持功能及驱动力方向。由此可研究：我们需要怎样的模板，以及哪些连接可以生成、合并或删减。[2013 全文](https://www.cs.ubc.ca/~van/papers/2013-TOG-MuscleBasedBipeds/2013-TOG-MuscleBasedBipeds.pdf)、[2021 全文](https://mrl.snu.ac.kr/research/ProjectFunctionalityDriven/Functionality_Driven_Musculature_Retargeting.pdf)

## 三种不同的简化

| 简化对象 | 可能方法 | 保留的成本与风险 |
| --- | --- | --- |
| 策略动作空间 | SAR、DynSyn、VAE 潜变量 | 可仍有原来的全部肌肉与激活状态；过强约束可能限制独立动作 |
| 肌肉几何计算 | 多项式或其他代理模型 | 状态数可能不变；超出采样区间的误差需要评估 |
| 身体状态和结构 | 合并执行器、简化肌腱、删除无用状态 | 会改变受力、记忆和扰动响应；需要新的等价标准 |

“少量潜变量控制很多肌肉”与“少量人工肌肉构成完整身体”是不同研究问题。对于我们的项目，应分别记录输出控制维数、执行器数、动态状态数和每步计算成本。

非线性最小实现与平衡降阶给出了可控、可观的理论方向；接触切换、姿态流形、非负驱动力与局部稳定假设使其不能直接成为现成的最小身体定理。[非线性最小实现摘要](https://www.sciencedirect.com/science/article/abs/pii/S0005109818302498)、[非线性平衡降阶](https://www.hahnresearchgroup.com/publications/journals/balancing-approach-minimal-realization-and-model-reduction-stable-nonlinear)

## 保留内部状态的判据

同一 q 可以对应不同 v、激活和反馈记忆。即使 q 与 v 相同，内部激活或刚度不同也可能在接触或扰动之后产生不同轨迹。因此不能按当前姿态相同，就删除内部状态。

项目可定义一个有边界的保留标准：在指定任务、扰动、观察时域和误差容限下，合并状态是否仍保留目标行为。这是待建立的方法，不是来源已经证明的 VRM 特化结论。

## 反射与全身协调

肌肉反射模型提供局部稳定和感觉反馈的构造方式；最优反馈控制提供按任务重要性处理冗余的思路；CPG 提供周期与相位组织方式。[反射模型](https://dspace.mit.edu/entities/publication/3cf5a6e6-f2af-4d9a-8f8b-65e16c0cd55f)、[最小干预原则](https://papers.neurips.cc/paper_files/paper/2002/hash/8c5f6ecd29a0eb234459190ca51c16dd-Abstract.html)

设计时需要明确：局部反射何时响应、全身协调何时修改目标、多任务如何竞争同一驱动能力，以及怎样避免迟延和高增益导致振荡。这些机制可分层运行，但所有层都必须观察同一个身体状态。

## 接触与根部运动

身体内部驱动力不能任意改变整体质心运动。若要求真实的自由根动力学，起步、站立与行走依赖外部接触力和相应约束。为根部额外施加控制力的方案需要记录辅助强度，否则容易将人为稳定误当身体能力。

固定根上肢实验、准静态支撑修正、自由根整身动力学是不同设置。性能和稳定性比较必须在同一设置下进行。

## 运动能力与表面形变

骨骼旋转足以承载丰富的时序、协调与交互响应；肌肉隆起和细致软组织形变需要额外表现通道。PhysRig 提供了体积软体与物理蒙皮方向的入口，但这会改变运行成本和素材要求。[PhysRig](https://physrig.github.io/)

先明确核心身体覆盖哪些表现通道，再决定额外骨、表情、弹簧骨和可选形变扩展怎样参与。对缺少通道的模型，应定义能力退化方式。

## 实时架构的研究边界

训练、身体参数优化、在线规划、策略推理、物理子步和渲染是六种不同成本。FreeMusco 的控制与物理子步频率也不同；官方 WASM 具有单线程与多线程的不同环境要求。

新的实时目标应给出实际设备、身体配置、控制频率、物理步长、接触数量、策略大小和帧时间分位数。当前资料提供实现入口和作者报告，没有替代目标配置的测量。


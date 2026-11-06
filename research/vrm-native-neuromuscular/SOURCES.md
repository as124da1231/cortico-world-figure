# VRM 特化神经肌肉系统来源卡片

核对日期：2026 年 11 月 3 日（Asia/Shanghai）。共 72 条来源记录。论文与其代码、全文等入口合并在同一卡片；规范、文档、数据集和仓库也是独立资料条目，因此条目数不等于论文数。

每条的“已阅读范围”按实际取得内容记录。P0 表示与核心设计直接相关；P1 为补充；P2 为待核验邻近线索。性能与许可说明保留适用范围。研究推论与设计问题见主报告和问题清单。

## VRM 标准与实现

### S01 VRM 1.0 Humanoid

- 年份：2022；优先级：P0。
- 来源：[原始入口](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md)。
- 已阅读范围：规范正文。
- 可用知识：规定标准骨骼语义、必需与可选节点及层级；允许标准节点之间存在非 humanoid 节点。
- 使用边界：骨骼语义不包含人体质量、关节限位或神经肌肉参数。

### S02 VRM Animation 1.0

- 年份：持续更新或本轮未核定；优先级：P0。
- 来源：[原始入口](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md)。
- 已阅读范围：规范正文。
- 可用知识：humanoid 动画禁止非 hips 平移与骨骼缩放；眼球动画通过 LookAt 表达。
- 使用边界：动画交换约束不能扩大为底层 glTF 节点的全部能力。

### S03 VRM Human Pose Transformation

- 年份：持续更新或本轮未核定；优先级：P0。
- 来源：[原始入口](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md)。
- 已阅读范围：规范正文。
- 可用知识：说明不同静止姿态旋转之间的人形姿态转换。
- 使用边界：解决坐标与静止姿态兼容，不保证接触、受力或动作风格一致。

### S04 VRMC_node_constraint 1.0

- 年份：2022；优先级：P0。
- 来源：[原始入口](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_node_constraint-1.0/README.md)。
- 已阅读范围：规范正文。
- 可用知识：提供 roll、aim、rotation 等节点约束及依赖规则。
- 使用边界：这里的节点约束不是解剖关节限位、接触求解或整身动力学。

### S05 VRMC_springBone 1.0

- 年份：2022；优先级：P0。
- 来源：[原始入口](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md)。
- 已阅读范围：规范正文。
- 可用知识：定义弹簧链、碰撞体及二次运动参数。
- 使用边界：碰撞能力属于弹簧骨系统，不能当作主动身体的通用接触引擎。

### S06 VRMC_vrm 1.0 execution order

- 年份：2022；优先级：P0。
- 来源：[原始入口](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/README.md)。
- 已阅读范围：规范正文。
- 可用知识：建议 humanoid、LookAt、expression、node constraint、spring bone 按顺序更新。
- 使用边界：新的运动系统需要明确各通道的写入所有权。

### S07 three-vrm VRMHumanoid API

- 年份：持续更新或本轮未核定；优先级：P0。
- 来源：[原始入口](https://pixiv.github.io/three-vrm/docs/classes/three-vrm-core.VRMHumanoid.html)。
- 已阅读范围：官方 API 文档。
- 可用知识：提供 normalized 与 raw 骨骼、相对静止姿态的读写及归一化姿态更新。
- 使用边界：这是运行库的归一化层；不能把它与文件原始骨骼完全等同。
- 代码：[代码入口](https://github.com/pixiv/three-vrm)。
- 许可记录：MIT；实际复用前固定版本并复核 LICENSE。

### S08 Unity HumanPose muscles

- 年份：持续更新或本轮未核定；优先级：P1。
- 来源：[原始入口](https://docs.unity.com/en-us/engine/6000.0/script-reference/unityengine/humanpose/muscles)。
- 已阅读范围：官方 API 文档。
- 可用知识：Muscle 值是 Humanoid 定义范围内的骨骼轴控制参数。
- 使用边界：名称包含 muscle，但它本身不是有激活、力和内部状态的生理肌肉模型。

### S09 glTF 2.0 Specification

- 年份：2021；优先级：P1。
- 来源：[原始入口](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)。
- 已阅读范围：规范入口与节点蒙皮章节。
- 可用知识：提供节点变换、蒙皮矩阵、动画和 morph target 的底层定义。
- 使用边界：VRM 标准身体通道与 glTF 全部可扩展能力须分开。

## 神经运动控制原理

### S10 A Muscle-Reflex Model That Encodes Principles of Legged Mechanics

- 年份：2010；优先级：P0。
- 来源：[原始入口](https://dspace.mit.edu/entities/publication/3cf5a6e6-f2af-4d9a-8f8b-65e16c0cd55f)。
- 已阅读范围：作者机构摘要与论文入口。
- 可用知识：以肌肉反射编码腿部力学，形成可适应部分扰动与坡度的行走。
- 使用边界：针对特定步行模型；不能直接覆盖全身操作和任意任务。
- 全文：[全文入口](https://aspirin.media.mit.edu/biomechatronics/wp-content/uploads/sites/8/2013/04/A-Muscle-Reflex-Model-that-Encodes-Princlples-of-Legged-Mechanics-Produces-Human-Walking-Dynamics-and-Muscle-Activities.pdf)。

### S11 Optimal Feedback Control as a Theory of Motor Coordination

- 年份：2002；优先级：P0。
- 来源：[原始入口](https://www.nature.com/articles/nn963)。
- 已阅读范围：出版方摘要；机构全文入口。
- 可用知识：任务相关误差与任务无关的冗余变化可以区别控制，为目标驱动提供理论依据。
- 使用边界：不能据此直接确定 VRM 的控制代价函数；出版方正文访问受限。
- 全文：[全文入口](https://homes.cs.washington.edu/~todorov/papers/TodorovNatNeurosci02.pdf)。

### S12 A Minimal Intervention Principle for Coordinated Movement

- 年份：2002；优先级：P1。
- 来源：[原始入口](https://papers.neurips.cc/paper_files/paper/2002/hash/8c5f6ecd29a0eb234459190ca51c16dd-Abstract.html)。
- 已阅读范围：会议摘要。
- 可用知识：只修正妨碍任务完成的偏差，可以自然保留动作冗余和协同。
- 使用边界：它是控制原则，不能替代身体动力学与接触模型。

### S13 Adaptive Control of Mechanical Impedance by Coactivation of Antagonist Muscles

- 年份：1984；优先级：P1。
- 来源：[原始入口](https://newmanlab.mit.edu/publications/)。
- 已阅读范围：作者实验室书目记录。
- 可用知识：拮抗肌共同激活与机械阻抗控制的经典文献入口。
- 使用边界：本轮只核对题名、作者及年份；公式与实验需进一步阅读全文。
- 核验状态：书目级，不能作为定量依据。

### S14 Combinations of Muscle Synergies in the Construction of a Natural Motor Behavior

- 年份：2003；优先级：P1。
- 来源：[原始入口](https://www.nature.com/articles/nn1010)。
- 已阅读范围：出版方检索摘要。
- 可用知识：研究肌肉协同组合与运动行为之间的关系。
- 使用边界：属于生物实验依据；不能据此断定通用 VRM 所需协同数量；正文访问受限。

### S15 Central Pattern Generators for Locomotion Control in Animals and Robots

- 年份：2008；优先级：P1。
- 来源：[原始入口](https://www.sciencedirect.com/science/article/pii/S0893608008000804)。
- 已阅读范围：出版方摘要与机构全文入口。
- 可用知识：整理耦合振荡器、节律生成和感觉反馈在运动中的作用。
- 使用边界：CPG 主要解决节律与相位，完整任务规划、接触和稳定仍需其他机制。
- 全文：[全文入口](https://www.cs.cmu.edu/~hgeyer/Teaching/R16-899B/Papers/Ijspeert08NeuralNEtworks.pdf)。

### S16 The Coordination of Arm Movements

- 年份：1985；优先级：P1。
- 来源：[原始入口](https://bpb-us-e1.wpmucdn.com/sites.mit.edu/dist/5/1384/files/2025/02/1985-the-coordination-of-arm-movements-an-experimentally-confirmed-mathematical-model.pdf)。
- 已阅读范围：机构论文检索正文。
- 可用知识：最小 jerk 模型为伸手轨迹的平滑性提供经典实验与数学依据。
- 使用边界：适用实验范围内的运动学描述，不能直接解释所有受力与操作行为。

## 解剖模型与肌肉力学

### S17 A Model of the Upper Extremity for Simulating Musculoskeletal Surgery

- 年份：2005；优先级：P0。
- 来源：[原始入口](https://pubmed.ncbi.nlm.nih.gov/16078622/)。
- 已阅读范围：PubMed 原始论文摘要。
- 可用知识：15 个自由度和 50 个肌肉分区的上肢模型，包含跨关节的几何与被动耦合。
- 使用边界：面向人体且只覆盖部分手指；参数不能直接当作 VRM 真值。

### S18 Full Body Musculoskeletal Model for Muscle Driven Simulation of Human Gait

- 年份：2016；优先级：P1。
- 来源：[原始入口](https://pmc.ncbi.nlm.nih.gov/articles/PMC5507211/)。
- 已阅读范围：原始论文正文入口与摘要。
- 可用知识：包含肌肉驱动下肢与理想力矩驱动上身的步态模型，提供明确的模型分工。
- 使用边界：题名中的 full body 不意味着所有身体部位都由解剖肌肉驱动。
- 代码：[代码入口](https://github.com/opensim-org/opensim-models/tree/master/Models/Rajagopal)。

### S19 Flexing Computational Muscle

- 年份：2013；优先级：P0。
- 来源：[原始入口](https://pubmed.ncbi.nlm.nih.gov/23445050/)。
- 已阅读范围：原始论文摘要与作者全文入口。
- 可用知识：比较肌腱动力学模型的速度、精度与数值表现；适合决定弹性肌腱和阻尼的取舍。
- 使用边界：PMC 正文入口本轮出现验证页；没有完成本机复现。
- 全文：[全文入口](https://nmbl.stanford.edu/publications/pdf/Millard2013.pdf)。

### S20 DeGrooteFregly2016Muscle implementation

- 年份：2016；优先级：P1。
- 来源：[原始入口](https://github.com/opensim-org/opensim-core/blob/main/OpenSim/Actuators/DeGrooteFregly2016Muscle.h)。
- 已阅读范围：官方源码接口与注释。
- 可用知识：可检查主动与被动力长曲线、力速曲线、肌腱刚度及模型属性。
- 使用边界：用于理解模型与接口；不能仅按类名认定适合实时部署。

### S21 MuJoCo Computation Actuation and Dynamics

- 年份：持续更新或本轮未核定；优先级：P0。
- 来源：[原始入口](https://mujoco.readthedocs.io/en/stable/computation/index.html)。
- 已阅读范围：官方执行器与激活动力学章节。
- 可用知识：分离激励、激活、力生成和传动；关节位姿之外可保存执行器动态状态。
- 使用边界：各模型的数值稳定性和时间步需求需要实测。

### S22 MuJoCo Modeling Muscle Actuators

- 年份：持续更新或本轮未核定；优先级：P0。
- 来源：[原始入口](https://mujoco.readthedocs.io/en/stable/modeling.html#muscle-actuators)。
- 已阅读范围：官方模型文档。
- 可用知识：提供肌肉长度范围、肌肉执行器及传动建模入口。
- 使用边界：简化模型与生理细节有取舍；需核对具体假设。

## 仿真与研究工具

### S23 Overview of OpenSim Workflows

- 年份：2024；优先级：P0。
- 来源：[原始入口](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53084226/Overview+of+OpenSim+Workflows)。
- 已阅读范围：官方工作流正文。
- 可用知识：明确区分逆问题、已知控制的正向仿真、优化及强化学习。
- 使用边界：文中离线优化耗时不能直接等同训练后运行时耗时。

### S24 OpenSim Core

- 年份：持续更新或本轮未核定；优先级：P1。
- 来源：[原始入口](https://github.com/opensim-org/opensim-core)。
- 已阅读范围：官方仓库 README 与许可标识。
- 可用知识：提供肌骨建模、动力学与 C++、Python 等接口。
- 使用边界：软件许可与各人体模型、实验数据许可分别核对。
- 代码：[代码入口](https://github.com/opensim-org/opensim-core)。
- 许可记录：Apache-2.0；仓库许可标识。

### S25 OpenSim Moco

- 年份：2020；优先级：P1。
- 来源：[原始入口](https://opensim-org.github.io/opensim-moco-site/)。
- 已阅读范围：官方项目页。
- 可用知识：直接配点法求解运动追踪、运动预测和参数优化问题。
- 使用边界：其主要定位是轨迹优化；不能把一次优化当作逐帧实时控制。

### S26 MyoSuite

- 年份：2022；优先级：P0。
- 来源：[原始入口](https://myosuite.readthedocs.io/en/latest/)。
- 已阅读范围：官方文档与仓库 README。
- 可用知识：肌肉控制任务与多个仿真、训练后端的研究平台。
- 使用边界：当前 3.x 与旧版策略存在兼容变化；复现要固定版本。
- 代码：[代码入口](https://github.com/MyoHub/myosuite)。
- 许可原文：[许可原文入口](https://raw.githubusercontent.com/MyoHub/myosuite/main/LICENSE)。
- 许可记录：Apache-2.0；已读根 LICENSE。

### S27 MyoSim

- 年份：2022；优先级：P0。
- 来源：[原始入口](https://github.com/MyoHub/myo_sim)。
- 已阅读范围：官方模型仓库与根许可。
- 可用知识：MuJoCo 肌骨模型集合，为小规模单关节、上肢和下肢实验提供入口。
- 使用边界：根许可不能替代每个来源模型、网格和引用数据的单独核对。
- 许可原文：[许可原文入口](https://raw.githubusercontent.com/MyoHub/myo_sim/main/LICENSE)。
- 许可记录：Apache-2.0；已读根 LICENSE。

### S28 MyoGen

- 年份：2026；优先级：P1。
- 来源：[原始入口](https://github.com/NsquaredLab/MyoGen)。
- 已阅读范围：官方 README 与项目说明。
- 可用知识：NEURON 支持的神经生理工具，覆盖运动单位、肌肉力及肌电信号生成。
- 使用边界：并不是一个默认含 700 块肌肉的通用全身控制器；没有找到可用的统一单帧耗时依据。
- 许可原文：[许可原文入口](https://github.com/NsquaredLab/MyoGen/blob/main/LICENSE.md)。
- 许可记录：AGPL-3.0；仓库标识与 README。

### S29 SCONE

- 年份：持续更新或本轮未核定；优先级：P0。
- 来源：[原始入口](https://scone.software/doku.php?id=start)。
- 已阅读范围：官方项目页。
- 可用知识：以速度、能耗等高层目标优化肌骨模型与控制器，支持 OpenSim 和 Hyfydy。
- 使用边界：软件、后端引擎与模型许可分开；优化结果的运行性能需逐模型测量。
- 代码：[代码入口](https://github.com/tgeijten/scone-core)。

### S30 Hyfydy

- 年份：持续更新或本轮未核定；优先级：P1。
- 来源：[原始入口](https://hyfydy.com/)。
- 已阅读范围：官方性能说明与用户手册入口。
- 可用知识：高性能肌骨与接触仿真；厂商给出相对 OpenSim 的速度比较。
- 使用边界：比较受模型、精度与硬件约束；引擎是独立授权产品。
- 全文：[全文入口](https://media.hyfydy.com/hyfydy-user-manual.pdf)。
- 许可记录：商业引擎，按官方条款单独核对。

## 人工身体与协同设计

### S31 Evolving Virtual Creatures

- 年份：1994；优先级：P1。
- 来源：[原始入口](https://karlsims.com/evolved-virtual-creatures.html)。
- 已阅读范围：作者项目页与论文检索正文。
- 可用知识：共同演化身体形态与神经控制结构的早期人工生命研究。
- 使用边界：并非 VRM 标准身体，也不是人体解剖肌肉建模方法。
- 全文：[全文入口](https://www.karlsims.com/papers/siggraph94.pdf)。

### S32 Automated Learning of Muscle Actuated Locomotion Through Control Abstraction

- 年份：1995；优先级：P1。
- 来源：[原始入口](https://web.cs.ucla.edu/~dt/papers/siggraph95a/siggraph95a.pdf)。
- 已阅读范围：作者论文摘要与引言。
- 可用知识：通过控制抽象学习肌肉驱动虚拟动物的运动，是分层肌肉控制的重要早期路线。
- 使用边界：对象与任务范围有限，不能直接当作现代全身人形实现。

### S33 Flexible Muscle Based Locomotion for Bipedal Creatures

- 年份：2013；优先级：P0。
- 来源：[原始入口](https://www.cs.ubc.ca/~van/papers/2013-TOG-MuscleBasedBipeds/index.html)。
- 已阅读范围：全文模型控制与实验段。
- 可用知识：联合优化近似肌肉模板的路径与参数；使用神经延迟和肌肉 Jacobian 控制虚构双足。
- 使用边界：模板与任务先验仍由人提供；全身操作与 VRM 指级控制不在论文验证范围。
- 全文：[全文入口](https://www.cs.ubc.ca/~van/papers/2013-TOG-MuscleBasedBipeds/2013-TOG-MuscleBasedBipeds.pdf)。

### S34 Functionality Driven Musculature Retargeting

- 年份：2021；优先级：P0。
- 来源：[原始入口](https://mrl.snu.ac.kr/research/ProjectFunctionalityDriven/fdmr.htm)。
- 已阅读范围：全文方法与运动技能实验段。
- 可用知识：优化肌肉几何和参数，在不同身体上保留功能、活动范围及驱动力方向。
- 使用边界：从已有参考肌肉系统出发；不是仅凭标准骨架就确定唯一的新肌肉结构。
- 全文：[全文入口](https://mrl.snu.ac.kr/research/ProjectFunctionalityDriven/Functionality_Driven_Musculature_Retargeting.pdf)。

### S35 Evolving the Complete Muscle

- 年份：2026；优先级：P0。
- 来源：[原始入口](https://arxiv.org/abs/2604.12855)。
- 已阅读范围：摘要与 HTML 方法入口。
- 可用知识：以双侧对称与 PCA 构造低维设计空间，联合优化肌肉力量、速度、刚度及控制。
- 使用边界：优化的是已有模型的参数空间；未证明最少驱动拓扑或 VRM 行为等价。
- 全文：[全文入口](https://arxiv.org/html/2604.12855v1)。

## 全身肌肉控制

### S36 MASS Scalable Muscle Actuated Human Simulation and Control

- 年份：2019；优先级：P0。
- 来源：[原始入口](https://mrl.snu.ac.kr/research/ProjectScalable/Page.htm)。
- 已阅读范围：作者项目说明与官方仓库。
- 可用知识：两级模仿学习控制全身肌骨模型，研究解剖变化、力学约束和运动风格。
- 使用边界：需区分不同模型配置；不是 VRM 原生身体生成方法。
- 全文：[全文入口](https://mrl.snu.ac.kr/research/ProjectScalable/Paper.pdf)。
- 代码：[代码入口](https://github.com/lsw9021/MASS)。
- 许可记录：Apache-2.0；仓库标识，模型资源另查。

### S37 MuscleVAE

- 年份：2023；优先级：P0。
- 来源：[原始入口](https://pku-mocca.github.io/MuscleVAE-page/)。
- 已阅读范围：作者项目页与仓库 README。
- 可用知识：结合 Hill 肌肉、3CC-r 疲劳、肌肉空间 PD 和可生成技能的潜空间。
- 使用边界：所查仓库声明只提供 playing 代码、训练代码待提供；网站许可不等于算法仓库许可。
- 代码：[代码入口](https://github.com/wangchek/MuscleVAE_)。
- 许可记录：算法仓库许可待逐文件核对。

### S38 FreeMusco

- 年份：2025；优先级：P0。
- 来源：[原始入口](https://arxiv.org/abs/2511.14205)。
- 已阅读范围：全文方法与实验段。
- 可用知识：无需动捕学习肌肉驱动的运动潜空间，并支持目标导航与路径跟随。
- 使用边界：不同形态有各自训练；不能解释为单一策略零适配控制所有 VRM。
- 全文：[全文入口](https://arxiv.org/html/2511.14205v1)。
- 代码：[代码入口](https://github.com/palkan21/FreeMusco)。
- 许可原文：[许可原文入口](https://raw.githubusercontent.com/palkan21/FreeMusco/main/LICENSE)。
- 许可记录：BSD-3-Clause；已读根 LICENSE，另核模型来源。

### S39 Self Model for Embodied Intelligence

- 年份：2024；优先级：P0。
- 来源：[原始入口](https://arxiv.org/abs/2312.05473)。
- 已阅读范围：论文摘要与作者项目页。
- 可用知识：MS-Human-700 结合分层低维表示实现全身肌肉控制，为高维身体与低维控制连接提供先例。
- 使用边界：论文报告的解剖关节数不能直接当作独立动力学自由度。
- 项目页：[项目页入口](https://lnsgroup.cc/research/MS-Human/)。

### S42 MyoDex

- 年份：2023；优先级：P1。
- 来源：[原始入口](https://sites.google.com/view/myodex)。
- 已阅读范围：作者项目页。
- 可用知识：以肌骨手进行接触丰富的操作，学习可迁移的灵巧操作先验。
- 使用边界：任务与物体的迁移不等同换任意身体或骨架后的零校准迁移。

### S43 MuscleMimic

- 年份：2026；优先级：P0。
- 来源：[原始入口](https://arxiv.org/abs/2603.25544)。
- 已阅读范围：摘要与官方仓库 README。
- 可用知识：开放肌肉驱动身体、模仿学习、重定向和策略资源，包含全身与双手操作路线。
- 使用边界：论文版本列 126 与 416 肌肉；当前浏览器示例为 354，配置和修订必须对应记录。
- 代码：[代码入口](https://github.com/amathislab/musclemimic)。
- 许可记录：代码 Apache-2.0 标识；模型与训练数据分别核对。

### S44 Muscle SuperMimic

- 年份：2026；优先级：P0。
- 来源：[原始入口](https://github.com/kaibohex/muscle-supermimic)。
- 已阅读范围：作者仓库 README。
- 可用知识：基于 mjlab 的全身肌肉动作跟踪，覆盖 MS-Human-700 和 MyoFullBody。
- 使用边界：训练小时数与 GPU 批量环境不能当作单实例 CPU 推理基准。
- 许可记录：Apache-2.0；README/NOTICE 记录第三方与数据限制。

### S45 MS-Emulator

- 年份：2026；优先级：P1。
- 来源：[原始入口](https://lnsgroup.cc/research/MS-Emulator/)。
- 已阅读范围：作者项目页方法说明。
- 可用知识：700 肌肉共享动作跟踪策略，结合世界模型、解析激活和策略改进。
- 使用边界：网页效果和作者指标属于报告值；本轮未运行策略或复核完整性能账目。

## 控制降维与模型降阶

### S40 DynSyn

- 年份：2024；优先级：P0。
- 来源：[原始入口](https://arxiv.org/abs/2407.11472)。
- 已阅读范围：论文摘要。
- 可用知识：从动力学结构构造协同，并作任务相关、状态相关的适配。
- 使用边界：协同表示降维不等同减少物理肌肉数量或全部动态状态。

### S41 SAR Synergistic Action Representation

- 年份：2023；优先级：P0。
- 来源：[原始入口](https://arxiv.org/abs/2307.03716)。
- 已阅读范围：摘要与作者方法展示。
- 可用知识：由简单任务的激活数据提取低维协同，以通用路径和任务专属路径共同控制。
- 使用边界：仍保留原始肌肉执行器；残差路径与分布外任务表现要单独评价。
- 项目页：[项目页入口](https://sites.google.com/view/sar-rl)。

### S47 Nonlinear Controllability and Observability

- 年份：1977；优先级：P1。
- 来源：[原始入口](https://ieeexplore.ieee.org/abstract/document/1101601)。
- 已阅读范围：出版方检索摘要。
- 可用知识：提供非线性可控、可观与最小实现的理论入口。
- 使用边界：正文访问返回 418；本轮不据此给 VRM 混合接触系统下最小性定理。
- 核验状态：摘要级，正文未取得。

### S48 Minimal Realizations of Nonlinear Systems

- 年份：2018；优先级：P1。
- 来源：[原始入口](https://www.sciencedirect.com/science/article/abs/pii/S0005109818302498)。
- 已阅读范围：出版方检索摘要。
- 可用知识：讨论非线性系统最小状态实现，提示最小维数与可观可达条件的细节。
- 使用边界：正文返回 403；所讨论系统条件不能直接套到全身接触仿真。
- 核验状态：摘要级，正文未取得。

### S49 Balancing Approach to Minimal Realization and Model Reduction of Stable Nonlinear Systems

- 年份：持续更新或本轮未核定；优先级：P1。
- 来源：[原始入口](https://www.hahnresearchgroup.com/publications/journals/balancing-approach-minimal-realization-and-model-reduction-stable-nonlinear)。
- 已阅读范围：作者实验室摘要。
- 可用知识：通过局部可控和可观信息进行稳定非线性系统降阶。
- 使用边界：局部稳定与光滑等假设须核实；碰撞和接触切换另需处理。

### S50 NMSM Surrogate Model Tutorial

- 年份：2025；优先级：P0。
- 来源：[原始入口](https://nmsm.rice.edu/guides-and-publications/tutorials/beginner-tutorials/surrogate-tutorial/)。
- 已阅读范围：官方教程正文。
- 可用知识：采样关节姿态后拟合肌腱长度与力臂的多项式代理，并由长度关系获得速度。
- 使用边界：几何计算加速不等同删除肌肉状态；训练采样范围外误差须评估。

## 接触与任务控制

### S46 MPC squared

- 年份：2025；优先级：P0。
- 来源：[原始入口](https://arxiv.org/abs/2505.08238)。
- 已阅读范围：论文摘要与作者项目说明。
- 可用知识：采样 MPC 规划目标姿态，形态感知比例控制通过 Jacobian 协调大量肌肉执行器。
- 使用边界：近实时取决于模型和规划资源；训练免除不等于每步计算免费。
- 代码：[代码入口](https://github.com/LNSGroup/MPC2)。
- 项目页：[项目页入口](https://lnsgroup.cc/research/MPC2)。

### S55 Virtual Model Control of a Biped Walking Robot

- 年份：1995；优先级：P1。
- 来源：[原始入口](https://dspace.mit.edu/entities/publication/cdfb4aa1-7638-4878-8092-d0061c39191d)。
- 已阅读范围：作者机构论文摘要。
- 可用知识：用虚构的机械部件产生力，再通过关节力矩实现任务行为。
- 使用边界：虚拟弹簧、阻尼等机制有长期研究基础；与解剖肌肉结构区分。

### S56 Rapier JavaScript Joints

- 年份：持续更新或本轮未核定；优先级：P1。
- 来源：[原始入口](https://rapier.rs/docs/user_guides/javascript/joints/)。
- 已阅读范围：官方关节文档。
- 可用知识：说明 impulse joint、multibody joint、自由度及关节驱动的 JavaScript 接口。
- 使用边界：关节约束与肌肉力学不是同一层；高刚度与接触性能需实测。

## 物理角色基线

### S51 DeepMimic

- 年份：2018；优先级：P0。
- 来源：[原始入口](https://xbpeng.github.io/projects/DeepMimic/index.html)。
- 已阅读范围：作者项目页与摘要。
- 可用知识：以动作模仿与任务奖励学习物理角色技能及部分扰动恢复。
- 使用边界：必须与肌肉驱动区分；可作为不含人工肌肉的行为基线。

### S52 AMP Adversarial Motion Priors

- 年份：2021；优先级：P1。
- 来源：[原始入口](https://xbpeng.github.io/projects/AMP/)。
- 已阅读范围：作者摘要与项目页。
- 可用知识：从动作数据学习风格奖励，避免逐段指定追踪目标。
- 使用边界：运动自然性仍受训练数据覆盖与任务设置影响。

### S53 Perpetual Humanoid Control

- 年份：2023；优先级：P1。
- 来源：[原始入口](https://github.com/ZhengyiLuo/PHC)。
- 已阅读范围：官方仓库 README。
- 可用知识：大规模动作跟踪与恢复，为实时模拟角色提供比较基线。
- 使用边界：SMPL、模型文件、动作数据与代码许可分别检查；不等于肌肉系统。

### S54 MaskedMimic

- 年份：2024；优先级：P0。
- 来源：[原始入口](https://research.nvidia.com/labs/par/project/maskedmimic.html)。
- 已阅读范围：作者机构项目说明。
- 可用知识：统一处理稀疏关节目标、路径、对象互动和文本风格等意图输入。
- 使用边界：不能把意图驱动本身当作空白；实际身体机制与策略输入仍有明确假设。

### S72 Interactive Character Animation Using Simulated Physics A State of the Art Review

- 年份：2012；优先级：P1。
- 来源：[原始入口](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-8659.2012.03189.x)。
- 已阅读范围：出版方摘要与作者全文入口。
- 可用知识：整理物理角色的控制、接触、自然性、鲁棒性与交互技术谱系。
- 使用边界：覆盖至其发表时期；与 2023 至 2026 的学习方法并读。
- 全文：[全文入口](https://perso.liris.cnrs.fr/nicolas.pronost/Papers/Interactive%20Character%20Animation%20Using%20Simulated%20Physics%20-%20A%20State-of-the-Art%20Review%20%5BGeijtenbeek2012%5D.pdf)。

## 浏览器与实时部署

### S57 MuJoCo JavaScript and WebAssembly Bindings

- 年份：持续更新或本轮未核定；优先级：P0。
- 来源：[原始入口](https://github.com/google-deepmind/mujoco/blob/main/wasm/README.md)。
- 已阅读范围：官方 README 正文。
- 可用知识：提供 canonical JS/TS 绑定、单线程与多线程构建及 WASM 内存管理说明。
- 使用边界：多线程需要跨源隔离；README 的 Windows 实验性说明注明 2025-11-13，不能当作本日实测结论。
- 原始文本：[原始文本入口](https://raw.githubusercontent.com/google-deepmind/mujoco/main/wasm/README.md)。
- 许可记录：引擎 Apache-2.0；绑定依赖另查。

### S58 mjswan

- 年份：2026；优先级：P0。
- 来源：[原始入口](https://github.com/ttktjmt/mjswan)。
- 已阅读范围：官方 README 正文。
- 可用知识：MuJoCo WASM、ONNX 策略与浏览器交互，提供本地客户端仿真结构。
- 使用边界：作者实时与跨平台声明并不是指定硬件下的帧时间统计。
- 原始文本：[原始文本入口](https://raw.githubusercontent.com/ttktjmt/mjswan/main/README.md)。
- 许可记录：Apache-2.0；README 明示。

### S59 mjswan playground MuscleMimic tasks

- 年份：2026；优先级：P0。
- 来源：[原始入口](https://github.com/ttktjmt/mjswan_playground)。
- 已阅读范围：作者仓库任务清单。
- 可用知识：列出 354 肌肉 MyoFullBody 运行示例，并列出肌肉全身跟踪任务。
- 使用边界：本轮未启动演示或下载权重；不宣称在本机达到 60fps。
- 许可记录：应用 Apache-2.0；每项上游资源分别授权。

### S60 ONNX Runtime Web

- 年份：持续更新或本轮未核定；优先级：P1。
- 来源：[原始入口](https://onnxruntime.ai/docs/tutorials/web/)。
- 已阅读范围：官方部署文档入口。
- 可用知识：为训练后策略在浏览器中推理提供工具入口。
- 使用边界：算子、执行后端和网络结构兼容需单独检查。

### S61 ONNX Runtime Web Environment Flags

- 年份：持续更新或本轮未核定；优先级：P1。
- 来源：[原始入口](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)。
- 已阅读范围：官方配置文档。
- 可用知识：说明 WASM 线程与运行环境、会话配置选项。
- 使用边界：线程数量、跨源隔离与实际宿主能力会影响部署方案。

## 数据模型与评估

### S62 AMASS Dataset License

- 年份：持续更新或本轮未核定；优先级：P0。
- 来源：[原始入口](https://amass.is.tue.mpg.de/license.html)。
- 已阅读范围：官方许可正文。
- 可用知识：仅按页面条款用于非商业科学研究等范围，并限制商业算法训练及数据再分发。
- 使用边界：不能因重定向、压缩或训练成权重，就自行认定脱离原始条款。
- 许可记录：自定义非商业科研许可；逐字以官方正文为准。

### S63 LAFAN1

- 年份：2020；优先级：P1。
- 来源：[原始入口](https://github.com/ubisoft/ubisoft-laforge-animation-dataset)。
- 已阅读范围：官方 README 许可声明。
- 可用知识：动作与插帧评估数据入口。
- 使用边界：不能默认作为可商用、可改编再分发的动作库。
- 许可记录：CC BY-NC-ND 4.0；README 明示。

### S64 AddBiomechanics FAQ

- 年份：2025；优先级：P1。
- 来源：[原始入口](https://www.addbiomechanics.org/faq.html)。
- 已阅读范围：官方 FAQ。
- 可用知识：介绍模型、数据与处理限制；数据下载附各自 LICENSE 和贡献者署名。
- 使用边界：按具体数据包许可核对，不能把平台许可当作每条数据许可。

### S65 AddBiomechanics Dataset

- 年份：2024，PMC 作者稿于 2025 年可用；优先级：P1。
- 来源：[原始入口](https://pmc.ncbi.nlm.nih.gov/articles/PMC11948690/)。
- 已阅读范围：原始论文入口与摘要。
- 可用知识：同时含运动和受力信息，适合比较运动学之外的物理一致性。
- 使用边界：数据库持续变化；论文固定版本和在线累计统计不能混用。

### S66 MuJoCo Menagerie MS Human 700

- 年份：2026；优先级：P0。
- 来源：[原始入口](https://github.com/google-deepmind/mujoco_menagerie/tree/main/ms_human_700)。
- 已阅读范围：官方模型 README。
- 可用知识：给出全身、运动与操作三个模型变体和来源，便于固定配置。
- 使用边界：不同模型变体的执行器数量与独立自由度不能混用。
- 许可记录：模型 Apache-2.0；目录 README 明示。

### S67 MuscleMimic Evaluation Kit

- 年份：2026；优先级：P1。
- 来源：[原始入口](https://github.com/amathislab/mm-evalkit)。
- 已阅读范围：作者仓库入口与说明。
- 可用知识：用生理相关评估补充单纯的动作跟踪指标。
- 使用边界：本轮未运行评估；具体数据和指标需按任务复核。
- 许可记录：Apache-2.0；仓库标识。

## 直接相关与表现边界

### S68 A Pilot Study on the Effects of a Physio Avatar EB Experience

- 年份：2026；优先级：P0。
- 来源：[原始入口](https://pmc.ncbi.nlm.nih.gov/articles/PMC13310907/)。
- 已阅读范围：原始论文系统设计正文。
- 可用知识：真人肌电经简化神经肌骨模型驱动 VRM 单自由度肘关节，关节更新为 100Hz。
- 使用边界：真人输入与局部肘关节实验，不覆盖自主意图、全身协调或 VRM 特化身体生成。

### S69 REALITY Muscle Compression for Motion UGC

- 年份：2023；优先级：P1。
- 来源：[原始入口](https://note.com/reality_eng/n/nbcd91e5cf543)。
- 已阅读范围：开发者技术说明。
- 可用知识：在 Unity 中存取 VRM Humanoid 的 muscle 参数以压缩动作。
- 使用边界：Muscle 参数是运动表示；不能当作人工肌肉动力学的已实现证据。

### S70 Eidoverse VRM Character Controller

- 年份：持续更新或本轮未核定；优先级：P2。
- 来源：[原始入口](https://github.com/SkyeShark/eidoverse-video/blob/main/README.md)。
- 已阅读范围：作者 README 线索。
- 可用知识：声明 VRM、Rapier、Foot IK 与自主导航等组合能力，是邻近系统入口。
- 使用边界：未审计实现、运行效果及许可；只作线索，不能用于性能或机制结论。
- 核验状态：README 声明级，待代码核验。

### S71 PhysRig

- 年份：2025；优先级：P1。
- 来源：[原始入口](https://physrig.github.io/)。
- 已阅读范围：作者项目说明。
- 可用知识：用体积软体表示与物理蒙皮处理复杂变形，帮助区分骨骼运动与表面形变能力。
- 使用边界：需要额外软体表示与计算，不属于仅靠 VRM 标准骨骼旋转自然获得的效果。
- 代码：[代码入口](https://github.com/haoz19/PhysRig)。
- 论文：[论文入口](https://arxiv.org/abs/2506.20936)。


# 资料搜集方法与访问记录

日期：2026 年 11 月 3 日，Asia/Shanghai。

## 搜集范围与方法

以完整 VRM 特化人工神经肌肉系统为目标，先检索 VRM 与相关机制的直接组合，再扩展至功能解剖、肌肉力学、反射、协调、形态设计、控制降维、状态降阶、接触、实时部署和评估。按论文参考关系回溯早期方法，再核对 2023 至 2026 年的作者项目、代码与版本差异。

来源优先级为官方规范、原始论文与作者机构、作者代码仓库、官方实现文档。搜索摘要用于发现资料；正文或完整方法未取得时，在卡片保留相应阅读级别。没有将媒体解读、镜像摘要、自动生成评测或论坛回复作为主要技术依据。

[SOURCES.md](SOURCES.md)中 72 条来源按 12 个主题组织。论文的代码与全文入口合并记录；规范、平台、模型目录和数据条款各自作为资料来源。因此 72 不代表 72 篇独立论文。

## 实际使用的代表性检索式

以下记录 56 个实际检索式，另有原始入口直开、论文引用追踪和正文关键词定位；它不是搜索结果总数或全部工具调用数。

| 方向 | 检索式 |
| --- | --- |
| 直接目标 | "VRM" "neuromuscular" |
| 直接目标 | "VRM" "musculoskeletal" "controller" |
| 直接目标 | "VRM" "artificial muscles" |
| 直接目标 | "VRM" "muscle-driven" |
| 直接目标 | "VRM" "physics-based" "autonomous" |
| 标准 | site.github.com/vrm-c/vrm-specification VRMC_vrm humanoid tpose |
| 标准 | site.pixiv.github.io/three-vrm VRMHumanoid normalized raw |
| 标准 | site.docs.unity3d.com Muscle Settings Humanoid muscles |
| 肌肉控制 | "Scalable Muscle-actuated Human Simulation and Control" github project |
| 肌肉控制 | "Flexible Muscle-Based Locomotion for Bipedal Creatures" |
| 肌肉控制 | "MuscleVAE" paper github |
| 肌肉控制 | "MuscleMimic" "github" "2026" |
| 肌肉控制 | "muscle-supermimic" github |
| 肌肉控制 | "MS-Emulator" "VRM" |
| 肌肉控制 | "FreeMusco" "github" |
| 工具 | "MyoSuite" github facebookresearch license |
| 工具 | "MyoGen" github musculoskeletal |
| 工具 | "SCONE" "Hyfydy" real-time simulation |
| 理论 | "A Muscle-Reflex Model" Geyer Herr 2010 pdf |
| 理论 | "optimal feedback control" "Todorov" "Jordan" 2002 nature |
| 理论 | "Flash" "Hogan" "1985" "coordination" arm movements |
| 理论 | "Ijspeert" "2008" "central pattern generators" locomotion control |
| 理论 | "Combinations of muscle synergies" "2003" nature |
| 力学 | "Hill" "muscle" "Zajac" 1989 model pubmed |
| 力学 | "De Groote" "Millard" muscle model 2016 opensim |
| 力学 | "co-contraction" "impedance" "Hogan" 1984 |
| 解剖 | "Holzbaur" "2005" "upper extremity" model opensim |
| 解剖 | "Rajagopal" "2016" "full-body" musculoskeletal model |
| 解剖 | "Millard" "2013" "Flexing Computational Muscle" |
| 人工身体 | "Automated Learning of Muscle-Actuated Locomotion through Control Abstraction" |
| 人工身体 | "Evolving Virtual Creatures" Karl Sims 1994 |
| 人工身体 | "automatic" "musculature" "topology" optimization animation |
| 人工身体 | "Functionality-Driven Musculature Retargeting" project |
| 人工身体 | "morphology" "muscle" "control" character animation universal |
| 降维 | "musculoskeletal" "model reduction" "control" muscle |
| 降维 | "muscle" "synergy" "reduced" "simulation" OpenSim |
| 降维 | "minimal realization" "nonlinear" "observability" control |
| 降维 | "balanced truncation" "Moore" "1981" controllability observability |
| 降维 | "musculoskeletal" "surrogate" "polynomial" muscle geometry OpenSim |
| 降维 | "SAR" "synergistic" "RSS 2023" muscle |
| 降维 | "Self model for embodied intelligence" musculoskeletal 2024 |
| 任务控制 | "Motion Control of High-Dimensional Musculoskeletal Systems" github |
| 任务控制 | "MyoDex" "ICML" project |
| 任务控制 | "virtual model control" Pratt 1997 MIT |
| 任务控制 | "operational space" Khatib 1987 task control |
| 物理角色 | "MaskedMimic" "project" |
| 物理角色 | "Perpetual Humanoid Control" "github" |
| 物理角色 | "AMP" "Adversarial Motion Priors" github |
| 物理角色 | "Interactive Character Animation Using Simulated Physics" 2012 |
| 部署 | "MuJoCo" "WebAssembly" github official |
| 部署 | "Rapier" "multibody" joints wasm javascript |
| 部署 | "Brax" "generalized" "spring" "positional" pipelines |
| 数据 | site.amass.is.tue.mpg.de license commercial |
| 数据 | site.lafan1.org dataset license |
| 数据 | "AddBiomechanics" dataset license "OpenCap" |
| 形变 | "PhysRig" "Differentiable Physics-Based Skinning" project |

## 正文与方法的重点阅读

- VRM humanoid、VRMA、姿态转换、节点约束、spring bone 和更新顺序。
- MuJoCo 执行器、激活状态、传动和模型配置。
- 2013 年肌肉双足论文的身体模板、控制与实验配置。
- 2021 年肌肉重定向论文的功能保持、力臂和运动技能实验段。
- FreeMusco 的方法、身体配置、控制频率和实验训练条件。
- SAR 项目方法中的协同提取、通用和任务专属路径。
- VRM 单肘关节论文的硬件、神经肌骨模型与更新链路。
- 官方 WASM 和 mjswan 的部署、线程、内存与资源说明。

“重点阅读方法和实验段”不表示逐页核对了每张图表、推导或全部补充材料。其余条目按来源卡片的实际范围使用。

## 访问限制与替代入口

| 资料 | 本轮情况 | 保留方式 |
| --- | --- | --- |
| Nonlinear Controllability and Observability | 正文返回 418 | 出版方检索摘要，标记正文未取得 |
| Minimal Realizations of Nonlinear Systems | 正文返回 403 | 出版方检索摘要，标记正文未取得 |
| 两篇 Nature 神经协调文献 | 正文访问重定向受限 | 原始摘要与作者机构全文入口 |
| Millard 2013 的 PMC 页面 | 返回浏览器验证页 | PubMed 摘要和作者机构 PDF 链接 |
| 个别 GitHub 原始 LICENSE 路径 | 404 或缓存失败 | 以真实目录和 README 找到的许可路径记录；不凭文件名猜测 |
| MuscleVAE 项目页的早期 click 解析 | 工具未解析成功 | 官方仓库、项目说明与全文入口分别记录 |

## 尚未作为证据取得的内容

没有在本机安装和运行研究框架，没有下载训练集或策略权重，没有启动外部演示，也没有进行同硬件性能复现。来源中的性能均标为作者报告或文档说明。

来源指向持续变化的 main 或 latest 时，记录的是本轮访问状态。正式复现需要把代码、模型、网络和依赖固定到具体提交或发布版本。当前索引没有伪装成已固定的源码快照。


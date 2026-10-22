# 宠物 3D 模型来源与授权

## v8.0（当前）—— 精选高精度现成模型

### 🐕 柴犬 `shiba.glb`（约 1.9MB）

- **来源**：Sketchfab — ["Shiba" by zixisun51](https://sketchfab.com/3d-models/shiba-faef9fe5ace445e7b2989d1c1ece361c)
- **授权**：CC Attribution 4.0（CC-BY 4.0）
- **说明**：Q 版盲盒手办风坐姿柴犬（大头圆眼、白眉点、红色项圈、手绘贴图、
  KHR_materials_unlit 材质）。静态模型，动画由 `PetModelView.tsx` 的刚体层
  程序化驱动（蹦跳 / 呼吸 / 前倾吃 / 压扁打盹 / 开心连蹦）。

### 🐈‍⬛ 小黑猫 `cat.glb`（约 4.1MB）

- **来源**：GitHub [moonwavestudios/rooms_full](https://github.com/moonwavestudios/rooms_full)
  （`models/cat/cat (2)/`，独立游戏《Rooms》官方开源仓库，作者自绘资产）
- **授权**：MIT License（随仓库 LICENSE）
- **说明**：写实毛绒质感黑猫玩家模型（sk_player_cat）：雕刻网格 + 毛发多层
  半透明壳 + 眼球/胡须贴图 + 完整骨骼（j_* 关节 175 通道）；自带骨骼动画
  「Take 001」= 坐姿舔毛/挠脸待机循环（约 6s），由 `PetModelView.tsx` 的
  AnimationMixer 播放、按状态调节 timeScale。

## v8.1 新增

### 🐶 奶油垂耳幼犬 `puppy.glb`（约 2.9MB）

- **来源**：Sketchfab — ["Dog Puppy" by kenchoo](https://sketchfab.com/3d-models/dog-puppy-72331763040e4314b154f84348fe0957)
- **授权**：CC Attribution 4.0（CC-BY 4.0）
- **说明**：写实毛绒质感奶油色垂耳幼犬（精细毛发贴图 + 湿润鼻头/高光眼睛 +
  KHR_materials_specular 材质），14,844 tris / 3 张贴图 / 静态骨骼站立。
  自带 1 段 8.7s 循环待机动画「Animation」（头部左右张望微动），可由
  `PetModelView.tsx` 播放或叠加刚体层程序化动作；模型原生面朝 +Z（正前）。

## 历史记录

### v7.0 —— 程序化 Q 版宠物（已移除）

纯 three.js 程序化建模（QPet.tsx，按用户参考图原创拼装，无第三方资产）。
因观感被用户反馈「跟假的一样」，v8.0 起弃用并移除（git 历史仍可追溯）。

### v6.4 —— Quaternius 模型（已移除）

曾使用 **Quaternius — Ultimate Animated Animals Pack**（CC0 公有领域）
低多边形模型。因风格差距较大弃用。

- 作者主页：https://quaternius.com
- 授权：CC0 1.0 Universal（公有领域）

特此记录，感谢以上作者提供的优秀资源。

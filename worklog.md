# 项目工作日志

项目：AI Phone（仿 iOS 智能助手）— 源自 https://github.com/cczzff468/5200.git

---

Task ID: 1
Agent: 主控 Agent（Z.ai Code）
Task: 从 GitHub 拉取 cczzff468/5200 仓库并部署到本地环境运行

Work Log:
- git clone 直连 github.com 超时（沙箱网络限制），改用 codeload.github.com 下载 main 分支 zip（161MB）成功
- 解压至 /home/z/5200-extract/5200-main 并分析项目结构
- 将 src/、public/、prisma/、db/（含 custom.db）、scripts/、mini-services/、tools/、deploy/ 及根配置文件（package.json、next.config.ts、tailwind.config.ts、tsconfig.json 等）同步到 /home/z/my-project
- 保留环境原有 .env（DATABASE_URL=file:/home/z/my-project/db/custom.db，与仓库期望一致）与 Caddyfile
- bun install 安装 406 个依赖（含 three、@react-three/fiber、leaflet、web-push、speech-asr 等新增包）
- bunx prisma generate + prisma db push（数据库已同步，复用仓库自带 custom.db）
- 启动开发服务器（端口 3000），页面正常渲染

Stage Summary:
- 项目已完整部署并运行：AI Phone — 仿 iOS 智能助手（Next.js 16 + TS + Tailwind 4 + shadcn/ui + Prisma/SQLite）
- 核心功能模块：锁屏/主屏、AI 聊天（LLM+TTS 语音回复）、信息/联系人、天气、主题、浏览器、备忘录、相机、照片、文件、计算器、美团/淘宝模拟、音乐（netease-api mini-service）、情侣空间、朋友圈、塔罗等（src/components/apps/ 105 个、src/components/ios/ 43 个）
- Agent Browser 端到端验证通过：锁屏上滑解锁 → 主屏 → 信息 App → 与 AI 小助手对话（消息已送达、AI 生成 10″ TTS 语音回复、可播放）→ 返回导航 → 桌面端横屏旋转自适应；无浏览器控制台错误
- mini-services：netease-api 的 keeper 脚本已在后台运行；imggen-mock / mock-imggen 未单独启动（按需）
- 后续修改/新增功能请直接在 /home/z/my-project 中进行；推回 GitHub 需注意沙箱直连 github.com 受限（git push 可能需重试或用户自行推送）

---
Task ID: 2
Agent: 主控 Agent（Z.ai Code）
Task: 拾光小屋发型修复（齐刘海/发束小球/背后补发）+ 宠物交互系统（抚摸/喂食/喂水/状态面板/改名）

Work Log:
- [发型] CharChibi3D.tsx v6.7：刘海由「额心中分」改为齐刘海（22-62/62-118/118-158 三片，中央直线压眉 θ76°，两侧顺到鬓角 θ86°）
- [发型] 删除全部发束小球：bob 4 颗内扣发梢、straight backTip+lockTip、wave 3+2 颗、twin/high tailTip；hairTipMat 随之移除
- [发型] 长直发/大波浪背后补发：窄胶囊改为 LatheGeometry 宽发幕（顶部藏头内 → 与发壳下缘 θ100° 衔接 → 垂至腰际，z 压扁 0.6/0.64）；大波浪顶点半径按 y 正弦调制出波浪卷边；修复背后看露头皮问题
- [宠物] types.ts：CharPose 增 'petcare'；新增 PetState/PetCareKind；HomeState.pet 持久化字段
- [宠物] CharChibi3D：新增 petcare 姿势（屈膝微蹲 + 右手前伸下摸/递碗，手随节奏轻摆）
- [宠物] HomeScene PetBuddy v6.9：点击回调 onPetTap；petCmdRef 指令驱动（walk 走向小人 → do 面对面互动）；吃/喝低头啄食动画（headGrp）；喂食/喂水碗（世界坐标组，内容物换色，小鱼饼干仅喂食显示）；9s 走路超时兜底传送（防家具卡死照顾永不完成）；小人/宠物面对面转向；中断/完成事件 onPetEvent
- [宠物] CoupleHome：宠物状态（默认 88/80/90）+ 离线/在线衰减（-4/-3/-6 每小时，48h 封顶）；状态面板 UI（体力蓝/清洁绿/心情橙进度条 + 改名铅笔 + 抚摸/喂食/喂水按钮）；照顾流程（抚摸+心情12/喂食+体力22心情4/喂水+清洁18体力4）；adoptHome 采纳时宠物状态 max 合并（防远端旧档回滚照顾加成）；改名限 8 字
- [验证] Agent Browser 端到端：齐刘海正面✓、短发无小球✓、长直发/大波浪背后宽发幕✓（经衣柜 UI 实时试穿逐一切换截图）；抚摸/喂食全流程✓（体力 88→100、心情 89→100）；改名「糯米团子」跨会话持久化✓
- [修复] 发现并修复走路阶段被家具卡死导致照顾永不完成的 bug（9s 超时兜底传送至小人身边）
- [清理] 移除全部临时调试代码；tsc 通过；lint 61 处均为仓库既有基线（react-hooks/refs 既有模式）

Stage Summary:
- 女主五款发型全面修复：齐刘海、无发束小球、长直发/大波浪背后不再露头皮
- 宠物交互系统完整落地：点击出面板、三种照顾动作带走位/蹲姿/递碗/进食动画、三围状态条、改名、跨会话持久化 + 时间衰减
- 关键文件：scene/CharChibi3D.tsx、scene/HomeScene.tsx、CoupleHome.tsx、types.ts

---
Task ID: 3
Agent: 主控 Agent（Z.ai Code）
Task: 齐刘海精修 + 小屋 HUD 重排（右上角宠物头像/毛玻璃面板/底部互动条/删全屏/相机移位）+ 宠物新动作（洗澡/抱抱/召唤）+ 钢琴面板变小

Work Log:
- [发型] CharChibi3D v7.0：三片齐刘海下缘统一 θ81°（y≈0.043m，处于眉 0.055 与眼顶 0.034 之间）→ 直线齐到眼睛上方不压眉不遮眼；bob 侧片上缘 86°→81° 同步衔接无缝
- [宠物] types.ts PetCareKind 增 'bath' | 'hug' | 'summon'
- [宠物] HomeScene PetBuddy：PET_CARE_DUR 增 bath 4.6/hug 3.4/summon 1.6；召唤走路速度 1.75×（一叫就到）；抱抱 do 阶段宠物贴到小人身前 0.15m + hugLift 抬升至胸口 0.33m（随呼吸轻晃、怀里每 1.1s 冒爱心、结束缓降回地面，含打断/切模式归零兜底）；洗澡 do 阶段 6 颗肥皂泡泡（PET_FOAM，呼吸起伏+光泽闪烁）；bowl/低头啄食仅限 feed/water；到位反应按 kind 分流（pat/hug/summon=压扁+爱心，bath=喵一声）
- [HUD] CoupleHome v7.0：删除全屏按钮（toggleFull/full state/Maximize/Minimize 一并移除）；相机按钮移到左上返回键正下方（左列 flex-col）；右上角新增宠物头像（🐱+红项圈 ring，状态<30 亮脉冲提醒点，点击开合面板，最外侧）；宠物状态面板改为从右上角头像下方弹出（origin-top-right，毛玻璃胶囊风：border-white/60 + bg-white/55 + backdrop-blur-2xl，三条状态改白/60 胶囊行）；面板内照顾按钮移出 → 底部独立互动条（bottom-[152px] 居中，毛玻璃 grid 3×2 六按钮：抚摸/喂食/喂水/洗澡/抱抱/召唤，进行中锁定，衣柜打开时隐藏，拍照/装修模式隐藏）
- [HUD] 位置避让：家具动作栏 196→272、cupBarCls 330/272、tvBarCls 388/330/272（整体上移 76px），验证与底部互动条无重叠（坐下按钮实测在互动条上方）
- [逻辑] beginAction 增照顾中守卫（petCareRef + effect 同步，不新增 lint）；照顾中不允许开始家具动作，反之 startPetCare 已有守卫
- [文案] startPetCare/onPetEvent 改 Record<PetCareKind,string> 全 kind 文案；结算：bath 清洁+26 心情+6、hug 心情+16 体力+2、summon 心情+4
- [钢琴] InstrumentOverlay：钢琴容器 h-[44%] max-h-380 → h-[34%] max-h-280（上下变小，吉他不变）
- [验证] tsc 通过（仅 next.config.ts 既有基线错误）；eslint 变更文件 60 处均为既有基线模式（0 新增）
- [验证] Agent Browser 端到端（390×844）：新 HUD 布局✓（左上返回+相机、右上装修/⋮/宠物头像、底部六键互动条、无全屏按钮）；头像点开毛玻璃面板✓；洗澡全流程✓（宠物走到身边→泡泡→清洁 80→100）；抚摸✓（心情+12）；抱抱✓（心情→100、体力+2）；召唤✓；改名「糯米团子」✓；拍照模式从新相机按钮进入✓；坐下动作栏与互动条分层✓；控制台无错误
- [说明] 齐刘海正面效果已在 ab-34 截图验证（刘海缘在眼上方、两侧齐平）；钢琴高度为纯 CSS 改动未单独走钢琴弹奏流程

Stage Summary:
- 女主齐刘海精修完成（眼上方直线齐缘、两侧同高）；小屋 HUD 完成用户要求重排；宠物系统新增洗澡/抱抱/召唤三种互动（动画+结算+文案完整）；钢琴弹奏面板上下收窄
- 关键文件：scene/CharChibi3D.tsx、scene/HomeScene.tsx、CoupleHome.tsx、types.ts、InstrumentOverlay.tsx

---
Task ID: 4
Agent: 主控 Agent（Z.ai Code）
Task: v7.1 宠物系统升级 —— 头像 SVG 美化 + 互动竖条重做（点宠物才出现）+ 男生/宠物跨房间漫游 + 猫窝夜睡 + 需求气泡 + 表情联动 + 刘海加长 + 钢琴再缩窄 + 萌系音效

Work Log:
- [HUD] CoupleHome：右上角宠物头像由 🐱 emoji 改为内联 SVG 猫头 CatFaceIcon（奶油脸+耳内廓+豆豆眼+w 嘴+腮红+胡须+红项圈金铃铛，与 3D 猫同配色），白玻璃圆钮粉环；状态面板头部头像同步替换
- [HUD] 互动条重做：底部毛玻璃 grid → 屏幕右侧竖排（right-3 top-1/2），六按钮改白玻璃圆钮（bg-white/70+ring+backdrop-blur，无彩色底），彩色图标+9px 小字；PET_ACTIONS 删 bg 字段
- [HUD] 交互逻辑：onPetTap 改为切换 petBarOpen（不再弹状态面板，面板只由头像唤出）；onFloorTap/onFurnTap 点别处收竖条；照顾完成/中断自动收起（onPetEvent done/cancel）；新增 petTapAtRef 450ms 守卫——修复「down 点中宠物开条 → up 射线落到地板/家具触发关闭」的闪烁 bug
- [场景] 跨房间漫游系统（HomeScene）：ROOM_ADJ 房间邻接图（lr-br/kt/ba、br-bal 树形）+ planDoors BFS + planRoute 门走廊双路点（DOOR_STEP=0.5，bed/kt/bal 横墙、bath 竖墙）+ roamStep 直线走+collideAndClamp 真实门态 + roam() 权重选房间（lr4/br2/kt1.5/ba1/bal1.5）+ WeakMap 卡死检测（0.9s 位移<0.05 放弃重选）；wander/petWander 删除
- [场景] GameLoop 男生 partner 漫游接 roam(doorRef)，开着门就跨房间闲逛（E2E 观察到男生在客厅/厨房/门口多个位置移动）
- [场景] PetBuddy 夜晚回窝：找 items 里 petBed → planRoute/roamStep 走向窝 → 蜷成团（sleepEase 缓动：scale 压扁 0.66/1.14、头埋 0.55rad、耳朵放平、尾巴卷身、呼吸起伏）→ Zzz sprite 循环上浮（2.2s 周期，手绘三连 Z 贴图）；天亮/照顾指令唤醒；8s 走不到窝 → 传送进窝兜底（修复被家具夹住永远到不了窝的 bug）
- [场景] 猫窝夹缝迁移（CoupleHome 补植 effect 重写）：badSpot=周围 0.35m 内有家具 AABB（footprintOf 旋转脚印）→ 挪到 pickSafe()（客厅随机 60 次开阔点，fallback 西北角固定点）；修复 findSpot 把窝随机进沙发-墙夹缝导致宠物卡死出不来
- [场景] 猫窝建模：Furn3D 新增 petBed 分支 + PetBed3D 程序化组件（樱粉外壳圆环+外壁+奶油内垫+白珠缝线+毛线球+拖线）；CATALOG 加 petBed（fp 0.66×0.58，decor 类，playful 弹跳）；types.ts FurnitureKind + 'petBed'；defaultHome 预置一个
- [场景] 需求气泡（D）：makeNeedTexture 手绘三款（饭碗热气/水滴/泡泡圈），宠物头顶 0.6m 并排浮动；体力<30=饿了、心情<30=想喝水、清洁<30=要洗澡；睡觉/照顾中隐藏；map 运行时切换+needsUpdate
- [场景] 小人表情联动（E）：4 颗爱心/星星交替 sprite（makeStarTexture 金星）跟随 meRT 头顶（1.02+age*0.3）上浮，do 阶段每 0.55s 冒一颗；抱抱时额外大笑脸（makeSmileTexture 弯眼+弧嘴+腮红）周期 1.6s
- [音效] sfx.ts 新增 7 个纯合成音效：purr 呼噜（62Hz sawtooth+24Hz LFO 颤动 1.1s）、crunch 咔嚓（双段 1900Hz 高通噪声）、sip 咕咚（双下滑水泡）、bathWater 流水（2.2s 带通噪声起伏）、kiss 咂嘴（340→880→420 圆润滑音）、whistle 召唤哨（双连上滑）、meow 喵叫（620→900→480 triangle+13Hz 颤音）；接线：摸头/进窝 purr、到位 kiss/meow、do 节拍 crunch/sip/bathWater、召唤指令 whistle
- [发型] CharChibi3D 齐刘海加长：三片 BANGS 下缘 θ81°→85°（bob 侧片上缘同步 85° 衔接），更长的齐刘海仍不遮眼
- [钢琴] InstrumentOverlay 钢琴容器 h-[34%] max-h-280 → h-[27%] max-h-218（键床 flex-1 自适应同步变窄）
- [验证] tsc 通过（仅 next.config.ts 既有基线错误）；eslint couple-home 63 处与 git stash 基线完全一致（0 新增）
- [验证] Agent Browser E2E（390×844）：SVG 猫头头像 ✓、点头像弹毛玻璃面板（面板内 SVG 头像）✓、互动竖条右侧竖排白玻璃圆钮 ✓、喂食全流程（按钮锁定→宠物走来→体力 88→100→自动收起）✓、点地板/点家具竖条消失 ✓、猫窝渲染+补植/迁移 ✓、男生跨房间漫游多处目击 ✓、夜晚模式+回窝逻辑 ✓；控制台无 error/warn（errors 面板仅 HMR 重连空噪音）
- [验证环境说明] headless rAF 节流至 2fps（dt clamp 0.05 → 游戏时间 10× 慢），瞬态动画（爱心/星星/笑脸/Zzz/需求气泡出现帧）与音效无法在该环境采证，逻辑均已代码审查确认；真机 60fps 下正常
- [清理] 删除 E2E 临时 window.__petDebug 钩子；agent-browser 会话关闭

Stage Summary:
- 宠物交互第二轮升级完成：无 emoji 的 SVG 猫头入口、点宠物才出现的右侧竖向互动条（点别处/完成自动消失）、男生与宠物全屋跨房间漫游（房间图寻路+门走廊+卡死兜底）、猫窝家具+夜晚回窝 Zzz、头顶需求气泡、照顾时小人表情粒子、7 个萌系音效；女生齐刘海再加长；钢琴再缩窄
- 关键修复：①点宠物 up 射线误关竖条（450ms 守卫）②猫窝落进沙发夹缝导致宠物卡死（badSpot 检测+pickSafe 迁移）③夜晚回窝被家具挡死（8s 传送兜底）
- 关键文件：CoupleHome.tsx、scene/HomeScene.tsx、scene/CharChibi3D.tsx、scene/Furn3D.tsx、sfx.ts、types.ts、catalog.ts、InstrumentOverlay.tsx

---
Task ID: 5
Agent: 主控 Agent（Z.ai Code）
Task: v7.2 宠物头像移位 + 面板下方互动按钮 + 头发白点修复 + 抱抱=抱起随意走动/放下

Work Log:
- [头发白点] CharChibi3D：诊断确认为低多边形发壳（22×12 细分）+ 低粗糙度（女 0.58/男 0.7）导致的方向光逐面片高光闪烁（碎白点）；修复 = 粗糙度提高（女 0.78/男 0.85）+ 发壳细分 30×18 + 长直发/大波浪 LatheGeometry 26→34 段；白天/夜晚双光照 E2E 截图确认白点消失
- [抱抱=抱起] types/HomeScene/CoupleHome：抱抱指令携带 carry 标志（petCmdRef {kind,seq,carry}）；PetBuddy care ref 增 carry 字段 —— walk 走向小人 → do 阶段贴身 0.27m + 抬升 0.33m（跟随更紧 dt*10）→ carrying=true 永不自动结束；开局 3.2s 冒爱心庆祝后安静窝着；表情粒子/笑脸同步 3.4s 门控；被抱时压扁窝团（scale 1.07/0.89）+ 尾巴卷贴身
- [放下] petCarryCmdRef {on:false,seq} 独立通道：放下 = 放到小人面前 0.42m + collideAndClamp 防卡家具 + kiss/爱心 + 恢复漫游；抱起途中点放下 = 取消照顾原地释放；切装修模式自动放下（mode!=live 分支复用）
- [怀抱手势] CharChibi3D carryRef 增 pet 字段：站立/走路双臂环抱（arm ±0.62/-1.42 + 走路轻颠）+ 低头看怀里（head 0.09），与端杯互斥（端杯逻辑 !petCarry 包裹）
- [UI 状态机] CoupleHome：carrying state + carryPetRef 镜像；startPetCare 抱着态守卫（抱抱=放下 + toast，其他动作提示先放下）；onPetEvent 增 'dropped' 事件 + arrive(hug) 抱起完成（pose stand + 结算 mo+16/st+2 + 按钮解锁）；beginAction 抱着时拦截家具动作
- [HUD] 右上角宠物头像移到「装修小家」按钮左侧（顺序：猫头像/装修小家/⋮）；宠物状态面板下方新增互动按钮区（分隔线 + grid 3×2 白玻璃圆钮，PetActionButton 复用组件）；抱抱按钮抱着时变「放下」（ArrowDownToLine 图标）；面板与右侧竖条互斥（点头像/点宠物互收）；点地板/家具同时收面板与竖条；面板提示文案改「点下面的按钮照顾它吧～」
- [验证] tsc 通过（仅 next.config.ts 既有基线）；eslint 三文件 60 处与 git stash 基线完全一致（0 新增）
- [验证] Agent Browser E2E（390×844）：右上角头像顺序✓；头像唤出面板+下方六按钮✓；抱抱全流程（宠物跑到身边→爱心→抱起）✓；摇杆抱着走动（镜头跟随平移）✓；按钮变「放下」+ 结算（心情 90→100/体力 88→90）✓；放下→猫落地+按钮恢复「抱抱」✓；点地板关面板✓；白天/夜晚头发无白点✓；控制台无 error（仅 three.js 既有弃用警告）
- [验证环境说明] headless rAF 节流至 2fps → 游戏时间 10× 慢，宠物走路等待约 60-90s 现实时间（9s 超时兜底在真机为 9s）；抱起途中放下/装修自动放下两条路径经代码审查覆盖未单独实测

Stage Summary:
- 白点根因修复（材质高光闪烁而非粒子）；抱抱改为「抱起怀抱随意走动 + 放下」双态交互；互动按钮同时出现在面板下方与点宠物的右侧竖条；宠物头像移到装修小家左侧
- 关键文件：CoupleHome.tsx、scene/HomeScene.tsx、scene/CharChibi3D.tsx

---
Task ID: 6
Agent: 主控 Agent（Z.ai Code）
Task: 3D 拾光小屋 · 完整陪伴交互系统（入口配置 / 3D头顶气泡对话+TTS / A*寻路指令执行 / 拥抱牵手 / AI主动请求与自主行动 / 记忆系统全面接入）

Work Log:
- [模块一·场景基础 commit 224020d] pathfind.ts 新建：0.2m 全屋 A* 网格寻路（墙段盒+关门洞补挡+家具脚印三重阻挡、对角防切角、视线拉直、目标被挡螺旋找近点、不可达返回 null）；房间图 planRoute/planDoors/doorPoints 自 HomeScene 迁出共用
- [模块一] companion-rt.ts 新建：陪伴小人状态机（come/goto/sit/lie/watch/lamp/free + hug + holdhand）；A* 路点跟随+collideAndClamp 注入；卡死 0.9s 重算一次后 giveup 回报；坐/躺粘性 25~55s 自起；牵手 0.5m 跟随（远=直奔+节流 A* 绕障、近=退半步防穿模、进新房间回报 room 事件）
- [模块一] CharChibi3D：新增 hug（双臂环抱前倾）/holdhand（牵手步行双态）姿势；partner 姿势通道 poseRef2；点击热区 onTap（透明大球 stopPropagation）
- [模块一] HomeScene：GameLoop 陪伴优先于漫游；A* 阻挡网格随 items/门态/门位重建；HeadBubbles 组件（canvas 气泡纹理缓存、每人一槽排队、淡入淡出、跟随头顶）
- [模块二 commit e5ce5d1] companion-brain.ts：buildCabinSystem（persona 七要素 channel=拾光小屋 + 实体行动 JSON 协议 <<ACT>>{actions}<<END>> + 聊天方式 + 记忆块 + 实时情境【我在干嘛/房间/牵手/昼夜/天气/时间/附近家具/照片识图】）；cabinChatTurn（/api/chat 代理→失败 forceSdk 重试）；parseAiReply（动作块拦截+按行拆 1~10 条气泡）
- [模块二] companion-memory.ts：cabinEventMemory（sourceTag 去重直写事件碎片）/ cabinBehaviorMemoryOncePerDay（同类一天一次）/ cabinRecentInteractions（最近物理互动摘要）/ cabinMemoryBlock（memChatRecallBlock 标准召回+摘要注入）/ cabinAfterChatTurn（memAfterAiTurn 标准管线 scene=拾光小屋）
- [模块二] MemApp/AccountApp 新增 'cabin'（MEM_APP_LABEL=拾光小屋；DEFAULT_APPS/LOGIN_HIST_KEY/FORCE_LOGIN_KEY/ACCOUNT_APP_NAMES 补齐；proactive-msg avatarApp cast）
- [模块二] CoupleHome：进入弹联系人选择列表（localStorage 记忆、⋮ 菜单「换个TA陪伴」重弹）；右上角 💬 信息图标→底部聊天输入条（文字/麦克风 Web Speech 实时转写再点自动发送/附照片走设置里识图模型 /api/vision）；AI 多条回复逐条气泡（用户消息 10s 淡出）+ 小人声音开关开启时角色音色 TTS 逐句播报（speakUserTts）+ 关闭时按阅读节奏排队
- [模块三] 点小人环形菜单【拥抱】【牵手】（牵手中=【松开】）：拥抱走过来→双方 hug 姿势→用户走动/6s 自动松开；牵手→0.5m 跟随；AI 主动请求弹窗「××想要拥抱你/想牵牵你的手」（同意→动画+记忆、拒绝→失落记忆+头顶小情绪气泡、45s 自收回）；自主行动调度（坐下/开电视看节目/去别的房间，记忆同类一天一次）
- [模块三] 全事件记忆：拥抱（user/ai 两视角）、牵手、指令执行（「主人让阿澄××，TA 照做了」）、主动请求同意/拒绝、牵手进新房间空间记忆（「主人牵着阿澄的手，把TA带到了××」）、自主行为（一天一次）
- [修复 E2E 发现] 点小人环形菜单被同一次点击 up 射线立即关闭（v7.1 宠物竖条同款 bug）→ partnerTapAtRef 450ms 守卫（onFloorTap/onFurnTap 双入口过滤）
- [验证] tsc 通过（仅 next.config.ts 既有基线）；eslint CoupleHome 47 处与基线完全一致（0 新增），新文件 pathfind/companion-rt/companion-brain/companion-memory 0 问题
- [验证] Agent Browser E2E（390×844）：入口联系人选择弹窗✓（创建「阿澄·恋人」后选定）；💬 图标+聊天输入条（含麦克风/拍照/发送/忙碌态）✓；用户消息头顶气泡（10s 淡出）✓；无 API 配置时 /api/chat 上游失败→SDK 兜底回复成功✓；AI 多条气泡逐条排队展示✓；「过来陪我坐到沙发上」→阿澄走位坐下并回复「刚坐到沙发上」✓；AI 主动请求弹窗两次触发✓（拒绝→头顶「呜……那好吧。」情绪气泡✓）；自主行动（自动开电视+坐电视前）✓；⋮ 菜单「小人声音 已关→已开」「换个TA陪伴 阿澄」✓；昼夜自动切换不受影响✓；换台等既有功能无回归✓
- [验证] 记忆库 IndexedDB 直查：app='cabin' 碎片已入库——「阿澄打开电视，坐在电视前看了会儿节目。」(cabin-auto:watch)、「阿澄想求个抱抱，但被主人拒绝了，有点失落。」(cabin-hug-reject)；互通开关下微信/QQ/信息/电话可召回
- [验证环境说明] headless rAF 节流 2fps → 走位/拥抱动画时长 10× 慢，环形菜单点选在移动目标上无法稳定命中（守卫修复后机制与 v7.1 宠物点击同源，真机 60fps 验证）；TTS 出声无法在 headless 采证（链路复用既有 speakUserTts 已验证实现）
- [说明] git push 无远程仓库（沙箱不可达 github）——三个模块 commit 均在本地（224020d / e5ce5d1 / 本次），用户网络可用时可自行推送

Stage Summary:
- 拾光小屋完整陪伴交互系统落地：选人入口 → 头顶气泡对话（TTS+麦克风+识图+多消息）→ 物理指令 A* 寻路执行 → 拥抱/牵手/跟随 → AI 主动请求 → 自主行动 → 六类事件全部入角色记忆库并跨 App 互通
- 关键文件：scene/pathfind.ts、scene/companion-rt.ts、scene/HomeScene.tsx、scene/CharChibi3D.tsx、companion-brain.ts、companion-memory.ts、CoupleHome.tsx、lib/memory-core.ts、lib/ios/accounts.ts
- 待用户反馈的后续优化清单已随回复输出（室内语音质检/牵手镜头/聊天记录持久化/记忆库场景标签筛选等）

---
Task ID: 7
Agent: frontend-styling-expert
Task: 衣柜弹窗毛玻璃胶囊美化 + 新增「宠物」栏（毛色/项圈/围巾/蝴蝶结）

Work Log:
- [毛玻璃] Wardrobe.tsx 抽屉容器：奶油渐变底（from-[#fff7f3] via-white to-[#fdf3ee]）→ border-white/60 + bg-white/55 + backdrop-blur-2xl + shadow-[0_-8px_40px_rgba(120,70,80,0.22)]（rounded-t-[26px] 保留，质感对齐宠物状态面板）
- [毛玻璃] 角色切换胶囊组容器 bg-[#f6ebe6] → bg-white/50 + ring-1 ring-white/70；选中胶囊改 /90 透明度（女生 #f4a7bc/90、男生 #7fc8ae/90，白字与投影保留）
- [毛玻璃] 分类 Tab 胶囊：未选中 bg-white + ring-[#f0e2dc] → bg-white/60 + ring-white/70；选中同上 /90；款式网格卡片：选中 bg-[#ffeef3] → bg-white/75（ring-2 ring-[#f4a7bc] 不变）、未选中 bg-[#fffdf9] → bg-white/45 + ring-white/70；调色盘/全色系外框、把手、标题、关闭按钮、summary 均保留
- [宠物] WardrobeProps 新增四个可选 props：petWear/petCoat/onPetChange({coat?,wear?})/initialChar（import type { PetCoat, PetWear } from './types'）；char state 扩为 'girl'|'boy'|'pet'，初始值 initialChar ?? 'girl'（useState 只初始一次）
- [宠物] 角色切换扩三档：新增「宠物」胶囊，选中 bg-[#e8b06a]/90 text-white + 同色投影；switchChar 支持 pet（不重置 tab，切回 girl/boy 时原 tab 保持有效）
- [宠物] pet 分支渲染：宠物专属滚动容器替换分类 Tab/调色盘/全色系/款式网格四块（各自包 char !== 'pet' 条件）；顶部小猫预览（内联 SVG PetHeadPreview：猫头+项圈金铃铛+围巾/蝴蝶结随装扮实时显隐）+ 摘要行「奶油猫 · 樱红项圈 · 戴围巾」格式（标题 summary 在宠物态同步显示该文案）
- [宠物] 毛色栏：grid-cols-4 四卡（奶油/橘子/烟灰/奶牛）各含 MiniCatIcon 迷你猫脸 SVG（48×48：三角耳+耳内粉 #f6c2ca+圆脸+豆豆眼+粉鼻+w 嘴+腮红，奶牛加两块不规则深灰 #3f3f44 斑块，CatHead 共用部件）；选中 ring-2 ring-[#e8b06a] + 杏黄角标；点击 onPetChange({ coat })
- [宠物] 项圈栏：色板 = 默认樱红 #e46a6a + CLOTH_COLORS 前 8 色（PetSwatches 共用组件），当前色 ring-2 ring-[#e8b06a] + Check，点击 onPetChange({ wear: { ...petWear, collar } })
- [宠物] 小围巾/蝴蝶结栏：各一行「戴上/不戴」白玻璃胶囊切换（戴上写默认色 #e8927c/#f4a7bc，不戴写 null）+ 戴上时同款式板换色；摘要联动「戴围巾/戴蝴蝶结」
- [宠物] 全部宠物按钮 sfx.tap() + aria-label（毛色卡/色板/四枚切换钮）；色板 aria 带色名（樱红/樱粉…）
- [验证] bunx tsc --noEmit 过滤 next.config.ts 后 0 输出；既有 HAIR_NAMES[h] 等字节级完好（od 抽查，避开环境显示丢 [h 的坑）；仅改 Wardrobe.tsx（725→1052 行），无新依赖
- [说明] CoupleHome/types.ts 的未提交改动来自本任务流水线其他并行任务，本任务未触碰；parent 接线（传 petWear/petCoat/onPetChange/initialChar）由后续任务完成，四个 props 均可选、当前调用方式向后兼容

Stage Summary:
- 衣柜抽屉整体升级毛玻璃胶囊风（容器/角色胶囊/分类 Tab/款式卡四层），功能与文案零变更
- 新增第三角色栏「宠物」：毛色四款迷你猫脸卡 + 项圈色板 + 围巾/蝴蝶结「戴上/不戴」胶囊与同款式板，实时 SVG 预览 + 搭配摘要，patch 式 onPetChange 回调待父组件接入
- 关键文件：src/components/apps/couple-home/Wardrobe.tsx（唯一改动）

---
Task ID: 8
Agent: 主控 Agent（Z.ai Code）
Task: v8.1~v8.3 —— AI 小人生活技能全家桶（钢琴/吉他/放歌/开灯/做饭/开门/睡觉/吃饭）+ 优化项 A-D + 衣柜毛玻璃美化 + 宠物全家桶（换装/毛色/玩具球/第二只宠物/小剧场/成长系统）

Work Log:
- [v8.1 commit 813658a] companion-rt：新增 play/cook/music/door/eat 指令（乐器锚点/灶台/发声设备站位/关门走点/餐桌），粘性姿势 cmd.dur（0=长睡到天亮）；companion-brain：ACT 协议扩 5 类 + 提示词示例；CoupleHome：事件结算（cook finish→一桌好菜上桌、music finish→关音箱、天亮→长睡自醒）、自主行动调度扩弹琴/做饭/放歌/夜睡、charActivityText 全量映射；HomeScene：partnerPlayingId 联动 Furn3D 音符 + 音箱/收音机开着也飘音符
- [v8.2 commit bede097] 优化A 聊天持久化：cabin-chat-<id> localStorage 按角色分档（选人恢复/换人封存/每轮落盘，上限40条）；优化B 牵手专属镜头：GameLoop hold 阶段镜头拉远 dist≥10.9 + 两人中点 + pitch≤0.74（不写回用户 ref，松手恢复）；优化C 夜睡做梦：夜里自主上床（dur=0）+ 头顶 9~17s 冒梦话气泡（聊天可回应）+ 天亮自醒；优化D 一起做动作：AI 回应「一起/陪」+watch/eat/play → TA 到位后招呼用户同步入座（弹琴用另一件乐器防抢琴凳），反向用户开始 watch/eat 时空闲 TA 自动凑过来
- [Task 7 子代理] Wardrobe.tsx：毛玻璃胶囊重做（容器/胶囊组/Tab/卡片全换 bg-white/55+backdrop-blur-2xl 质感）+ 新增「宠物」栏（毛色 4 卡带迷你猫脸 SVG / 项圈色板 / 围巾/蝴蝶结 开关+色板 / initialChar 预设）
- [v8.3 commit 52e32e4] types：PetCoat/PetWear/PetExtra/Pet2State + PetCareKind+shake/spin/roll/ball + HomeState.pet2；PetBuddy：四色毛色（奶牛带三块斑块）/项圈色/围巾/蝴蝶结 meshes、握手（右前爪 ref 抬爪挥）/转圈（自转 4π）/打滚（侧翻 2π+离地弧）把戏动画、玩具球状态机（抛物线+落地弹跳+叼回主人脚边+mo+8）、小剧场（白天蝴蝶精灵绕飞猫追 8s / 夜里三只萤火虫飘+蹲守扑跳 / 雨天走到沙发旁趴 10s）、PetBuddy2 第二只宠物（小狗垂耳摇尾/兔子长耳蹦跳，追猫玩 9~17s 一次、摸摸汪汪&噔噔、夜里蜷窝边睡）；CoupleHome：成长系统（Lv1~9 = 1+天数/2+照顾/6，握手Lv2/转圈Lv3/打滚Lv5 解锁，面板 Lv 徽章+陪伴天数+升级进度+升级 toast）、扔球/把戏按钮（面板 3×4 + 右侧竖条）、领伙伴弹窗（小狗/小兔子）、装扮按钮直开衣柜宠物栏；sfx：whoosh/pop/bark/boing 四音效
- [E2E 修复 commit 2244aa9] ①TA 走路被关着的门挡住→重算失败时自动开门自救（closedDoorNear 0.85m + auto-open 事件 + 宿主开门+「把门推开」文案，repathed 复位续走）②主动请求守卫改 idle/near 才触发（弹琴/做饭/睡觉中不再弹窗打断）
- [验证] tsc 0 错误；eslint couple-home 新增仅 2 处与全仓既有 itemsRef.current=items 同款模式（基线 CoupleHome 42/HomeScene 14 不变）
- [验证] Agent Browser E2E（390×844）：入口选人✓；宠物面板 Lv.1 徽章/陪伴第1天/成长进度/领伙伴/扔球+三把戏锁定✓；扔球抛出✓；衣柜毛玻璃+宠物栏（橘子毛色/围巾/蝴蝶结即时生效，3D 猫变橘色目视）✓；领养小狗进场✓；小剧场蝴蝶出现猫在追✓；AI 对话两条回复均带 <<ACT>>（play / goto br+play）✓；走路→卡门→自动开门→进卧室→坐下弹奏 全链路目视✓；AI 主动请求弹窗两次（牵手版/拥抱版）+拒绝路径✓；聊天存档 localStorage 落盘✓；控制台无 error（仅无上游 API 的预期兜底告警）
- [验证环境说明] headless rAF 2fps（真机 60fps 正常）：TTS 出声、牵手镜头过渡、把戏动画（需 Lv2）、夜睡梦话、雨天躲屋檐为代码审查覆盖；球抛物线/捡球完整回环因 10× 慢速未等完全程
- [git] push 依旧不可达（沙箱无 github 权限），4 个 commit 全部在本地：813658a / bede097 / 52e32e4 / 2244aa9

Stage Summary:
- AI 小人现在会：弹钢琴/吉他（音符飘出）、做饭（做完菜真上桌可开饭）、放歌（音箱/唱片机开+音符）、开灯、开门（含被门挡住自己开）、上床长睡+做梦说梦话、吃饭；用户一句话即可指挥，全事件入角色记忆库
- 优化项 A-D 全落地：小屋聊天退出重进不丢、牵手双人电影镜头、夜里睡觉冒梦话（可回应）、「一起看电视/吃饭/弹琴」双向同步
- 衣柜弹窗毛玻璃胶囊美化 + 新增宠物栏（换毛色/项圈/围巾/蝴蝶结）；宠物系统：玩具球扔捡、第二只宠物（狗/兔）、小剧场（蝶/萤火虫/雨躲）、成长等级解锁把戏
- 关键文件：companion-rt.ts、companion-brain.ts、CoupleHome.tsx、scene/HomeScene.tsx、Wardrobe.tsx、types.ts、sfx.ts、scene/pathfind.ts（doorPoints 复用）

---
Task ID: 9-b
Agent: frontend-styling-expert
Task: 衣柜宠物毛色调色盘 + 物种感知预览

Work Log:
- [调色盘] Wardrobe.tsx 新增 PALETTE_COLORS 30 色板（樱红/桃红/粉红/樱粉/玫紫/橘橙/杏橘/鹅黄/奶黄/嫩绿/薄荷/青碧/天蓝/雾蓝/宝蓝/淡紫/藕紫/奶油/奶白/雪白/杏色/淡粉/淡绿/淡蓝/米白/米棕/浅棕/棕褐/深棕/炭黑，含 4 预设同款 hex 便于狗兔取用同色调）
- [调色盘] 宠物栏毛色区改为「猫：4 预设快速卡（奶油/橘/烟灰/奶牛，MiniCatIcon 不变）+ 全色系调色盘；狗/兔：只显示调色盘」；调色盘 flex-wrap 网格 30 枚 h-6 w-6 圆点（复用 PetSwatches 色板风格：选中 ring-2 ring-[#e8b06a] ring-offset-1 + Check，未选 ring-1 ring-black/10；浅色自动深色 Check——isLightHex 亮度>205 判定），点击 sfx.tap() + onPetChange({ coat: '#hex' })，aria-label「毛色 ×色名」
- [hex 毛色渲染] 新增 coatIconColors()：预设名查 PET_COAT_COLORS；任意 #rrggbb 直接当体色 + 脸部 lightenHex(0.16) 提亮；非法值回落奶油 —— CatHead 改走该函数（修复 Record<PetCoat> 索引对 hex 返回 undefined 的运行时隐患）；新增 lightenHex/shadeHex/isLightHex/HEX_RE 工具
- [物种感知] 新增可选 prop petKind?: 'cat'|'dog'|'rabbit'（export type PetKind 从 Wardrobe 导出供父组件接线；缺省 'cat'）；PetHeadPreview 增 kind 参数：cat=CatHead 沿用、dog=新 DogHead（垂耳 shadeHex 深一档 + 吻部 + 深色鼻头）、rabbit=新 RabbitHead（长耳 + 耳内粉 + 圆脸），48×48 坐标系与豆豆眼/w 嘴/腮红风格与猫头一致；项圈/铃铛/围巾/蝴蝶结三物种共用
- [物种感知] 摘要行随物种：cat+预设=奶油猫/橘猫/灰猫/奶牛猫；任意 #hex=调色盘色名（不在盘内则「自定义色」）+ 小猫/小狗/小兔子；狗兔套预设名=基础名+物种（PET_COAT_BASE 表，如「奶油小狗」）；标题 summary 与栏内摘要行同步生效
- [布局] 预设卡 grid 包进 kind === 'cat' 条件；「全色系调色盘」小标题仅猫显示（狗兔为「毛色」标题直连色板）；项圈/围巾/蝴蝶结栏与毛玻璃胶囊风格零改动
- [验证] bunx tsc --noEmit 过滤 next.config 后 0 输出（Wardrobe 相关 0 错误）；bunx eslint Wardrobe.tsx 0 问题；仅改 Wardrobe.tsx（1053→1255 行），未动 types.ts 及其他任何文件；未跑 dev server、未做 git 操作

Stage Summary:
- 宠物毛色从 4 预设卡升级为「预设 4 卡（仅猫显示）+ 30 色全色系调色盘（猫狗兔通用）」，任意 #hex 毛色可正确渲染到头像（体色+脸部自动提亮）与搭配摘要
- 新增 petKind 物种感知：预览 SVG（狗=垂耳+吻部 / 兔=长耳+圆脸，风格与猫头统一）与摘要行随物种显示
- 关键文件：src/components/apps/couple-home/Wardrobe.tsx（唯一改动）；父组件后续传 petKind 即可接线（PetKind 类型已从 Wardrobe.tsx 导出）

---
Task ID: 10-b
Agent: frontend-styling-expert
Task: E1 小屋聊天记录回看面板（新文件 CabinHistorySheet.tsx）

Work Log:
- [新文件] src/components/apps/couple-home/CabinHistorySheet.tsx：底部抽屉毛玻璃胶囊回看面板，质感对齐 Wardrobe / 宠物状态面板（rounded-t-[26px] + border-white/60 + bg-white/55 + backdrop-blur-2xl + shadow-[0_-8px_40px_rgba(120,70,80,0.22)]）
- [结构] 外壳组件 `if (!open) return null`；内层 HistorySheetInner 每次打开全新挂载（自动重读最新存档，惰性 useState 读档）；framer-motion spring（damping 30 / stiffness 320，与 Wardrobe 同参）y:'100%'→0 translate-y 滑入；遮罩 fixed inset-0 z-[65] bg-black/25 点击关闭，抽屉 fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-[430px]
- [头部] 标题「和{name}的聊天记忆」+ 右上圆形关闭钮（lucide-react X，白玻璃圆钮 ring+shadow）；信息行「共 N 条 · 最近聊天 new Date(ts).toLocaleString('zh-CN')」（ts 无值不显示时间）
- [列表] max-h-[52vh] overflow-y-auto + webkit 细滚动条（[&::-webkit-scrollbar]:w-[4px] / thumb 圆角 bg-[#e3c8d1] / track 透明）；me=右侧粉调气泡 bg-[#fbdce6]/90 rounded-br-md、peer=左侧白玻璃气泡 bg-white/75 rounded-bl-md，max-w-[78%]、text-[13px] leading-relaxed、rounded-2xl、whitespace-pre-wrap；条目间 gap-2.5、容器 px-4 pb-3；空状态居中灰字「还没有聊天记忆，去和 TA 说说话吧～」
- [数据] 读 localStorage `cabin-chat-${charId}`（与 CoupleHome 的 loadCabinConvo/saveCabinConvo 同 key 同结构），JSON.parse + 逐条 role('me'|'peer')/text 校验过滤，try/catch 兜底空数组；按存档顺序（时间正序）展示；挂载与清空后 useEffect scrollTop=scrollHeight 自动滚到底部
- [清空] 底部居中「清空聊天记录」文字按钮（text-[#c98a9a] text-xs）→ window.confirm 确认 → localStorage.removeItem(key) + 清空列表（removeItem 也包 try/catch 防隐私模式）
- [音效] import { sfx } from './sfx'：打开（挂载 effect）与清空点击各调一次 sfx.tap()
- [验证] bunx tsc --noEmit（过滤 next.config）0 输出；bunx eslint CabinHistorySheet.tsx 0 问题 —— 首版在打开 effect 内同步 setTurns 被 react-hooks/set-state-in-effect 新规拦截，重构为「外壳条件渲染 + 内层惰性 useState 读档」结构后归零（无 any、无 setState-in-effect）；仅新增 CabinHistorySheet.tsx 一个文件，未动其他任何文件；未起 dev server、无 git 操作

Stage Summary:
- 小屋聊天记录回看面板落地：底部抽屉毛玻璃胶囊面板，回看 localStorage cabin-chat-<charId> 存档的 turns（me 右粉泡 / peer 左白泡、正序自动滚底）、头部「共 N 条 · 最近聊天时间」、一键清空（confirm + removeItem）、空状态文案、打开/清空 tap 音效
- props 契约：export interface CabinHistorySheetProps { open: boolean; onClose: () => void; charId: string; charName: string }；CoupleHome 后续以 <CabinHistorySheet open onClose charId={companion.id} charName={companion.name} /> 接线（open=false 不渲染任何节点）
- 数据 key 格式：`cabin-chat-${charId}`，JSON { convo: {role:'user'|'assistant',content:string}[], turns: {role:'me'|'peer',text:string}[], ts: number }（ts=最近聊天时间戳，展示只用 turns）
- 关键文件：src/components/apps/couple-home/CabinHistorySheet.tsx（唯一改动，新文件）

---
Task ID: 10-c
Agent: general-purpose（B2 电视真能看 · 频道内容升级）
Task: TV3D 频道内容升级 —— 新增 4 天气台（实时联动室外天气）/ 5 风景相册台 / 6 喵喵台，保持 1/2/3 台不动

Work Log:
- [频道清单] TV3D makeScreenTexture 扩为 6 频道：1 流光云朵 / 2 啵啵新闻 / 3 音乐台（原样保留逐字节不动）/ 4 天气台 / 5 风景相册台 / 6 喵喵台；换台仍走 useMemo([channel]) 重建纹理 + useFrame 0.08s（~12fps）节流重绘，既有节拍不变
- [频道4·天气台] 顶部 import { weatherBusGet } from './weather-bus'（只读不写），每帧 draw 里实时读取；上半屏按 weather 画动态动画：sunny=8 翼旋转光芒太阳（ctx.rotate(t*0.55)）+2 朵飘云、cloudy=5 朵两层飘云、overcast=6 朵灰云密布、rain=暗云+26 条斜落雨丝（斜率 0.32）+地面 5 组扩散涟漪、snow=云+24 片摇曳飘雪+3 座积雪椭圆；night（读总线 night）改深蓝夜空+月亮（光晕+陨石坑）+14 颗微闪星星（STARS 固定点位复用）；下半屏「天气预报 · 拾光气象台」圆角横幅（rrect 手绘）+ 大字天气名（晴/多云/阴/雨/雪，按天气配色 W_COLOR）+ 今日温度（W_TEMP 固定区间 [晴23~27/多云18~23/阴14~19/雨12~17/雪-3~2]，天气变化时 Math.random 重掷一次后闭包缓存稳定显示）；天气一变画面自动跟着变
- [频道5·相册台] 4 张程序化风景 6s/张轮播、末尾 0.9s globalAlpha 淡入淡出（slides 数组闭包内建一次）：海滩日落（四段渐变天空+半沉太阳+太阳倒影波光 12 条闪烁横线+海面碎光）、雪山松林（双峰+背光面+雪顶+雪原+7 棵 pine 三层三角松树+微风飘雪）、樱花原野（3 棵 sakuraTree 四球粉冠+16 片摇摆飘落花瓣）、星空夜湖（深蓝星空 14 星微闪+月亮光晕+山影+月光倒影列+星星倒影短竖线）；右下角画迷你小相框角标（clip 内微缩风景）
- [频道6·喵喵台] 草地渐变背景+小太阳+飘云+小草；奶油猫（#f5e6c8 圆头+三角耳+耳内粉+豆豆眼+w 嘴+腮红+背纹，ctx.scale(dir,1) 朝行进方向）7s 一趟左右往返走动+四腿摆动+小颠步，每 5s 扑跳一次（0.9s 正弦跳、影子同步缩小变淡）；旁边红色毛线球随行进方向滚动（rotate 纹路+拖线摆动）；头顶「喵~」白气泡 4.2s 循环出现约 1s（15% 淡入淡出）
- [台标] 新增统一 badge() 小工具：右上角半透明深底（rgba(16,19,24,0.4)）圆角胶囊 + 白字，三新频道分别画「天气」「相册」「喵喵」；1/2/3 台保持原有左上文字台标不动
- [性能] 全部可复用状态（STARS 点位/W_NAME/W_COLOR/W_TEMP/温度缓存/slides/rrect/cloud/drift/tri/pine/sakuraTree/四个场景函数）都在 makeScreenTexture 闭包内建一次，draw 里零 new 数组/对象，与既有 blobs 模式一致；tsc 通过（仅 next.config.ts 既有基线）；eslint TV3D.tsx 0 问题；另以 mock-ctx 冒烟脚本实测 6 频道 ×13 个时间点 + 天气 5 态×昼夜 全部 draw 无异常
- [依赖说明] weather-bus.ts 仅 import weatherBusGet 未做任何修改；weatherBusSet 目前尚无调用方（本批次并行任务接线），总线默认 { weather:'sunny', night:false }，故接线前台 4 稳定显示晴天白天，不报错
- [接线方式（供后续任务）] Furn3D.tsx:261 已有 <TV3D channel={item.st?.channel} /> 透传，家具 st.channel 存 1~6 即可换台；CoupleHome.tsx:2974 换台循环 ((x % 3) + 1) 需改为 % 6 以纳入新频道；HomeScene 按任务 10-a 方案调用 weatherBusSet(weatherFx, night) 后天气台即实时联动室外天气，无需 TV 侧再做接线

Stage Summary:
- 电视「真能看」：频道从 3 台扩到 6 台 —— 4 天气台实时读 weather-bus 总线（五档天气动画+昼夜星空+天气预报横幅）、5 风景相册台四景轮播淡入淡出、6 喵喵台奶油猫草地小剧场（走动/扑跳/毛线球/喵~气泡）；新频道统一右上角圆角台标，1/2/3 台逐字节不动
- 关键文件：src/components/apps/couple-home/scene/TV3D.tsx（唯一改动，263→956 行）；weather-bus.ts 只 import 未修改

---
Task ID: 10-d（主控接手中断任务）+ 接线
Agent: 主控 Agent（Z.ai Code）
Task: B4 新房间扩建（书房 sr + 花园 yd）—— 子代理超时中断后由主控补完并全量接线

Work Log:
- [子代理遗留] 10-d 子代理完成 types.ts（RoomId+sr/yd、studyDoorOpen/gardenGateOpen）、catalog.ts（STUDY_*/GARDEN_* 常量、roomAt/ROOM_SPANS/ROOM_NAMES/clampFurnToRooms/WALL_SLOTS、defaultHome 书房+花园预置家具）、scene/pathfind.ts（DoorKey 六扇导出、ROOM_ADJ lr-sr/kt-yd、doorPoints sr/yd、planRoute Partial 化、buildBlockGrid 书房墙+花园栅栏阻挡+固定门位关门补挡、网格扩界）、scene/Room.tsx（书房三面外墙+客厅西墙两段夹门洞+厨房南墙两段夹花园走廊、FenceRun/GardenGate 栅栏组件）后超时；HomeScene/CoupleHome 接线与门板渲染缺失
- [主控补完·Room.tsx] 书房门板 HouseDoor（客厅西墙 x=-ROOM_X, z=SRDOOR_Z, ry=π/2，点击开合）+ GardenGate 挂进渲染 + 书房/花园走廊 DoorLintel×2 + 书房地板/天花板 + 花园草地平面
- [主控接线·HomeScene] collideAndClamp 扩 sr/yd 双门走廊（书房东墙/花园北栅栏，开门才可穿）；本地 DoorKey 改从 pathfind 导入六扇；doorRef/同步 effect/buildBlockGrid 加 sr/yd；doorsLive 及 PetBuddy/PetBuddy2 四处 doors 记录补 sr/yd；全部 collideAndClamp 调用点透传；ROOM_WEIGHTS 加 sr 1.2/yd 1.5（AI 与宠物会自己溜达去书房/花园）；props 加 studyDoorOpen/gardenGateOpen/onToggle*；HOUSE_BX0 扩到书房西缘（雨雪不进书房）；weatherBusSet(weatherFx, night) 接线（TV 天气台实时联动）
- [主控接线·companion-rt] doors 参数 Partial<Record<DoorKey,DoorGate>> 化（goto sr/yd 走 ROOM_ADJ 自动可达）；nearestClosedDoor/closedDoorNeardoor 空值守卫
- [主控接线·CoupleHome] studyDoorOpen/gardenGateOpen state/ref/snap/adoptHome/toggleStudyDoor/toggleGardenGateDoor（sfx.door + toast + saveSoon）→ HomeScene；自主行动 rooms 数组加 sr/yd；cycleChannel 1→6 循环（新增天气台/相册台/喵喵台 toast 名）
- [并行成果] 10-b CabinHistorySheet.tsx（E1 聊天回看面板，待接线）、10-c TV3D 六频道（B2，1/2/3 保留 + 4 天气台读 weather-bus/5 风景相册/6 喵喵台）
- [验证] bunx tsc --noEmit 过滤 next.config 0 输出；eslint 新增仅 CoupleHome 2 处（与既有 balconyDoorOpenRef.current=xx 完全同款基线模式，HomeScene/Room/companion-rt 0 新增）

Stage Summary:
- 七区域之家达成：客厅/卧室/厨房/卫生间/阳台 + 书房（书架/书桌/台灯/电脑/装饰窗）+ 花园（花箱/躺椅/栅栏/草地）；门全 DoorKey 化，A* 寻路/漫游/家具钳制/雨雪排除全适配；AI 指令「去书房/去花园」可直达；换台 6 频道；天气总线贯通
- 待接线：CabinHistorySheet 面板（E1）、电视喵喵台等新频道的 AI 观看偏好（后续模块）
- 关键文件：types.ts、catalog.ts、scene/pathfind.ts、scene/Room.tsx、scene/HomeScene.tsx、scene/companion-rt.ts、scene/weather-bus.ts（新）、CabinHistorySheet.tsx（新）、TV3D.tsx、CoupleHome.tsx

---
Task ID: 10-a/10-e/10-f/10-g
Agent: 主控 Agent（Z.ai Code）
Task: v10.2 「有心的家」——AI 决策大脑全家桶（用户选定 21 项：A1~A10 全部 + B1~B4 + C1~C4 + E1/E2/E4）

Work Log:
- [A1 决策循环] CoupleHome 30s 心跳：tickMind（衰减+情绪推进）→ 到点（95~155s 抖动）且 TA 空闲时自动决策——buildDecisionPrompt（内心/甜度/作息/强化/特别日子/情境）→ cabinChatTurn 大模型决策 → parseDecision（thought/say/actions）→ 失败 decideLocally 规则兜底（永远有得做）；闹脾气时自动过滤 come/hug/holdhand
- [A2 需求] cabin-mind.ts 四需求（饱腹-9/精力-7/心情-6/社交-8 每小时）在线心跳+离线补算衰减；事件结算：吃饭+42饱腹、睡觉醒来+70精力、弹琴/跳舞+14心情、被拒绝-8心情 等
- [A3 情绪甜度] 情绪机 happy/content/low/missing/sulking（由需求与互动推导）；甜度 Lv.1~6（渐渐熟悉→命中注定）；⋮ 菜单新增「TA 的心」面板（等级/甜度/情绪/四条需求条实时渲染，仅_decision 心跳刷新）
- [A4 作息] scheduleSlot 按小时作息表（三餐/午休/午后练琴/花园/晚间电视/23点睡觉/周末赖床），决策 prompt 注入 + 本地兜底直接执行
- [A5 任务链] cook 完成 → mealReady 上桌 → 「饭好啦快来吃」气泡 + meal 主动请求弹窗（4 分钟冷却）→ 不在旁时气泡指路
- [A6 主动聊天] 请求弹窗扩 5 类（hug/holdhand/meal/chat/miss）：想你了（mood=missing 60% 触发）/喊你吃饭/有话想说；同意 → TA 走到你身边；拒绝 → 情绪受伤 + 各自回应文案
- [A7 想法气泡] BubbleCmd 加 kind='thought'；makeBubbleTexture 想法样式（淡蓝云朵虚线描边 + 💭 前缀 + 独立缓存键）；决策/天气联动/记日子时冒泡
- [A8 纪念日] captureSpecialDay 聊天正则抓生日/考试/纪念日（MM-DD 或 7 天后）去重入库 + 每月相识小纪念日；决策循环当天首次撞上主动庆祝 + 入记忆
- [A9 闹脾气] 冷落>25min 22% 概率闹脾气（40min 自愈）：第一次拥抱被扭头拒绝（要哄）；聊天含对不起/哄哄/原谅/爱你 → 和好剧情 + 记忆；决策期间远离用户
- [A10 行为强化] 聊天正则识别夸/嫌 → reinforceActivity（play/cook/music/eat/dance 归因 lastAct）；权重 0.4~2.2 反哺决策池与 prompt 经验块
- [B1 真歌] music 到位 → ncmSearch 点歌名 → songUrl 直链 Audio 循环播放（音量 0.5）；失败回落八音盒合成 + toast 说明；release/free 统一停（stopRealSong）
- [B2 电视] TV3D 六频道（子代理 10-c）：4 天气台（weather-bus 实时晴雨雪昼夜）/5 风景相册台/6 喵喵台；CoupleHome cycleChannel %6 + 台名 toast
- [B3 天气联动] weatherFx 变化沿：下雨 → TA 走去关窗（window 指令 + 记忆）；下雪 → 点壁炉 + 暖融融；雨停 → 开窗透气；window 到位宿主按房间映射关/开对应窗（lr[0-2]/br[3-4]/kt[5-6]/ba[7-8]）。雷电闪白未做（其余全落地）
- [C1 小剧场] PetBuddy 剧场扩 3 种：激光笔（红点 sprite 高速乱窜猫疯追）/钻纸箱（临时纸箱 mesh 出现→钻入窝 6s→淡出）/照镜子炸毛（凑近 standingMirror→后跳逃开）；白天 42% 蝴蝶/20% 激光/18% 纸箱/20% 镜子
- [C2 训练] PetCareKind + dead（Lv.7 解锁，侧倒 0.75π 装死动画）；PetExtra.train 熟练度按把戏计数（跨会话）；每 5 次 toast 熟练度；n≥3 后 40% 概率练完自己表演另一段把戏
- [C3 多宠社交] PET_RT_REG 全屋宠物 rt 注册表；猫 2.5%/帧概率追兄弟宠物 → 追上跳一下冒爱心喵一声；宠物间互相可达
- [C4 宠物日记] addPetDiary（cabin-pet-diary 上限 60 条）；照顾/把戏完成自动记一篇；面板成长行新增「日记」按钮 → 毛玻璃抽屉倒序翻阅 + 空状态
- [E1 回看面板] 子代理 10-b CabinHistorySheet.tsx（底部抽屉毛玻璃、正序自动滚底、清空 confirm）；输入条新增 History 按钮
- [E2 对讲机] web-speech.ts 加 onFinal 逐句定稿回调；sendChat 支持 override 文本（麦克风复用同管线）；输入条新增对讲按钮（绿色脉冲，与单次麦克风互斥，连续监听自动发送 + TTS 回复）
- [E4 新动作] CompanionCmd + dance/stretch/water/read/window；companion-rt：dance/stretch 原地粘性姿势、water 找最近花草（7 类 PLANT_KINDS）站位、read 坐下看书、window 走到目标房间回报开关窗；CharChibi3D 新增三套姿势动画（跳舞节拍摆臂踮脚/伸懒腰呼吸使劲/浇花前倾倾壶）
- [E2E·Agent Browser 390×844] 直写 IndexedDB 建「阿澄·恋人」→ 进小屋：入口选择✓、3D 场景/宠物/猫窝渲染✓、右下角 💬 聊天条✓；发消息 → 上游失败 SDK 兜底重试 → TA 真的走过来✓；E1 聊天记忆面板（空态+清空）✓；E2/对讲/历史按钮就位✓；⋮「TA 的心」面板（Lv.1 渐渐熟悉/甜度 3/开心/饱腹 77 精力 82 心情 89 想你 5 实时衰减）✓；A6 主动请求弹窗「阿澄想牵牵你的手」→ 同意必行动✓；书房门点击开合 toast✓；客厅西墙视线遮挡淡出✓；B1 小屋点歌面板✓；宠物面板（Lv/成长/日记按钮/把戏 Lv.7 装死锁位）✓；C4 日记抽屉空态✓；cabin-mind localStorage 持久化（needs 衰减数值/mood=happy/affinity=3）✓；决策循环被牵手态正确抑制✓；控制台无错误（仅预期上游失败告警）
- [lint/tsc] bunx tsc 0 错误（过滤 next.config 既有基线）；CoupleHome 52 vs 基线 50（+2 = 新门状态 ref，与既有 balconyDoorOpenRef 同款仓库惯例）；HomeScene 19 vs 20、其余文件 0 新增
- [git] v10.1（42c7b2c）+ v10.2（29f8dbf）两个 commit 在本地；沙箱不可达 github，push 待用户网络可用时执行

Stage Summary:
- 拾光小屋 v10「有心的家」21 项全落地：TA 有了需求/情绪/甜度/作息/记忆强化/纪念日/脾气，每 1.5~2.5 分钟自己决定做什么（大模型优先+规则兜底），行动前冒想法气泡；会主动喊你吃饭/说想你；被冷落会闹脾气要哄；被夸的事更爱做；电视能看 6 个频道（天气台实时联动）、音箱能放真歌；新书房+花园可去；小剧场+训练+日记+多宠社交；对讲机免打语音对话 + 聊天记忆回看
- 已知边界：B3 雷电闪白未做；决策循环大模型路径依赖 API 配置（无配置走 SDK 兜底也可用）；C3 兄弟追逐由猫侧发起（PetBuddy2 追猫为既有）
- 关键文件：cabin-mind.ts（新）、companion-brain.ts、companion-memory.ts（未动）、scene/companion-rt.ts、scene/HomeScene.tsx、scene/CharChibi3D.tsx、scene/TV3D.tsx、CabinHistorySheet.tsx（新）、scene/weather-bus.ts（新）、CoupleHome.tsx、lib/ios/web-speech.ts、types.ts

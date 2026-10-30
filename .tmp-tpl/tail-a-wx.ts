// ================= 全局（个性装扮 › 自定义CSS Tab · 第七十七轮：一份「模板」含全部） =================
// 用户指定（第七十七轮）：① 手机公共模板删除——公共部分（手机壳/页面底/面板/滚动条…）
// 合并进每份 App 模板的「手机壳与公共」一节，编辑器只显示一份「模板」；
// ② 模板名从「微信模板（全部界面）」改为「模板」；③ 模板补上所有图标段
// （顶栏/输入栏/标签栏/多选栏/卡片里的 SVG 图标——颜色跟按钮 color 走）；
// ④ CSS 字数不再设上限（CUSTOM_CSS_MAX_LEN 已删除）。
// 聊天作用域（联系人 › 聊天设置）与线下作用域（现场设置）同样是「一份模板含全部」。

/** 微信 · 模板：微信所有界面逐项列出——聊天界面（气泡/输入栏/按钮/图标/面板/菜单）、
 *  聊天卡片（红包/转账/亲属卡/礼物/代付/外卖…一张一段）、红包转账亲属卡详情页、
 *  微信主页 / 联系人 / 发现 / 我 / 朋友圈 / 聊天设置 / 手机壳与公共。 */
export const WX_APP_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '微信全部界面：聊天 / 卡片 / 红包页 / 朋友圈 / 图标 / 手机壳',
  css: `/* ═══════════════════════════════════════════════
   微信 · 模板（全部界面 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：整台手机，按界面分节：
   一 聊天界面（气泡/输入栏/按钮/图标/面板/菜单）
   二 聊天卡片（红包/转账/亲属卡/礼物/代付…一张一段）
   三 红包/转账/亲属卡页面
   四 微信(消息)界面  五 联系人  六 发现  七 我
   八 朋友圈  九 聊天设置  十 手机壳与公共。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面都是微信现在的默认样式——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值。
   图标（返回箭头/笑脸/＋/发送…）是 SVG 线条，颜色跟着
   所在按钮的文字色（color）走——改按钮 color 图标就变。
   提醒：只想改某一个联系人，用该联系人 › 聊天设置 ›
   自定义CSS（优先级更高，只作用于 TA）。 */

/* ══ 一、聊天界面（所有微信联系人通用） ══ */

/* ── 1. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.wx-topbar { background: #EDEDED; }
.dark & .wx-topbar { background: #111111; }

/* ── 2. 顶部栏图标（返回箭头 / ⋯ 菜单；颜色跟页面文字色） ── */
.wx-topbar button { color: #000000; }
.dark & .wx-topbar button { color: #FFFFFF; }

/* ── 3. 我的气泡（右侧绿泡；文字和语音一起换） ── */
.wx-bub-mine { background: #95EC69 !important; color: #000000; }
.dark & .wx-bub-mine { background: #3EB575 !important; color: #000000; }

/* ── 4. 对方的气泡（左侧白泡） ── */
.wx-bub-theirs { background: #FFFFFF !important; color: #000000; }
.dark & .wx-bub-theirs { background: #1E1E1E !important; color: #FFFFFF; }

/* ── 5. 气泡小尾巴（跟气泡同色的小三角） ── */
.wx-bub-tail-mine { background: #95EC69 !important; }
.dark & .wx-bub-tail-mine { background: #3EB575 !important; }
.wx-bub-tail-theirs { background: #FFFFFF !important; }
.dark & .wx-bub-tail-theirs { background: #1E1E1E !important; }

/* ── 6. 时间胶囊（居中的时间小条） ── */
.wx-time-chip {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & .wx-time-chip {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 7. 撤回提示（居中的「撤回了一条消息」胶囊） ── */
[data-testid='wx-recall-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='wx-recall-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 8. 系统消息（拉黑/解除拉黑那类居中提示胶囊） ── */
[data-testid='wx-sys-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='wx-sys-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 9. 引用条（回复时输入框上方那条白条） ── */
[data-testid='wx-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.25);
}
.dark & [data-testid='wx-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.25);
}

/* ── 10. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 11. 好友详情页（点对方名字进入的资料页底色） ── */
.wx-fdetail-page { background: #EDEDED; }
.dark & .wx-fdetail-page { background: #111111; }

/* ── 12. 底部输入栏（打字那一栏） ── */
.wx-inputbar { background: #EDEDED; border-color: rgba(0, 0, 0, 0.07); }
.dark & .wx-inputbar { background: #111111; border-color: rgba(255, 255, 255, 0.06); }

/* ── 13. 输入框（打字的白色方框；光标是微信绿） ── */
[data-testid='wx-chat-input'] { background: #FFFFFF; }
.dark & [data-testid='wx-chat-input'] { background: #232323; }

/* ── 14. 语音按钮（输入栏最左的圆圈钮＋声波图标） ── */
[data-testid='wx-voice-toggle'] > span {
  border-color: rgba(0, 0, 0, 0.85);
  color: rgba(0, 0, 0, 0.9);
}
.dark & [data-testid='wx-voice-toggle'] > span {
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(255, 255, 255, 0.9);
}

/* ── 15. 表情按钮（输入栏的笑脸图标） ── */
[data-testid='wx-chat-sticker'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='wx-chat-sticker'] { color: rgba(255, 255, 255, 0.85); }

/* ── 16. 加号按钮（更多功能那个＋图标） ── */
[data-testid='wx-chat-plus'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='wx-chat-plus'] { color: rgba(255, 255, 255, 0.85); }

/* ── 17. 麦克风按钮（输入框里的文字转语音开关；开启时变微信绿） ── */
[data-testid='wx-tts-toggle'] { color: rgba(0, 0, 0, 0.4); }
.dark & [data-testid='wx-tts-toggle'] { color: rgba(255, 255, 255, 0.4); }

/* ── 18. 发送按钮（右侧绿色按钮） ── */
[data-testid='wx-chat-send'] { background: #07C160; color: #FFFFFF; }
[data-testid='wx-chat-send']:active { background: #06AD56; }

/* ── 19. 加号面板（相册/转账/位置/线下…展开层） ── */
[data-testid='wx-plus-panel'] {
  background: #F7F7F7;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & [data-testid='wx-plus-panel'] {
  background: #161616;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 20. 表情面板（笑脸展开的表情选择层） ── */
[data-testid='wx-sticker-panel'] {
  background: #F7F7F7;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & [data-testid='wx-sticker-panel'] {
  background: #161616;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 21. 多选栏按钮（长按消息进入多选：转发 / 收藏；图标跟色） ── */
[data-testid='wx-select-forward'],
[data-testid='wx-select-fav'] { color: rgba(0, 0, 0, 0.75); }
.dark & [data-testid='wx-select-forward'],
.dark & [data-testid='wx-select-fav'] { color: rgba(255, 255, 255, 0.75); }

/* ── 22. 多选栏删除键（红字红图标） ── */
[data-testid='wx-select-del'] { color: #FA5151; }

/* ══ 二、聊天卡片（一段一张，全在聊天页里） ══ */

/* ── 23. 所有卡片的圆角（微信小方角） ── */
.chat-card-body { border-radius: 4px; }

/* ── 24. 红包卡（红橙渐变 + 小尾巴） ── */
.chat-card-rp .chat-card-body {
  background: linear-gradient(135deg, #F2694C, #E94E38) !important;
}
.chat-card-rp .chat-card-tail { background: #EC5A42 !important; }

/* ── 25. 转账卡（橙色渐变 + 小尾巴） ── */
.chat-card-tr .chat-card-body {
  background: linear-gradient(135deg, #F6AC3D, #EF9A2E) !important;
}
.chat-card-tr .chat-card-tail { background: #F2A233 !important; }

/* ── 26. 亲属卡（米白卡身 + 小尾巴） ── */
.chat-card-fam .chat-card-body { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-body { background: #1E1E1E; }
.chat-card-fam .chat-card-tail { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-tail { background: #1E1E1E; }

/* ── 27. 礼物卡（深蓝星空 + 小尾巴） ── */
.chat-card-gift .chat-card-body {
  background: linear-gradient(160deg, #4467B4 0%, #2C4E92 46%, #20396E 100%) !important;
}
.chat-card-gift .chat-card-tail { background: #2C4E92 !important; }

/* ── 28. 美团代付卡（找人代付：白卡 + 黄横幅 + 黄按钮） ── */
.chat-card-mtpay { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 29. 淘宝代付卡（找人代付：白卡 + 橙横幅 + 橙按钮） ── */
.chat-card-tbpay { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 30. 代点外卖卡（美团外卖草稿：白卡 + 黄按钮） ── */
.chat-card-mtdraft { background: #FFFFFF; }
.chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 31. AI 帮买卡（淘宝代买草稿：白卡） ── */
.chat-card-tbdraft { background: #FFFFFF; }

/* ── 32. 订单分享卡（美团/淘宝购物订单：白卡） ── */
.chat-card-mtshare, .chat-card-tbshare { background: #FFFFFF; }

/* ── 33. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 34. 卡片横幅（代付卡顶部的彩色横条；默认方角贴卡） ── */
.chat-card-banner { border-radius: 0; }

/* ── 35. 卡片主按钮（查看详情 / 确认下单那类胶囊） ── */
.chat-card-btn { border-radius: 99px; }

/* ── 36. 卡片底部标签条（红包/转账/亲属卡/礼物那行小字） ── */
.chat-card-label { color: rgba(255, 255, 255, 0.9); font-size: 12px; }

/* ── 37. 卡片小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }

/* ── 38. 卡片里的图标（红包铜钱/礼物盒/外卖袋…各有专属色） ──
   想统一换成同一个颜色？解开下面这行 */
/* .chat-card-body svg { color: #FFE9B8; } */

/* ══ 三、红包 / 转账 / 亲属卡页面（点卡片进入） ══ */

/* ── 39. 发红包页（塞红包 · 金额 · 祝福语那页） ── */
[data-testid='wx-rp-compose'] { background: #EDEDED; }
.dark & [data-testid='wx-rp-compose'] { background: #111111; }

/* ── 40. 红包详情页（白色页身 + 红色头部横幅） ── */
[data-testid='wx-rp-detail'] { background: #FFFFFF; }
.dark & [data-testid='wx-rp-detail'] { background: #111111; }
[data-testid='wx-rp-detail'] > div { background: #F25844; }

/* ── 41. 开红包弹层（点「開」之前那页的黑色遮罩） ── */
[data-testid='wx-rp-open'] { background: rgba(0, 0, 0, 0.7); }

/* ── 42. 转账页（输入金额那页） ── */
[data-testid='wx-tr-compose'] { background: #EDEDED; }
.dark & [data-testid='wx-tr-compose'] { background: #111111; }

/* ── 43. 转账详情页 ── */
[data-testid='wx-tr-detail'] { background: #FFFFFF; }
.dark & [data-testid='wx-tr-detail'] { background: #111111; }

/* ── 44. 确认收款页（别人转账给你时那页） ── */
[data-testid='wx-tr-receive'] { background: #FFFFFF; }
.dark & [data-testid='wx-tr-receive'] { background: #111111; }

/* ── 45. 亲属卡领取页（送你一张亲属卡那页） ── */
[data-testid='wx-fc-claim'] { background: #EDEDED; }
.dark & [data-testid='wx-fc-claim'] { background: #111111; }

/* ── 46. 亲属卡详情页 ── */
[data-testid='wx-fc-detail'] { background: #FFFFFF; }
.dark & [data-testid='wx-fc-detail'] { background: #111111; }

/* ══ 四、微信界面（消息 Tab 主页） ══ */

/* ── 47. 顶部导航（头像/返回 + 标题 + 搜索图标 + ＋） ──
   默认透明贴着页面底色；想加底色解开下一行 */
/* .wx-nav { background: #EDEDED; } */

/* ── 48. 顶部导航图标（返回 / 搜索放大镜 / ＋；颜色跟文字色） ── */
.wx-nav button { color: rgba(0, 0, 0, 0.75); }
.dark & .wx-nav button { color: rgba(255, 255, 255, 0.75); }

/* ── 49. 会话列表白色面板（微信特有的一整幅白底） ── */
.wx-panel { background: #FFFFFF; }
.dark & .wx-panel { background: #1A1A1A; }

/* ── 50. 会话行（头像 + 名字 + 预览；默认透明，置顶行浅灰） ── */
.wx-session-row { background: transparent; }
/* 想连置顶行一起换色？解开下面两行 */
/* .wx-session-row { background: #ECECEC !important; } */
/* .dark & .wx-session-row { background: rgba(255, 255, 255, 0.06) !important; } */

/* ── 51. 未读角标（头像右上角红色数字） ── */
[data-testid^='wx-unread-badge-'],
[data-testid='wx-tab-badge-chats'],
[data-testid='wx-tab-badge-discover'] { background: #FA5151; }

/* ── 52. 右上角＋下拉菜单（深色小面板：添加朋友/扫一扫/收付款…） ── */
[data-testid='wx-plus-menu'] { background: #4C4C4C; color: #FFFFFF; }
.dark & [data-testid='wx-plus-menu'] { background: #383838; }

/* ── 53. 长按会话菜单（标为未读/置顶/删除那个白条菜单） ── */
[data-testid='wx-session-ctx'] {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.08);
}
.dark & [data-testid='wx-session-ctx'] {
  background: rgba(76, 76, 76, 0.95);
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 54. 底部标签栏（微信 / 通讯录 / 发现 / 我） ── */
.wx-tabbar {
  background: #F7F7F7;
  border-color: rgba(0, 0, 0, 0.10);
}
.dark & .wx-tabbar {
  background: #1A1A1A;
  border-color: rgba(255, 255, 255, 0.10);
}

/* ── 55. 标签按钮与图标（未选中字色图标色一起换；
   选中色是程序控制的微信绿 #07C160） ── */
[data-testid^='wx-tab-'] { color: rgba(0, 0, 0, 0.55); }
.dark & [data-testid^='wx-tab-'] { color: rgba(255, 255, 255, 0.55); }

/* ══ 五、联系人界面 ══ */

/* ── 56. 功能入口行（新的朋友 / 群聊 / 标签 / 公众号…；默认透明） ──
   这个锚点同时管「发现」页和「我」页的行——三页的行样式一起换 */
.wx-menu-row { background: transparent; }

/* ── 57. 字母分组条（A B C…吸顶那一行） ── */
.wx-letter-bar { background: #EDEDED; color: rgba(0, 0, 0, 0.5); }
.dark & .wx-letter-bar { background: #111111; color: rgba(255, 255, 255, 0.5); }

/* ── 58. 好友行（默认透明） ── */
[data-testid^='wx-contact-'] { background: transparent; }

/* ══ 六、发现界面 ══ */

/* ── 59. 入口行（朋友圈 / 视频号 / 扫一扫 / 看一看…） ──
   与联系人/我共用 .wx-menu-row 锚点（见 56）；想只换白面板里的行，
   解开下面这行 */
/* .wx-panel .wx-menu-row { background: #FFFFFF; } */

/* ══ 七、我界面 ══ */

/* ── 60. 名片区（头像 + 名字 + 微信号那一块；默认透明） ── */
[data-testid='wx-me-profile'] { background: transparent; }

/* ── 61. 功能行（服务 / 收藏 / 朋友圈 / 卡包 / 表情 / 设置） ──
   与联系人/发现共用 .wx-menu-row 锚点（见 56） */

/* ══ 八、朋友圈界面 ══ */

/* ── 62. 朋友圈页面底色 ── */
[data-testid='wx-moments-list'] { background: #FFFFFF; }
.dark & [data-testid='wx-moments-list'] { background: #111111; }

/* ── 63. 顶部导航（悬浮在封面上；滚过封面自动变白底，默认透明） ── */
/* .wx-moments-nav { background: rgba(255, 255, 255, 0.95); } */

/* ── 64. 「N条新消息」胶囊（封面下方那条深色气泡） ── */
[data-testid='wx-moments-pill'] { background: rgba(0, 0, 0, 0.7); }
.dark & [data-testid='wx-moments-pill'] { background: rgba(255, 255, 255, 0.2); }

/* ── 65. 动态卡（头像 + 名字 + 正文 + 配图一整行） ── */
.wx-moments-post {
  background: transparent;
  border-color: rgba(0, 0, 0, 0.06);
}
.dark & .wx-moments-post { border-color: rgba(255, 255, 255, 0.08); }

/* ── 66. 作者名字（微信经典蓝） ── */
.wx-moments-name { color: #576B95; }
.dark & .wx-moments-name { color: #8FA5C9; }

/* ── 67. 赞 / 评论小胶囊（时间右边那颗灰按钮） ── */
.wx-moments-act { background: #F2F2F2; }
.dark & .wx-moments-act { background: #2A2A2A; }

/* ── 68. 通知铃铛 / 相机图标（右上角两个；在封面上是白色带投影，
   滚下封面后变黑——程序按滚动状态切换，想固定颜色解开注释） ── */
/* [data-testid='wx-moments-notices'],
[data-testid='wx-moments-compose'] { color: #FFFFFF; } */

/* ══ 九、聊天设置界面（联系人的聊天设置页） ══ */

/* ── 69. 设置页底色（备注/主题/翻译那页；QQ/信息不受影响） ── */
.chat-set-page[data-chat-set-app='wx'][class*='bg-[#EDEDED]'] { background: #EDEDED; }
.dark & .chat-set-page[data-chat-set-app='wx'][class*='bg-[#EDEDED]'] { background: #111111; }

/* ── 70. 设置卡（圆角 10px 方角卡 = 微信的） ── */
.chat-set-page[data-chat-set-app='wx'] .chat-set-card[class*='rounded-[10px]'] { background: #FFFFFF; }
.dark & .chat-set-page[data-chat-set-app='wx'] .chat-set-card[class*='rounded-[10px]'] { background: #1A1A1A; }

/* ── 71. 设置行（备注 / 主题 / 翻译 / 消息翻译…；默认透明） ── */
.chat-set-page[data-chat-set-app='wx'] .chat-set-row { background: transparent; }

/* ══ 十、手机壳与公共（所有 App 共用部分） ══ */

/* ── 72. 状态栏（顶部时间 · 信号 · 电池） ──
   默认自动选黑/白字；想固定颜色就解开注释填 */
/* .ph-statusbar { color: #1F1F1F; } */

/* ── 73. 灵动岛（顶部黑色胶囊） ── */
.ph-island { background: #000000; }

/* ── 74. Home 指示条（屏幕最底部的小横杠） ──
   同样默认自动黑/白；想固定颜色就解开注释填 */
/* .ph-homebar { background: #1F1F1F; opacity: 0.9; } */

/* ── 75. 页面背景（微信 / QQ / 淘宝…所有 App 的灰白底一起换色） ── */
[class*='bg-[#F5F6F7]'], [class*='bg-[#EDEDED]'], [class*='bg-[#F4F5F7]'],
[class*='bg-[#F7F8FA]'], [class*='bg-[#F5F6F8]'], [class*='bg-[#F7F7F7]'],
[class*='bg-[#F2F3F5]'], [class*='bg-[#F6F7F8]'], [class*='bg-[#F8F8F8]'],
[class*='bg-[#F6F7F9]'], [class*='bg-[#F4F5F9]'], [class*='bg-[#FAFAFC]'],
[class*='bg-[#FAFAFA]'], [class*='bg-[#EFEFF4]'] {
  background: #F5F6F7;   /* ← 所有 App 底色统一换成这个值 */
}
.dark & [class*='bg-[#F5F6F7]'], .dark & [class*='bg-[#EDEDED]'],
.dark & [class*='bg-[#F4F5F7]'], .dark & [class*='bg-[#F7F8FA]'],
.dark & [class*='bg-[#F5F6F8]'], .dark & [class*='bg-[#F7F7F7]'],
.dark & [class*='bg-[#F2F3F5]'], .dark & [class*='bg-[#F6F7F8]'],
.dark & [class*='bg-[#F8F8F8]'], .dark & [class*='bg-[#F6F7F9]'],
.dark & [class*='bg-[#F4F5F9]'], .dark & [class*='bg-[#FAFAFC]'],
.dark & [class*='bg-[#FAFAFA]'], .dark & [class*='bg-[#EFEFF4]'] {
  background: #111214;   /* 深色模式下这些页面的底色 */
}

/* ── 76. App 顶部导航栏（大标题那一整条） ── */
[class*='bg-background/80'] {
  background: color-mix(in oklab, var(--background) 80%, transparent);
}
/* ↑ 这行 = 系统默认（半透明，自动跟随深浅模式）；
   换成你要的颜色即可，如 rgba(255, 250, 240, 0.85) */

/* ── 77. 面板与卡片（设置页 · 弹窗 · 主题面板；线下模式的卡在现场设置里改） ── */
.rt-panel { background: #FFFFFF; }                    /* 古早主题白卡 */
.dark & .rt-panel { background: #35353D; }
.lg-card  { background: rgba(255, 255, 255, 0.62); }  /* 液态玻璃内容卡 */
.dark & .lg-card { background: rgba(28, 28, 34, 0.62); }
.lg-sheet { background: rgba(255, 255, 255, 0.78); }  /* 液态玻璃弹层 */
.dark & .lg-sheet { background: rgba(30, 30, 36, 0.86); }
.lg-panel { background: rgba(255, 255, 255, 0.96); }  /* 液态玻璃白色分组卡 */
.dark & .lg-panel { background: rgba(28, 28, 32, 0.96); }

/* ── 78. 表单控件（输入框光标 / 选择框 / 复选框） ── */
/* 输入框打字时的光标颜色 */
/* input, textarea { caret-color: #FF7A59; } */
/* 选择框（下拉框）统一圆角 */
/* select { border-radius: 10px; } */
/* 复选框勾选颜色（各 App 默认不一样：微信绿 / 删除红…这里统一改） */
/* input[type='checkbox'] { accent-color: #07C160; } */

/* ── 79. 按钮手感（按下轻轻缩，松手弹回来） ── */
button {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.4),
    background-color 0.18s, color 0.18s, opacity 0.18s;
}
button:active { transform: scale(0.955); }

/* ── 80. 文字选中（长按 / 拖选文字的高亮色） ── */
/* 解开注释填你想要的颜色 */
/* ::selection { background: #FF7A59; color: #FFFFFF; } */

/* ── 81. 滚动条（所有列表的滚动条） ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.25); border-radius: 99px; }
.dark & ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); }

/* ══ 十一、再动手？解开这些注释 ══ */

/* 气泡圆角改小一点 */
/* .wx-bub-mine, .wx-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .wx-chat-list { font-size: 17px; } */

/* 发送键换个颜色 */
/* [data-testid='wx-chat-send'] { background: #FF7A59 !important; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .wx-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

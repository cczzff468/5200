
/** QQ · 模板：QQ 所有界面逐项列出——聊天界面（气泡/输入栏/按钮/图标/面板/菜单）、
 *  聊天卡片（红包/转账/亲属卡/代付/外卖…一张一段）、红包·亲属卡页面、
 *  消息界面 / 联系人 / 动态(空间) / 个人中心 / 聊天设置 / 手机壳与公共。 */
export const QQ_APP_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: 'QQ全部界面：聊天 / 卡片 / 红包页 / 动态 / 个人中心 / 图标 / 手机壳',
  css: `/* ═══════════════════════════════════════════════
   QQ · 模板（全部界面 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：整台手机，按界面分节：
   一 聊天界面（气泡/输入栏/按钮/图标/面板/菜单）
   二 聊天卡片（红包/转账/亲属卡/代付/外卖…一张一段）
   三 红包/亲属卡页面  四 消息(QQ主页)界面
   五 联系人  六 动态(空间)  七 个人中心
   八 聊天设置  九 手机壳与公共。
   用法同微信模板：每段 = 一处，改值生效，不想要整段删。
   成对的两行里，第二行是深色模式的值。
   图标是 SVG 线条，颜色跟着所在按钮的文字色（color）走。
   两个提醒：① 聊天页灰白底（#F5F6F7）与其他 App 共用，
   在「手机壳与公共 › 页面背景」统一改；② 我的气泡和发送键
   颜色是程序内联写死的，规则带 !important 才能盖住——保留，别删。 */

/* ══ 一、聊天界面（所有 QQ 联系人通用） ══ */

/* ── 1. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.qq-topbar { background: #F5F6F7; }
.dark & .qq-topbar { background: #111214; }

/* ── 2. 顶部栏图标（返回箭头 / ⋯ 菜单；颜色跟页面文字色） ── */
.qq-topbar button { color: inherit; }
/* 想固定图标颜色？把上面那行换成下面两行 */
/* .qq-topbar button { color: #1F2329; } */
/* .dark & .qq-topbar button { color: #FFFFFF; } */

/* ── 3. 我的气泡（右侧蓝泡；文字和语音一起换） ── */
.qq-bub-mine { background: #0099FF !important; color: #FFFFFF; }
/* 想让深色模式换个颜色？解开下面这行 */
/* .dark & .qq-bub-mine { background: #0077E0 !important; color: #FFFFFF; } */

/* ── 4. 对方的气泡（左侧白泡） ── */
.qq-bub-theirs { background: #FFFFFF !important; color: #1F2329; }
.dark & .qq-bub-theirs { background: #2A2C31 !important; color: #FFFFFF; }

/* ── 5. 时间胶囊（居中的时间小条） ── */
.qq-time-chip {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & .qq-time-chip {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 6. 撤回提示（居中的「撤回了一条消息」胶囊） ── */
[data-testid='qq-recall-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='qq-recall-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 7. 系统消息（拉黑/解除拉黑那类居中提示胶囊） ── */
[data-testid='qq-sys-row'] span {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & [data-testid='qq-sys-row'] span {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 8. 引用条（回复时输入框上方那条白条） ── */
[data-testid='qq-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.25);
}
.dark & [data-testid='qq-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.25);
}

/* ── 9. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 10. 底部输入栏（打字那一栏） ── */
.qq-inputbar { background: #FFFFFF; }
.dark & .qq-inputbar { background: #1B1C1F; }

/* ── 11. 输入框（打字的浅灰圆角框） ── */
[data-testid='qq-chat-input'] {
  background: #F6F7F8;
  border-color: rgba(0, 0, 0, 0.07);
}
.dark & [data-testid='qq-chat-input'] {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 12. 表情按钮（输入栏的笑脸图标；展开时变 QQ 蓝是程序控制） ── */
[data-testid='qq-chat-sticker'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='qq-chat-sticker'] { color: rgba(255, 255, 255, 0.85); }

/* ── 13. 加号按钮（更多功能那个＋图标；展开时旋转 45°） ── */
[data-testid='qq-chat-plus'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='qq-chat-plus'] { color: rgba(255, 255, 255, 0.85); }

/* ── 14. 发送按钮（QQ 蓝圆角按钮；颜色程序内联 → 带 !important） ── */
[data-testid='qq-chat-send'] { background: #12B7F5 !important; color: #FFFFFF; }

/* ── 15. 加号面板（相册/转账/位置…展开层；默认主题贴着输入栏） ── */
[data-testid='qq-plus-panel'] { border-color: rgba(0, 0, 0, 0.05); }
.dark & [data-testid='qq-plus-panel'] { border-color: rgba(255, 255, 255, 0.06); }

/* ── 16. 表情面板（笑脸展开的表情选择层） ── */
[data-testid='qq-sticker-panel'] { background: #FFFFFF; }
.dark & [data-testid='qq-sticker-panel'] { background: #1B1C1F; }

/* ── 17. 多选栏按钮（长按消息进入多选：转发 / 收藏；图标跟色）
   与删除键（红字红图标） ── */
[data-testid='qq-select-del'] { color: #F5455C; }

/* ── 18. 右上菜单按钮（聊天页顶部的 ⋯ 图标） ── */
[data-testid='qq-chat-menu'] { color: inherit; }

/* ══ 二、聊天卡片（QQ 无小尾巴、无礼物卡） ══ */

/* ── 19. 所有卡片的圆角（QQ 大圆角） ── */
.chat-card-body { border-radius: 12px; }

/* ── 20. QQ红包卡（红粉渐变封面） ── */
.chat-card-rp {
  background: linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%) !important;
}

/* ── 21. 转账卡（QQ蓝渐变） ── */
.chat-card-tr {
  background: linear-gradient(135deg, #29ABF2 0%, #0099FF 100%) !important;
}

/* ── 22. 亲属卡（金色渐变） ── */
.chat-card-fam {
  background: linear-gradient(135deg, #F7D488 0%, #EDB95E 100%) !important;
}

/* ── 23. 美团代付卡（找人代付：白卡 + 黄横幅 + 黄按钮） ── */
.chat-card-mtpay { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 24. 淘宝代付卡（找人代付：白卡 + 橙横幅 + 橙按钮） ── */
.chat-card-tbpay { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 25. 代点外卖卡（美团外卖草稿：白卡 + 黄按钮） ── */
.chat-card-mtdraft { background: #FFFFFF; }
.chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 26. AI 帮买卡（淘宝代买草稿：白卡） ── */
.chat-card-tbdraft { background: #FFFFFF; }

/* ── 27. 订单分享卡（美团/淘宝购物订单：白卡） ── */
.chat-card-mtshare, .chat-card-tbshare { background: #FFFFFF; }

/* ── 28. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 29. 卡片横幅（代付卡顶部的彩色横条） ── */
.chat-card-banner { border-radius: 10px; }

/* ── 30. 卡片主按钮（查看详情 / 确认下单那类胶囊） ── */
.chat-card-btn { border-radius: 99px; }

/* ── 31. 卡片底部标签条（QQ红包/转账/亲属卡那行小字） ── */
.chat-card-label {
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.25);
  font-size: 12.5px;
}

/* ── 32. 卡片小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }

/* ── 33. 卡片里的图标（红包铜钱/礼物盒…各有专属色） ──
   想统一换成同一个颜色？解开下面这行 */
/* .chat-card svg { color: #FFE9B8; } */

/* ══ 三、红包 / 亲属卡页面 ══ */

/* ── 34. 开红包按钮（红包封面上的金色圆钮「開」） ── */
[data-testid='qq-rp-open'] { background: #FBE7B2; color: #D8332F; }

/* ── 35. 红包详情金额（点开红包后的大字金额，浅金色） ── */
[data-testid='qq-rp-detail-amount'] { color: #FFE9B8; }

/* ── 36. 亲属卡详情卡（金色渐变卡身；程序内联 → 带 !important） ── */
[data-testid='qq-family-detail-card'] {
  background: linear-gradient(150deg, #F7D488 0%, #EDB95E 60%, #E3A94B 100%) !important;
}

/* ══ 四、消息界面（QQ 主页） ══ */

/* ── 37. QQ 主界面底色（QQ 特有的冷灰白，与微信的 #EDEDED 各改各的） ── */
.qq-root { background: #FAFAFC; }
.dark & .qq-root { background: #16171A; }

/* ── 38. 页面头部（头像 + 大标题那一行；默认透明贴着页面底色） ── */
/* .qq-head { background: #FAFAFC; } */

/* ── 39. 搜索框胶囊 ── */
.qq-search { background: rgba(0, 0, 0, 0.05); }
.dark & .qq-search { background: rgba(255, 255, 255, 0.08); }

/* ── 40. 会话行（默认透明，置顶行浅灰） ── */
.qq-session-row { background: transparent; }
/* 想连置顶行一起换色？解开下面两行 */
/* .qq-session-row { background: #F0F1F5 !important; } */
/* .dark & .qq-session-row { background: rgba(255, 255, 255, 0.06) !important; } */

/* ── 41. 未读角标（红色数字） ── */
[data-testid^='qq-unread-badge-'],
[data-testid='qq-tab-badge-消息'],
[data-testid='qq-tab-badge-动态'],
[data-testid='qq-discover-zone-badge'] { background: #F5455C; }

/* ── 42. 右上角＋菜单（消息页的下拉小面板） ── */
[data-testid='qq-msgs-plus-menu'] { background: #FFFFFF; }
.dark & [data-testid='qq-msgs-plus-menu'] { background: #2A2C31; }

/* ── 43. 长按会话菜单（置顶/删除那个白条菜单） ── */
[data-testid='qq-session-ctx'] {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(0, 0, 0, 0.08);
}
.dark & [data-testid='qq-session-ctx'] {
  background: rgba(76, 76, 76, 0.95);
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 44. 底部标签栏（消息 / 联系人 / 动态） ── */
.qq-tabbar {
  background: #FFFFFF;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .qq-tabbar {
  background: #1B1C1F;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 45. 标签按钮与图标（未选中字色图标色一起换；
   选中色是程序控制的 QQ 蓝） ── */
[data-testid^='qq-tab-'] { color: rgba(0, 0, 0, 0.55); }
.dark & [data-testid^='qq-tab-'] { color: rgba(255, 255, 255, 0.55); }

/* ══ 五、联系人界面 ══ */

/* ── 46. 分组标签（分组 / 好友 / 群聊那排；选中色是程序控制的 QQ 蓝） ── */
[data-testid^='qq-ct-tab-'] { color: rgba(0, 0, 0, 0.55); }
.dark & [data-testid^='qq-ct-tab-'] { color: rgba(255, 255, 255, 0.55); }

/* ── 47. 好友行（我的好友列表里的行；默认透明） ── */
.qq-contact-row { background: transparent; }

/* ── 48. 添加入口（新的朋友 / 添加好友那两颗） ──
   [data-testid='qq-contacts-add'] 与 [data-testid='qq-contacts-newfriends'] */

/* ══ 六、动态界面（QQ 空间） ══ */

/* ── 49. 动态入口行（好友动态 / 相册 / 日历…；默认透明） ── */
[data-testid^='qq-discover-'] { background: transparent; }

/* ── 50. 空间动态流（说说的滚动区域；默认透明） ── */
[data-testid='qq-zone-feed'] { background: transparent; }

/* ── 51. 空间小红点（好友动态入口的未读点） ── */
[data-testid='qq-discover-zone-badge'] { background: #F5455C; }

/* ══ 七、个人中心（QQ 的「我」） ══ */

/* ── 52. 侧边抽屉头像（左上头像点开的抽屉里那颗） ── */
[data-testid='qq-drawer-avatar'] { border-radius: 999px; }

/* ── 53. 抽屉里的名字 ── */
[data-testid='qq-drawer-name'] { color: inherit; }

/* ── 54. 切换账号按钮（名字下面那个空心小胶囊） ── */
[data-testid='qq-drawer-switch'] {
  border-color: rgba(0, 0, 0, 0.12);
  color: rgba(0, 0, 0, 0.6);
}
.dark & [data-testid='qq-drawer-switch'] {
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 55. 抽屉功能行图标（相册黄 / 收藏·表情·钱包蓝 / 个性装扮粉；
   颜色程序内联——想统一改色解开注释） ── */
/* [data-testid='qq-drawer'] ~ * svg { color: #3BA0FF; } */

/* ── 56. 个人资料页（头像 / 签名 / QQ号） ──
   [data-testid='qq-profile-avatar'] / [data-testid='qq-profile-sign'] /
   [data-testid='qq-profile-qqid'] */

/* ── 57. 好友资料页（点头像进入：点赞 / 留言 / 空间那排） ──
   [data-testid='qq-fprofile-like'] / [data-testid='qq-fprofile-message'] /
   [data-testid='qq-fprofile-zone'] */

/* ══ 八、聊天设置界面（联系人的聊天设置页） ══ */

/* ── 58. 设置页底色（备注/主题/翻译那页；微信/信息不受影响） ── */
.chat-set-page[data-chat-set-app='qq'][class*='bg-[#F5F6F8]'] { background: #F5F6F8; }
.dark & .chat-set-page[data-chat-set-app='qq'][class*='bg-[#F5F6F8]'] { background: #16171A; }

/* ── 59. 设置卡（圆角 14px 大圆角卡 = QQ 的） ── */
.chat-set-page[data-chat-set-app='qq'] .chat-set-card[class*='rounded-[14px]'] { background: #FFFFFF; }
.dark & .chat-set-page[data-chat-set-app='qq'] .chat-set-card[class*='rounded-[14px]'] { background: #232529; }

/* ── 60. 设置行（备注 / 主题 / 翻译…；默认透明） ── */
.chat-set-page[data-chat-set-app='qq'] .chat-set-row { background: transparent; }

/* ══ 九、手机壳与公共（所有 App 共用部分） ══ */

/* ── 61. 状态栏（顶部时间 · 信号 · 电池；默认自动黑/白） ── */
/* .ph-statusbar { color: #1F1F1F; } */

/* ── 62. 灵动岛（顶部黑色胶囊） ── */
.ph-island { background: #000000; }

/* ── 63. Home 指示条（屏幕最底部的小横杠；默认自动黑/白） ── */
/* .ph-homebar { background: #1F1F1F; opacity: 0.9; } */

/* ── 64. 页面背景（微信 / QQ / 淘宝…所有 App 的灰白底一起换色） ── */
[class*='bg-[#F5F6F7]'], [class*='bg-[#EDEDED]'], [class*='bg-[#F4F5F7]'],
[class*='bg-[#F7F8FA]'], [class*='bg-[#F5F6F8]'], [class*='bg-[#F7F7F7]'],
[class*='bg-[#F2F3F5]'], [class*='bg-[#F6F7F8]'], [class*='bg-[#F8F8F8]'],
[class*='bg-[#F6F7F9]'], [class*='bg-[#F4F5F9]'], [class*='bg-[#FAFAFC]'],
[class*='bg-[#FAFAFA]'], [class*='bg-[#EFEFF4]'] {
  background: #F5F6F7;
}
.dark & [class*='bg-[#F5F6F7]'], .dark & [class*='bg-[#EDEDED]'],
.dark & [class*='bg-[#F4F5F7]'], .dark & [class*='bg-[#F7F8FA]'],
.dark & [class*='bg-[#F5F6F8]'], .dark & [class*='bg-[#F7F7F7]'],
.dark & [class*='bg-[#F2F3F5]'], .dark & [class*='bg-[#F6F7F8]'],
.dark & [class*='bg-[#F8F8F8]'], .dark & [class*='bg-[#F6F7F9]'],
.dark & [class*='bg-[#F4F5F9]'], .dark & [class*='bg-[#FAFAFC]'],
.dark & [class*='bg-[#FAFAFA]'], .dark & [class*='bg-[#EFEFF4]'] {
  background: #111214;
}

/* ── 65. App 顶部导航栏（大标题那一整条） ── */
[class*='bg-background/80'] {
  background: color-mix(in oklab, var(--background) 80%, transparent);
}

/* ── 66. 面板与卡片（设置页 · 弹窗 · 主题面板） ── */
.rt-panel { background: #FFFFFF; }
.dark & .rt-panel { background: #35353D; }
.lg-card  { background: rgba(255, 255, 255, 0.62); }
.dark & .lg-card { background: rgba(28, 28, 34, 0.62); }
.lg-sheet { background: rgba(255, 255, 255, 0.78); }
.dark & .lg-sheet { background: rgba(30, 30, 36, 0.86); }
.lg-panel { background: rgba(255, 255, 255, 0.96); }
.dark & .lg-panel { background: rgba(28, 28, 32, 0.96); }

/* ── 67. 表单控件（输入框光标 / 选择框 / 复选框） ── */
/* input, textarea { caret-color: #FF7A59; } */
/* select { border-radius: 10px; } */
/* input[type='checkbox'] { accent-color: #0099FF; } */

/* ── 68. 按钮手感（按下轻轻缩，松手弹回来） ── */
button {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.4),
    background-color 0.18s, color 0.18s, opacity 0.18s;
}
button:active { transform: scale(0.955); }

/* ── 69. 文字选中（长按 / 拖选文字的高亮色） ── */
/* ::selection { background: #FF7A59; color: #FFFFFF; } */

/* ── 70. 滚动条（所有列表的滚动条） ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.25); border-radius: 99px; }
.dark & ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); }

/* ══ 十、再动手？解开这些注释 ══ */

/* 气泡圆角改小一点 */
/* .qq-bub-mine, .qq-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .qq-chat-list { font-size: 17px; } */

/* 发送键换个颜色 */
/* [data-testid='qq-chat-send'] { background: #FF7A59 !important; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .qq-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

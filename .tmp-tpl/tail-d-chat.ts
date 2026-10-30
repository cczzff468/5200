
// ================= 聊天（联系人 › 聊天设置 › 自定义CSS） =================
// 第七十七轮（用户指定）：聊天编辑器与主题页编辑器同款体验——一份「模板」全量列出：
// 背景顶栏 / 气泡尾巴 / 时间撤回系统引用 / 状态卡片 / 输入栏与全部按钮图标 /
// 加号表情面板 / 多选栏 / 红包转账亲属卡礼物代付外卖全部卡片，一段一处。

/** 微信 · 聊天模板（联系人专属）：该联系人聊天页的全部元素清单 */
const WX_CHAT_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '聊天页全部：气泡 / 卡片 / 按钮 / 图标 / 面板',
  css: `/* ═══════════════════════════════════════════════
   微信 · 聊天模板（联系人专属 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：只有这个联系人的聊天页（其他联系人、
   消息列表、朋友圈等界面都不受影响）。
   一 聊天界面（背景/顶栏/气泡/输入栏/按钮/图标）
   二 聊天卡片（红包/转账/亲属卡/礼物/代付…一张一段）。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的都是微信现在的默认样式——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值（想让深浅不一样才留它）。
   图标（返回箭头/笑脸/＋/发送…）是 SVG 线条，颜色跟着
   所在按钮的文字色（color）走——改按钮 color 图标就变。
   装扮气泡（纯色/七彩/古早/液态）自带样式，不吃这套规则；
   聊天设置里设过纯色/图片背景时，背景层会盖在第 1 段上面。 */

/* ══ 一、聊天界面 ══ */

/* ── 1. 聊天页背景 ── */
& { background: #EDEDED; }
.dark & { background: #111111; }

/* ── 2. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.wx-topbar { background: #EDEDED; }
.dark & .wx-topbar { background: #111111; }

/* ── 3. 顶部栏图标（返回箭头 / ⋯ 菜单；颜色跟页面文字色） ── */
.wx-topbar button { color: #000000; }
.dark & .wx-topbar button { color: #FFFFFF; }

/* ── 4. 我的气泡（右侧绿泡；文字和语音一起换） ── */
.wx-bub-mine {
  background: #95EC69 !important;   /* 微信绿 */
  color: #000000;
}
.dark & .wx-bub-mine {
  background: #3EB575 !important;
  color: #000000;
}

/* ── 5. 对方的气泡（左侧白泡；文字和语音一起换） ── */
.wx-bub-theirs {
  background: #FFFFFF !important;
  color: #000000;
}
.dark & .wx-bub-theirs {
  background: #1E1E1E !important;
  color: #FFFFFF;
}

/* ── 6. 气泡小尾巴（跟气泡同色的小三角） ── */
.wx-bub-tail-mine { background: #95EC69 !important; }
.dark & .wx-bub-tail-mine { background: #3EB575 !important; }
.wx-bub-tail-theirs { background: #FFFFFF !important; }
.dark & .wx-bub-tail-theirs { background: #1E1E1E !important; }

/* ── 7. 时间胶囊（居中的时间小条） ── */
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

/* ── 8. 撤回提示（居中的「撤回了一条消息」胶囊） ── */
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

/* ── 9. 系统消息（拉黑/解除拉黑那类居中提示胶囊） ── */
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

/* ── 10. 引用条（回复时输入框上方那条白条） ── */
[data-testid='wx-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.25);
}
.dark & [data-testid='wx-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.25);
}

/* ── 11. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 12. 底部输入栏（打字那一栏） ── */
.wx-inputbar {
  background: #EDEDED;
  border-color: rgba(0, 0, 0, 0.07);
}
.dark & .wx-inputbar {
  background: #111111;
  border-color: rgba(255, 255, 255, 0.06);
}

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

/* ══ 二、聊天卡片（一段一张） ══ */

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

/* ══ 三、再动手？解开这些注释 ══ */

/* 气泡圆角改小一点 */
/* .wx-bub-mine, .wx-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .wx-chat-list { font-size: 17px; } */

/* 消息区左右留窄一点 */
/* .wx-chat-list { padding-left: 10px; padding-right: 10px; } */

/* 发送键换个颜色 */
/* [data-testid='wx-chat-send'] { background: #FF7A59 !important; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .wx-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** QQ · 聊天模板（联系人专属）：该联系人聊天页的全部元素清单 */
const QQ_CHAT_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '聊天页全部：气泡 / 卡片 / 按钮 / 图标 / 面板',
  css: `/* ═══════════════════════════════════════════════
   QQ · 聊天模板（联系人专属 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：只有这个联系人的聊天页。
   一 聊天界面（背景/顶栏/气泡/输入栏/按钮/图标）
   二 聊天卡片（红包/转账/亲属卡/代付/外卖…一张一段）。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的都是 QQ 现在的默认样式——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值。
   图标是 SVG 线条，颜色跟着所在按钮的文字色（color）走。
   特别说明：我的气泡和发送键颜色是程序内联写死的，
   模板里那两条规则带了 !important 才能盖住——保留它，别删。 */

/* ══ 一、聊天界面 ══ */

/* ── 1. 聊天页背景 ── */
& { background: #F5F6F7; }
.dark & { background: #111214; }

/* ── 2. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.qq-topbar { background: #F5F6F7; }
.dark & .qq-topbar { background: #111214; }

/* ── 3. 顶部栏图标（返回箭头 / ⋯ 菜单；颜色跟页面文字色） ── */
.qq-topbar button { color: inherit; }
/* 想固定图标颜色？把上面那行换成下面两行 */
/* .qq-topbar button { color: #1F2329; } */
/* .dark & .qq-topbar button { color: #FFFFFF; } */

/* ── 4. 我的气泡（右侧蓝泡；文字和语音一起换） ── */
.qq-bub-mine {
  background: #0099FF !important;   /* QQ 蓝（深浅模式同色） */
  color: #FFFFFF;
}
/* 想让深色模式换个颜色，解开下面这行 */
/* .dark & .qq-bub-mine { background: #0077E0 !important; color: #FFFFFF; } */

/* ── 5. 对方的气泡（左侧白泡；文字和语音一起换） ── */
.qq-bub-theirs {
  background: #FFFFFF !important;
  color: #1F2329;
}
.dark & .qq-bub-theirs {
  background: #2A2C31 !important;
  color: #FFFFFF;
}

/* ── 6. 时间胶囊（居中的时间小条） ── */
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

/* ── 7. 撤回提示（居中的「撤回了一条消息」胶囊） ── */
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

/* ── 8. 系统消息（拉黑/解除拉黑那类居中提示胶囊） ── */
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

/* ── 9. 引用条（回复时输入框上方那条白条） ── */
[data-testid='qq-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.25);
}
.dark & [data-testid='qq-quote-bar'] > div {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.25);
}

/* ── 10. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 11. 底部输入栏（打字那一栏） ── */
.qq-inputbar { background: #FFFFFF; }
.dark & .qq-inputbar { background: #1B1C1F; }

/* ── 12. 输入框（打字的浅灰圆角框） ── */
[data-testid='qq-chat-input'] {
  background: #F6F7F8;
  border-color: rgba(0, 0, 0, 0.07);
}
.dark & [data-testid='qq-chat-input'] {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 13. 表情按钮（输入栏的笑脸图标；展开时变 QQ 蓝是程序控制） ── */
[data-testid='qq-chat-sticker'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='qq-chat-sticker'] { color: rgba(255, 255, 255, 0.85); }

/* ── 14. 加号按钮（更多功能那个＋图标；展开时旋转 45°） ── */
[data-testid='qq-chat-plus'] { color: rgba(0, 0, 0, 0.85); }
.dark & [data-testid='qq-chat-plus'] { color: rgba(255, 255, 255, 0.85); }

/* ── 15. 发送按钮（QQ 蓝圆角按钮；颜色程序内联 → 带 !important） ── */
[data-testid='qq-chat-send'] { background: #12B7F5 !important; color: #FFFFFF; }

/* ── 16. 加号面板（相册/转账/位置…展开层；默认主题贴着输入栏） ── */
[data-testid='qq-plus-panel'] { border-color: rgba(0, 0, 0, 0.05); }
.dark & [data-testid='qq-plus-panel'] { border-color: rgba(255, 255, 255, 0.06); }

/* ── 17. 表情面板（笑脸展开的表情选择层） ── */
[data-testid='qq-sticker-panel'] { background: #FFFFFF; }
.dark & [data-testid='qq-sticker-panel'] { background: #1B1C1F; }

/* ── 18. 多选栏删除键（长按消息进入多选后的红字红图标） ── */
[data-testid='qq-select-del'] { color: #F5455C; }

/* ── 19. 右上菜单按钮（聊天页顶部的 ⋯ 图标） ── */
[data-testid='qq-chat-menu'] { color: inherit; }

/* ══ 二、聊天卡片（QQ 无小尾巴、无礼物卡） ══ */

/* ── 20. 所有卡片的圆角（QQ 大圆角） ── */
.chat-card-body { border-radius: 12px; }

/* ── 21. QQ红包卡（红粉渐变封面） ── */
.chat-card-rp {
  background: linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%) !important;
}

/* ── 22. 转账卡（QQ蓝渐变） ── */
.chat-card-tr {
  background: linear-gradient(135deg, #29ABF2 0%, #0099FF 100%) !important;
}

/* ── 23. 亲属卡（金色渐变） ── */
.chat-card-fam {
  background: linear-gradient(135deg, #F7D488 0%, #EDB95E 100%) !important;
}

/* ── 24. 美团代付卡（找人代付：白卡 + 黄横幅 + 黄按钮） ── */
.chat-card-mtpay { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 25. 淘宝代付卡（找人代付：白卡 + 橙横幅 + 橙按钮） ── */
.chat-card-tbpay { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 26. 代点外卖卡（美团外卖草稿：白卡 + 黄按钮） ── */
.chat-card-mtdraft { background: #FFFFFF; }
.chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 27. AI 帮买卡（淘宝代买草稿：白卡） ── */
.chat-card-tbdraft { background: #FFFFFF; }

/* ── 28. 订单分享卡（美团/淘宝购物订单：白卡） ── */
.chat-card-mtshare, .chat-card-tbshare { background: #FFFFFF; }

/* ── 29. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 30. 卡片横幅（代付卡顶部的彩色横条） ── */
.chat-card-banner { border-radius: 10px; }

/* ── 31. 卡片主按钮（查看详情 / 确认下单那类胶囊） ── */
.chat-card-btn { border-radius: 99px; }

/* ── 32. 卡片底部标签条（QQ红包/转账/亲属卡那行小字） ── */
.chat-card-label {
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.25);
  font-size: 12.5px;
}

/* ── 33. 卡片小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }

/* ── 34. 卡片里的图标（红包铜钱/礼物盒…各有专属色） ──
   想统一换成同一个颜色？解开下面这行 */
/* .chat-card svg { color: #FFE9B8; } */

/* ══ 三、再动手？解开这些注释 ══ */

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

/** 聊天模板组（「模板」chips 按此列出）：微信 / QQ 各一份全量模板 */
export function chatCssTemplates(app: 'wx' | 'qq'): CssTemplate[] {
  return app === 'qq' ? [QQ_CHAT_TEMPLATE] : [WX_CHAT_TEMPLATE];
}

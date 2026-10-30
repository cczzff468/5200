
/** 信息 · 模板：信息 App（iMessage 风）所有界面逐项列出——会话列表 / 联系人 /
 *  聊天界面（顶栏/气泡/尾巴/系统消息/引用条/输入栏/加号面板/多选栏/图标）/
 *  聊天设置 / 手机壳与公共。 */
export const SMS_APP_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '信息全部界面：会话列表 / 联系人 / 聊天 / 图标 / 手机壳',
  css: `/* ═══════════════════════════════════════════════
   信息 · 模板（全部界面 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：整台手机，按界面分节：
   一 会话列表  二 联系人  三 聊天界面
   四 聊天设置  五 手机壳与公共。
   用法同微信模板：每段 = 一处，改值生效，不想要整段删。
   成对的两行里，第二行是深色模式的值。
   图标是 SVG 线条，颜色跟着所在按钮的文字色（color）走。
   两个提醒：① 信息 App 的页面底色跟系统走，在「手机壳与
   公共 › 页面背景」统一改；② 气泡若装扮过（纯色/七彩），
   颜色是程序写死的，规则里的 !important 用来盖住——保留。 */

/* ══ 一、会话列表界面（信息 Tab） ══ */

/* ── 1. 会话行（小助手 / 好友；默认透明，置顶行浅灰） ── */
.sms-session-row { background: transparent; }
/* 想连置顶行一起换色？解开下面两行 */
/* .sms-session-row { background: rgba(0, 0, 0, 0.06) !important; } */
/* .dark & .sms-session-row { background: rgba(255, 255, 255, 0.08) !important; } */

/* ── 2. 匿名号码按钮（右上角眼睛图标） ── */
[data-testid='chat-list-anon'] { color: hsl(var(--muted-foreground)); }

/* ── 3. 未读角标（红色数字） ── */
[data-testid='sms-unread-badge'] { background: #FF3B30; }

/* ── 4. 底部分段栏（信息 / 联系人 胶囊那一栏；毛玻璃半透） ── */
.sms-tabbar { background: rgba(255, 255, 255, 0.6); }
.dark & .sms-tabbar { background: rgba(255, 255, 255, 0.06); }
/* 分段的选中胶囊是 iOS 蓝（#007AFF），由程序控制 */

/* ── 5. 分段按钮（信息 / 联系人 两颗字；未选中灰、选中白） ── */
.sms-tabbar [role='tab'] { color: hsl(var(--muted-foreground)); }

/* ══ 二、联系人界面（信息 App 联系人 Tab） ══ */

/* ── 6. 联系人行（与信息行共用锚点 .sms-session-row，见 1） ── */

/* ── 7. 搜索框（联系人页顶部那个圆角搜索条） ── */
input[aria-label='搜索联系人'] {
  background: transparent;
  color: inherit;
}

/* ══ 三、聊天界面 ══ */

/* ── 8. 顶部栏（返回 + 头像/手机号 + 设置钮；毛玻璃半透） ── */
.sms-topbar {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & .sms-topbar {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 9. 顶部栏图标（返回箭头 / ⋯ 设置钮；颜色跟系统文字色） ── */
.sms-topbar button { color: hsl(var(--foreground)); }

/* ── 10. 我的气泡（右侧 iOS 蓝泡；文字和语音一起换） ── */
.sms-bub-mine { background: #007AFF !important; color: #FFFFFF; }

/* ── 11. 对方的气泡（左侧灰泡） ── */
.sms-bub-theirs { background: hsl(var(--muted)) !important; color: hsl(var(--foreground)); }

/* ── 12. 气泡小尾巴（跟气泡同色的弯钩） ── */
.sms-bub-tail-mine { background: #007AFF !important; }
.sms-bub-tail-theirs { background: hsl(var(--muted)) !important; }

/* ── 13. 系统消息（居中提示胶囊） ── */
[data-testid='sms-sys-row'] span {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.55);
}
.dark & [data-testid='sms-sys-row'] span {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 14. 撤回提示（居中的「撤回一条消息」胶囊） ── */
[data-testid='sms-recall-row'] span {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.55);
}
.dark & [data-testid='sms-recall-row'] span {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 15. 引用条（回复时输入框上方那条；文字灰） ── */
[data-testid='sms-quote-bar'] { color: hsl(var(--muted-foreground)); }

/* ── 16. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ── 17. 底部输入栏（加号 + 输入胶囊 + 麦克风；毛玻璃半透） ── */
.sms-inputbar {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & .sms-inputbar {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 18. 输入胶囊（打字的白色圆角条） ── */
.sms-inputbar input { background: transparent; color: inherit; }
/* 想改打字光标颜色？解开下面这行 */
/* .sms-inputbar input { caret-color: #FF7A59; } */

/* ── 19. 加号按钮（输入栏左侧的灰圆钮＋图标） ── */
[data-testid='sms-plus-button'] {
  background: rgba(255, 255, 255, 0.6);
  color: hsl(var(--muted-foreground));
}
.dark & [data-testid='sms-plus-button'] {
  background: rgba(255, 255, 255, 0.08);
}

/* ── 20. 语音按钮（声波图标；开启录音时变 iOS 蓝） ── */
[data-testid='sms-voice-toggle'] { color: hsl(var(--muted-foreground)); }

/* ── 21. 麦克风按钮（文字转语音开关；开启时变 iOS 蓝） ── */
[data-testid='sms-tts-toggle'] { color: hsl(var(--muted-foreground)); }

/* ── 22. 加号面板（相机 / 图片 / 文字图片 展开层；毛玻璃半透） ── */
[data-testid='sms-plus-panel'] {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & [data-testid='sms-plus-panel'] {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 23. 多选栏（长按消息进入多选后的底部一排；毛玻璃半透） ── */
[data-testid='sms-select-bar'] {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & [data-testid='sms-select-bar'] {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 24. 文字图片创建层（底部弹起的白色面板 + 黑遮罩） ── */
[data-testid='sms-textcard-sheet'] { background: rgba(0, 0, 0, 0.45); }
[data-testid='sms-textcard-sheet'] > div {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(255, 255, 255, 0.7);
}
.dark & [data-testid='sms-textcard-sheet'] > div {
  background: rgba(28, 28, 30, 0.85);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ══ 四、聊天设置界面（iOS 风：跟系统底色走） ══ */

/* ── 25. 设置页底色（备注/主题/翻译那页；跟随系统深浅） ── */
.chat-set-page[data-chat-set-app='sms'][class*='bg-background'] { background: hsl(var(--background)); }

/* ── 26. 设置卡（半透明 iOS 圆角卡，圆角 14px） ── */
.chat-set-page[data-chat-set-app='sms'] .chat-set-card {
  background: rgba(0, 0, 0, 0.045);
}
.dark & .chat-set-page[data-chat-set-app='sms'] .chat-set-card {
  background: rgba(255, 255, 255, 0.08);
}

/* ── 27. 设置行（备注 / 主题 / 翻译 / 回复条数…；默认透明） ── */
.chat-set-page[data-chat-set-app='sms'] .chat-set-row { background: transparent; }

/* ── 28. 消息翻译行 / 文字转语音开关 ──
   [data-testid='sms-translate-row'] 与 [data-testid='sms-tts-toggle'] */

/* ══ 五、手机壳与公共（所有 App 共用部分） ══ */

/* ── 29. 状态栏（顶部时间 · 信号 · 电池；默认自动黑/白） ── */
/* .ph-statusbar { color: #1F1F1F; } */

/* ── 30. 灵动岛（顶部黑色胶囊） ── */
.ph-island { background: #000000; }

/* ── 31. Home 指示条（屏幕最底部的小横杠；默认自动黑/白） ── */
/* .ph-homebar { background: #1F1F1F; opacity: 0.9; } */

/* ── 32. 页面背景（微信 / QQ / 淘宝…所有 App 的灰白底一起换色） ── */
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

/* ── 33. App 顶部导航栏（大标题那一整条） ── */
[class*='bg-background/80'] {
  background: color-mix(in oklab, var(--background) 80%, transparent);
}

/* ── 34. 面板与卡片（设置页 · 弹窗 · 主题面板） ── */
.rt-panel { background: #FFFFFF; }
.dark & .rt-panel { background: #35353D; }
.lg-card  { background: rgba(255, 255, 255, 0.62); }
.dark & .lg-card { background: rgba(28, 28, 34, 0.62); }
.lg-sheet { background: rgba(255, 255, 255, 0.78); }
.dark & .lg-sheet { background: rgba(30, 30, 36, 0.86); }
.lg-panel { background: rgba(255, 255, 255, 0.96); }
.dark & .lg-panel { background: rgba(28, 28, 32, 0.96); }

/* ── 35. 表单控件（输入框光标 / 选择框 / 复选框） ── */
/* input, textarea { caret-color: #FF7A59; } */
/* select { border-radius: 10px; } */
/* input[type='checkbox'] { accent-color: #007AFF; } */

/* ── 36. 按钮手感（按下轻轻缩，松手弹回来） ── */
button {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.4),
    background-color 0.18s, color 0.18s, opacity 0.18s;
}
button:active { transform: scale(0.955); }

/* ── 37. 文字选中（长按 / 拖选文字的高亮色） ── */
/* ::selection { background: #FF7A59; color: #FFFFFF; } */

/* ── 38. 滚动条（所有列表的滚动条） ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.25); border-radius: 99px; }
.dark & ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); }

/* ══ 六、再动手？解开这些注释 ══ */

/* 聊天文字放大一档 */
/* .sms-chat-list { font-size: 17px; } */

/* 气泡圆角改小一点 */
/* .sms-bub-mine, .sms-bub-theirs { border-radius: 12px; } */

/* 我的气泡换个颜色（iOS 蓝改薄荷绿） */
/* .sms-bub-mine { background: #63E6BE !important; color: #00332B !important; } */
/* .sms-bub-tail-mine { background: #63E6BE !important; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .sms-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

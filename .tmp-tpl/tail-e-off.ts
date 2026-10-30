
// ================= 线下（线下模式 › 现场设置 › 自定义CSS） =================

/** 线下 · 模板：线下模式所有界面逐项列出（开始页 / 见面页 / 存档面板 / 现场设置 /
 *  历史记录 + 全部按钮与图标），默认值 = 默认毛玻璃皮肤当前样式。 */
export const OFFLINE_CSS_TEMPLATE: CssTemplate = {
  name: '模板',
  desc: '线下全部界面：开始页 / 见面页 / 存档 / 设置 / 历史 / 图标',
  css: `/* ═══════════════════════════════════════════════
   线下模式 · 模板（全部界面 · 逐项列出）
   ═══════════════════════════════════════════════
   作用范围：线下模式的所有界面，按界面分节：
   一 全部界面共用（卡片/按钮/输入框/图标）
   二 开始页  三 见面页  四 存档面板
   五 现场设置面板  六 过去的见面（历史）。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的是线下界面现在的默认样式（毛玻璃）——
   不改直接应用 ≈ 没变化。成对的两行里，第二行是深色
   模式的值（想让深浅不一样才留它）。
   图标（返回箭头/收藏星/存档箱/滑杆/旋转/发送…）是
   SVG 线条，颜色跟着所在按钮的文字色（color）走。 */

/* ══ 一、全部界面共用 ══ */

/* ── 1. 页面底色（开始页/见面页/各面板的底） ── */
& { background: #F3F1EE; }
.dark & { background: #0C0C0E; }

/* ── 2. 卡片（AI 叙事卡 / 信息卡 / 存档卡 / 历史卡） ── */
.off-card {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & .off-card {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── 3. 顶部小按钮（返回 / 收藏 / 存档 / 现场设置四颗圆钮，
   图标跟按钮文字色一起换） ── */
.off-chip {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(0, 0, 0, 0.6);
}
.dark & .off-chip {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 4. 主按钮（新建 / 保存 / 确认那类深色实心钮） ── */
.off-btn-primary { background: rgba(28, 28, 30, 0.9); color: #FFFFFF; }
.dark & .off-btn-primary { background: #FFFFFF; color: #000000; }

/* ── 5. 幽灵按钮（取消 / 过去的见面 那类空心钮） ── */
.off-btn-ghost {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(0, 0, 0, 0.6);
}
.dark & .off-btn-ghost {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 6. 输入框（表单 · 聊天输入条） ── */
.off-input {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(255, 255, 255, 0.7);
}
.dark & .off-input {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── 7. 发送按钮（输入条里的深色圆钮＋上箭头） ── */
.off-send { background: rgba(28, 28, 30, 0.9); color: #FFFFFF; }
.dark & .off-send { background: #FFFFFF; color: #000000; }

/* ── 8. 标题区（顶部头像 + 名字 + 日期那一块） ── */
.off-title { color: inherit; }

/* ══ 二、开始页（还没点「开始见面」时） ══ */

/* ── 9. 开始页中心区（大头像 + 名字 + 按钮那块；默认透明） ── */
.off-hero { background: transparent; }

/* ── 10. 开始见面按钮（深色大按钮＋星图标） ── */
.off-start { background: rgba(28, 28, 30, 0.9); color: #FFFFFF; }
.dark & .off-start { background: #FFFFFF; color: #000000; }

/* ── 11. 过去的见面按钮（历史入口，幽灵样式＋时钟图标） ── */
[data-testid='offline-history-open'] { color: rgba(0, 0, 0, 0.6); }
.dark & [data-testid='offline-history-open'] { color: rgba(255, 255, 255, 0.6); }

/* ══ 三、见面页（见面进行中） ══ */

/* ── 12. 消息流（叙事卡 + 你的气泡滚动的区域；默认透明） ── */
.off-feed { background: transparent; }

/* ── 13. AI 叙事卡（对方说的话；样式 = 共用 .off-card，见 2） ── */

/* ── 14. 我的气泡（见面页里你说的话） ── */
.off-bubble-user {
  background: rgba(236, 234, 231, 0.85);
  border-color: rgba(0, 0, 0, 0.06);
}
.dark & .off-bubble-user {
  background: rgba(44, 44, 46, 0.85);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── 15. 底部输入区（继续/重Roll 圆钮 + 输入条 + 发送；默认透明） ── */
.off-dock { background: transparent; }

/* ── 16. 继续 / 重Roll 圆钮（输入条左边两颗；图标跟色） ── */
[data-testid='offline-continue'],
[data-testid='offline-reroll'] { color: rgba(0, 0, 0, 0.75); }
.dark & [data-testid='offline-continue'],
.dark & [data-testid='offline-reroll'] { color: rgba(255, 255, 255, 0.8); }

/* ══ 四、存档面板（顶部「存档」按钮进入） ══ */

/* ── 17. 存档面板底色 ── */
.off-panel-archive { background: #F3F1EE; }
.dark & .off-panel-archive { background: #0C0C0E; }

/* ── 18. 新建存档 / 存档卡 / 导入按钮 ──
   卡片样式 = 共用 .off-card（见 2）；按钮 = .off-btn-primary / .off-btn-ghost（见 4、5） */

/* ══ 五、现场设置面板（顶部「滑杆」按钮进入） ══ */

/* ── 19. 现场设置面板底色 ── */
.off-panel-settings { background: #F3F1EE; }
.dark & .off-panel-settings { background: #0C0C0E; }

/* ── 20. 放弃见面按钮（设置里那颗红色的） ──
   [data-testid='offline-abandon'] { color: #FF3B30; } */

/* ══ 六、过去的见面（历史记录） ══ */

/* ── 21. 历史页底色 ── */
.off-panel-history { background: #F3F1EE; }
.dark & .off-panel-history { background: #0C0C0E; }

/* ── 22. 历史里的见面卡（样式 = 共用 .off-card，见 2） ── */

/* ── 23. 再动手？解开这些注释 ── */
/* 卡片圆角改小 */
/* .off-card { border-radius: 12px; } */

/* 开始见面按钮改渐变色 */
/* .off-start { background: linear-gradient(180deg, #97CC58 0%, #71A83B 100%); color: #fff; } */

/* 叙事文字放大一档 */
/* .off-card { font-size: 15.5px; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* & { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** 全局模板组（个性装扮 › 自定义CSS Tab）：每个 App 只显示自己的一份「模板」
 *  （第七十六轮按 App 分开；第七十七轮用户指定：手机公共模板删除，
 *  公共部分并入各 App 模板的「手机壳与公共」一节）。 */
export function globalCssTemplates(app: 'wx' | 'qq' | 'sms'): CssTemplate[] {
  if (app === 'wx') return [WX_APP_TEMPLATE];
  if (app === 'qq') return [QQ_APP_TEMPLATE];
  return [SMS_APP_TEMPLATE];
}

/** 线下模板组（线下模式 › 现场设置）：一份「模板」含全部 */
export const OFFLINE_CSS_TEMPLATES: CssTemplate[] = [OFFLINE_CSS_TEMPLATE];

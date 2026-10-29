'use client';

/**
 * 聊天装扮设置（第十七轮建立 · 第二十一轮整页删除重做 · 拆分两页 · 本轮主题页重做）
 * ---------------------------------------------------------------------------
 * 入口：QQ 个人抽屉 / 设置 › 个性装扮；微信「发现」页 › 主题（原小程序位）；
 *       信息 App › 聊天设置 › 主题。
 *
 * 本轮主题页重做（用户指定：主题单独成界面 + 液态玻璃设置挂在对应主题下 + 简约）：
 *  1. ThemeStylePage 主题页 = **纯主题选择界面**：每个主题一张全宽大卡，卡内自带
 *     实时缩影预览（mini 顶栏 + 日期胶囊 + 两条真实渲染气泡 + 输入胶囊 + TabBar，
 *     气泡装扮同步联动）；选中卡 accent 描边 + 圆勾徽标；
 *     **液态玻璃设置行嵌在液态玻璃卡内部下方**（仅选中该主题时展开，归属一目了然）；
 *     页尾仅保留气泡入口行；
 *  2. BubbleStylePage 气泡页：实时预览（日期胶囊 + 四条模拟消息）+
 *     气泡样式四格（默认 / 七彩 / 毛玻璃 / 液态）+ 自定义颜色
 *     （一起 / 我的 / TA的 HSL 三滑条 + 预设色板）+ 保存当前设置 + 收藏夹。
 *  主题切换仍联动气泡（液态玻璃 ↔ 原生默认，setBubbleTheme 内实现）；
 *  之后单独换气泡样式不动主题（patchAppStyle 只写 kind）。
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, MessageCircle, Palette, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { useSettings } from '@/lib/ios/store';
import {
  BUBBLE_KIND_LABEL,
  BUBBLE_THEME_LABEL,
  THEMES_OF_APP,
  NATIVE_BUBBLE,
  PRESET_SWATCHES,
  TAIL_CLIP_LEFT,
  TAIL_CLIP_RIGHT,
  bubbleVisual,
  hexToHsl,
  hslToHex,
  withAlpha,
  yiqTextOn,
  type BubbleAppId,
  type BubbleAppStyle,
  type BubbleScheme,
  type BubbleStyleConfig,
  type BubbleStyleKind,
  type BubbleTheme,
} from '@/lib/ios/bubble-style';

const PLATFORM_META: Record<BubbleAppId, { name: string; accent: string }> = {
  wx: { name: '微信', accent: '#07C160' },
  qq: { name: 'QQ', accent: '#0099FF' },
  sms: { name: '信息', accent: '#007AFF' },
};

/** 样式副标题（简短说明各自质感，帮助区分毛玻璃/液态） */
const KIND_CAPTIONS: Record<BubbleStyleKind, string> = {
  default: '纯色 · 可自选颜色',
  rainbow: '九色 · 按消息循环',
  frosted: '奶白磨砂 · 隐约透底',
  liquid: '清透水膜 · 透底',
};

/** 主题副标题（主题卡下方的一行小注） */
const THEME_CAPTIONS: Record<BubbleTheme, string> = {
  default: '原生经典 · 纯色界面',
  liquid: '玻璃通透 · 悬浮胶囊',
};

/** 玻璃卡（统一材质；圆角 22px） */
const GLASS_CARD =
  'rounded-[22px] bg-white/60 backdrop-blur-xl ring-1 ring-white/70 dark:bg-white/[0.06] dark:ring-white/[0.14]';

/** 弱文字小标题（区块标签，非装饰；accent 色点 + 文字） */
function SectionLabel({ accent, children }: { accent?: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-2 text-[12.5px] font-semibold tracking-wide text-black/40 dark:text-white/40">
      {accent && (
        <span
          aria-hidden="true"
          className="h-[5px] w-[5px] rounded-full"
          style={{ backgroundColor: accent, boxShadow: `0 0 0 2.5px ${withAlpha(accent, 0.18)}` }}
        />
      )}
      {children}
    </p>
  );
}

/** 区块入场动画（轻微错峰淡入上浮） */
function FadeInSection({
  index,
  className,
  role,
  ariaLabel,
  children,
}: {
  index: number;
  className?: string;
  role?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className={className}
      role={role}
      aria-label={ariaLabel}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index, duration: 0.32 }}
    >
      {children}
    </motion.div>
  );
}

// ---------------- 迷你预览气泡（与聊天页同一渲染引擎，所见即所得） ----------------

/** 彩色光斑层：垫在毛玻璃/液态泡下面，让 backdrop-filter 的模糊效果肉眼可见（功能性，非装饰） */
function AuraLayer() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute -left-4 top-2 h-16 w-16 rounded-full bg-[#FF9500]/35 blur-2xl" />
      <span className="absolute right-6 top-6 h-14 w-14 rounded-full bg-[#34C759]/35 blur-2xl" />
      <span className="absolute bottom-0 left-1/3 h-16 w-16 rounded-full bg-[#AF52DE]/30 blur-2xl" />
      <span className="absolute -right-2 bottom-2 h-14 w-14 rounded-full bg-[#3D9BFF]/30 blur-2xl" />
    </div>
  );
}

/** 单条迷你预览气泡：override 时用装扮样式，否则 App 原生配色
 *  （尾巴跟随 bubbleVisual：QQ 纯色/七彩 = 信息 App 同款底部弯钩剪影（第五十一轮，迷你版 12×10px 随色）；
 *   微信/信息 = 原生小方块随色；胶囊无尾巴） */
function PreviewBubble({
  app,
  cfg,
  side,
  index,
  children,
  className = '',
}: {
  app: BubbleAppId;
  cfg: BubbleStyleConfig;
  side: 'mine' | 'theirs';
  index: number;
  children: React.ReactNode;
  className?: string;
}) {
  const vis = bubbleVisual(side, cfg, index, app);
  const native = side === 'mine' ? NATIVE_BUBBLE[app].mine : NATIVE_BUBBLE[app].theirs;
  const nativeText = side === 'mine' && app !== 'wx' ? 'text-white' : 'text-black';
  // 原生圆角与各端文本气泡同规格：微信 5px / QQ 10px / 信息 18px（iMessage 大圆角）
  const nativeRadius = app === 'sms' ? 'rounded-[18px]' : app === 'qq' ? 'rounded-[10px]' : 'rounded-[5px]';
  return (
    <div
      className={`relative w-fit max-w-full whitespace-pre-wrap break-words ${nativeRadius} px-2.5 py-[7px] text-[12.5px] leading-[1.45] ${
        vis.override ? vis.className : nativeText
      } ${className}`}
      style={vis.override ? vis.style : { backgroundColor: native }}
    >
      {vis.tail === 'im' && (
        /* QQ 装扮纯色/七彩（第五十一轮）：信息 App 同款底部弯钩剪影尾巴（迷你版，随 tailColor 上色） */
        <span
          aria-hidden="true"
          className={`absolute bottom-0 ${side === 'mine' ? '-right-[4px]' : '-left-[4px]'} h-[13px] w-[10px]`}
          style={{ clipPath: side === 'mine' ? TAIL_CLIP_RIGHT : TAIL_CLIP_LEFT, backgroundColor: vis.tailColor || native }}
        />
      )}
      {vis.tail === 'native' && app !== 'qq' && (
        <span
          aria-hidden="true"
          className={`absolute top-[7px] h-[6px] w-[6px] rotate-45 ${side === 'mine' ? '-right-[2px]' : '-left-[2px]'}`}
          style={{ backgroundColor: vis.tailColor || native }}
        />
      )}
      {children}
    </div>
  );
}

/** 预览卡里的一行消息（带头像圆点） */
function PreviewRow({
  app,
  cfg,
  side,
  index,
  text,
}: {
  app: BubbleAppId;
  cfg: BubbleStyleConfig;
  side: 'mine' | 'theirs';
  index: number;
  text: string;
}) {
  const meta = PLATFORM_META[app];
  return (
    <div className={`flex items-end gap-1.5 ${side === 'mine' ? 'flex-row-reverse' : ''}`}>
      <span
        aria-hidden="true"
        className={`z-[1] flex h-[26px] w-[26px] shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white ${
          side === 'mine' ? '' : 'bg-gradient-to-br from-[#F0A0B8] to-[#C86DD7]'
        }`}
        style={side === 'mine' ? { background: meta.accent } : undefined}
      >
        {side === 'mine' ? '我' : 'TA'}
      </span>
      <PreviewBubble app={app} cfg={cfg} side={side} index={index}>
        {text}
      </PreviewBubble>
    </div>
  );
}

/** 预览消息序列：序号 0-3 递增（七彩样式下能看到 亮黄→青柠→杏色→青色 依次切换） */
const PREVIEW_MESSAGES: { side: 'mine' | 'theirs'; text: string }[] = [
  { side: 'theirs', text: '早安呀，今天也要开心' },
  { side: 'mine', text: '早安！窗外云超好看' },
  { side: 'theirs', text: '哈哈快拍给我看看' },
  { side: 'mine', text: '这就发你，等我' },
];

// ---------------- 主题卡内实时缩影预览（本轮重做：主题单独成界面，每卡自带预览） ----------------

/** 主题卡内的紧凑实时缩影（约 132px）：mini 顶栏 + 日期胶囊 + 两条**真实渲染**气泡
 *  （PreviewBubble，气泡装扮同步联动）+ 输入胶囊 + TabBar；
 *  液态 = 玻璃半透 lg-* 同材质 + 悬浮胶囊 TabBar；默认 = 白实底 + 贴底素条。 */
function ThemeCardPreview({
  app,
  cfg,
  theme,
  accent,
}: {
  app: BubbleAppId;
  cfg: BubbleStyleConfig;
  theme: BubbleTheme;
  accent: string;
}) {
  const liquid = theme === 'liquid';
  const solid = 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.07)] dark:bg-[#2A2B30] dark:shadow-none';
  return (
    <div
      className={`relative h-[132px] overflow-hidden rounded-[16px] ${
        liquid ? 'lg-root' : 'bg-[#F2F3F7] dark:bg-[#17181C]'
      }`}
    >
      {liquid && <AuraLayer />}
      {/* mini 顶栏：液态 = 玻璃胶囊；默认 = 白实底条 */}
      <div className={`mx-2.5 mt-2.5 flex h-[15px] items-center justify-center ${liquid ? 'lg-search' : solid}`}>
        <span className="h-[3.5px] w-[30px] rounded-full bg-black/[0.12] dark:bg-white/25" />
      </div>
      {/* 日期胶囊（居中小字） */}
      <div className="mt-[5px] flex justify-center">
        <span
          className={`rounded-full px-1.5 py-[1px] text-[7px] leading-none text-black/35 dark:text-white/35 ${
            liquid ? '' : 'bg-black/[0.05] dark:bg-white/[0.08]'
          }`}
        >
          10:24
        </span>
      </div>
      {/* 消息：TA（左）真实装扮泡 + 我（右）真实装扮泡 */}
      <div className="mt-[5px] flex flex-col items-start gap-[5px] px-3">
        <PreviewBubble app={app} cfg={cfg} side="theirs" index={0} className="!px-2 !py-[3.5px] !text-[8.5px]">
          早呀
        </PreviewBubble>
        <span className="ml-auto">
          <PreviewBubble app={app} cfg={cfg} side="mine" index={1} className="!px-2 !py-[3.5px] !text-[8.5px]">
            今天也要开心
          </PreviewBubble>
        </span>
      </div>
      {/* mini 输入条 */}
      <div className={`mx-2.5 mt-2 h-[12px] rounded-full ${liquid ? 'lg-input' : solid}`} />
      {/* mini TabBar：默认 = 贴底素条；液态 = 悬浮玻璃胶囊 */}
      {liquid ? (
        <div className="lg-tabbar absolute inset-x-[10px] bottom-[7px] flex h-[14px] items-center justify-around">
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              className="h-[4.5px] w-[4.5px] rounded-full"
              style={{ background: d === 0 ? accent : 'rgba(0,0,0,0.35)' }}
            />
          ))}
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex h-[16px] items-center justify-around border-t border-black/[0.06] bg-[#FBFBFD] dark:border-white/[0.08] dark:bg-[#1D1E23]">
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              className="h-[4.5px] w-[4.5px] rounded-full bg-black/[0.18] dark:bg-white/40"
              style={d === 0 ? { background: accent } : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- HSL 滑条（胶囊轨道） ----------------

let hslSliderSeq = 0;

function HslSlider({
  value,
  max,
  trackBackground,
  thumbColor,
  label,
  onChange,
}: {
  value: number;
  max: number;
  trackBackground: string;
  thumbColor: string;
  label: string;
  onChange: (v: number) => void;
}) {
  const [id] = useState(() => `hsl-slider-${++hslSliderSeq}`);
  return (
    <div className="relative h-6">
      {/* 滑杆手柄底色随当前色变化：内联样式选不中伪元素，挂一段组件级动态样式 */}
      <style>{`#${id}::-webkit-slider-thumb{background-color:${thumbColor}} #${id}::-moz-range-thumb{background-color:${thumbColor}}`}</style>
      {/* 胶囊轨道：渐变底 + 发丝白描边 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full ring-1 ring-white/60 dark:ring-white/[0.14]"
        style={{ background: trackBackground }}
      />
      <input
        id={id}
        type="range"
        aria-label={label}
        value={Math.round(value)}
        min={0}
        max={max}
        step={1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-6 w-full cursor-pointer appearance-none bg-transparent
          [&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.22)]
          [&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.22)]"
      />
    </div>
  );
}

// ================= 主题页（本轮重做：主题单独成界面 + 液态玻璃设置挂在液态主题卡内） =================

export interface ThemeStylePageProps {
  /** 宿主 App（装扮完全隔离：本页所有修改只写入 cfg[app]） */
  app: BubbleAppId;
  /** 返回上一级 */
  onBack: () => void;
  /** 进入气泡样式页（本页只管界面主题，气泡在独立页单独调） */
  onOpenBubbles: () => void;
  /** 进入液态玻璃皮肤设置页（挂在液态玻璃主题卡内；仅选中液态主题时显示，wx/qq 传入） */
  onOpenSkin?: () => void;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
}

/** 主题页（本轮重做·简约）：纯主题选择界面 —— 每个主题一张全宽大卡（卡内自带实时缩影
 *  预览，气泡装扮同步联动，所见即所得）；选中卡 accent 描边 + 圆勾徽标；
 *  液态玻璃设置行嵌在液态玻璃卡内部下方（归属一目了然）；页尾仅气泡入口一行。 */
export function ThemeStylePage({ app, onBack, onOpenBubbles, onOpenSkin, onToast }: ThemeStylePageProps) {
  const meta = PLATFORM_META[app];
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const setBubbleTheme = useSettings((s) => s.setBubbleTheme);

  /** 当前 App 的装扮（三 App 隔离：只读写 bubbleStyle[app]） */
  const appStyle: BubbleAppStyle = bubbleStyle[app] ?? { kind: 'default' };
  const curTheme: BubbleTheme = appStyle.theme ?? 'default';

  return (
    <IOSScreen className="bg-[#F4F5F7] dark:bg-[#0E1014]">
      <IOSNavBar
        title="主题"
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        className="bg-[#F4F5F7]/75! dark:bg-[#0E1014]/75!"
      />

      <div className="no-scrollbar relative flex-1 space-y-6 overflow-y-auto px-4 pb-12">
        {/* ---------- 1. 主题卡（主题单独成界面：每卡自带实时缩影预览 + 名称行；点整卡切换） ---------- */}
        <FadeInSection index={0} className="section">
          <SectionLabel accent={meta.accent}>界面主题</SectionLabel>
          <div className="mt-2.5 space-y-3.5">
            {THEMES_OF_APP[app].map((theme) => {
              const selected = curTheme === theme;
              const liquid = theme === 'liquid';
              return (
                <div
                  key={theme}
                  className={`overflow-hidden rounded-[22px] bg-white transition-shadow duration-300 dark:bg-[#1C1E23] ${
                    selected ? '' : 'ring-1 ring-inset ring-black/[0.05] dark:ring-white/[0.08]'
                  }`}
                  style={
                    selected
                      ? { boxShadow: `inset 0 0 0 1.5px ${meta.accent}, 0 10px 28px ${withAlpha(meta.accent, 0.14)}` }
                      : undefined
                  }
                >
                  {/* 点按整卡切换主题 */}
                  <button
                    type="button"
                    data-testid={`bubble-theme-${theme}`}
                    aria-pressed={selected}
                    onClick={() => {
                      if (!selected) {
                        setBubbleTheme(app, theme);
                        onToast(
                          theme === 'liquid'
                            ? '已切换液态玻璃主题，气泡同步换为液态玻璃'
                            : '已恢复默认主题，气泡同步换为原生默认',
                        );
                      }
                    }}
                    className="block w-full text-left transition-transform active:scale-[0.99]"
                  >
                    <div className="p-2.5 pb-0">
                      <ThemeCardPreview app={app} cfg={bubbleStyle} theme={theme} accent={meta.accent} />
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15.5px] font-semibold leading-tight text-black/85 dark:text-white/90">
                          {BUBBLE_THEME_LABEL[theme]}
                        </span>
                        <span className="mt-[3px] block truncate text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                          {THEME_CAPTIONS[theme]}
                        </span>
                      </span>
                      {selected && (
                        <span
                          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-white shadow-sm"
                          style={{ backgroundColor: meta.accent }}
                        >
                          <Check className="h-[13px] w-[13px]" strokeWidth={3.2} />
                        </span>
                      )}
                    </div>
                  </button>

                  {/* 液态玻璃专属设置：嵌在液态玻璃主题卡内部下方（仅选中该主题时展开，
                      归属清晰：设置就在对应主题里面，不再放页尾独立区块） */}
                  <AnimatePresence initial={false}>
                    {liquid && selected && onOpenSkin && (
                      <motion.div
                        key="skin-row"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-black/[0.05] dark:border-white/[0.07]">
                          <button
                            type="button"
                            data-testid="liquid-skin-entry"
                            onClick={onOpenSkin}
                            className="flex w-full items-center gap-2.5 bg-black/[0.02] px-4 py-[10px] text-left transition-colors active:bg-black/[0.05] dark:bg-white/[0.03] dark:active:bg-white/[0.06]"
                          >
                            <span
                              className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[9px]"
                              style={{ backgroundColor: withAlpha(meta.accent, 0.12) }}
                            >
                              <Sparkles
                                className="h-[15px] w-[15px]"
                                style={{ color: meta.accent }}
                                strokeWidth={2.1}
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] font-medium leading-tight text-black/80 dark:text-white/85">
                                液态玻璃设置
                              </span>
                              <span className="mt-[2px] block truncate text-[10.5px] leading-tight text-black/35 dark:text-white/35">
                                {app === 'wx' ? '顶栏名字样式 · 分类标签 · 小组件' : '顶栏名字样式'}
                              </span>
                            </span>
                            <ChevronRight
                              className="h-4 w-4 shrink-0 text-black/25 dark:text-white/25"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
          <p className="mt-2.5 px-2 text-[11px] leading-relaxed text-black/35 dark:text-white/35">
            {app === 'sms' ? '信息 App 暂仅默认主题；气泡样式可单独挑选' : '切换主题会同步气泡与界面；气泡样式也可单独挑选'}
          </p>
        </FadeInSection>

        {/* ---------- 2. 气泡入口（列表行，进入独立气泡页） ---------- */}
        <FadeInSection index={1} className="section">
          <SectionLabel accent={meta.accent}>气泡</SectionLabel>
          <button
            type="button"
            data-testid="bubble-style-entry"
            onClick={onOpenBubbles}
            className="mt-2.5 flex w-full items-center gap-3 rounded-[22px] bg-white px-4 py-[13px] text-left ring-1 ring-black/[0.05] transition-transform active:scale-[0.99] dark:bg-[#1C1E23] dark:ring-white/[0.08]"
          >
            <span
              className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px]"
              style={{ backgroundColor: withAlpha(meta.accent, 0.12) }}
            >
              <MessageCircle className="h-[19px] w-[19px]" style={{ color: meta.accent }} strokeWidth={2.1} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium leading-tight text-black/85 dark:text-white/90">
                聊天气泡样式
              </span>
              <span className="mt-[2px] block truncate text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                {BUBBLE_KIND_LABEL[appStyle.kind]}
                {appStyle.mineColor || appStyle.theirsColor ? ' · 自定义色' : ''}
              </span>
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </FadeInSection>
      </div>
    </IOSScreen>
  );
}

// ================= 气泡页（本轮拆分：主题与气泡各自独立成页之二） =================

export interface BubbleStylePageProps {
  /** 宿主 App（装扮完全隔离：本页所有修改只写入 cfg[app]） */
  app: BubbleAppId;
  /** 返回上一级（主题页） */
  onBack: () => void;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
}

export function BubbleStylePage({ app, onBack, onToast }: BubbleStylePageProps) {
  const meta = PLATFORM_META[app];
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const schemes = useSettings((s) => s.bubbleSchemes);
  const setBubbleStyle = useSettings((s) => s.setBubbleStyle);
  const setBubbleSchemes = useSettings((s) => s.setBubbleSchemes);

  /** 自定义颜色编辑目标：both=两侧一起改 / mine=我的 / theirs=TA的（仅颜色分侧；样式对两侧同时生效） */
  const [side, setSide] = useState<'both' | 'mine' | 'theirs'>('mine');
  /** 命名弹窗 */
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  /** 当前 App 的装扮（三 App 隔离：只读写 bubbleStyle[app]） */
  const appStyle: BubbleAppStyle = bubbleStyle[app] ?? { kind: 'default' };
  const kindDisabled = appStyle.kind === 'rainbow';
  /** 当前编辑目标展示色：both 优先取我的（未设时回退 TA 的） */
  const currentColor =
    side === 'both'
      ? appStyle.mineColor ?? appStyle.theirsColor
      : side === 'mine'
        ? appStyle.mineColor
        : appStyle.theirsColor;
  /** 无自定义色时滑条落在 App 原生默认色位置（拖动任意一杆立即生成自定义色落地） */
  const fallbackHex = NATIVE_BUBBLE[app][side === 'theirs' ? 'theirs' : 'mine'];
  const hsl = useMemo(() => hexToHsl(currentColor ?? fallbackHex), [currentColor, fallbackHex]);
  const hasCustomColor = !!(side === 'both' ? appStyle.mineColor || appStyle.theirsColor : currentColor);

  /** 修改当前 App 的装扮（其他 App 原样保留 —— 装扮隔离；只写 kind/颜色，不动主题） */
  const patchAppStyle = (patch: Partial<BubbleAppStyle>) => {
    setBubbleStyle({
      ...bubbleStyle,
      [app]: { ...appStyle, ...patch },
    });
  };

  /** 写入颜色到编辑目标（both = 两侧同步写） */
  const commitColor = (hex: string) => {
    if (side === 'both') patchAppStyle({ mineColor: hex, theirsColor: hex });
    else if (side === 'mine') patchAppStyle({ mineColor: hex });
    else patchAppStyle({ theirsColor: hex });
  };

  /** 滑条拖动：实时合成 hex 写入编辑目标（预览卡/聊天页即时跟随） */
  const commitHsl = (h: number, s: number, l: number) => {
    commitColor(hslToHex(h, s, l));
  };

  const saveScheme = () => {
    const name = nameDraft.trim().slice(0, 16) || `我的气泡 ${schemes.length + 1}`;
    const scheme: BubbleScheme = {
      id: `bs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      app,
      style: { ...appStyle },
      createdAt: Date.now(),
    };
    setBubbleSchemes([scheme, ...schemes]);
    setNaming(false);
    setNameDraft('');
    onToast(`已保存「${name}」`);
  };

  /** 应用方案：只覆盖方案归属的 App（跨 App 应用时提示归属） */
  const applyScheme = (s: BubbleScheme) => {
    setBubbleStyle({
      ...bubbleStyle,
      [s.app]: { ...s.style },
    });
    const target = PLATFORM_META[s.app].name;
    onToast(s.app === app ? `已应用「${s.name}」` : `已将「${s.name}」应用到${target}`);
  };

  const removeScheme = (s: BubbleScheme) => {
    setBubbleSchemes(schemes.filter((x) => x.id !== s.id));
    onToast(`已删除「${s.name}」`);
  };

  /** 当前 App 下与现有装扮完全一致的方案 = 使用中 */
  const activeSchemeId = useMemo(() => {
    const cur = JSON.stringify(appStyle);
    return schemes.find((s) => s.app === app && JSON.stringify(s.style) === cur)?.id ?? null;
  }, [schemes, appStyle]);

  return (
    <IOSScreen className="bg-[#F4F5F7] dark:bg-[#0E1014]">
      <IOSNavBar
        title="气泡样式"
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        className="bg-[#F4F5F7]/75! dark:bg-[#0E1014]/75!"
      />

      <div className="no-scrollbar relative flex-1 space-y-8 overflow-y-auto px-4 pb-12">
        {/* ---------- 1. 实时预览：单层干净浅底幕布（去玻璃相框嵌套） ---------- */}
        <FadeInSection index={0} className="section" role="region" ariaLabel="实时预览">
          <div className="relative overflow-hidden rounded-[20px] ring-1 ring-black/[0.05] dark:ring-white/[0.09]">
            <div className="absolute inset-0 bg-gradient-to-b from-[#F5F7FA] to-[#EAEFF4] dark:from-[#222631] dark:to-[#161A22]" />
            <AuraLayer />
            <div className="relative flex flex-col px-4 py-5">
              {/* 日期胶囊（真聊天页的时间行样式） */}
              <div className="mb-3.5 flex justify-center">
                <span className="rounded-full bg-black/[0.06] px-2.5 py-[3px] text-[10px] font-medium text-black/40 dark:bg-white/[0.08] dark:text-white/40">
                  今天 14:32
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {PREVIEW_MESSAGES.map((m, i) => (
                  <div key={i} className={m.side === 'mine' ? 'self-end' : 'self-start'}>
                    <PreviewRow app={app} cfg={bubbleStyle} side={m.side} index={i} text={m.text} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </FadeInSection>

        {/* ---------- 2. 气泡样式四格（示意胶囊 + 名称，无多余装饰） ---------- */}
        <FadeInSection index={1} className="section" role="region" ariaLabel="气泡样式">
          <SectionLabel accent={meta.accent}>样式</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(Object.keys(BUBBLE_KIND_LABEL) as BubbleStyleKind[]).map((kind) => {
              const selected = appStyle.kind === kind;
              // 每格迷你预览配置：展示「若应用此样式」的效果（样式对两侧同时生效）
              const previewCfg: BubbleStyleConfig = {
                ...bubbleStyle,
                [app]: { kind, mineColor: appStyle.mineColor, theirsColor: appStyle.theirsColor },
              };
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    patchAppStyle({ kind });
                    try {
                      navigator.vibrate?.(6);
                    } catch {
                      /* 震动不可用 */
                    }
                  }}
                  aria-pressed={selected}
                  className={`rounded-[22px] bg-white/60 p-2.5 text-left backdrop-blur-xl ring-1 transition-all active:scale-[0.97] dark:bg-white/[0.06] ${
                    selected
                      ? 'ring-[1.5px]'
                      : 'ring-black/[0.06] hover:ring-black/[0.12] dark:ring-white/[0.10] dark:hover:ring-white/[0.16]'
                  }`}
                  style={
                    selected
                      ? { ['--tw-ring-color' as string]: meta.accent, backgroundColor: withAlpha(meta.accent, 0.05) }
                      : undefined
                  }
                >
                  {/* 示意区：胶囊条 + 左右两颗泡（磨砂/液态需要底光斑才可见） */}
                  <div className="relative mb-2.5 flex h-[54px] items-center justify-between gap-1.5 overflow-hidden rounded-full bg-black/[0.04] px-3 dark:bg-white/[0.05]">
                    <AuraLayer />
                    <PreviewBubble app={app} cfg={previewCfg} side="theirs" index={0} className="!text-[11px]">
                      早呀
                    </PreviewBubble>
                    <PreviewBubble app={app} cfg={previewCfg} side="mine" index={1} className="!text-[11px]">
                      {kind === 'rainbow' ? '变啦' : '你好'}
                    </PreviewBubble>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold leading-tight">{BUBBLE_KIND_LABEL[kind]}</span>
                      <span className="mt-[2px] block truncate text-[11px] leading-tight text-black/40 dark:text-white/40">
                        {KIND_CAPTIONS[kind]}
                      </span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0" strokeWidth={2.6} style={{ color: meta.accent }} aria-hidden="true" />}
                  </div>
                </button>
              );
            })}
          </div>
        </FadeInSection>

        {/* ---------- 3. 颜色（分段胶囊 / 滑条 / 色板，同卡三分区） ---------- */}
        <FadeInSection index={2} className="section" role="region" ariaLabel="自定义颜色">
          <SectionLabel accent={meta.accent}>颜色</SectionLabel>
          <div
            className={`mt-3 space-y-4 ${GLASS_CARD} p-4 transition-opacity ${
              kindDisabled ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            {/* 分区一：编辑目标分段胶囊 + 恢复默认 */}
            <div className="flex items-center justify-between gap-2">
              <div className="relative flex rounded-full bg-black/[0.05] p-[3px] dark:bg-white/[0.08]">
                {(['both', 'mine', 'theirs'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSide(k)}
                    aria-pressed={side === k}
                    className={`relative z-10 rounded-full px-3.5 py-[5px] text-[12px] font-semibold transition-colors ${
                      side === k ? 'text-black/80 dark:text-white' : 'text-black/45 dark:text-white/50'
                    }`}
                  >
                    {side === k && (
                      <motion.span
                        layoutId="bubble-color-side-pill"
                        className="absolute inset-0 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] dark:bg-white/20 dark:ring-1 dark:ring-white/15"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative">{k === 'both' ? '一起' : k === 'mine' ? '我的' : 'TA的'}</span>
                  </button>
                ))}
              </div>
              {hasCustomColor && (
                <button
                  type="button"
                  aria-label="恢复默认色"
                  onClick={() =>
                    patchAppStyle(
                      side === 'both'
                        ? { mineColor: undefined, theirsColor: undefined }
                        : side === 'mine'
                          ? { mineColor: undefined }
                          : { theirsColor: undefined },
                    )
                  }
                  className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-medium text-black/45 transition-colors active:bg-black/[0.06] dark:text-white/50 dark:active:bg-white/10"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  默认
                </button>
              )}
            </div>

            {/* 分区二：当前色（纯色珠 + hex 文字列）+ HSL 三滑条（行内标签） */}
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="h-11 w-11 shrink-0 rounded-full ring-1 ring-black/[0.06] dark:ring-white/15"
                style={{
                  background: currentColor ?? fallbackHex,
                  boxShadow: `inset 0 1px 2px rgba(255,255,255,0.4), 0 2px 6px ${withAlpha(currentColor ?? fallbackHex, 0.3)}`,
                }}
              />
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-tight tabular-nums">
                  {(currentColor ?? fallbackHex).toUpperCase()}
                </p>
                <p className="mt-[2px] text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                  {hasCustomColor ? '自定义颜色' : 'App 默认色'}
                </p>
              </div>
            </div>
            <div className="space-y-2.5">
              {(
                [
                  {
                    label: '色相',
                    value: hsl.h,
                    max: 360,
                    thumbColor: hslToHex(hsl.h, Math.max(hsl.s, 70), 55),
                    track: 'linear-gradient(90deg, #FF0000, #FFFF00 17%, #00FF00 33%, #00FFFF 50%, #0000FF 67%, #FF00FF 83%, #FF0000)',
                    on: (h: number) => commitHsl(h, hsl.s, hsl.l),
                  },
                  {
                    label: '饱和',
                    value: hsl.s,
                    max: 100,
                    thumbColor: currentColor ?? fallbackHex,
                    track: `linear-gradient(90deg, ${hslToHex(hsl.h, 0, hsl.l)}, ${hslToHex(hsl.h, 100, hsl.l)})`,
                    on: (s: number) => commitHsl(hsl.h, s, hsl.l),
                  },
                  {
                    label: '明度',
                    value: hsl.l,
                    max: 100,
                    thumbColor: currentColor ?? fallbackHex,
                    track: `linear-gradient(90deg, #000000, ${hslToHex(hsl.h, hsl.s, 50)} 50%, #FFFFFF)`,
                    on: (l: number) => commitHsl(hsl.h, hsl.s, l),
                  },
                ] as const
              ).map((r) => (
                <div key={r.label} className="flex items-center gap-2.5">
                  <span className="w-[28px] shrink-0 text-right text-[11px] font-medium text-black/35 dark:text-white/40">
                    {r.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <HslSlider
                      label={r.label}
                      value={r.value}
                      max={r.max}
                      thumbColor={r.thumbColor}
                      trackBackground={r.track}
                      onChange={r.on}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* 分区三：预设色板（胶囊色点） */}
            <div className="grid grid-cols-12 gap-[7px]" role="group" aria-label="预设颜色">
              {PRESET_SWATCHES.map((c) => {
                const selected = (currentColor ?? '').toUpperCase() === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={`预设色 ${c}`}
                    aria-pressed={selected}
                    onClick={() => commitColor(c)}
                    className={`flex aspect-square items-center justify-center rounded-full transition-transform active:scale-90 ${
                      selected ? 'ring-2 ring-white/90 dark:ring-white/80' : 'ring-1 ring-black/10 dark:ring-white/15'
                    }`}
                    style={{ backgroundColor: c, ...(selected ? { boxShadow: `0 0 0 2px ${meta.accent}` } : {}) }}
                  >
                    {selected && (
                      <Check
                        className="h-3 w-3"
                        style={{ color: yiqTextOn(c) === '#000000' ? '#111111' : '#FFFFFF' }}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {kindDisabled && (
              <p className="text-[12px] text-black/40 dark:text-white/40">七彩气泡按消息顺序自动循环 9 色，无需选色</p>
            )}
          </div>
        </FadeInSection>

        {/* ---------- 4. 保存当前设置（accent 胶囊） ---------- */}
        <FadeInSection index={3}>
          <button
            type="button"
            onClick={() => {
              setNameDraft('');
              setNaming(true);
            }}
            className="w-full rounded-full py-3.5 text-[15.5px] font-semibold text-white transition-transform active:scale-[0.98]"
            style={{ backgroundColor: meta.accent, boxShadow: `0 4px 14px ${withAlpha(meta.accent, 0.2)}` }}
          >
            保存当前设置
          </button>
        </FadeInSection>

        {/* ---------- 5. 收藏夹（胶囊行） ---------- */}
        <FadeInSection index={4} className="section" role="region" ariaLabel="我的气泡收藏夹">
          <SectionLabel accent={meta.accent}>我的气泡</SectionLabel>
          {schemes.length === 0 ? (
            <div className={`mt-2.5 border border-dashed border-black/[0.14] ${GLASS_CARD} py-6 text-center dark:border-white/[0.14]`}>
              <Palette className="mx-auto mb-1.5 h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
              <p className="text-[13px] text-black/40 dark:text-white/40">还没有收藏的气泡方案</p>
            </div>
          ) : (
            <ul className="mt-2.5 space-y-2.5">
              {schemes.map((s) => {
                const active = s.id === activeSchemeId;
                const sMeta = PLATFORM_META[s.app];
                /** 缩略图预览配置：当前装扮 + 该方案覆盖其归属 App */
                const thumbCfg: BubbleStyleConfig = { ...bubbleStyle, [s.app]: s.style };
                return (
                  <li key={s.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`应用方案 ${s.name}`}
                      onClick={() => applyScheme(s)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          applyScheme(s);
                        }
                      }}
                      className={`flex cursor-pointer items-center gap-3 rounded-full bg-white/60 p-1.5 pr-2 backdrop-blur-xl ring-1 transition-all active:scale-[0.98] dark:bg-white/[0.06] ${
                        active
                          ? 'ring-[1.5px]'
                          : 'ring-black/[0.06] hover:ring-black/[0.12] dark:ring-white/[0.10] dark:hover:ring-white/[0.16]'
                      }`}
                      style={active ? { ['--tw-ring-color' as string]: sMeta.accent } : undefined}
                    >
                      {/* 缩略图：胶囊幕布 + 迷你双泡 */}
                      <div className="relative flex h-[44px] w-[80px] shrink-0 items-center justify-between gap-1 overflow-hidden rounded-full bg-black/[0.04] px-3 dark:bg-white/[0.05]">
                        <AuraLayer />
                        <PreviewBubble app={s.app} cfg={thumbCfg} side="theirs" index={0} className="!text-[10.5px] !px-1.5 !py-[3px]">
                          早
                        </PreviewBubble>
                        <PreviewBubble app={s.app} cfg={thumbCfg} side="mine" index={1} className="!text-[10.5px] !px-1.5 !py-[3px]">
                          呀
                        </PreviewBubble>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[14px] font-semibold leading-tight">{s.name}</p>
                          {active && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold text-white"
                              style={{ backgroundColor: sMeta.accent }}
                            >
                              使用中
                            </span>
                          )}
                        </div>
                        <p className="mt-[2px] truncate text-[11px] text-black/40 dark:text-white/40">
                          {BUBBLE_KIND_LABEL[s.style.kind]}
                          {s.style.mineColor ? ` · 我 ${s.style.mineColor}` : ''}
                          {s.style.theirsColor ? ` · TA ${s.style.theirsColor}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`应用 ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            applyScheme(s);
                          }}
                          className="flex items-center gap-0.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white transition-transform active:scale-95"
                          style={{ backgroundColor: sMeta.accent }}
                        >
                          应用
                          <ChevronRight className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除 ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeScheme(s);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-black/35 transition-colors active:bg-[#FF3B30]/12 active:text-[#FF3B30] dark:text-white/40 dark:active:text-[#FF6B6B]"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </FadeInSection>
      </div>

      {/* ---------- 命名弹窗（毛玻璃卡 + 胶囊控件） ---------- */}
      <AnimatePresence>
        {naming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-sm"
            onClick={() => setNaming(false)}
            role="dialog"
            aria-label="命名这套气泡"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="w-full max-w-[300px] rounded-[22px] bg-white/80 p-5 shadow-2xl ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#1F2126]/85 dark:ring-white/[0.12]"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-center text-[16px] font-bold">给这套气泡起个名字</p>
              {/* 迷你效果预览：胶囊幕布 */}
              <div className="relative mt-3.5 flex items-center justify-center gap-1.5 overflow-hidden rounded-full bg-black/[0.04] px-4 py-2.5 dark:bg-white/[0.05]">
                <AuraLayer />
                <PreviewBubble app={app} cfg={bubbleStyle} side="theirs" index={0}>
                  早安
                </PreviewBubble>
                <PreviewBubble app={app} cfg={bubbleStyle} side="mine" index={1}>
                  你也早安
                </PreviewBubble>
              </div>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveScheme();
                }}
                maxLength={16}
                placeholder="比如：我的天蓝专属"
                aria-label="方案名称"
                className="mt-3.5 w-full rounded-full bg-black/[0.05] px-4 py-2.5 text-center text-[15px] outline-none transition-shadow placeholder:text-black/30 focus:ring-2 dark:bg-white/[0.08] dark:placeholder:text-white/30"
                style={{ ['--tw-ring-color' as string]: meta.accent }}
              />
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setNaming(false)}
                  className="flex-1 rounded-full bg-black/[0.05] py-2.5 text-[15px] font-semibold text-black/60 transition-colors active:bg-black/10 dark:bg-white/[0.08] dark:text-white/70 dark:active:bg-white/15"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveScheme}
                  className="flex-1 rounded-full py-2.5 text-[15px] font-semibold text-white transition-transform active:scale-95"
                  style={{ backgroundColor: meta.accent }}
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </IOSScreen>
  );
}

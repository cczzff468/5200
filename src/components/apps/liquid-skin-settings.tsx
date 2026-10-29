'use client';

/**
 * 液态玻璃主题 · 皮肤设置页（本轮新增）
 * ---------------------------------------------------------------------------
 * 入口：主题页（ThemeStylePage）›「液态玻璃设置」行——仅在当前 App 启用液态玻璃主题时显示。
 *
 * 内容：
 *  1. 聊天顶栏名字区：四种模式（纯文字 / 头像+名字 / 双头像+中间文字 / 双头像+名字），
 *     每格带迷你预览；双头像模式可自定义中间文字（空 = 只有两个头像）；
 *     头像+名字模式可关闭名字（只剩头像）。
 *  2. （仅微信）分类标签自定义文字：全部/好友/工作/群聊/服务号 五个输入框（空 = 默认文字）。
 *  3. （仅微信）会话列表小组件：网易云音乐 / 日历 / 自定义 CSS 内容（HTML+<style>，带示例）。
 *
 * 修改即时写入 useSettings.setLiquidSkin（App 隔离）并持久化，聊天页/列表实时跟随。
 */
import { motion } from 'framer-motion';
import { CalendarDays, Check, ChevronRight, Music2, Paintbrush, RotateCcw } from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { Switch } from '@/components/ui/switch';
import { useSettings } from '@/lib/ios/store';
import {
  LIQUID_CUSTOM_WIDGET_EXAMPLE,
  LIQUID_HEADER_MODE_DESC,
  LIQUID_HEADER_MODE_LABEL,
  LIQUID_TABS,
  liquidTabLabel,
  type LiquidHeaderMode,
  type LiquidSkinSettings,
  type LiquidTabKey,
} from '@/lib/ios/liquid-skin';
import type { BubbleAppId } from '@/lib/ios/bubble-style';

const PLATFORM_META: Record<BubbleAppId, { name: string; accent: string }> = {
  wx: { name: '微信', accent: '#07C160' },
  qq: { name: 'QQ', accent: '#0099FF' },
  sms: { name: '信息', accent: '#007AFF' },
};

/** 弱文字小标题（与气泡装扮页同语言） */
function SectionLabel({ accent, children }: { accent?: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-2 text-[12.5px] font-semibold tracking-wide text-black/40 dark:text-white/40">
      {accent && (
        <span
          aria-hidden="true"
          className="h-[5px] w-[5px] rounded-full"
          style={{ backgroundColor: accent, boxShadow: `0 0 0 2.5px rgba(0,0,0,0.05)` }}
        />
      )}
      {children}
    </p>
  );
}

/** 区块入场动画 */
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

// ---------------- 迷你头像（设置页预览用，不读真实头像：纯色渐变示意） ----------------

/** TA 的头像（粉紫渐变 · 示意） */
function MiniAvatarPeer({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg,#F0A0B8,#C86DD7)',
        boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.6)',
      }}
    />
  );
}

/** 我的头像（App accent 渐变 · 示意） */
function MiniAvatarMine({ size = 24, accent }: { size?: number; accent: string }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg,${accent},#AF52DE00)`,
        backgroundColor: accent,
        boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.6)',
      }}
    />
  );
}

// ---------------- 顶栏模式迷你预览（一节小顶栏：左返回示意 + 中央名字区） ----------------

function HeaderModePreview({
  mode,
  middle,
  showName,
  accent,
}: {
  mode: LiquidHeaderMode;
  middle: string;
  showName: boolean;
  accent: string;
}) {
  const name = '安吉丽娜';
  const mid = middle || '';
  return (
    <div className="relative flex h-[42px] items-center justify-center overflow-hidden rounded-[14px] bg-[#F1F2F6] dark:bg-[#1B1D22]">
      {/* 返回示意小圆 */}
      <span className="absolute left-2 top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full bg-white/80 shadow-sm dark:bg-white/15" />
      {/* 名字区（按模式） */}
      {mode === 'text' && (
        <span className="rounded-full bg-white/90 px-3 py-[5px] text-[10.5px] font-semibold text-black/85 shadow-sm dark:bg-white/15 dark:text-white/90">
          {name}
        </span>
      )}
      {mode === 'avatarName' && (
        <span className="flex items-center gap-1.5 rounded-full bg-white/90 py-[4px] pl-[5px] pr-3 shadow-sm dark:bg-white/15">
          <MiniAvatarPeer size={20} />
          {showName && <span className="text-[10.5px] font-semibold text-black/85 dark:text-white/90">{name}</span>}
        </span>
      )}
      {(mode === 'dual' || mode === 'dualName') && (
        <span className="flex items-center gap-1.5 rounded-full bg-white/90 py-[4px] pl-[5px] pr-[7px] shadow-sm dark:bg-white/15">
          <MiniAvatarPeer size={22} />
          {mid && <span className="text-[10px] font-semibold text-black/75 dark:text-white/85">{mid}</span>}
          <MiniAvatarMine size={22} accent={accent} />
          {mode === 'dualName' && <span className="ml-0.5 text-[10.5px] font-semibold text-black/85 dark:text-white/90">{name}</span>}
        </span>
      )}
      {/* 右侧菜单示意小圆 */}
      <span className="absolute right-2 top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full bg-white/80 shadow-sm dark:bg-white/15" />
    </div>
  );
}

// ================= 主页面 =================

export interface LiquidSkinPageProps {
  app: BubbleAppId;
  onBack: () => void;
  onToast: (m: string) => void;
}

export function LiquidSkinPage({ app, onBack, onToast }: LiquidSkinPageProps) {
  const meta = PLATFORM_META[app];
  const liquidSkin = useSettings((s) => s.liquidSkin);
  const setLiquidSkin = useSettings((s) => s.setLiquidSkin);

  const skin: LiquidSkinSettings = liquidSkin[app];

  const patch = (p: Partial<LiquidSkinSettings>) => setLiquidSkin(app, p);

  const patchTab = (key: LiquidTabKey, v: string) => {
    patch({ tabLabels: { ...skin.tabLabels, [key]: v } });
  };

  const modes = Object.keys(LIQUID_HEADER_MODE_LABEL) as LiquidHeaderMode[];
  const isWx = app === 'wx';

  return (
    <IOSScreen className="bg-[#F4F5F7] dark:bg-[#0E1014]">
      <IOSNavBar
        title="液态玻璃设置"
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        className="bg-[#F4F5F7]/75! dark:bg-[#0E1014]/75!"
      />

      <div className="no-scrollbar relative flex-1 space-y-8 overflow-y-auto px-4 pb-12">
        {/* ---------- 1. 聊天顶栏名字区 ---------- */}
        <FadeInSection index={0} className="section" role="region" ariaLabel="聊天顶栏">
          <SectionLabel accent={meta.accent}>聊天顶栏名字</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {modes.map((mode) => {
              const selected = skin.headerMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  data-testid={`liquid-header-${mode}`}
                  aria-pressed={selected}
                  onClick={() => {
                    patch({ headerMode: mode });
                    navigator.vibrate?.(6);
                  }}
                  className={`rounded-[18px] bg-white/60 p-2 text-left backdrop-blur-xl ring-1 transition-all active:scale-[0.97] dark:bg-white/[0.06] ${
                    selected
                      ? 'ring-[1.5px]'
                      : 'ring-black/[0.06] hover:ring-black/[0.12] dark:ring-white/[0.10] dark:hover:ring-white/[0.16]'
                  }`}
                  style={selected ? { ['--tw-ring-color' as string]: meta.accent } : undefined}
                >
                  <HeaderModePreview
                    mode={mode}
                    middle={skin.headerMiddleText}
                    showName={skin.headerShowName}
                    accent={meta.accent}
                  />
                  <div className="mt-2 flex items-center gap-1 px-1 pb-0.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-tight text-black/85 dark:text-white/90">
                        {LIQUID_HEADER_MODE_LABEL[mode]}
                      </span>
                      <span className="mt-[2px] block truncate text-[10.5px] leading-tight text-black/40 dark:text-white/40">
                        {LIQUID_HEADER_MODE_DESC[mode]}
                      </span>
                    </span>
                    {selected && (
                      <span
                        className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: meta.accent }}
                      >
                        <Check className="h-[10px] w-[10px]" strokeWidth={3.4} />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 双头像模式：中间自定义文字 */}
          {(skin.headerMode === 'dual' || skin.headerMode === 'dualName') && (
            <div className="mt-3 rounded-[16px] bg-white px-4 py-3 ring-1 ring-black/[0.05] dark:bg-[#1C1E23] dark:ring-white/[0.08]">
              <label className="block text-[13px] font-medium text-black/75 dark:text-white/80" htmlFor="liquid-middle-text">
                头像中间的文字
              </label>
              <input
                id="liquid-middle-text"
                data-testid="liquid-middle-text"
                value={skin.headerMiddleText}
                onChange={(e) => patch({ headerMiddleText: e.target.value.slice(0, 24) })}
                placeholder="如 >_< ≦（留空只显示两个头像）"
                className="mt-2 h-9 w-full rounded-[10px] bg-black/[0.04] px-3 text-[14px] text-black/85 outline-none placeholder:text-black/25 focus:ring-2 focus:ring-black/[0.08] dark:bg-white/[0.08] dark:text-white/90 dark:placeholder:text-white/25 dark:focus:ring-white/[0.12]"
              />
            </div>
          )}

          {/* 头像+名字模式：显示名字开关 */}
          {skin.headerMode === 'avatarName' && (
            <div className="mt-3 flex items-center gap-3 rounded-[16px] bg-white px-4 py-3 ring-1 ring-black/[0.05] dark:bg-[#1C1E23] dark:ring-white/[0.08]">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-tight text-black/85 dark:text-white/90">显示名字</span>
                <span className="mt-[2px] block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                  关闭后顶栏只显示 TA 的头像
                </span>
              </span>
              <Switch
                data-testid="liquid-show-name"
                checked={skin.headerShowName}
                onCheckedChange={(v) => patch({ headerShowName: v })}
              />
            </div>
          )}
          <p className="mt-2 px-2 text-[11px] leading-relaxed text-black/35 dark:text-white/35">
            只在液态玻璃主题的聊天页生效；群聊保持显示群名。
          </p>
        </FadeInSection>

        {/* ---------- 2. 分类标签自定义文字（仅微信） ---------- */}
        {isWx && (
          <FadeInSection index={1} className="section" role="region" ariaLabel="分类标签">
            <SectionLabel accent={meta.accent}>分类标签文字</SectionLabel>
            <div className="mt-3 overflow-hidden rounded-[16px] bg-white ring-1 ring-black/[0.05] dark:bg-[#1C1E23] dark:ring-white/[0.08]">
              {LIQUID_TABS.map((t, i) => (
                <div
                  key={t.key}
                  className={`flex items-center gap-3 px-4 py-2.5 ${
                    i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
                  }`}
                >
                  <span className="w-[52px] shrink-0 text-[13.5px] text-black/45 dark:text-white/45">{t.fallback}</span>
                  <input
                    data-testid={`liquid-tab-${t.key}`}
                    value={skin.tabLabels[t.key] ?? ''}
                    onChange={(e) => patchTab(t.key, e.target.value.slice(0, 12))}
                    placeholder={`默认「${t.fallback}」`}
                    className="h-9 min-w-0 flex-1 rounded-[10px] bg-black/[0.04] px-3 text-[14px] text-black/85 outline-none placeholder:text-black/25 focus:ring-2 focus:ring-black/[0.08] dark:bg-white/[0.08] dark:text-white/90 dark:placeholder:text-white/25 dark:focus:ring-white/[0.12]"
                  />
                  {(skin.tabLabels[t.key] ?? '').length > 0 && (
                    <button
                      type="button"
                      aria-label={`恢复${t.fallback}默认文字`}
                      onClick={() => patchTab(t.key, '')}
                      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-black/20 text-white active:bg-black/35 dark:bg-white/25"
                    >
                      <RotateCcw className="h-[10px] w-[10px]" strokeWidth={2.6} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 px-2 text-[11px] leading-relaxed text-black/35 dark:text-white/35">
              会话列表顶部的分类标签改成你写的字；留空恢复默认。
            </p>
          </FadeInSection>
        )}

        {/* ---------- 3. 会话列表小组件（仅微信） ---------- */}
        {isWx && (
          <FadeInSection index={2} className="section" role="region" ariaLabel="小组件">
            <SectionLabel accent={meta.accent}>列表小组件</SectionLabel>
            <div className="mt-3 overflow-hidden rounded-[16px] bg-white ring-1 ring-black/[0.05] dark:bg-[#1C1E23] dark:ring-white/[0.08]">
              {/* 网易云音乐 */}
              <div className="flex items-center gap-3 px-4 py-3" data-testid="liquid-widget-row-music">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: 'rgba(7,193,96,0.12)' }}>
                  <Music2 className="h-[17px] w-[17px]" style={{ color: '#07C160' }} strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-tight text-black/85 dark:text-white/90">网易云音乐</span>
                  <span className="mt-[2px] block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                    搜索框下的迷你播放器卡片
                  </span>
                </span>
                <Switch
                  data-testid="liquid-widget-music"
                  checked={skin.widgetMusic}
                  onCheckedChange={(v) => patch({ widgetMusic: v })}
                />
              </div>
              {/* 日历 */}
              <div className="flex items-center gap-3 border-t border-black/[0.05] px-4 py-3 dark:border-white/[0.07]" data-testid="liquid-widget-row-calendar">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: 'rgba(255,69,58,0.10)' }}>
                  <CalendarDays className="h-[17px] w-[17px]" style={{ color: '#FF453A' }} strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-tight text-black/85 dark:text-white/90">日历</span>
                  <span className="mt-[2px] block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                    今天几号一眼看到
                  </span>
                </span>
                <Switch
                  data-testid="liquid-widget-calendar"
                  checked={skin.widgetCalendar}
                  onCheckedChange={(v) => patch({ widgetCalendar: v })}
                />
              </div>
              {/* 自定义 CSS 内容 */}
              <div className="flex items-center gap-3 border-t border-black/[0.05] px-4 py-3 dark:border-white/[0.07]" data-testid="liquid-widget-row-custom">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: 'rgba(175,82,222,0.10)' }}>
                  <Paintbrush className="h-[17px] w-[17px]" style={{ color: '#AF52DE' }} strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-tight text-black/85 dark:text-white/90">自定义 CSS 小组件</span>
                  <span className="mt-[2px] block text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                    用 HTML + CSS 画自己的卡片
                  </span>
                </span>
                <Switch
                  data-testid="liquid-widget-custom"
                  checked={skin.widgetCustom}
                  onCheckedChange={(v) => patch({ widgetCustom: v })}
                />
              </div>
              {/* 自定义内容编辑（开关打开才显示） */}
              {skin.widgetCustom && (
                <div className="border-t border-black/[0.05] px-4 py-3 dark:border-white/[0.07]">
                  <div className="flex items-center gap-2">
                    <label className="min-w-0 flex-1 text-[13px] font-medium text-black/75 dark:text-white/80" htmlFor="liquid-custom-html">
                      小组件内容（支持 &lt;style&gt;）
                    </label>
                    <button
                      type="button"
                      data-testid="liquid-custom-example"
                      onClick={() => {
                        patch({ customHtml: LIQUID_CUSTOM_WIDGET_EXAMPLE });
                        onToast('已插入示例，可在列表里看到效果');
                      }}
                      className="shrink-0 rounded-full px-3 py-1 text-[12px] font-medium active:opacity-60"
                      style={{ color: meta.accent, backgroundColor: `rgba(7,193,96,0.10)` }}
                    >
                      插入示例
                    </button>
                    {skin.customHtml && (
                      <button
                        type="button"
                        aria-label="清空自定义内容"
                        onClick={() => patch({ customHtml: '' })}
                        className="shrink-0 rounded-full px-3 py-1 text-[12px] font-medium text-black/45 active:opacity-60 dark:text-white/45"
                      >
                        清空
                      </button>
                    )}
                  </div>
                  <textarea
                    id="liquid-custom-html"
                    data-testid="liquid-custom-html"
                    value={skin.customHtml}
                    onChange={(e) => {
                      patch({ customHtml: e.target.value.slice(0, 20000) });
                    }}
                    rows={6}
                    placeholder={'<style>…</style>\n<div class="my-card">你好呀</div>'}
                    className="mt-2 w-full resize-y rounded-[12px] bg-black/[0.04] p-3 font-mono text-[12px] leading-relaxed text-black/85 outline-none placeholder:text-black/25 focus:ring-2 focus:ring-black/[0.08] dark:bg-white/[0.08] dark:text-white/90 dark:placeholder:text-white/25 dark:focus:ring-white/[0.12]"
                  />
                  <p className="mt-2 text-[11px] leading-relaxed text-black/35 dark:text-white/35">
                    直接写 HTML；颜色、动画写进 &lt;style&gt; 里即可。内容保存在本机。
                  </p>
                </div>
              )}
            </div>
            <p className="mt-2 px-2 text-[11px] leading-relaxed text-black/35 dark:text-white/35">
              小组件出现在液态玻璃主题会话列表搜索框下面，全部可单独开关。
            </p>
          </FadeInSection>
        )}

        {/* ---------- 4. 跳回主题页提示行（辅助导航） ---------- */}
        <FadeInSection index={3} className="section">
          <button
            type="button"
            data-testid="liquid-skin-back-themes"
            onClick={onBack}
            className="flex w-full items-center gap-3 rounded-[16px] bg-white px-4 py-[13px] text-left ring-1 ring-black/[0.05] transition-transform active:scale-[0.99] dark:bg-[#1C1E23] dark:ring-white/[0.08]"
          >
            <span className="min-w-0 flex-1 text-[15px] font-medium text-black/85 dark:text-white/90">返回主题页</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </FadeInSection>
      </div>
    </IOSScreen>
  );
}

/** 分类标签生效文字（会话列表渲染用；从 store 读） */
export function useWxTabLabels(): (key: LiquidTabKey) => string {
  const skin = useSettings((s) => s.liquidSkin.wx);
  return (key: LiquidTabKey) => liquidTabLabel(skin, key);
}

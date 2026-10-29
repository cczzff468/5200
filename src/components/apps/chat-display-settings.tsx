'use client';

/**
 * 聊天显示设置页（微信 / QQ 共用，配置按 App 隔离）
 * ---------------------------------------------------------------------------
 * 入口：微信「我」页 › 主题下方「显示」；QQ 设置 › 聊天显示。
 *
 * 三个维度（本轮用户指定）：
 *  1. 头像样式：圆形头像 / 圆角头像（两卡选择，所见即所得小预览）；
 *  2. 已读未读：开关 + 位置（头像下面 / 气泡下面）；
 *     双向回执——我发的消息，AI 回复落地时转已读；AI 发的消息，我发消息时转已读。
 *  3. 时间显示：开关 + 格式（HH:mm / HH:mm:ss）+ 位置（头像下面 / 气泡下面）。
 *  位置为「气泡下面」时元信息靠气泡末尾（远离头像的一侧）；
 *  已读与时间同显时垂直堆叠（已读在上、时间在下）。
 *
 * 顶部整块实时预览：迷你对话（TA 两条 + 我两条）按当前全部配置渲染，
 * 改任何一项立即反映——头像形状、每条气泡旁的已读/时间、位置与堆叠关系一目了然。
 * 视觉延续主题页的简约路线：玻璃大卡 + 胶囊分段选择器 + accent 细描边选中态。
 */
import { motion } from 'framer-motion';
import { Check, Eye, MessageCircle, Clock, RotateCcw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { useSettings } from '@/lib/ios/store';
import {
  DEFAULT_CHAT_DISPLAY,
  READ_ACCENT,
  fmtMsgTime,
  type AvatarShape,
  type ChatDisplayAppId,
  type ChatDisplayConfig,
  type MetaPosition,
  type TimeFormat,
} from '@/lib/ios/chat-display';

const PLATFORM_NAME: Record<ChatDisplayAppId, string> = { wx: '微信', qq: 'QQ' };
/** App 原生气泡配色（预览用；我的 = 品牌色，TA 的 = 白） */
const NATIVE_MINE: Record<ChatDisplayAppId, string> = { wx: '#95EC69', qq: '#0099FF' };

/** 区块小标题（与主题页同款：accent 色点 + 弱文字） */
function SectionLabel({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-2 text-[12.5px] font-semibold tracking-wide text-black/40 dark:text-white/40">
      <span
        aria-hidden="true"
        className="h-[5px] w-[5px] rounded-full"
        style={{ backgroundColor: accent, boxShadow: `0 0 0 2.5px ${accent}2E` }}
      />
      {children}
    </p>
  );
}

/** 区块入场动画（轻微淡入上浮，与主题页同节奏） */
function FadeInSection({ index, className, children }: { index: number; className?: string; children: React.ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index, duration: 0.32 }}
    >
      {children}
    </motion.div>
  );
}

/** 胶囊分段选择器（iOS segmented 同款：浅底容器 + 白色活动块 + 细阴影） */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      data-testid={testId}
      className="flex gap-[3px] rounded-full bg-black/[0.05] p-[3px] dark:bg-white/[0.07]"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={testId ? `${testId}-${o.value}` : undefined}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-full px-3 py-[7px] text-[13px] font-medium leading-none transition-all ${
              active
                ? 'bg-white text-black shadow-[0_1px_4px_rgba(0,0,0,0.12)] dark:bg-white/[0.16] dark:text-white'
                : 'text-black/45 active:scale-[0.97] dark:text-white/45'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 设置卡内的一行：左侧图标 + 标题/副标题，右侧控件（开关或分段器） */
function SettingRow({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.08]"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-tight">{title}</p>
        {hint && <p className="mt-[3px] text-[11.5px] leading-snug text-black/40 dark:text-white/40">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// ================= 实时预览（迷你对话，跟随全部配置） =================

/** 预览头像小方块：跟随头像形状设置（有图形态简化为色块 + 首字） */
function PreviewAvatar({ app, cfg, side, size = 30 }: { app: ChatDisplayAppId; cfg: ChatDisplayConfig; side: 'mine' | 'theirs'; size?: number }) {
  const radius = cfg.avatarShape === 'circle' ? size / 2 : Math.max(3, Math.round(size * 0.11));
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 select-none items-center justify-center text-[11px] font-semibold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: side === 'mine' ? NATIVE_MINE[app] : 'linear-gradient(135deg,#F0A0B8,#C86DD7)',
      }}
    >
      {side === 'mine' ? '我' : 'TA'}
    </span>
  );
}

/** 预览单行消息：头像（+头像下元信息）+ 气泡列（气泡 + 气泡下元信息） */
function PreviewRow({
  app,
  cfg,
  side,
  text,
  read,
  time,
}: {
  app: ChatDisplayAppId;
  cfg: ChatDisplayConfig;
  side: 'mine' | 'theirs';
  text: string;
  read: boolean;
  time: string;
}) {
  const accent = READ_ACCENT[app];
  const showRead = cfg.readEnabled;
  const showTime = cfg.timeEnabled;
  /** 头像下元信息（已读/时间按各自开关与位置渲染；同显时已读在上、时间在下） */
  const avatarMeta =
    showRead || showTime ? (
      <span className="mt-[3px] flex flex-col items-center gap-[1px] leading-none">
        {showRead && cfg.readPosition === 'avatar' && (
          <span className="whitespace-nowrap text-[8.5px] leading-[1.3]" style={{ color: read ? undefined : accent }}>
            <span className={read ? 'text-black/40 dark:text-white/40' : ''}>{read ? '已读' : '未读'}</span>
          </span>
        )}
        {showTime && cfg.timePosition === 'avatar' && (
          <span className="whitespace-nowrap text-[8.5px] leading-[1.3] text-black/40 dark:text-white/40">{time}</span>
        )}
      </span>
    ) : null;

  /** 气泡下元信息：靠气泡末尾（远离头像的一侧——我的=左，TA的=右） */
  const bubbleMeta =
    showRead || showTime ? (
      <span
        className={`mt-[3px] flex flex-col gap-[1px] leading-none ${
          side === 'mine' ? 'self-start items-start' : 'self-end items-end'
        }`}
      >
        {showRead && cfg.readPosition === 'bubble' && (
          <span className="whitespace-nowrap text-[9.5px] leading-[1.3]" style={{ color: read ? undefined : accent }}>
            <span className={read ? 'text-black/40 dark:text-white/40' : ''}>{read ? '已读' : '未读'}</span>
          </span>
        )}
        {showTime && cfg.timePosition === 'bubble' && (
          <span className="whitespace-nowrap text-[9.5px] leading-[1.3] text-black/40 dark:text-white/40">{time}</span>
        )}
      </span>
    ) : null;

  return (
    <div className={`flex items-start gap-2 ${side === 'mine' ? 'flex-row-reverse' : ''}`}>
      <div className="flex w-[30px] shrink-0 flex-col items-center">
        <PreviewAvatar app={cfg && app} cfg={cfg} side={side} />
        {avatarMeta}
      </div>
      <div className={`flex min-w-0 flex-col ${side === 'mine' ? 'items-end' : 'items-start'}`}>
        <span
          className={`max-w-full whitespace-pre-wrap break-words px-2.5 py-[7px] text-[12.5px] leading-[1.45] ${
            side === 'mine' ? 'rounded-[5px] text-black' : 'rounded-[5px] bg-white text-black dark:bg-[#2A2C31] dark:text-white'
          }`}
          style={side === 'mine' ? { backgroundColor: NATIVE_MINE[app] } : undefined}
        >
          {text}
        </span>
        {bubbleMeta}
      </div>
    </div>
  );
}

/** 整块预览：TA 一条（未读）→ 我一条（已读）→ 我一条（未读，等回复）→ TA 一条（已读） */
function DisplayPreview({ app, cfg }: { app: ChatDisplayAppId; cfg: ChatDisplayConfig }) {
  const t1 = fmtMsgTime(Date.now() - 92_000, cfg.timeFormat);
  const t2 = fmtMsgTime(Date.now() - 60_000, cfg.timeFormat);
  return (
    <div className="relative overflow-hidden rounded-[18px] bg-[#F2F3F7] px-3.5 py-4 dark:bg-[#17181C]">
      <div className="flex flex-col gap-[14px]">
        <PreviewRow app={app} cfg={cfg} side="theirs" text="在忙什么呀？" read={false} time={t1} />
        <PreviewRow app={app} cfg={cfg} side="mine" text="刚下课，正回宿舍" read time={t1} />
        <PreviewRow app={app} cfg={cfg} side="mine" text="你吃晚饭了吗" read={false} time={t2} />
        <PreviewRow app={app} cfg={cfg} side="theirs" text="吃啦，等你回来" read time={t2} />
      </div>
      {/* 开关全关时的空态说明（预览仍展示气泡与头像形状） */}
      {!cfg.readEnabled && !cfg.timeEnabled && (
        <p className="mt-3 text-center text-[10.5px] text-black/30 dark:text-white/30">
          已读未读与时间显示均未开启
        </p>
      )}
    </div>
  );
}

// ================= 头像样式选择卡 =================

/** 头像形状选项卡：形状示意 + 名称，选中 = accent 细描边 + 右上圆勾（与主题页同语言） */
function AvatarShapeCard({
  shape,
  selected,
  accent,
  onClick,
}: {
  shape: AvatarShape;
  selected: boolean;
  accent: string;
  onClick: () => void;
}) {
  const radius = shape === 'circle' ? 20 : 5;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`avatar-shape-${shape}`}
      onClick={onClick}
      className={`relative flex flex-col items-center gap-2.5 rounded-[18px] bg-white/60 p-4 backdrop-blur-xl transition-transform active:scale-[0.97] dark:bg-white/[0.06] ${
        selected ? 'ring-[1.5px]' : 'ring-1 ring-black/[0.06] dark:ring-white/[0.12]'
      }`}
      style={selected ? { ['--tw-ring-color' as string]: accent } : undefined}
    >
      {selected && (
        <span
          className="absolute right-[9px] top-[9px] z-10 flex h-[17px] w-[17px] items-center justify-center rounded-full text-white shadow-sm"
          style={{ backgroundColor: accent }}
        >
          <Check className="h-[10px] w-[10px]" strokeWidth={3.4} />
        </span>
      )}
      {/* 形状示意：示例头像块（渐变底 + 人形剪影） */}
      <span
        aria-hidden="true"
        className="flex h-[44px] w-[44px] items-center justify-center bg-gradient-to-br from-[#8FD99F] to-[#3FA9F5] text-white"
        style={{ borderRadius: radius }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-[24px] w-[24px]">
          <circle cx="12" cy="8.2" r="4.3" />
          <path d="M12 14.1c-4.7 0-8.1 2.7-8.1 6.3 0 .9.7 1.6 1.6 1.6h13c.9 0 1.6-.7 1.6-1.6 0-3.6-3.4-6.3-8.1-6.3z" />
        </svg>
      </span>
      <span className="text-[13px] font-semibold leading-none text-black/75 dark:text-white/80">
        {shape === 'circle' ? '圆形头像' : '圆角头像'}
      </span>
      <span className="text-[10.5px] leading-none text-black/35 dark:text-white/35">
        {shape === 'circle' ? 'QQ 经典' : '微信经典'}
      </span>
    </button>
  );
}

// ================= 显示设置页 =================

export interface ChatDisplayPageProps {
  /** 宿主 App（配置完全隔离：本页所有修改只写入 chatDisplay[app]） */
  app: ChatDisplayAppId;
  /** 返回上一级 */
  onBack: () => void;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
}

export function ChatDisplayPage({ app, onBack, onToast }: ChatDisplayPageProps) {
  const accent = READ_ACCENT[app];
  const cfg = useSettings((s) => s.chatDisplay[app]);
  const setChatDisplay = useSettings((s) => s.setChatDisplay);

  const patch = (p: Partial<ChatDisplayConfig>) => setChatDisplay(app, p);

  const POSITION_OPTIONS: { value: MetaPosition; label: string }[] = [
    { value: 'avatar', label: '头像下面' },
    { value: 'bubble', label: '气泡下面' },
  ];

  return (
    <IOSScreen className="bg-[#F4F5F7] dark:bg-[#0E1014]">
      <IOSNavBar
        title="显示"
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        className="bg-[#F4F5F7]/75! dark:bg-[#0E1014]/75!"
      />

      <div className="no-scrollbar relative flex-1 space-y-7 overflow-y-auto px-4 pb-12">
        {/* ---------- 实时预览 ---------- */}
        <FadeInSection index={0} className="section" role="region" aria-label="效果预览">
          <SectionLabel accent={accent}>效果预览 · {PLATFORM_NAME[app]}</SectionLabel>
          <div className="mt-3 rounded-[22px] bg-white/60 p-2.5 backdrop-blur-xl ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.12]">
            <DisplayPreview app={app} cfg={cfg} />
          </div>
          <p className="mt-2 px-2 text-[11px] leading-relaxed text-black/35 dark:text-white/35">
            左右滑动下方设置，预览实时刷新；「气泡下面」= 气泡末尾（远离头像一侧）
          </p>
        </FadeInSection>

        {/* ---------- 1. 头像样式 ---------- */}
        <FadeInSection index={1} className="section" role="region" aria-label="头像样式">
          <SectionLabel accent={accent}>头像样式</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(['rounded', 'circle'] as AvatarShape[]).map((shape) => (
              <AvatarShapeCard
                key={shape}
                shape={shape}
                selected={cfg.avatarShape === shape}
                accent={accent}
                onClick={() => {
                  if (cfg.avatarShape !== shape) {
                    patch({ avatarShape: shape });
                    onToast(shape === 'circle' ? '已切换为圆形头像' : '已切换为圆角头像');
                  }
                }}
              />
            ))}
          </div>
        </FadeInSection>

        {/* ---------- 2. 已读未读 ---------- */}
        <FadeInSection index={2} className="section" role="region" aria-label="已读未读">
          <SectionLabel accent={accent}>已读未读</SectionLabel>
          <div className="mt-3 overflow-hidden rounded-[22px] bg-white/60 backdrop-blur-xl ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.12]">
            <SettingRow
              icon={<Eye className="h-[17px] w-[17px] text-black/50 dark:text-white/50" strokeWidth={2.1} />}
              title="显示已读未读"
              hint="我发的消息：对方回复后转已读；对方发的：我发消息后转已读"
            >
              <Switch
                checked={cfg.readEnabled}
                onCheckedChange={(v) => patch({ readEnabled: v })}
                aria-label="显示已读未读"
                data-testid="read-toggle"
              />
            </SettingRow>
            {cfg.readEnabled && (
              <div className="border-t border-black/[0.05] px-4 pb-3.5 pt-3 dark:border-white/[0.07]">
                <p className="mb-2 text-[11.5px] text-black/40 dark:text-white/40">显示位置</p>
                <Segmented
                  testId="read-position"
                  value={cfg.readPosition}
                  options={POSITION_OPTIONS}
                  onChange={(v) => patch({ readPosition: v })}
                />
              </div>
            )}
          </div>
        </FadeInSection>

        {/* ---------- 3. 时间显示 ---------- */}
        <FadeInSection index={3} className="section" role="region" aria-label="时间显示">
          <SectionLabel accent={accent}>时间显示</SectionLabel>
          <div className="mt-3 overflow-hidden rounded-[22px] bg-white/60 backdrop-blur-xl ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.12]">
            <SettingRow
              icon={<Clock className="h-[17px] w-[17px] text-black/50 dark:text-white/50" strokeWidth={2.1} />}
              title="显示消息时间"
              hint="开启后每条消息单独显示时间（替代默认的间隔时间条）"
            >
              <Switch
                checked={cfg.timeEnabled}
                onCheckedChange={(v) => patch({ timeEnabled: v })}
                aria-label="显示消息时间"
                data-testid="time-toggle"
              />
            </SettingRow>
            {cfg.timeEnabled && (
              <div className="space-y-3 border-t border-black/[0.05] px-4 pb-3.5 pt-3 dark:border-white/[0.07]">
                <div>
                  <p className="mb-2 text-[11.5px] text-black/40 dark:text-white/40">时间格式</p>
                  <Segmented
                    testId="time-format"
                    value={cfg.timeFormat}
                    options={[
                      { value: 'hhmm' as TimeFormat, label: 'HH:mm' },
                      { value: 'hhmmss' as TimeFormat, label: 'HH:mm:ss' },
                    ]}
                    onChange={(v) => patch({ timeFormat: v })}
                  />
                </div>
                <div>
                  <p className="mb-2 text-[11.5px] text-black/40 dark:text-white/40">显示位置</p>
                  <Segmented
                    testId="time-position"
                    value={cfg.timePosition}
                    options={POSITION_OPTIONS}
                    onChange={(v) => patch({ timePosition: v })}
                  />
                </div>
              </div>
            )}
          </div>
        </FadeInSection>

        {/* ---------- 恢复默认 ---------- */}
        <FadeInSection index={4} className="section" role="region" aria-label="恢复默认">
          <button
            type="button"
            data-testid="chat-display-reset"
            onClick={() => {
              setChatDisplay(app, DEFAULT_CHAT_DISPLAY[app]);
              onToast('显示设置已恢复默认');
            }}
            className="flex w-full items-center justify-center gap-2 rounded-[22px] bg-white/60 py-3.5 text-[14px] font-medium text-black/55 backdrop-blur-xl ring-1 ring-black/[0.06] transition-transform active:scale-[0.98] dark:bg-white/[0.06] dark:text-white/55 dark:ring-white/[0.12]"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2.1} />
            恢复默认
          </button>
          <p className="mt-2 flex items-center justify-center gap-1 px-2 text-center text-[11px] leading-relaxed text-black/30 dark:text-white/30">
            <MessageCircle className="h-3 w-3" aria-hidden="true" />
            仅影响{PLATFORM_NAME[app]}聊天页；{app === 'wx' ? 'QQ' : '微信'}的显示设置独立保存
          </p>
        </FadeInSection>
      </div>
    </IOSScreen>
  );
}

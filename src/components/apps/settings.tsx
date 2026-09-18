'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  Bell,
  Bluetooth,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Info,
  Loader2,
  Lock,
  Monitor,
  Moon,
  Plane,
  Plus,
  Sun,
  Upload,
  User,
  Wifi,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import PasscodePad from '@/components/ios/PasscodePad';
import { useUI } from '@/lib/ios/store';
import { genId, localDB } from '@/lib/ios/db';
import {
  DEFAULT_API_CONFIG,
  WALLPAPER_PRESETS,
  useSettings,
  type ApiPreset,
  type ThemeMode,
  type VisionPreset,
} from '@/lib/ios/store';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { directFetchModels, directTest, isPrivateApiUrl } from '@/lib/ios/direct-api';

// ---------------- 常量与类型 ----------------

type Page = 'root' | 'profile' | 'theme' | 'notification' | 'storage' | 'wallpaper' | 'api' | 'vision' | 'about' | 'lock';

const IOS_RED = '#FF453A';

/** 主列表"显示与亮度"右侧的主题短名 */
const THEME_SHORT: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  auto: '自动',
};

/** 内置预设：仅保留国内可直连的三家（服务器出口网络对海外厂商有地区限制） */
const BUILTIN_API_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
];

/** 内置识图预设：均为支持图片输入的模型（识图模型与聊天模型可同厂不同款） */
const BUILTIN_VISION_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4v-flash' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-vl-plus' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1/chat/completions', model: 'Qwen/Qwen2.5-VL-7B-Instruct' },
];

// ---------------- 模块级工具 ----------------

async function readStorageEstimate(): Promise<{ usage: number; quota: number }> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    }
  } catch {
    // 忽略，返回 0
  }
  return { usage: 0, quota: 0 };
}

function formatMB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

// ---------------- 通用小组件 ----------------

/** iOS 分组卡片（子页用） */
function GroupCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-[12px] bg-card">{children}</div>
  );
}

/** iOS 系统设置图标色板（参照用户截图：纯色圆角方块 + 白色图标） */
const TONE_ORANGE = '#FF9500';
const TONE_BLUE = '#007AFF';
const TONE_GREEN = '#34C759';
const TONE_RED = '#FF3B30';
const TONE_GRAY = '#8E8E93';
const TONE_CYAN = '#32ADE6';
const TONE_PURPLE = '#AF52FF';

/** 主列表行图标：纯色圆角方块 + 白色线性图标（iOS 设置风） */
function RowIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: string }) {
  return (
    <span
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px]"
      style={{ backgroundColor: tone }}
    >
      <Icon className="h-[17px] w-[17px] text-white" strokeWidth={2.2} />
    </span>
  );
}

/** 主列表行：左彩色方块图标 + 标签，右侧可选值 / ChevronRight */
function MainRow({
  icon,
  tone,
  label,
  value,
  onClick,
  chevron,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value?: string;
  onClick?: () => void;
  chevron?: boolean;
}) {
  const showChevron = chevron ?? onClick !== undefined;
  const inner = (
    <>
      <RowIcon icon={icon} tone={tone} />
      <span className="min-w-0 flex-1 truncate text-[16px]">{label}</span>
      {value !== undefined && (
        <span className="max-w-[50%] shrink-0 truncate text-[15px] text-muted-foreground">{value}</span>
      )}
      {showChevron && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />}
    </>
  );

  if (onClick === undefined) {
    return <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
    >
      {inner}
    </button>
  );
}

/** 详情页外壳：居中标题导航 + 返回按钮 + 右滑进入动画 */
function DetailShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <IOSNavBar title={title} large={false} left={<IOSBackButton onClick={onBack} label="" />} />
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <div
          key={title}
          className="animate-in slide-in-from-right-6 fade-in duration-300 px-4 pb-[40px] pt-2"
        >
          {children}
        </div>
      </div>
    </>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[13px] font-medium text-muted-foreground">{children}</div>;
}

// ---------------- 主列表 ----------------

function RootPage({ onOpen }: { onOpen: (page: Page) => void }) {
  const theme = useSettings((s) => s.theme);
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const apiKey = useSettings((s) => s.apiConfig.apiKey);
  const apiModel = useSettings((s) => s.apiConfig.model);
  const visionConfigured = useSettings((s) => Boolean(s.visionConfig.baseUrl.trim()));
  const visionModel = useSettings((s) => s.visionConfig.model);
  const profile = useSettings((s) => s.profile);

  const [airplane, setAirplane] = useState(false);

  // 挂载读取持久化的飞行模式开关（演示项）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rec = await localDB.get('settings', 'radios');
        if (!cancelled && rec && typeof rec.value === 'object' && rec.value !== null) {
          const v = rec.value as { airplane?: unknown };
          setAirplane(v.airplane === true);
        }
      } catch {
        // IndexedDB 不可用时保持默认关闭
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAirplane = (v: boolean) => {
    setAirplane(v);
    void localDB.put('settings', { key: 'radios', value: { airplane: v } });
  };

  const wallpaperName = customWallpaperUrl
    ? '自定义'
    : (WALLPAPER_PRESETS.find((p) => p.id === wallpaperPreset)?.name ?? '自定义');

  return (
    <>
      {/* 顶部：返回主屏幕箭头 + 大标题「设置」（用户要求补上标签；返回键处不显示文字） */}
      <div className="sticky top-0 z-20 shrink-0 bg-background/80 pt-[54px] backdrop-blur-xl">
        <div className="flex h-11 items-center gap-1.5 px-4">
          <button
            type="button"
            onClick={useUI.getState().closeApp}
            aria-label="返回主屏幕"
            className="flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors active:bg-muted/60"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <span className="truncate text-[19px] font-bold leading-none tracking-tight">设置</span>
        </div>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto pb-5">
        {/* 个人资料卡（点击进入个人信息：头像/名字/标签） */}
        <div className="mx-4 mt-2 overflow-hidden rounded-[16px] bg-card">
          <button
            type="button"
            onClick={() => onOpen('profile')}
            className="flex w-full items-center gap-4 p-4 text-left transition-colors active:bg-muted/50"
          >
            {profile.avatar ? (
              <img
                src={profile.avatar}
                alt="头像"
                className="h-[56px] w-[56px] shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#D8D8DD] to-[#AEB0B8]">
                <User className="h-7 w-7 text-[#7C7C84]" strokeWidth={1.8} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[22px] font-semibold leading-tight">
                {profile.name.trim() || 'iPhone 用户'}
              </span>
              <span className="mt-1 block truncate text-[13px] text-muted-foreground">
                {profile.tag.trim() || 'Apple 账户、iCloud'}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
          </button>
        </div>

        {/* 无线控制（演示项） */}
        <div className="mx-4 mt-4 divide-y divide-border/60 overflow-hidden rounded-[16px] bg-card">
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <RowIcon icon={Plane} tone={TONE_ORANGE} />
            <span className="min-w-0 flex-1 truncate text-[16px]">飞行模式</span>
            <Switch checked={airplane} onCheckedChange={toggleAirplane} aria-label="飞行模式" />
          </div>
          <MainRow icon={Wifi} tone={TONE_BLUE} label="无线局域网" value="未连接" chevron />
          <MainRow icon={Bluetooth} tone={TONE_BLUE} label="蓝牙" value="打开" chevron />
        </div>
        <p className="mt-2 px-8 text-[12px] leading-relaxed text-muted-foreground">
          飞行模式、无线局域网与蓝牙均为演示项，不改变系统状态。
        </p>

        {/* 锁屏与密码（按用户要求不显示开启状态提示） */}
        <div className="mx-4 mt-4 divide-y divide-border/60 overflow-hidden rounded-[16px] bg-card">
          <MainRow icon={Lock} tone={TONE_RED} label="锁屏与密码" onClick={() => onOpen('lock')} />
        </div>

        {/* 显示与亮度 / 壁纸 / 通知 */}
        <div className="mx-4 mt-4 divide-y divide-border/60 overflow-hidden rounded-[16px] bg-card">
          <MainRow
            icon={Sun}
            tone={TONE_BLUE}
            label="显示与亮度"
            value={THEME_SHORT[theme]}
            onClick={() => onOpen('theme')}
          />
          <MainRow
            icon={ImageIcon}
            tone={TONE_CYAN}
            label="壁纸"
            value={wallpaperName}
            onClick={() => onOpen('wallpaper')}
          />
          <MainRow icon={Bell} tone={TONE_RED} label="通知" onClick={() => onOpen('notification')} />
        </div>

        {/* 开发者 */}
        <div className="mb-2 mt-6 px-8 text-[13px] text-muted-foreground">开发者</div>
        <div className="mx-4 divide-y divide-border/60 overflow-hidden rounded-[16px] bg-card">
          <MainRow
            icon={Wrench}
            tone={TONE_GRAY}
            label="API 配置"
            value={apiKey.trim() ? `已配置 · ${apiModel}` : '未配置'}
            onClick={() => onOpen('api')}
          />
          <MainRow
            icon={Eye}
            tone={TONE_PURPLE}
            label="识图模型"
            value={visionConfigured ? `已配置 · ${visionModel.trim() || '未填模型名'}` : '未配置'}
            onClick={() => onOpen('vision')}
          />
          <MainRow icon={Database} tone={TONE_GREEN} label="存储" onClick={() => onOpen('storage')} />
        </div>

        {/* 关于本机 */}
        <div className="mx-4 mt-4 divide-y divide-border/60 overflow-hidden rounded-[16px] bg-card">
          <MainRow icon={Info} tone={TONE_GRAY} label="关于本机" onClick={() => onOpen('about')} />
        </div>

        <p className="py-6 text-center text-[12px] text-muted-foreground">
          iOS Web · 本地优先架构 · 数据仅存于你的浏览器
        </p>
      </div>
    </>
  );
}

// ---------------- 外观与主题 ----------------

function ThemePage({ onBack }: { onBack: () => void }) {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  const options: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
    { value: 'light', label: '浅色', icon: Sun },
    { value: 'dark', label: '深色', icon: Moon },
    { value: 'auto', label: '跟随系统', icon: Monitor },
  ];

  return (
    <DetailShell title="显示与亮度" onBack={onBack}>
      <GroupCard>
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setTheme(o.value)}
              className="flex h-[46px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-muted/50"
            >
              <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span className="flex-1 text-[16px]">{o.label}</span>
              {theme === o.value && (
                <Check className="h-5 w-5 shrink-0 text-foreground" strokeWidth={2.5} />
              )}
            </button>
          );
        })}
      </GroupCard>
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        跟随系统将随设备深色模式自动切换，过渡动画平滑。
      </p>
    </DetailShell>
  );
}

// ---------------- 通知 ----------------

function NotificationPage({ onBack }: { onBack: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof Notification !== 'undefined'
      ? Notification.permission === 'granted'
      : false
  );
  const [denied, setDenied] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof Notification !== 'undefined'
      ? Notification.permission === 'denied'
      : false
  );

  const handleToggle = async (checked: boolean) => {
    if (!checked) {
      setEnabled(false);
      return;
    }
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      setEnabled(false);
      return;
    }
    if (Notification.permission === 'granted') {
      setEnabled(true);
      setDenied(false);
      return;
    }
    if (Notification.permission === 'denied') {
      setEnabled(false);
      setDenied(true);
      return;
    }
    // 'default'：向浏览器请求授权
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      setEnabled(true);
      setDenied(false);
    } else {
      setEnabled(false);
      setDenied(result === 'denied');
    }
  };

  return (
    <DetailShell title="通知" onBack={onBack}>
      <GroupCard>
        <div className="flex h-[46px] items-center justify-between px-4">
          <span className="text-[16px]">允许通知</span>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void handleToggle(v)}
            aria-label="允许通知"
          />
        </div>
      </GroupCard>
      {denied && (
        <p className="mt-3 px-1 text-[13px] leading-relaxed" style={{ color: IOS_RED }}>
          通知已被浏览器拒绝，请在浏览器设置中恢复。
        </p>
      )}
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        闹钟和计时器到点时将通过系统通知提醒。
      </p>
    </DetailShell>
  );
}

// ---------------- 存储空间 ----------------

interface StorageCounts {
  photos: number;
  recordings: number;
  music: number;
  notes: number;
  events: number;
}

function StoragePage({ onBack }: { onBack: () => void }) {
  const [usage, setUsage] = useState<number | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const [counts, setCounts] = useState<StorageCounts | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState('');

  const loadStats = useCallback(async () => {
    const est = await readStorageEstimate();
    setUsage(est.usage);
    setQuota(est.quota);
    try {
      const [photos, recordings, music, notes, events] = await Promise.all([
        localDB.count('photos'),
        localDB.count('recordings'),
        localDB.count('music'),
        localDB.count('notes'),
        localDB.count('events'),
      ]);
      setCounts({ photos, recordings, music, notes, events });
    } catch {
      setCounts({ photos: 0, recordings: 0, music: 0, notes: 0, events: 0 });
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleClean = async () => {
    if (cleaning) return;
    if (!window.confirm('确定清理全部媒体缓存吗？照片、录音和音乐将被删除。')) return;
    setCleaning(true);
    setCleanMsg('');
    try {
      await Promise.all([localDB.clear('photos'), localDB.clear('recordings'), localDB.clear('music')]);
      await loadStats();
      setCleanMsg('已清理媒体缓存，空间已释放');
      window.setTimeout(() => setCleanMsg(''), 3000);
    } catch {
      setCleanMsg('清理失败，请重试');
    } finally {
      setCleaning(false);
    }
  };

  const percent =
    usage !== null && quota !== null && quota > 0
      ? Math.min(100, Math.round((usage / quota) * 1000) / 10)
      : 0;

  const rows: { label: string; count: number; unit: string }[] = counts
    ? [
        { label: '照片', count: counts.photos, unit: '张' },
        { label: '录音', count: counts.recordings, unit: '条' },
        { label: '音乐', count: counts.music, unit: '首' },
        { label: '备忘录', count: counts.notes, unit: '条' },
        { label: '事件', count: counts.events, unit: '项' },
      ]
    : [];

  return (
    <DetailShell title="存储空间" onBack={onBack}>
      <GroupCard>
        <div className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[16px]">设备存储</span>
            <span className="text-right text-[13px] tabular-nums text-muted-foreground">
              {usage === null || quota === null
                ? '计算中…'
                : `已用 ${formatMB(usage)} / 可用约 ${formatMB(quota)}`}
            </span>
          </div>
          <Progress value={percent} className="mt-3 h-2" />
        </div>
      </GroupCard>

      <div className="mt-6">
        <GroupCard>
          {rows.length === 0 ? (
            <div className="flex h-[46px] items-center px-4 text-[15px] text-muted-foreground">
              统计中…
            </div>
          ) : (
            rows.map((r) => (
              <div key={r.label} className="flex h-[46px] items-center justify-between px-4">
                <span className="text-[16px]">{r.label}</span>
                <span className="text-[15px] tabular-nums text-muted-foreground">
                  {r.count} {r.unit}
                </span>
              </div>
            ))
          )}
        </GroupCard>
      </div>

      <div className="mt-6">
        <GroupCard>
          <button
            type="button"
            onClick={() => void handleClean()}
            disabled={cleaning}
            className="flex h-[46px] w-full items-center justify-center gap-2 px-4 text-[16px] transition-colors active:bg-muted/50 disabled:opacity-50"
            style={{ color: IOS_RED }}
          >
            {cleaning && <Loader2 className="h-4 w-4 animate-spin" />}
            清理媒体缓存
          </button>
        </GroupCard>
      </div>

      {cleanMsg && (
        <p
          className={`mt-3 px-1 text-[13px] leading-relaxed ${
            cleanMsg.startsWith('已清理') ? 'text-emerald-600 dark:text-emerald-400' : ''
          }`}
          style={cleanMsg.startsWith('已清理') ? undefined : { color: IOS_RED }}
        >
          {cleanMsg}
        </p>
      )}
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        清理将删除全部照片、录音与音乐文件，备忘录和日程不受影响。
      </p>
    </DetailShell>
  );
}

// ---------------- 壁纸 ----------------

function WallpaperPage({ onBack }: { onBack: () => void }) {
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const setWallpaperPreset = useSettings((s) => s.setWallpaperPreset);
  const setCustomWallpaper = useSettings((s) => s.setCustomWallpaper);

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCustomWallpaper(file);
    e.target.value = '';
  };

  return (
    <DetailShell title="壁纸" onBack={onBack}>
      <div className="flex flex-col gap-6">
        {customWallpaperUrl && (
          <div>
            <div className="relative h-[140px] w-full overflow-hidden rounded-[14px] border border-border">
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${customWallpaperUrl})` }}
              />
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md">
                <Check className="h-4 w-4 text-foreground" strokeWidth={3} />
              </span>
              <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-[12px] text-white">
                自定义壁纸
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCustomWallpaper(null)}
              className="mt-2.5 text-[13px] transition-opacity active:opacity-50"
              style={{ color: IOS_RED }}
            >
              移除自定义壁纸
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {WALLPAPER_PRESETS.map((p) => {
            const selected = !customWallpaperUrl && wallpaperPreset === p.id;
            return (
              <button key={p.id} type="button" onClick={() => setWallpaperPreset(p.id)} className="text-left">
                <div
                  className="relative h-[120px] overflow-hidden rounded-[14px] border border-border/60 transition-transform active:scale-[0.98]"
                  style={{ background: p.css }}
                >
                  {selected && (
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md">
                      <Check className="h-4 w-4 text-foreground" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-[14px]">{p.name}</div>
              </button>
            );
          })}
        </div>

        <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[12px] border border-border bg-card text-[15px] font-medium transition-colors active:bg-muted/60">
          <Upload className="h-4 w-4" />
          上传自定义壁纸
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </label>

        <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
          自定义壁纸保存在本机 IndexedDB，不会上传。
        </p>
      </div>
    </DetailShell>
  );
}

// ---------------- API 设置 ----------------

function ApiPage({ onBack }: { onBack: () => void }) {
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiPresets = useSettings((s) => s.apiPresets);
  const updateApiConfig = useSettings((s) => s.updateApiConfig);
  const setApiPresets = useSettings((s) => s.setApiPresets);

  const [showKey, setShowKey] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  const [models, setModels] = useState<string[]>([]);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsHint, setModelsHint] = useState('');

  const [testLoading, setTestLoading] = useState(false);
  const [testOk, setTestOk] = useState<{ latencyMs: number; model: string; viaDirect?: boolean } | null>(null);
  const [testError, setTestError] = useState('');
  const [testConnected, setTestConnected] = useState(false);
  const [testUrl, setTestUrl] = useState('');

  const [maxText, setMaxText] = useState(() => String(apiConfig.maxTokens));

  const clearTestResult = () => {
    setTestOk(null);
    setTestError('');
    setTestConnected(false);
    setTestUrl('');
  };

  const applyBuiltin = (p: (typeof BUILTIN_API_PRESETS)[number]) => {
    updateApiConfig({ baseUrl: p.baseUrl, model: p.model });
    clearTestResult();
  };

  const applyUserPreset = (p: ApiPreset) => {
    updateApiConfig(p.config);
    setMaxText(String(p.config.maxTokens));
    clearTestResult();
  };

  const deletePreset = (id: string) => {
    setApiPresets(apiPresets.filter((p) => p.id !== id));
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setApiPresets([...apiPresets, { id: genId(), name, config: { ...apiConfig } }]);
    setPresetName('');
    setSaveOpen(false);
  };

  const fetchModels = async () => {
    if (!apiConfig.baseUrl.trim()) {
      setModelsError('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setModelsHint('');
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | { models?: string[]; hint?: string; error?: string; url?: string; directOnly?: boolean }
        | null;
      // 内网地址或服务器不可达/地区限制（directOnly）：改用浏览器直连拉取
      if (!data || data.directOnly || (data.error && isPrivateApiUrl(apiConfig.baseUrl))) {
        const direct = await directFetchModels(apiConfig.baseUrl, apiConfig.apiKey);
        if (direct.error) {
          const serverMsg = typeof data?.error === 'string' ? data.error : '';
          setModelsError(
            serverMsg && !isPrivateApiUrl(apiConfig.baseUrl)
              ? `${serverMsg}；浏览器直连也不可用：${direct.error}`
              : direct.error
          );
          return;
        }
        if (direct.hint && direct.models.length === 0) {
          setModelsHint(direct.hint);
          return;
        }
        setModels(direct.models);
        setModelQuery('');
        setModelPanelOpen(true);
        return;
      }
      if (!res.ok || !data || data.error) {
        const base = data?.error ?? '拉取模型失败，请稍后重试';
        setModelsError(data?.url ? `${base}（实际请求：${data.url}）` : base);
      } else if (data.hint && (data.models ?? []).length === 0) {
        // 反代等无模型列表接口：优雅降级，提示手动输入
        setModelsHint(data.hint);
      } else {
        setModels(data.models ?? []);
        setModelQuery('');
        setModelPanelOpen(true);
      }
    } catch {
      setModelsError('无法连接到服务器');
    } finally {
      setFetchingModels(false);
    }
  };

  const runTest = async () => {
    if (!apiConfig.baseUrl.trim()) {
      setTestError('请先填写 API 地址');
      return;
    }
    setTestLoading(true);
    clearTestResult();
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: apiConfig.baseUrl,
          apiKey: apiConfig.apiKey,
          model: apiConfig.model,
          temperature: apiConfig.temperature,
          maxTokens: apiConfig.maxTokens,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            latencyMs?: number;
            model?: string;
            error?: string;
            connected?: boolean;
            url?: string;
            directOnly?: boolean;
          }
        | null;
      setTestUrl(typeof data?.url === 'string' ? data.url : '');
      if (data?.ok) {
        setTestOk({ latencyMs: data.latencyMs ?? 0, model: data.model ?? apiConfig.model });
        return;
      }
      // 私有地址（云端服务器必然不可达）或服务器明确建议直连（地区限制/网络不可达/限流）：
      // 改用浏览器直连兑底；服务器返回非 JSON（网关错误页等 data=null）时私有地址同样兑底，
      // 避免误报「测试失败」
      const serverError = data?.error ?? '测试失败，请稍后重试';
      if (data?.directOnly || isPrivateApiUrl(apiConfig.baseUrl)) {
        const direct = await directTest(apiConfig);
        if (direct.ok) {
          setTestOk({ latencyMs: direct.latencyMs, model: direct.model, viaDirect: true });
          return;
        }
        setTestUrl(apiConfig.baseUrl);
        setTestError(
          isPrivateApiUrl(apiConfig.baseUrl)
            ? direct.error ?? '浏览器直连失败'
            : `${serverError}；浏览器直连也不可用：${direct.error ?? '请确认该 API 允许跨域访问（CORS）'}`
        );
        return;
      }
      setTestError(serverError);
      setTestConnected(Boolean(data?.connected));
    } catch {
      setTestError('无法连接到服务器');
    } finally {
      setTestLoading(false);
    }
  };

  const handleMaxChange = (v: string) => {
    setMaxText(v);
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n >= 64) updateApiConfig({ maxTokens: n });
  };

  const handleMaxBlur = () => {
    const n = Number.parseInt(maxText, 10);
    if (!Number.isFinite(n) || n < 64) {
      setMaxText(String(apiConfig.maxTokens));
    } else {
      setMaxText(String(n));
      updateApiConfig({ maxTokens: n });
    }
  };

  const q = modelQuery.trim().toLowerCase();
  const filteredModels = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;

  return (
    <DetailShell title="API 设置" onBack={onBack}>
      <div className="flex flex-col gap-5">
        {/* 预设区 */}
        <section>
          <div className="mb-2 text-[13px] font-medium text-muted-foreground">预设</div>
          <div className="flex flex-wrap gap-2">
            {BUILTIN_API_PRESETS.map((p) => {
              const active = apiConfig.baseUrl === p.baseUrl;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyBuiltin(p)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-foreground/85 hover:border-muted-foreground/40'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
            {apiPresets.map((p) => {
              const active =
                apiConfig.baseUrl === p.config.baseUrl && apiConfig.model === p.config.model;
              return (
                <span
                  key={p.id}
                  className={`flex items-center gap-1.5 rounded-full border py-1.5 pl-3 pr-2 text-[13px] ${
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-foreground/85'
                  }`}
                >
                  <button type="button" onClick={() => applyUserPreset(p)} className="max-w-[120px] truncate">
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(p.id)}
                    aria-label={`删除预设 ${p.name}`}
                    className="opacity-60 transition-opacity hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => setSaveOpen((v) => !v)}
              className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-muted-foreground/50"
            >
              <Plus className="h-3.5 w-3.5" />
              存为预设
            </button>
          </div>
          {saveOpen && (
            <div className="mt-3 flex gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="预设名称，如 我的GPT"
                autoFocus
                className="h-9 flex-1 rounded-[10px] bg-background text-[14px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePreset();
                }}
              />
              <button
                type="button"
                onClick={savePreset}
                disabled={!presetName.trim()}
                className="h-9 shrink-0 rounded-[10px] bg-foreground px-4 text-[13px] font-medium text-background transition-opacity active:opacity-80 disabled:opacity-40"
              >
                保存
              </button>
            </div>
          )}
        </section>

        {/* 配置表单 */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-muted-foreground">连接配置</span>
            <span className="text-[11px] text-muted-foreground/70">更改自动保存</span>
          </div>
          <div className="flex flex-col gap-4 rounded-[12px] bg-card p-4">
            {/* API 地址 */}
            <div>
              <FieldLabel>API 地址</FieldLabel>
              <Input
                value={apiConfig.baseUrl}
                onChange={(e) => updateApiConfig({ baseUrl: e.target.value })}
                placeholder={DEFAULT_API_CONFIG.baseUrl}
                className="h-10 rounded-[10px] bg-background text-[14px]"
              />
            </div>

            {/* API Key */}
            <div>
              <FieldLabel>API Key</FieldLabel>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiConfig.apiKey}
                  onChange={(e) => updateApiConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="off"
                  className={`h-10 rounded-[10px] bg-background text-[14px] ${
                    apiConfig.apiKey ? 'pr-16' : 'pr-10'
                  }`}
                />
                {/* 清空 Key（仅在有内容时显示） */}
                {apiConfig.apiKey && (
                  <button
                    type="button"
                    onClick={() => {
                      updateApiConfig({ apiKey: '' });
                      clearTestResult();
                    }}
                    aria-label="清空 API Key"
                    className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* 模型 */}
            <div className="relative">
              <FieldLabel>模型</FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={apiConfig.model}
                  onChange={(e) => updateApiConfig({ model: e.target.value })}
                  placeholder={DEFAULT_API_CONFIG.model}
                  className="h-10 flex-1 rounded-[10px] bg-background text-[14px]"
                />
                <button
                  type="button"
                  onClick={() => void fetchModels()}
                  disabled={fetchingModels}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium transition-colors active:bg-muted/60 disabled:opacity-50"
                >
                  {fetchingModels && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  拉取模型
                </button>
              </div>
              {modelsError && (
                <p className="mt-1.5 text-[12px]" style={{ color: IOS_RED }}>
                  {modelsError}
                </p>
              )}
              {modelsHint && (
                <div className="mt-1.5 rounded-[10px] border border-amber-500/30 bg-amber-400/10 px-3 py-2 text-[12px] leading-relaxed text-amber-700 dark:border-amber-400/25 dark:text-amber-200/90">
                  {modelsHint}
                </div>
              )}

              {modelPanelOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setModelPanelOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute -left-4 -right-4 top-full z-30 mt-1 overflow-hidden rounded-[12px] border border-border bg-card shadow-2xl">
                    <div className="border-b border-border/60 p-2">
                      <Input
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="搜索模型，如 32k / turbo"
                        autoFocus
                        className="h-9 rounded-[10px] bg-background text-[13px]"
                      />
                    </div>
                    <div className="thin-scrollbar max-h-64 overflow-y-auto">
                      {filteredModels.length === 0 ? (
                        <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                          没有匹配的模型
                        </div>
                      ) : (
                        filteredModels.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              updateApiConfig({ model: m });
                              setModelPanelOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                          >
                            <span className="truncate text-[14px]">{m}</span>
                            {apiConfig.model === m && (
                              <Check
                                className="h-4 w-4 shrink-0 text-foreground"
                                strokeWidth={2.5}
                              />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 温度 */}
            <div>
              <div className="mb-2.5 text-[13px] font-medium text-muted-foreground">温度</div>
              <div className="flex items-center gap-3">
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  value={[apiConfig.temperature]}
                  onValueChange={(v) => updateApiConfig({ temperature: v[0] ?? 0.7 })}
                  className="flex-1"
                  aria-label="温度"
                />
                <span className="min-w-[48px] rounded-full bg-muted px-2.5 py-1 text-center text-[13px] tabular-nums">
                  {apiConfig.temperature.toFixed(1)}
                </span>
              </div>
            </div>

            {/* 最大 Token */}
            <div>
              <FieldLabel>最大 Token</FieldLabel>
              <Input
                type="number"
                min={64}
                step={64}
                value={maxText}
                onChange={(e) => handleMaxChange(e.target.value)}
                onBlur={handleMaxBlur}
                className="h-10 rounded-[10px] bg-background text-[14px]"
              />
            </div>

            {/* 未配置 Key 提示 */}
            {!apiConfig.apiKey.trim() && (
              <div className="rounded-[10px] border border-amber-500/30 bg-amber-400/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-700 dark:border-amber-400/25 dark:text-amber-200/90">
                未配置 API Key 时，AI 助手无法回复；请填写 OpenAI 兼容接口地址与 API Key 后再聊天。
              </div>
            )}
          </div>
        </section>

        {/* 测试连接 */}
        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testLoading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-foreground text-[15px] font-medium text-background transition-opacity active:opacity-80 disabled:opacity-50"
          >
            {testLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            测试连接
          </button>
          {testOk && (
            <div className="rounded-[12px] border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] leading-relaxed text-emerald-700 dark:text-emerald-300">
              ✅ 连接成功{testOk.viaDirect ? '（浏览器直连）' : ''} · 延迟 {testOk.latencyMs}ms · 模型 {testOk.model}
            </div>
          )}
          {testError && (
            <div
              className="rounded-[12px] border px-4 py-3 text-[13px] leading-relaxed"
              style={
                testConnected
                  ? {
                      borderColor: 'rgba(245,158,11,0.35)',
                      backgroundColor: 'rgba(245,158,11,0.1)',
                      color: '#B45309',
                    }
                  : { borderColor: 'rgba(255,69,58,0.3)', backgroundColor: 'rgba(255,69,58,0.1)', color: IOS_RED }
              }
            >
              {testConnected ? '⚠️ ' : '❌ '}
              {testError}
              {testConnected && (
                <span className="mt-1 block text-[12px] opacity-80">
                  接口本身可达，问题出在配置而不是连接；按提示修正后即可聊天。
                </span>
              )}
            </div>
          )}
          {testUrl && (
            <div className="break-all px-1 text-[11px] leading-relaxed text-muted-foreground/80">
              实际请求：{testUrl}
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            预设保存后下次打开网站依然可用（数据保存在本机 IndexedDB）。
          </p>
        </section>
      </div>
    </DetailShell>
  );
}

// ---------------- 识图模型设置 ----------------

/**
 * 识图模型配置页（与「API 配置」并列、互相独立）：
 * 预设（内置 4 家 + 用户自存）/ API 地址 / API Key / 模型名（可拉取模型列表）/ 存为预设；
 * 更改自动保存、聊天发送时现场读取（保存后自动生效，无需重启）。
 * 未配置时聊天发图不触发识图，文字聊天完全不受影响。
 */
function VisionPage({ onBack }: { onBack: () => void }) {
  const visionConfig = useSettings((s) => s.visionConfig);
  const visionPresets = useSettings((s) => s.visionPresets);
  const updateVisionConfig = useSettings((s) => s.updateVisionConfig);
  const setVisionPresets = useSettings((s) => s.setVisionPresets);

  const [showKey, setShowKey] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  const [models, setModels] = useState<string[]>([]);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsHint, setModelsHint] = useState('');

  const applyBuiltin = (p: (typeof BUILTIN_VISION_PRESETS)[number]) => {
    updateVisionConfig({ baseUrl: p.baseUrl, model: p.model });
    setModelsError('');
    setModelsHint('');
  };

  const applyUserPreset = (p: VisionPreset) => {
    updateVisionConfig(p.config);
    setModelsError('');
    setModelsHint('');
  };

  const deletePreset = (id: string) => {
    setVisionPresets(visionPresets.filter((p) => p.id !== id));
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setVisionPresets([...visionPresets, { id: genId(), name, config: { ...visionConfig } }]);
    setPresetName('');
    setSaveOpen(false);
  };

  const fetchModels = async () => {
    if (!visionConfig.baseUrl.trim()) {
      setModelsError('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setModelsHint('');
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: visionConfig.baseUrl, apiKey: visionConfig.apiKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | { models?: string[]; hint?: string; error?: string; directOnly?: boolean }
        | null;
      // 内网地址或服务器不可达/地区限制（directOnly）：改用浏览器直连拉取
      if (!data || data.directOnly || (data.error && isPrivateApiUrl(visionConfig.baseUrl))) {
        const direct = await directFetchModels(visionConfig.baseUrl, visionConfig.apiKey);
        if (direct.error) {
          setModelsError(direct.error);
          return;
        }
        if (direct.hint && direct.models.length === 0) {
          setModelsHint(direct.hint);
          return;
        }
        setModels(direct.models);
        setModelQuery('');
        setModelPanelOpen(true);
        return;
      }
      if (!res.ok || !data || data.error) {
        setModelsError(data?.error ?? '拉取模型失败，请稍后重试');
      } else if (data.hint && (data.models ?? []).length === 0) {
        // 反代等无模型列表接口：优雅降级，提示手动输入
        setModelsHint(data.hint);
      } else {
        setModels(data.models ?? []);
        setModelQuery('');
        setModelPanelOpen(true);
      }
    } catch {
      setModelsError('无法连接到服务器');
    } finally {
      setFetchingModels(false);
    }
  };

  const q = modelQuery.trim().toLowerCase();
  const filteredModels = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;

  return (
    <DetailShell title="识图模型" onBack={onBack}>
      <div className="flex flex-col gap-5">
        {/* 说明 */}
        <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
          识图模型只负责「看图」：聊天里发图片时先用它把图片转成文字描述，再交给聊天模型生成回复；两者配置互相独立、互不覆盖。未配置时发图不识图，文字聊天不受影响。
        </p>

        {/* 预设区 */}
        <section>
          <div className="mb-2 text-[13px] font-medium text-muted-foreground">预设</div>
          <div className="flex flex-wrap gap-2">
            {BUILTIN_VISION_PRESETS.map((p) => {
              const active = visionConfig.baseUrl === p.baseUrl;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyBuiltin(p)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-foreground/85 hover:border-muted-foreground/40'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
            {visionPresets.map((p) => {
              const active =
                visionConfig.baseUrl === p.config.baseUrl && visionConfig.model === p.config.model;
              return (
                <span
                  key={p.id}
                  className={`flex items-center gap-1.5 rounded-full border py-1.5 pl-3 pr-2 text-[13px] ${
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-foreground/85'
                  }`}
                >
                  <button type="button" onClick={() => applyUserPreset(p)} className="max-w-[120px] truncate">
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(p.id)}
                    aria-label={`删除识图预设 ${p.name}`}
                    className="opacity-60 transition-opacity hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => setSaveOpen((v) => !v)}
              className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-muted-foreground/50"
            >
              <Plus className="h-3.5 w-3.5" />
              存为预设
            </button>
          </div>
          {saveOpen && (
            <div className="mt-3 flex gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="预设名称，如 本地视觉模型"
                autoFocus
                className="h-9 flex-1 rounded-[10px] bg-background text-[14px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePreset();
                }}
              />
              <button
                type="button"
                onClick={savePreset}
                disabled={!presetName.trim()}
                className="h-9 shrink-0 rounded-[10px] bg-foreground px-4 text-[13px] font-medium text-background transition-opacity active:opacity-80 disabled:opacity-40"
              >
                保存
              </button>
            </div>
          )}
        </section>

        {/* 配置表单 */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-muted-foreground">连接配置</span>
            <span className="text-[11px] text-muted-foreground/70">更改自动保存 · 即时生效</span>
          </div>
          <div className="flex flex-col gap-4 rounded-[12px] bg-card p-4">
            {/* API 地址 */}
            <div>
              <FieldLabel>API 地址</FieldLabel>
              <Input
                value={visionConfig.baseUrl}
                onChange={(e) => updateVisionConfig({ baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1/chat/completions"
                className="h-10 rounded-[10px] bg-background text-[14px]"
              />
            </div>

            {/* API Key */}
            <div>
              <FieldLabel>API Key</FieldLabel>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={visionConfig.apiKey}
                  onChange={(e) => updateVisionConfig({ apiKey: e.target.value })}
                  placeholder="sk-...（免 Key 接口可留空）"
                  autoComplete="off"
                  className={`h-10 rounded-[10px] bg-background text-[14px] ${
                    visionConfig.apiKey ? 'pr-16' : 'pr-10'
                  }`}
                />
                {visionConfig.apiKey && (
                  <button
                    type="button"
                    onClick={() => updateVisionConfig({ apiKey: '' })}
                    aria-label="清空识图 API Key"
                    className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏识图 Key' : '显示识图 Key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* 模型名 */}
            <div className="relative">
              <FieldLabel>模型名</FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={visionConfig.model}
                  onChange={(e) => updateVisionConfig({ model: e.target.value })}
                  placeholder="如 gpt-4o-mini / qwen-vl-plus / glm-4v-flash"
                  className="h-10 flex-1 rounded-[10px] bg-background text-[14px]"
                />
                <button
                  type="button"
                  onClick={() => void fetchModels()}
                  disabled={fetchingModels}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium transition-colors active:bg-muted/60 disabled:opacity-50"
                >
                  {fetchingModels && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  拉取模型
                </button>
              </div>
              {modelsError && (
                <p className="mt-1.5 text-[12px]" style={{ color: IOS_RED }}>
                  {modelsError}
                </p>
              )}
              {modelsHint && (
                <div className="mt-1.5 rounded-[10px] border border-amber-500/30 bg-amber-400/10 px-3 py-2 text-[12px] leading-relaxed text-amber-700 dark:border-amber-400/25 dark:text-amber-200/90">
                  {modelsHint}
                </div>
              )}

              {modelPanelOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setModelPanelOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute -left-4 -right-4 top-full z-30 mt-1 overflow-hidden rounded-[12px] border border-border bg-card shadow-2xl">
                    <div className="border-b border-border/60 p-2">
                      <Input
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="搜索模型，如 vl / vision"
                        autoFocus
                        className="h-9 rounded-[10px] bg-background text-[13px]"
                      />
                    </div>
                    <div className="thin-scrollbar max-h-64 overflow-y-auto">
                      {filteredModels.length === 0 ? (
                        <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                          没有匹配的模型
                        </div>
                      ) : (
                        filteredModels.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              updateVisionConfig({ model: m });
                              setModelPanelOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                          >
                            <span className="truncate text-[14px]">{m}</span>
                            {visionConfig.model === m && (
                              <Check className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2.5} />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 未配置提示 */}
            {!visionConfig.baseUrl.trim() && (
              <div className="rounded-[10px] border border-amber-500/30 bg-amber-400/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-700 dark:border-amber-400/25 dark:text-amber-200/90">
                还没有配置识图模型：聊天中发送图片不会触发识图（不影响文字聊天）。填写 OpenAI 兼容的多模态接口地址与模型名后，发图即可让 AI 看懂图片。
              </div>
            )}
          </div>
        </section>

        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          图片仅内联传给你自己配置的识图接口，不经过任何第三方图床；预设保存在本机 IndexedDB（API Key 加密存储）。
        </p>
      </div>
    </DetailShell>
  );
}

// ---------------- 锁屏密码 ----------------

type LockStage = 'menu' | 'verifyOff' | 'verifyChange' | 'setNew' | 'confirmNew';

const LOCK_STAGE_TITLE: Record<Exclude<LockStage, 'menu'>, string> = {
  verifyOff: '输入密码',
  verifyChange: '输入密码',
  setNew: '输入新密码',
  confirmNew: '再输入一次',
};

/**
 * 锁屏密码管理：开启/关闭（需验证原密码）、修改密码（原密码 → 新密码两次）、
 * 密码类型（4/6 位，未开启时可切换）、立即锁定。
 */
function LockPage({ onBack }: { onBack: () => void }) {
  const lockConfig = useSettings((s) => s.lockConfig);
  const applyLockConfig = useSettings((s) => s.applyLockConfig);
  const setLockScreen = useSettings((s) => s.setLockScreen);

  const [stage, setStage] = useState<LockStage>('menu');
  const [tempCode, setTempCode] = useState('');
  const [errText, setErrText] = useState('');
  const [errSignal, setErrSignal] = useState(0);

  const fail = (msg: string) => {
    setErrSignal((s) => s + 1);
    setErrText(msg);
  };

  const cancelSub = () => {
    setStage('menu');
    setTempCode('');
    setErrText('');
  };

  // ---------------- 菜单 ----------------
  if (stage === 'menu') {
    return (
      <DetailShell title="锁屏与密码" onBack={onBack}>
        <GroupCard>
          <div className="divide-y divide-border/60">
            {/* 锁屏总开关：关掉后不再出现锁屏界面 */}
            <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 text-[16px]">锁屏</span>
              <Switch
                checked={lockConfig.lockScreen}
                onCheckedChange={(v) => {
                  setErrText('');
                  setLockScreen(v);
                }}
                aria-label="锁屏开关"
              />
            </div>
            {/* 锁屏密码开关（仅在锁屏开启时可用） */}
            <div
              className={`flex min-h-[52px] items-center gap-3 px-4 py-2 ${
                lockConfig.lockScreen ? '' : 'pointer-events-none opacity-40'
              }`}
            >
              <span className="min-w-0 flex-1 text-[16px]">锁屏密码</span>
              <Switch
                checked={lockConfig.enabled}
                onCheckedChange={(v) => {
                  setErrText('');
                  if (v) {
                    setTempCode('');
                    setStage('setNew');
                  } else if (lockConfig.code) {
                    setStage('verifyOff');
                  } else {
                    applyLockConfig({ lockScreen: true, enabled: false, code: '', len: lockConfig.len });
                  }
                }}
                aria-label="锁屏密码开关"
              />
            </div>
          </div>
        </GroupCard>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-muted-foreground">
          {lockConfig.lockScreen
            ? '开启后，锁屏上滑解锁需要输入密码；关闭浏览器再打开或按下电源键都会回到锁屏。'
            : '锁屏已关闭：开机和按下电源键都会直接进入主屏幕。'}
        </p>

        {lockConfig.lockScreen && (
          <div className="mt-4">
            <GroupCard>
              {lockConfig.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    setErrText('');
                    setTempCode('');
                    setStage('verifyChange');
                  }}
                  className="flex h-[46px] w-full items-center justify-between px-4 text-left transition-colors active:bg-muted/50"
                >
                  <span className="text-[16px]">更改密码</span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
                </button>
              )}
              <div className="flex min-h-[52px] items-center justify-between px-4 py-2">
                <span className="text-[16px]">密码类型</span>
                {lockConfig.enabled ? (
                  <span className="text-[15px] text-muted-foreground">
                    {lockConfig.len === 6 ? '6 位数字' : '4 位数字'}
                  </span>
                ) : (
                  <div className="flex rounded-full bg-muted p-0.5" role="radiogroup" aria-label="密码位数">
                    {([4, 6] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={lockConfig.len === n}
                        onClick={() => applyLockConfig({ lockScreen: true, enabled: false, code: '', len: n })}
                        className={`h-8 w-[68px] rounded-full text-[14px] transition ${
                          lockConfig.len === n
                            ? 'bg-background font-medium shadow-sm'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {n} 位
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </GroupCard>
          </div>
        )}

        {errText && (
          <p className="mt-3 px-1 text-[13px] leading-relaxed" style={{ color: IOS_RED }} role="alert">
            {errText}
          </p>
        )}
      </DetailShell>
    );
  }

  // ---------------- 密码输入子页 ----------------

  const handleComplete = (code: string) => {
    if (stage === 'verifyOff') {
      if (code === lockConfig.code) {
        applyLockConfig({ ...lockConfig, enabled: false, code: '' });
        setErrText('');
        setStage('menu');
      } else {
        fail('密码错误，请重试');
      }
    } else if (stage === 'verifyChange') {
      if (code === lockConfig.code) {
        setErrText('');
        setTempCode('');
        setStage('setNew');
      } else {
        fail('密码错误，请重试');
      }
    } else if (stage === 'setNew') {
      setTempCode(code);
      setErrText('');
      setStage('confirmNew');
    } else if (stage === 'confirmNew') {
      if (code === tempCode) {
        applyLockConfig({ ...lockConfig, enabled: true, code });
        setErrText('');
        setTempCode('');
        setStage('menu');
      } else {
        setTempCode('');
        setStage('setNew');
        fail('两次输入不一致，请重新设置');
      }
    }
  };

  return (
    <DetailShell title="锁屏与密码" onBack={cancelSub}>
      <div className="flex flex-col items-center pt-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" strokeWidth={2} />
        </div>
        <p className="mt-3 text-[17px] font-semibold">{LOCK_STAGE_TITLE[stage]}</p>
        {stage === 'confirmNew' && (
          <p className="mt-1 text-[13px] text-muted-foreground">请再次输入相同的密码</p>
        )}
        <PasscodePad
          length={lockConfig.len}
          onComplete={handleComplete}
          errorSignal={errSignal}
          className="mt-6"
        />
        <p className="mt-4 min-h-[20px] text-[13px] font-medium" style={{ color: IOS_RED }} role="alert">
          {errText}
        </p>
        <button
          type="button"
          onClick={cancelSub}
          className="mt-2 rounded-full px-6 py-2 text-[15px] text-muted-foreground transition active:opacity-60"
        >
          取消
        </button>
      </div>
    </DetailShell>
  );
}

// ---------------- 关于本机 ----------------

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[46px] items-center justify-between gap-3 px-4 py-2">
      <span className="shrink-0 text-[16px]">{label}</span>
      <span className="text-right text-[15px] text-muted-foreground">{value}</span>
    </div>
  );
}

// ---------------- 个人信息 ----------------

/** 读取图片文件 → 居中裁剪缩放为 256px 头像 data URL（控住 IndexedDB 体积） */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 不可用');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error('图片处理失败'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

/** 个人信息页：从手机上传头像、修改名字与标签（即改即存，锁屏「×××的iPhone」同步） */
function ProfilePage({ onBack }: { onBack: () => void }) {
  const profile = useSettings((s) => s.profile);
  const setProfile = useSettings((s) => s.setProfile);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一张图
    if (!file) return;
    void fileToAvatarDataUrl(file)
      .then((dataUrl) => setProfile({ avatar: dataUrl }))
      .catch(() => undefined);
  };

  return (
    <DetailShell title="个人信息" onBack={onBack}>
      {/* 头像：点击从手机相册/文件选择 */}
      <div className="flex flex-col items-center pt-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="更换头像"
          className="relative rounded-full transition-transform active:scale-95"
        >
          {profile.avatar ? (
            <img src={profile.avatar} alt="头像" className="h-[88px] w-[88px] rounded-full object-cover" />
          ) : (
            <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-gradient-to-b from-[#D8D8DD] to-[#AEB0B8]">
              <User className="h-11 w-11 text-[#7C7C84]" strokeWidth={1.8} />
            </span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-[30px] w-[30px] items-center justify-center rounded-full border-[3px] border-background bg-muted">
            <Camera className="h-[15px] w-[15px] text-foreground" strokeWidth={2.2} />
          </span>
        </button>
        <p className="mt-2.5 text-[12px] text-muted-foreground">轻点头像，从手机相册选择照片</p>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
      </div>

      {/* 名字 / 标签（即改即存） */}
      <div className="mt-6">
        <GroupCard>
          <div className="flex items-center gap-3 px-4 py-1.5">
            <span className="w-[64px] shrink-0 text-[15px] text-muted-foreground">名字</span>
            <Input
              value={profile.name}
              onChange={(e) => setProfile({ name: e.target.value })}
              placeholder="iPhone 用户"
              maxLength={20}
              aria-label="名字"
              className="h-11 border-0 bg-transparent px-0 text-[16px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
          <div className="flex items-center gap-3 px-4 py-1.5">
            <span className="w-[64px] shrink-0 text-[15px] text-muted-foreground">标签</span>
            <Input
              value={profile.tag}
              onChange={(e) => setProfile({ tag: e.target.value })}
              placeholder="Apple 账户、iCloud"
              maxLength={30}
              aria-label="标签"
              className="h-11 border-0 bg-transparent px-0 text-[16px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        </GroupCard>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-muted-foreground">
          名字将显示在锁屏「×××的iPhone」小组件上；头像、名字与标签自动保存。
        </p>
      </div>
    </DetailShell>
  );
}

function AboutPage({ onBack }: { onBack: () => void }) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const uaShort = ua.length > 48 ? `${ua.slice(0, 48)}…` : ua;

  return (
    <DetailShell title="关于本机" onBack={onBack}>
      <GroupCard>
        <AboutRow label="名称" value="iPhone" />
        <AboutRow label="系统版本" value="iOS Web 1.0.0" />
        <AboutRow label="架构" value="本地优先（IndexedDB）" />
        <div className="flex min-h-[46px] items-center justify-between gap-3 px-4 py-2">
          <span className="shrink-0 text-[16px]">浏览器</span>
          <span className="truncate text-right text-[13px] text-muted-foreground" title={ua || undefined}>
            {uaShort || '—'}
          </span>
        </div>
      </GroupCard>
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        照片、备忘录、日程、聊天与全部设置均保存在浏览器 IndexedDB 中，可随时清理，不会上传服务器。
      </p>
    </DetailShell>
  );
}

// ---------------- 根组件 ----------------

export default function SettingsApp() {
  const [page, setPage] = useState<Page>('root');

  return (
    <IOSScreen>
      {page === 'root' && <RootPage onOpen={setPage} />}
      {page === 'profile' && <ProfilePage onBack={() => setPage('root')} />}
      {page === 'theme' && <ThemePage onBack={() => setPage('root')} />}
      {page === 'notification' && <NotificationPage onBack={() => setPage('root')} />}
      {page === 'storage' && <StoragePage onBack={() => setPage('root')} />}
      {page === 'wallpaper' && <WallpaperPage onBack={() => setPage('root')} />}
      {page === 'api' && <ApiPage onBack={() => setPage('root')} />}
      {page === 'vision' && <VisionPage onBack={() => setPage('root')} />}
      {page === 'lock' && <LockPage onBack={() => setPage('root')} />}
      {page === 'about' && <AboutPage onBack={() => setPage('root')} />}
    </IOSScreen>
  );
}

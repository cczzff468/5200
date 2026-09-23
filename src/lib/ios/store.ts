'use client';

import { create } from 'zustand';
import { useSyncExternalStore, useMemo, useState, useEffect, type CSSProperties } from 'react';
import { localDB } from './db';
import { encryptValue, decryptValue } from './secure-store';

// ---------------- 类型 ----------------

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export interface ApiConfig {
  /** OpenAI 兼容的 chat/completions 完整地址（或以 /v1 结尾的基地址） */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 0 - 2 */
  temperature: number;
  maxTokens: number;
}

export interface ApiPreset {
  id: string;
  name: string;
  config: ApiConfig;
}

/** 识图模型配置：与聊天模型（ApiConfig）完全独立、互不覆盖，只负责「看图」，不负责回复
 *  ——聊天发图时先用它把图片转成文字描述，再交给聊天模型生成最终回复；未配置（baseUrl 空）时不影响文字聊天 */
export interface VisionConfig {
  /** OpenAI 兼容的 chat/completions 完整地址（或以 /v1 结尾的基地址） */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface VisionPreset {
  id: string;
  name: string;
  config: VisionConfig;
}

/** 默认未配置：发图不触发识图，聊天行为与旧版完全一致 */
export const DEFAULT_VISION_CONFIG: VisionConfig = { baseUrl: '', apiKey: '', model: '' };

export type PasscodeLength = 4 | 6;

export interface LockConfig {
  /** 是否启用锁屏界面（关闭后开机/电源键不再出现锁屏，直接进主屏幕） */
  lockScreen: boolean;
  /** 是否启用锁屏密码（关闭后锁屏仅需上滑解锁；仅在 lockScreen 开启时生效） */
  enabled: boolean;
  /** 密码（数字字符串，enabled=false 时为 ''） */
  code: string;
  /** 密码位数 */
  len: PasscodeLength;
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 2048,
};

/** 个人信息（设置根页个人卡片 + 锁屏「×××的iPhone」小组件共用） */
export interface Profile {
  name: string;
  tag: string;
  /** 头像 data URL（上传时已缩至 256px，控住体积） */
  avatar: string | null;
}

export const DEFAULT_PROFILE: Profile = { name: '', tag: 'Apple 账户、iCloud', avatar: null };

/** 锁屏壁纸持久化记录（锁屏壁纸与主屏幕完全独立） */
interface LockWallpaperRecord {
  preset?: string;
  customBlob?: Blob;
}

export interface WallpaperPreset {
  id: string;
  name: string;
  css: string;
  /** 浅色壁纸（状态栏文字用黑色） */
  light: boolean;
  /** 底色兜底：PNG 预设图片异步加载/解码前先铺纯色，避免锁屏/主屏透出下层内容闪现 */
  base: string;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'dark-stream',
    name: '暗流',
    css: 'url(/wallpapers/dark-stream.png) center / cover no-repeat',
    light: false,
    base: '#0a0a0d',
  },
  {
    id: 'ink-marble',
    name: '墨纹',
    css: 'url(/wallpapers/ink-marble.png) center / cover no-repeat',
    light: false,
    base: '#141417',
  },
  {
    id: 'mist-mountain',
    name: '雾山',
    css: 'url(/wallpapers/mist-mountain.png) center / cover no-repeat',
    light: true,
    base: '#d9dade',
  },
  {
    id: 'graphite',
    name: '石墨黑',
    css: 'radial-gradient(120% 90% at 20% 0%, #2a2a2e 0%, #161618 45%, #050506 100%)',
    light: false,
    base: '#161618',
  },
  {
    id: 'dusk',
    name: '暮色灰',
    css: 'linear-gradient(180deg, #1b1b1f 0%, #33343b 52%, #5c5d66 100%)',
    light: false,
    base: '#1b1b1f',
  },
  {
    id: 'silver',
    name: '银白',
    css: 'linear-gradient(180deg, #fafafc 0%, #e3e3e9 55%, #b7b8c0 100%)',
    light: true,
    base: '#fafafc',
  },
  {
    id: 'mist',
    name: '晨雾',
    css: 'linear-gradient(180deg, #ececf1 0%, #c6c7cf 55%, #90919b 100%)',
    light: true,
    base: '#ececf1',
  },
];

// ---------------- 设置 Store ----------------

interface SettingsState {
  theme: ThemeMode;
  wallpaperPreset: string;
  /** 自定义壁纸的 ObjectURL（Blob 存 IndexedDB） */
  customWallpaperUrl: string | null;
  /** 锁屏壁纸预设（锁屏壁纸与主屏幕完全独立，各有各的预设/自定义） */
  lockWallpaperPreset: string;
  /** 锁屏自定义壁纸的 ObjectURL（Blob 存 IndexedDB） */
  lockCustomWallpaperUrl: string | null;
  apiConfig: ApiConfig;
  /** 用户自己保存的 API 预设 */
  apiPresets: ApiPreset[];
  /** 识图模型配置（与 apiConfig 互相独立、互不覆盖；密文持久化） */
  visionConfig: VisionConfig;
  /** 用户自己保存的识图模型预设 */
  visionPresets: VisionPreset[];
  /** 锁屏密码配置（持久化） */
  lockConfig: LockConfig;
  /** 个人信息（头像/名字/标签，持久化） */
  profile: Profile;
  /** 自定义 App 图标（AppId → ObjectURL，Blob 存 IndexedDB settings.customIcons） */
  customIcons: Record<string, string>;
  loaded: boolean;

  load: () => Promise<void>;
  /** 锁屏总开关：关闭时同时停用密码并立即回到主屏幕 */
  setLockScreen: (on: boolean) => void;
  setTheme: (t: ThemeMode) => void;
  setWallpaperPreset: (id: string) => void;
  setCustomWallpaper: (blob: Blob | null) => void;
  /** 设置锁屏壁纸预设（独立于主屏幕壁纸） */
  setLockWallpaperPreset: (id: string) => void;
  /** 设置锁屏自定义壁纸（null=移除自定义，回退到锁屏已选预设） */
  setLockCustomWallpaper: (blob: Blob | null) => void;
  updateApiConfig: (patch: Partial<ApiConfig>) => void;
  setApiPresets: (list: ApiPreset[]) => void;
  /** 更新识图模型配置（立即持久化；聊天发送时现场读取 → 保存后自动生效，无需重启） */
  updateVisionConfig: (patch: Partial<VisionConfig>) => void;
  setVisionPresets: (list: VisionPreset[]) => void;
  applyLockConfig: (cfg: LockConfig) => void;
  /** 更新个人信息（立即持久化） */
  setProfile: (patch: Partial<Profile>) => void;
  /** 设置/移除某 App 的自定义图标（blob=null 恢复默认），同步持久化到 IndexedDB */
  setCustomIcon: (appId: AppId, blob: Blob | null) => void;
  /** 清空全部自定义图标（全部恢复默认） */
  resetAllCustomIcons: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  // 主题默认浅色（用户要求）；load 时无记录/一次性迁移后也回退到浅色
  theme: 'light',
  wallpaperPreset: 'graphite',
  customWallpaperUrl: null,
  lockWallpaperPreset: 'graphite',
  lockCustomWallpaperUrl: null,
  apiConfig: { ...DEFAULT_API_CONFIG },
  apiPresets: [],
  visionConfig: { ...DEFAULT_VISION_CONFIG },
  visionPresets: [],
  lockConfig: { lockScreen: true, enabled: false, code: '', len: 4 },
  profile: { ...DEFAULT_PROFILE },
  customIcons: {},
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const [themeRec, wallpaperRec, lockWallpaperRec, apiRec, presetsRec, visionRec, visionPresetsRec, lockRec, profileRec, iconsRec] = await Promise.all([
        localDB.get('settings', 'theme'),
        localDB.get('settings', 'wallpaper'),
        localDB.get('settings', 'lockWallpaper'),
        localDB.get('settings', 'apiConfig'),
        localDB.get('settings', 'apiPresets'),
        localDB.get('settings', 'visionConfig'),
        localDB.get('settings', 'visionPresets'),
        localDB.get('settings', 'lock'),
        localDB.get('settings', 'profile'),
        localDB.get('settings', 'customIcons'),
      ]);

      // 自定义 App 图标：{ AppId: Blob } → 为每个 Blob 建 ObjectURL
      let customIcons: Record<string, string> = {};
      if (iconsRec && typeof iconsRec.value === 'object' && iconsRec.value !== null) {
        for (const [k, v] of Object.entries(iconsRec.value as Record<string, unknown>)) {
          if (v instanceof Blob) customIcons[k] = URL.createObjectURL(v);
        }
      }

      let profile: Profile = { ...DEFAULT_PROFILE };
      if (profileRec && typeof profileRec.value === 'object' && profileRec.value !== null) {
        const v = profileRec.value as Partial<Profile>;
        profile = {
          name: typeof v.name === 'string' ? v.name : '',
          tag: typeof v.tag === 'string' ? v.tag : DEFAULT_PROFILE.tag,
          avatar:
            typeof v.avatar === 'string' && v.avatar.startsWith('data:image/') && v.avatar.length < 600_000
              ? v.avatar
              : null,
        };
      }

      let lockConfig: LockConfig = { lockScreen: true, enabled: false, code: '', len: 4 };
      if (lockRec && typeof lockRec.value === 'object' && lockRec.value !== null) {
        const v = lockRec.value as Partial<LockConfig>;
        lockConfig = {
          lockScreen: v.lockScreen !== false, // 旧记录无此字段 → 默认开启
          enabled: v.enabled === true,
          code: typeof v.code === 'string' ? v.code : '',
          len: v.len === 6 ? 6 : 4,
        };
      }

      // 主题默认浅色（用户要求）：无记录回退浅色；历史存储里的「深色」一次性重置为浅色
      //（否则用户之前测试时持久化的 dark 会让默认值改动不可见；重置后用户再手动切深色仍可保留）
      let theme: ThemeMode = 'light';
      if (themeRec && (themeRec.value === 'light' || themeRec.value === 'dark' || themeRec.value === 'auto')) {
        theme = themeRec.value;
      }
      const themeResetRec = await localDB.get('settings', 'themeDefaultLight');
      const themeReset = !themeResetRec;
      if (themeReset && theme === 'dark') {
        theme = 'light';
        void localDB.put('settings', { key: 'theme', value: 'light' });
      }
      if (themeReset) void localDB.put('settings', { key: 'themeDefaultLight', value: true });

      let wallpaperPreset = 'graphite';
      let customWallpaperUrl: string | null = null;
      if (wallpaperRec && typeof wallpaperRec.value === 'object' && wallpaperRec.value !== null) {
        const w = wallpaperRec.value as { preset?: unknown; customBlob?: unknown };
        if (w.customBlob instanceof Blob) {
          customWallpaperUrl = URL.createObjectURL(w.customBlob);
        } else if (typeof w.preset === 'string' && WALLPAPER_PRESETS.some((p) => p.id === w.preset)) {
          wallpaperPreset = w.preset;
        }
      }

      // 锁屏壁纸（完全独立，默认 graphite）：{ preset, customBlob } 同时记录，移除自定义后可回退到已选预设
      let lockWallpaperPreset = 'graphite';
      let lockCustomWallpaperUrl: string | null = null;
      if (lockWallpaperRec && typeof lockWallpaperRec.value === 'object' && lockWallpaperRec.value !== null) {
        const lw = lockWallpaperRec.value as LockWallpaperRecord;
        if (typeof lw.preset === 'string' && WALLPAPER_PRESETS.some((p) => p.id === lw.preset)) {
          lockWallpaperPreset = lw.preset;
        }
        if (lw.customBlob instanceof Blob) {
          lockCustomWallpaperUrl = URL.createObjectURL(lw.customBlob);
        }
      }

      let apiConfig: ApiConfig = { ...DEFAULT_API_CONFIG };
      if (apiRec && typeof apiRec.value === 'object' && apiRec.value !== null) {
        // 兼容：旧版明文记录 / 新版密文信封都从这里解出
        const v = ((await decryptValue<Partial<ApiConfig>>(apiRec.value)) ?? apiRec.value) as Partial<ApiConfig>;
        apiConfig = {
          baseUrl: typeof v.baseUrl === 'string' && v.baseUrl ? v.baseUrl : DEFAULT_API_CONFIG.baseUrl,
          apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
          model: typeof v.model === 'string' && v.model ? v.model : DEFAULT_API_CONFIG.model,
          temperature: typeof v.temperature === 'number' ? v.temperature : DEFAULT_API_CONFIG.temperature,
          maxTokens: typeof v.maxTokens === 'number' ? v.maxTokens : DEFAULT_API_CONFIG.maxTokens,
        };
        // 旧版明文静默升级：立即以密文回写（有 apiKey 才有必要；无 key 的占位配置不动）
        const wasPlain = !('__enc' in (apiRec.value as object));
        if (wasPlain && typeof apiConfig.apiKey === 'string' && apiConfig.apiKey.length > 0) {
          void encryptValue(apiConfig)
            .then((enc) => localDB.put('settings', { key: 'apiConfig', value: enc }))
            .catch(() => undefined);
        }
      }

      let apiPresets: ApiPreset[] = [];
      if (presetsRec && presetsRec.value) {
        // 兼容：旧版明文数组 / 新版密文信封
        const pv = (await decryptValue<ApiPreset[]>(presetsRec.value)) ?? presetsRec.value;
        if (Array.isArray(pv)) {
          apiPresets = pv.filter(
            (p): p is ApiPreset =>
              typeof p === 'object' &&
              p !== null &&
              typeof (p as ApiPreset).id === 'string' &&
              typeof (p as ApiPreset).name === 'string' &&
              typeof (p as ApiPreset).config === 'object'
          );
          // 旧版明文含 apiKey 时静默升级为密文
          const hasKey = apiPresets.some((p) => typeof p.config?.apiKey === 'string' && p.config.apiKey.length > 0);
          if (!('__enc' in (presetsRec.value as object)) && hasKey) {
            void encryptValue(apiPresets)
              .then((enc) => localDB.put('settings', { key: 'apiPresets', value: enc }))
              .catch(() => undefined);
          }
        }
      }

      // 识图模型配置（含 apiKey，密文信封，与 apiConfig 同策略；未配置 = baseUrl 空）
      let visionConfig: VisionConfig = { ...DEFAULT_VISION_CONFIG };
      if (visionRec && typeof visionRec.value === 'object' && visionRec.value !== null) {
        const v = ((await decryptValue<Partial<VisionConfig>>(visionRec.value)) ?? visionRec.value) as Partial<VisionConfig>;
        visionConfig = {
          baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl : '',
          apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
          model: typeof v.model === 'string' ? v.model : '',
        };
        const visionWasPlain = !('__enc' in (visionRec.value as object));
        if (visionWasPlain && visionConfig.apiKey.length > 0) {
          void encryptValue(visionConfig)
            .then((enc) => localDB.put('settings', { key: 'visionConfig', value: enc }))
            .catch(() => undefined);
        }
      }

      let visionPresets: VisionPreset[] = [];
      if (visionPresetsRec && visionPresetsRec.value) {
        const vv = (await decryptValue<VisionPreset[]>(visionPresetsRec.value)) ?? visionPresetsRec.value;
        if (Array.isArray(vv)) {
          visionPresets = vv.filter(
            (p): p is VisionPreset =>
              typeof p === 'object' &&
              p !== null &&
              typeof (p as VisionPreset).id === 'string' &&
              typeof (p as VisionPreset).name === 'string' &&
              typeof (p as VisionPreset).config === 'object'
          );
          const visionHasKey = visionPresets.some((p) => typeof p.config?.apiKey === 'string' && p.config.apiKey.length > 0);
          if (!('__enc' in (visionPresetsRec.value as object)) && visionHasKey) {
            void encryptValue(visionPresets)
              .then((enc) => localDB.put('settings', { key: 'visionPresets', value: enc }))
              .catch(() => undefined);
          }
        }
      }

      set({
        theme,
        wallpaperPreset,
        customWallpaperUrl,
        lockWallpaperPreset,
        lockCustomWallpaperUrl,
        apiConfig,
        apiPresets,
        visionConfig,
        visionPresets,
        lockConfig,
        profile,
        customIcons,
        loaded: true,
      });
      // 锁屏被用户关闭：本次开机直接进主屏幕（跳过锁屏）
      if (!lockConfig.lockScreen) useUI.setState({ locked: false });
    } catch {
      set({ loaded: true });
    }
  },

  setLockScreen: (on) => {
    const cur = get().lockConfig;
    const cfg: LockConfig = on
      ? { ...cur, lockScreen: true }
      : { lockScreen: false, enabled: false, code: '', len: cur.len }; // 关锁屏即停用密码
    set({ lockConfig: cfg });
    void localDB.put('settings', { key: 'lock', value: { ...cfg } });
    if (!on) useUI.setState({ locked: false, screenOff: false, lockCameraOpen: false, torchOpen: false });
  },

  setTheme: (t) => {
    set({ theme: t });
    void localDB.put('settings', { key: 'theme', value: t });
  },

  setWallpaperPreset: (id) => {
    const old = get().customWallpaperUrl;
    if (old) URL.revokeObjectURL(old);
    set({ wallpaperPreset: id, customWallpaperUrl: null });
    void localDB.put('settings', { key: 'wallpaper', value: { preset: id } });
  },

  setCustomWallpaper: (blob) => {
    const old = get().customWallpaperUrl;
    if (old) URL.revokeObjectURL(old);
    if (!blob) {
      set({ customWallpaperUrl: null });
      void localDB.put('settings', { key: 'wallpaper', value: { preset: get().wallpaperPreset } });
      return;
    }
    const url = URL.createObjectURL(blob);
    set({ customWallpaperUrl: url });
    void localDB.put('settings', { key: 'wallpaper', value: { customBlob: blob } });
  },

  setLockWallpaperPreset: (id) => {
    const old = get().lockCustomWallpaperUrl;
    if (old) URL.revokeObjectURL(old);
    set({ lockWallpaperPreset: id, lockCustomWallpaperUrl: null });
    void localDB.put('settings', { key: 'lockWallpaper', value: { preset: id } });
  },

  setLockCustomWallpaper: (blob) => {
    const old = get().lockCustomWallpaperUrl;
    if (old) URL.revokeObjectURL(old);
    const preset = get().lockWallpaperPreset;
    if (!blob) {
      set({ lockCustomWallpaperUrl: null });
      void localDB.put('settings', { key: 'lockWallpaper', value: { preset } });
      return;
    }
    const url = URL.createObjectURL(blob);
    set({ lockCustomWallpaperUrl: url });
    void localDB.put('settings', { key: 'lockWallpaper', value: { preset, customBlob: blob } });
  },

  updateApiConfig: (patch) => {
    const apiConfig = { ...get().apiConfig, ...patch };
    set({ apiConfig });
    // 安全：含 apiKey，密文落盘（AES-GCM 非可提取密钥），IndexedDB 不存明文
    void encryptValue(apiConfig)
      .then((v) => localDB.put('settings', { key: 'apiConfig', value: v }))
      .catch(() => undefined);
  },

  setApiPresets: (list) => {
    set({ apiPresets: list });
    // 安全：预设的 config 可能含 apiKey，同样密文落盘
    void encryptValue(list)
      .then((v) => localDB.put('settings', { key: 'apiPresets', value: v }))
      .catch(() => undefined);
  },

  updateVisionConfig: (patch) => {
    const visionConfig = { ...get().visionConfig, ...patch };
    set({ visionConfig });
    // 安全：含 apiKey，密文落盘（与 apiConfig 同策略）
    void encryptValue(visionConfig)
      .then((v) => localDB.put('settings', { key: 'visionConfig', value: v }))
      .catch(() => undefined);
  },

  setVisionPresets: (list) => {
    set({ visionPresets: list });
    void encryptValue(list)
      .then((v) => localDB.put('settings', { key: 'visionPresets', value: v }))
      .catch(() => undefined);
  },

  applyLockConfig: (cfg) => {
    set({ lockConfig: { ...cfg } });
    void localDB.put('settings', { key: 'lock', value: { ...cfg } });
  },

  setProfile: (patch) => {
    const profile = { ...get().profile, ...patch };
    set({ profile });
    void localDB.put('settings', { key: 'profile', value: profile });
  },

  setCustomIcon: (appId, blob) => {
    set((s) => {
      const urls = { ...s.customIcons };
      if (blob) urls[appId] = URL.createObjectURL(blob);
      else delete urls[appId];
      return { customIcons: urls };
    });
    // 持久化：读出完整 Blob 映射，改完写回（store 内只保留 ObjectURL）
    void (async () => {
      try {
        const rec = await localDB.get('settings', 'customIcons');
        const value: Record<string, Blob> = {};
        if (rec && typeof rec.value === 'object' && rec.value !== null) {
          for (const [k, v] of Object.entries(rec.value as Record<string, unknown>)) {
            if (v instanceof Blob) value[k] = v;
          }
        }
        if (blob) value[appId] = blob;
        else delete value[appId];
        await localDB.put('settings', { key: 'customIcons', value });
      } catch {
        /* 持久化失败忽略：本次会话内仍生效 */
      }
    })();
  },

  resetAllCustomIcons: () => {
    for (const u of Object.values(get().customIcons)) URL.revokeObjectURL(u);
    set({ customIcons: {} });
    void localDB.put('settings', { key: 'customIcons', value: {} });
  },
}));

/** 解析后的实际主题（auto 跟随系统） */
export function selectResolvedTheme(theme: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (theme === 'auto') return systemDark ? 'dark' : 'light';
  return theme;
}

/** 由预设 id + 自定义 URL 解析壁纸背景样式（手机壳/锁屏/前景明暗共用，故导出）。
 *  自定义优先；预设 css 可能是 background 简写，需拆解。
 *  始终带 backgroundColor 底色：PNG 壁纸异步加载/解码前先铺不透明纯色，
 *  否则锁屏/主屏头几帧透明，会透出下层界面（刷新时主界面一闪而过的根因） */
export function resolveWallpaperStyle(presetId: string, customUrl: string | null): CSSProperties {
  if (customUrl) {
    return {
      backgroundColor: '#1c1c1e',
      backgroundImage: `url(${customUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  const preset = WALLPAPER_PRESETS.find((w) => w.id === presetId) ?? WALLPAPER_PRESETS[0];
  // 预设 css 可能是 background 简写（如 "url(...) center / cover no-repeat"），
  // 不能整体赋给 backgroundImage（浏览器会丢弃整条声明），需拆解
  if (preset.css.startsWith('url(')) {
    const end = preset.css.indexOf(')');
    const url = end > 4 ? preset.css.slice(4, end) : '';
    return {
      backgroundColor: preset.base,
      backgroundImage: `url(${url})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return { backgroundColor: preset.base, backgroundImage: preset.css };
}

/** 主屏幕壁纸背景样式（手机壳用）。锁屏/前景明暗实测也需要它，故导出 */
export function useWallpaperStyle(): CSSProperties {
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  return useMemo(
    () => resolveWallpaperStyle(wallpaperPreset, customWallpaperUrl),
    [customWallpaperUrl, wallpaperPreset]
  );
}

/**
 * 锁屏壁纸（样式 + 明暗）：锁屏壁纸与主屏幕壁纸完全独立，永远用自己的预设/自定义，
 * 不再跟随主屏幕。手机壳壁纸层是主屏幕壁纸，锁屏自绘壁纸层盖住主屏幕。
 */
export function useLockWallpaper(): { style: CSSProperties; light: boolean } {
  const lockPreset = useSettings((s) => s.lockWallpaperPreset);
  const lockCustom = useSettings((s) => s.lockCustomWallpaperUrl);
  return useMemo(() => {
    if (lockCustom) {
      return {
        style: {
          // 底色兜底：Blob 图片异步解码前先铺不透明纯色，避免锁屏头几帧透出主屏幕（闪烁根因之一）
          backgroundColor: '#1c1c1e',
          backgroundImage: `url(${lockCustom})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } as CSSProperties,
        light: false, // 自定义壁纸按深色处理（与主屏逻辑一致）
      };
    }
    const preset = WALLPAPER_PRESETS.find((w) => w.id === lockPreset);
    return {
      style: resolveWallpaperStyle(preset?.id ?? WALLPAPER_PRESETS[0].id, null),
      light: preset?.light ?? false,
    };
  }, [lockCustom, lockPreset]);
}

// ---------------- 壁纸亮度实测（锁屏文字跟随背景色） ----------------

/** 区域平均亮度高于该值视为偏浅（该区域文字用黑色） */
const LIGHT_LUMINANCE_THRESHOLD = 0.5;

/** 图片壁纸亮度实测结果的模块级缓存（url → 三区域结果）：
 *  同一张壁纸被多处独立 hook消费（图标底座 ×N / 锁屏 / 状态栏 / 页点），
 *  共享缓存避免每个实例重复解码测量；后挂载的实例（如打开 Spotlight/多任务）
 *  首帧即命中，不会闪「测量中回退静态标记」的错误颜色。上限 32 条防泄漏 */
const wallpaperLightCache = new Map<string, { top: boolean; bottom: boolean; all: boolean }>();
const WALLPAPER_LIGHT_CACHE_MAX = 32;

export interface WallpaperLightness {
  /** 顶部区域（状态栏/日期/大时钟/小组件，0–35%）是否偏浅：true=用黑字 */
  top: boolean | null;
  /** 底部区域（上滑提示/快捷按钮/Home 横杠，86–100%）是否偏浅：true=用黑字 */
  bottom: boolean | null;
  /** 整体平均亮度是否偏浅（主屏图标标签/页点分布在全屏，用整体判定）：true=用黑字 */
  all: boolean | null;
}

/** 从 backgroundImage 里提取第一张 url(...) 的图片地址 */
function bgImageUrlOf(bgImage: string): string | null {
  const m = bgImage.match(/url\((['"]?)([^'")]+)\1\)/);
  return m ? m[2] : null;
}

/** 解析 CSS 颜色为 [r,g,b]（支持 #rgb/#rrggbb/#rrggbbaa 与 rgb()/rgba()） */
function parseCssColor(input: string): [number, number, number] | null {
  const s = input.trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
    return null;
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

function luminanceOf([r, g, b]: [number, number, number]): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * 分区域实测壁纸亮度（锁屏文字随背景变色）：
 * - 图片壁纸：解码后缩到 32×64 逐行取 Rec.709 亮度，顶部 0–35%（状态栏/时钟/小组件）与
 *   底部 86–100%（上滑提示/快捷按钮/Home 横杠）分别求均值 —— 解决「上亮下暗」壁纸
 *   （如雾山上白山+下深林）一刀切判色导致某端文字看不清的问题；
 * - 纯色/渐变壁纸：解析样式里的色值，按出现顺序（渐变自上而下）前半=顶/后半=底；
 * 返回 true=偏浅（黑字）/ false=偏深（白字）/ null=测量中或失败（调用方回退预设静态标记）。
 */
export function useMeasuredWallpaperLight(style: CSSProperties): WallpaperLightness {
  const bgImage = typeof style.backgroundImage === 'string' ? style.backgroundImage : '';
  const bgColor = typeof style.backgroundColor === 'string' ? style.backgroundColor : '';
  const url = useMemo(() => bgImageUrlOf(bgImage), [bgImage]);

  // 纯色/渐变壁纸：同步纯函数推导
  const colorLight = useMemo<WallpaperLightness>(() => {
    if (url) return { top: null, bottom: null, all: null }; // 图片壁纸走异步实测
    const tokens = `${bgColor} ${bgImage}`.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g) ?? [];
    const lums = tokens
      .map(parseCssColor)
      .filter((c): c is [number, number, number] => c !== null)
      .map(luminanceOf);
    if (lums.length === 0) return { top: null, bottom: null, all: null };
    const half = Math.max(1, Math.ceil(lums.length / 2));
    const avg = (arr: number[]) => arr.reduce((acc, v) => acc + v, 0) / arr.length;
    return {
      top: avg(lums.slice(0, half)) > LIGHT_LUMINANCE_THRESHOLD,
      bottom: avg(lums.slice(Math.max(0, lums.length - half))) > LIGHT_LUMINANCE_THRESHOLD,
      all: avg(lums) > LIGHT_LUMINANCE_THRESHOLD,
    };
  }, [bgColor, bgImage, url]);

  // 图片壁纸：解码后异步实测。结果绑定当时的 url，防止换壁纸瞬间新旧串值
  const [imgState, setImgState] = useState<{ url: string; top: boolean; bottom: boolean; all: boolean } | null>(null);
  useEffect(() => {
    if (!url) return;
    // 共享缓存已命中：渲染时已同步消费，无需重复解码测量
    if (wallpaperLightCache.has(url)) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      try {
        const W = 32;
        const H = 64;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return; // 保持 null → 回退静态标记
        ctx.drawImage(img, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);
        const rowLum: number[] = [];
        for (let y = 0; y < H; y++) {
          let sum = 0;
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            sum += luminanceOf([data[i], data[i + 1], data[i + 2]]);
          }
          rowLum.push(sum / W);
        }
        const avgRows = (a: number, b: number) => {
          let sum = 0;
          for (let y = a; y < b; y++) sum += rowLum[y];
          return sum / (b - a);
        };
        const result = {
          top: avgRows(0, Math.floor(H * 0.35)) > LIGHT_LUMINANCE_THRESHOLD,
          bottom: avgRows(Math.floor(H * 0.86), H) > LIGHT_LUMINANCE_THRESHOLD,
          all: avgRows(0, H) > LIGHT_LUMINANCE_THRESHOLD,
        };
        // 写入共享缓存（简单上限淘汰，防长会话换壁纸累积泄漏）
        if (wallpaperLightCache.size >= WALLPAPER_LIGHT_CACHE_MAX) {
          wallpaperLightCache.delete(wallpaperLightCache.keys().next().value as string);
        }
        wallpaperLightCache.set(url, result);
        setImgState({ url, ...result });
      } catch {
        // 画布被污染等异常：保持 null 回退静态标记
      }
    };
    img.onerror = () => {
      if (!cancelled) setImgState(null);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (url) {
    // 共享缓存命中：同步返回（后挂载的图标/多任务/Spotlight 首帧即拿到结果，
    // 不闪「测量中回退静态标记」的错误颜色，也避免 effect 内 setState）
    const cached = wallpaperLightCache.get(url);
    if (cached) return cached;
    return imgState && imgState.url === url
      ? { top: imgState.top, bottom: imgState.bottom, all: imgState.all }
      : { top: null, bottom: null, all: null };
  }
  return colorLight;
}

const darkMQ =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** 是否为系统深色模式（useSyncExternalStore 安全订阅） */
export function useSystemDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (!darkMQ) return () => undefined;
      darkMQ.addEventListener('change', onChange);
      return () => darkMQ.removeEventListener('change', onChange);
    },
    () => darkMQ?.matches ?? false,
    () => false
  );
}

// ---------------- UI Store ----------------

export type AppId =
  | 'chat'
  | 'wechat'
  | 'qq'
  | 'phone'
  | 'photos'
  | 'camera'
  | 'music'
  | 'browser'
  | 'weather'
  | 'clock'
  | 'themes'
  | 'files'
  | 'reminders'
  | 'calculator'
  | 'notes'
  | 'calendar'
  | 'recorder'
  | 'contacts'
  | 'settings'
  | 'appstore'
  | 'memory'
  | 'worldbook';

export type AppPhase = 'closed' | 'opening' | 'open' | 'closing';

/** 多任务卡片上限（最新在前） */
const MAX_RECENT_APPS = 6;

interface UIState {
  activeApp: AppId | null;
  phase: AppPhase;
  /** 最近使用过的 App（多任务切换器卡片，最新在前；关闭 App 仍保留在后台） */
  recentApps: AppId[];
  /** 多任务切换器是否打开（可在主屏幕或任一 App 内打开） */
  switcherOpen: boolean;
  /** 锁屏是否激活（页面加载即锁定；锁定时覆盖全部交互） */
  locked: boolean;
  /** 熄屏（电源键：亮屏锁定 ↔ 熄屏，黑屏遮罩） */
  screenOff: boolean;
  /** 锁屏直达相机（不解锁，关闭相机回锁屏） */
  lockCameraOpen: boolean;
  /** 锁屏手电筒补光开启（全屏白，前景需转黑） */
  torchOpen: boolean;
  /** 闹钟响铃弹层全屏显示中（背景色，前景随主题） */
  alarmRinging: boolean;
  /** 电话 App 通话全屏层显示中（深色背景，状态栏/Home 横杠需白前景） */
  callActive: boolean;
  /** 主屏幕编辑（抖动）模式进行中：底部边缘上滑手势不触发多任务切换器 */
  homeEdit: boolean;
  openApp: (id: AppId) => void;
  closeApp: () => void;
  openSwitcher: () => void;
  closeSwitcher: () => void;
  /** 切换器关闭动画期间先把前台 App 退到后台（立即露出主屏幕） */
  exitForegroundApp: () => void;
  /** 在切换器里点卡片：切到该 App（无论当前是否已有 App 在前台） */
  switchToApp: (id: AppId) => void;
  /** 在切换器里上滑卡片：彻底关闭该 App（若是前台 App 则一并退出） */
  killApp: (id: AppId) => void;
  /** 解锁（锁屏上滑验证通过） */
  unlock: () => void;
  /** 立即锁定（关闭一切 App/切换器/锁屏相机，回到锁屏） */
  lock: () => void;
  /** 电源键：熄屏 ↔ 亮屏锁定 */
  pressPower: () => void;
  setLockCameraOpen: (v: boolean) => void;
  setTorchOpen: (v: boolean) => void;
  setAlarmRinging: (v: boolean) => void;
  setCallActive: (v: boolean) => void;
  /** 跨 App 跳转：电话 App 联系人详情点「信息」→ 打开信息 App 后自动进入该联系人会话（相当于添加好友），消费后置回 null */
  pendingChatContact: string | null;
  setPendingChatContact: (id: string | null) => void;
  /** 跨 App 跳转：QQ 好友资料页「编辑资料」/ 微信好友详情页「朋友资料」→ 打开联系人 App 后直接进入该联系人的编辑页，消费后置回 null */
  pendingContactEdit: string | null;
  setPendingContactEdit: (id: string | null) => void;
}

export const useUI = create<UIState>((set, get) => ({
  activeApp: null,
  phase: 'closed',
  recentApps: [],
  switcherOpen: false,
  locked: true,
  screenOff: false,
  lockCameraOpen: false,
  torchOpen: false,
  alarmRinging: false,
  callActive: false,
  homeEdit: false,
  pendingChatContact: null,
  setPendingChatContact: (v) => {
    set({ pendingChatContact: v });
  },
  pendingContactEdit: null,
  setPendingContactEdit: (v) => {
    set({ pendingContactEdit: v });
  },
  openApp: (id) => {
    if (get().locked) return; // 锁屏时禁止打开 App（锁屏直达相机走 lockCameraOpen）
    if (get().activeApp || get().phase !== 'closed') return;
    set({
      activeApp: id,
      phase: 'opening',
      switcherOpen: false,
      recentApps: [id, ...get().recentApps.filter((a) => a !== id)].slice(0, MAX_RECENT_APPS),
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (useUI.getState().phase === 'opening') set({ phase: 'open' });
      });
    });
  },
  closeApp: () => {
    if (get().locked) return;
    if (!get().activeApp || get().phase === 'closing') return;
    set({ phase: 'closing' });
    window.setTimeout(() => {
      if (useUI.getState().phase === 'closing') set({ activeApp: null, phase: 'closed' });
    }, 380);
  },
  openSwitcher: () => {
    // 主屏幕或 App 内都可打开（打开/关闭动画进行中除外；锁定时禁止）
    if (get().locked) return;
    if (get().switcherOpen || get().phase === 'opening' || get().phase === 'closing') return;
    set({ switcherOpen: true });
  },
  closeSwitcher: () => {
    if (get().switcherOpen) set({ switcherOpen: false });
  },
  exitForegroundApp: () => {
    if (get().activeApp) set({ activeApp: null, phase: 'closed' });
  },
  switchToApp: (id) => {
    if (get().locked) return;
    set({
      activeApp: id,
      phase: 'open',
      switcherOpen: false,
      recentApps: [id, ...get().recentApps.filter((a) => a !== id)].slice(0, MAX_RECENT_APPS),
    });
  },
  killApp: (id) => {
    const patch: Partial<UIState> = { recentApps: get().recentApps.filter((a) => a !== id) };
    if (get().activeApp === id) {
      patch.activeApp = null;
      patch.phase = 'closed';
    }
    set(patch);
  },
  unlock: () => {
    set({ locked: false, screenOff: false, lockCameraOpen: false, torchOpen: false });
  },
  lock: () => {
    set({
      locked: true,
      screenOff: false,
      lockCameraOpen: false,
      torchOpen: false,
      activeApp: null,
      phase: 'closed',
      switcherOpen: false,
    });
  },
  pressPower: () => {
    const s = get();
    const lockScreen = useSettings.getState().lockConfig.lockScreen;
    if (s.screenOff) {
      // 熄屏 → 亮屏：有锁屏回锁定界面；无锁屏保持原界面
      set(lockScreen ? { screenOff: false, locked: true } : { screenOff: false });
    } else if (lockScreen) {
      // 熄屏并锁定（退出一切前台界面）
      set({
        screenOff: true,
        locked: true,
        lockCameraOpen: false,
        torchOpen: false,
        activeApp: null,
        phase: 'closed',
        switcherOpen: false,
      });
    } else {
      // 无锁屏：仅熄屏，保留当前界面
      set({ screenOff: true });
    }
  },
  setLockCameraOpen: (v) => {
    set({ lockCameraOpen: v });
  },
  setTorchOpen: (v) => {
    set({ torchOpen: v });
  },
  setAlarmRinging: (v) => {
    set({ alarmRinging: v });
  },
  setCallActive: (v) => {
    set({ callActive: v });
  },
}));

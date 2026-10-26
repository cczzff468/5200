'use client';

/**
 * 拾光小屋 顶栏（返回/拍照 · TA 的心 · 宠物头像 · 装修入口 · ⋮ 更多菜单）
 * 从 CoupleHome.tsx 原样搬移，行为零变化。
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Heart,
  Moon,
  MoreVertical,
  Pencil,
  Sparkles,
  Sun,
  Users,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { CatFaceIcon, DogFaceIcon, RabbitFaceIcon } from '../lib/home-core';
import type { ContactRecord } from '@/lib/contacts';
import type { HomeMode, PetState } from '../types';

export interface TopBarProps {
  mode: HomeMode;
  night: boolean;
  nightAuto: boolean;
  sfxOn: boolean;
  voiceOn: boolean;
  ambientOn: boolean;
  fp: boolean;
  moreOpen: boolean;
  heartOpen: boolean;
  petPanel: boolean;
  companion: ContactRecord | null;
  /** 当前互动宠物（猫 = 缺 kind；领养宠物带 dog/rabbit） */
  activePetName: string;
  activePetIdx: number;
  activePetObj: PetState;
  petsCount: number;
  onClose: () => void;
  onPhotoMode: () => void;
  /** 装修小家 / 完成：switchMode(mode === 'live' ? 'edit' : 'live') */
  onSwitchMode: () => void;
  onToggleHeart: () => void;
  onRotatePet: () => void;
  onToggleMore: () => void;
  onToggleNight: () => void;
  onEnableAutoNight: () => void;
  onToggleSfx: () => void;
  onToggleFp: () => void;
  onToggleVoice: () => void;
  onToggleAmbient: () => void;
  onOpenTaDiary: () => void;
  onOpenStats: () => void;
  onOpenHeart: () => void;
  onOpenPicker: () => void;
}

export default function TopBar({
  mode,
  night,
  nightAuto,
  sfxOn,
  voiceOn,
  ambientOn,
  fp,
  moreOpen,
  heartOpen,
  petPanel,
  companion,
  activePetName,
  activePetIdx,
  activePetObj,
  petsCount,
  onClose,
  onPhotoMode,
  onSwitchMode,
  onToggleHeart,
  onRotatePet,
  onToggleMore,
  onToggleNight,
  onEnableAutoNight,
  onToggleSfx,
  onToggleFp,
  onToggleVoice,
  onToggleAmbient,
  onOpenTaDiary,
  onOpenStats,
  onOpenHeart,
  onOpenPicker,
}: TopBarProps) {
  return (
    <div className="relative z-20 flex items-start justify-between p-3 pt-11">
      {/* 左列：返回 + 拍照（v7.0 相机按钮移到返回键下方） */}
      <div className="pointer-events-auto flex flex-col gap-2">
        <button
          onClick={onClose}
          aria-label="返回"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#5a5a5e] shadow-sm backdrop-blur transition active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={onPhotoMode}
          aria-label="拍照模式"
          title="拍照模式"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#5a5a5e] shadow-sm backdrop-blur transition active:scale-95"
        >
          <Camera className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* v10.3 TA 的心（宠物头像左侧独立按钮）：甜度/情绪/需求一览 */}
        <button
          onClick={onToggleHeart}
          aria-label="TA 的心"
          aria-expanded={heartOpen}
          title="TA 的心：甜度 / 情绪 / 需求"
          className={
            heartOpen
              ? 'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#e88a9a] text-white shadow-md backdrop-blur transition active:scale-95'
              : 'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#e88a9a] shadow-sm backdrop-blur transition active:scale-95'
          }
        >
          <Heart className="h-[18px] w-[18px]" />
        </button>
        {/* v9 宠物头像（装修小家左侧 · 白玻璃圆钮）：点击轮换宠物（团子 → 领养的狗狗/兔兔 → 团子…）并唤出当前这只的状态面板；状态偏低时亮提醒小红点 */}
        <button
          onClick={onRotatePet}
          aria-label={`${activePetName}状态面板（点按切换宠物）`}
          aria-expanded={petPanel}
          className={`pointer-events-auto relative flex h-10 w-10 items-center justify-center rounded-full bg-white/75 shadow-md ring-2 backdrop-blur transition active:scale-95 ${
            petPanel ? 'ring-[#e46a6a]' : 'ring-[#f4b3c2]'
          }`}
        >
          {activePetIdx < 0 ? (
            <CatFaceIcon className="h-7 w-7 drop-shadow-sm" />
          ) : activePetObj.kind === 'dog' ? (
            <DogFaceIcon className="h-7 w-7 drop-shadow-sm" />
          ) : (
            <RabbitFaceIcon className="h-7 w-7 drop-shadow-sm" />
          )}
          {petsCount > 0 && (
            <span aria-hidden="true" className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#e8b06a] px-0.5 text-[8.5px] font-bold leading-none text-white ring-2 ring-white/90">
              {petsCount + 1}
            </span>
          )}
          {(activePetObj.st < 30 || activePetObj.cl < 30 || activePetObj.mo < 30) && (
            <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-[#ff7a59] ring-2 ring-white/90" />
          )}
        </button>
        {/* 装修小家 / 完成（右上角入口） */}
        <button
          onClick={onSwitchMode}
          aria-label={mode === 'live' ? '装修小家' : '完成装修'}
          className={
            mode === 'live'
              ? 'pointer-events-auto flex h-10 items-center gap-1.5 rounded-full bg-[#f4b3c2] px-3.5 text-[13px] font-semibold text-white shadow-md shadow-[#f4b3c2]/40 transition active:scale-95'
              : 'pointer-events-auto flex h-10 items-center gap-1.5 rounded-full bg-[#8fce9e] px-3.5 text-[13px] font-semibold text-white shadow-md shadow-[#8fce9e]/40 transition active:scale-95'
          }
        >
          {mode === 'live' ? <Pencil className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {mode === 'live' ? '装修小家' : '完成'}
        </button>
        {/* ⋮ 更多菜单：时间变化 / 声音开关 / 视角 */}
        <div className="pointer-events-auto relative">
          <button
            onClick={onToggleMore}
            aria-label="更多设置"
            aria-expanded={moreOpen}
            title="更多设置"
            className={
              moreOpen
                ? 'flex h-10 w-10 items-center justify-center rounded-full bg-[#3a3a3e]/80 text-white shadow-sm backdrop-blur transition active:scale-95'
                : 'flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#5a5a5e] shadow-sm backdrop-blur transition active:scale-95'
            }
          >
            <MoreVertical className="h-[18px] w-[18px]" />
          </button>
          <AnimatePresence>
            {moreOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                transition={{ type: 'spring', damping: 28, stiffness: 400 }}
                className="absolute right-0 top-12 z-50 w-[218px] origin-top-right overflow-hidden rounded-2xl bg-white/95 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl"
              >
                {/* 时间变化：手动切白天 / 夜晚 */}
                <button
                  onClick={onToggleNight}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  {night ? <Moon className="h-4 w-4 shrink-0 text-[#8a7ab0]" /> : <Sun className="h-4 w-4 shrink-0 text-[#e0a458]" />}
                  <span className="flex-1 text-left">{night ? '切换到白天' : '切换到夜晚'}</span>
                  <span className="text-[11px] text-[#b0aeb4]">{night ? '夜晚' : '白天'}</span>
                </button>
                {/* 时间变化：昼夜跟随真实时间（19点~6点为夜晚） */}
                <button
                  onClick={onEnableAutoNight}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  <Clock className="h-4 w-4 shrink-0 text-[#7fa8c9]" />
                  <span className="flex-1 text-left">昼夜跟随现实</span>
                  {nightAuto ? (
                    <span className="rounded-full bg-[#dff0e2] px-2 py-0.5 text-[10px] font-semibold text-[#3f9a58]">已开启</span>
                  ) : (
                    <span className="text-[11px] text-[#b0aeb4]">关</span>
                  )}
                </button>
                <div className="mx-2.5 my-1 h-px bg-[#f0eeea]" />
                {/* 声音开关 */}
                <button
                  onClick={onToggleSfx}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  {sfxOn ? <Volume2 className="h-4 w-4 shrink-0 text-[#6a8a6a]" /> : <VolumeX className="h-4 w-4 shrink-0 text-[#b09a9a]" />}
                  <span className="flex-1 text-left">音效</span>
                  {sfxOn ? (
                    <span className="rounded-full bg-[#dff0e2] px-2 py-0.5 text-[10px] font-semibold text-[#3f9a58]">已开</span>
                  ) : (
                    <span className="rounded-full bg-[#f0eff1] px-2 py-0.5 text-[10px] font-semibold text-[#8a8a90]">已关</span>
                  )}
                </button>
                {/* 视角：第一 / 第三人称 */}
                <button
                  onClick={onToggleFp}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  {fp ? <Eye className="h-4 w-4 shrink-0 text-[#c99a5b]" /> : <Users className="h-4 w-4 shrink-0 text-[#c99a5b]" />}
                  <span className="flex-1 text-left">视角</span>
                  <span className="text-[11px] text-[#b0aeb4]">{fp ? '第一人称' : '第三人称'}</span>
                </button>
                {/* v8.0 小人声音开关：开 = 男生小人开口说话（TTS 播报），关 = 只显示文字气泡 */}
                <div className="mx-2.5 my-1 h-px bg-[#f0eeea]" />
                <button
                  onClick={onToggleVoice}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  {voiceOn ? <Volume2 className="h-4 w-4 shrink-0 text-[#6a8a6a]" /> : <VolumeX className="h-4 w-4 shrink-0 text-[#b09a9a]" />}
                  <span className="flex-1 text-left">小人声音</span>
                  {voiceOn ? (
                    <span className="rounded-full bg-[#dff0e2] px-2 py-0.5 text-[10px] font-semibold text-[#3f9a58]">已开</span>
                  ) : (
                    <span className="rounded-full bg-[#f0eff1] px-2 py-0.5 text-[10px] font-semibold text-[#8a8a90]">已关</span>
                  )}
                </button>
                {/* v11 G2 环境音效开关：开 = 跟天气/壁炉智能联动（雨→雨声 / 雪→风声 / 壁炉→炉火），关 = 恒静 */}
                <div className="mx-2.5 my-1 h-px bg-[#f0eeea]" />
                <button
                  onClick={onToggleAmbient}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  <Waves className="h-4 w-4 shrink-0 text-[#6a9ab0]" />
                  <span className="flex-1 text-left">环境音效</span>
                  {ambientOn ? (
                    <span className="rounded-full bg-[#dff0e2] px-2 py-0.5 text-[10px] font-semibold text-[#3f9a58]">已开</span>
                  ) : (
                    <span className="rounded-full bg-[#f0eff1] px-2 py-0.5 text-[10px] font-semibold text-[#8a8a90]">已关</span>
                  )}
                </button>
                {/* v11 F2 TA 的日记：TA 每天自己写一篇，抽屉翻阅 */}
                <button
                  onClick={onOpenTaDiary}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  <BookOpen className="h-4 w-4 shrink-0 text-[#c9a58a]" />
                  <span className="flex-1 text-left">TA 的日记</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#d8cfc4]" />
                </button>
                {/* v11 I2 我们的里程碑：在一起天数/聊天/做饭/拥抱/牵手/照顾宠物 */}
                <button
                  onClick={onOpenStats}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  <Sparkles className="h-4 w-4 shrink-0 text-[#b89ad4]" />
                  <span className="flex-1 text-left">我们的里程碑</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#d8cfc4]" />
                </button>
                {/* v10.3 TA 的心：移到顶栏爱心按钮独立面板（此处保留入口行） */}
                <button
                  onClick={onOpenHeart}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  <Heart className="h-4 w-4 shrink-0 text-[#e88a9a]" />
                  <span className="flex-1 text-left">TA 的心 · 甜度 / 情绪 / 需求</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#d8cfc4]" />
                </button>
                {/* v8.0 换个TA：重弹陪伴角色选择列表 */}
                <button
                  onClick={onOpenPicker}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                >
                  <Heart className="h-4 w-4 shrink-0 text-[#e8a3b3]" />
                  <span className="flex-1 text-left">换个TA陪伴</span>
                  <span className="truncate text-[11px] text-[#b0aeb4]">{companion?.name ?? '未选择'}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

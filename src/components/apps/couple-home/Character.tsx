'use client';

/**
 * 情侣小家 —— 小人（2.5D 定向纸片人）
 *
 * - 贴图：AI 生成 Adorable Home 式 Q 版小人 ×（我=男生 / TA=女生）×（正面/背面/侧面）
 * - 朝向映射：up→背面（远离镜头）/ down→正面（朝镜头）/ left→左侧面 / right=左侧面镜像
 * - 走路动画：CSS bob（上下轻弹 + 微倾斜），贴图单帧 + 摆动足够可爱
 * - 脚下椭圆阴影贴地；zIndex = round(y) 参与世界深度排序
 */

import { memo } from 'react';
import type { CharState } from './types';
import { CHAR_H } from './catalog';

const SHEET: Record<'me' | 'partner', { front: string; back: string; side: string }> = {
  me: {
    front: '/home/chars/me_front.webp',
    back: '/home/chars/me_back.webp',
    side: '/home/chars/me_side.webp',
  },
  partner: {
    front: '/home/chars/ta_front.webp',
    back: '/home/chars/ta_back.webp',
    side: '/home/chars/ta_side.webp',
  },
};

export interface CharacterProps {
  ch: CharState;
  /** 编辑模式下隐藏小人（上帝视角装修） */
  hidden?: boolean;
}

function CharacterInner({ ch, hidden }: CharacterProps) {
  if (hidden) return null;
  const sheet = SHEET[ch.id];
  const isSide = ch.dir === 'left' || ch.dir === 'right';
  const src = ch.dir === 'up' ? sheet.back : ch.dir === 'down' ? sheet.front : sheet.side;
  const flip = ch.dir === 'right';

  return (
    <div
      aria-label={ch.id === 'me' ? '我' : 'TA'}
      className="absolute select-none"
      style={{
        left: ch.x,
        top: ch.y,
        transform: 'translate(-50%, -100%)',
        zIndex: Math.round(ch.y) + 5,
        height: CHAR_H,
        width: (CHAR_H * 3) / 4, // 宽按 3:4 纵横比预留，img 自身等比缩放居中
        visibility: hidden ? 'hidden' : undefined,
      }}
    >
      {/* 脚下阴影（贴地椭圆，不随走路帧抖） */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-[50%]"
        style={{
          bottom: -7,
          width: 52,
          height: 16,
          background: 'rgba(64,52,40,0.22)',
          filter: 'blur(3px)',
        }}
      />
      <img
        src={src}
        alt={ch.id === 'me' ? '我' : 'TA'}
        draggable={false}
        className="h-full w-full object-contain"
        style={{
          transform: flip ? 'scaleX(-1)' : undefined,
          animation: ch.moving ? 'char-bob 0.34s ease-in-out infinite' : undefined,
          filter: 'drop-shadow(0 4px 6px rgba(60,48,36,0.18))',
        }}
      />
      {/* 名牌 */}
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold text-white"
        style={{
          top: -26,
          background:
            ch.id === 'me'
              ? 'linear-gradient(135deg, rgba(226,106,150,0.92), rgba(214,88,128,0.92))'
              : 'linear-gradient(135deg, rgba(112,158,196,0.92), rgba(96,144,178,0.92))',
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        }}
      >
        {ch.id === 'me' ? '我' : 'TA'}
      </div>
    </div>
  );
}

export default memo(CharacterInner);

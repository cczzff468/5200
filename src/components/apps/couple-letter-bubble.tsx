'use client';

/**
 * 情书信封卡片气泡（第十八轮）——微信/QQ 聊天共用。
 *
 * 用户规格（第七批）：AI 写给我的信（AI 也可以主动写信/回信）以信封卡片发到聊天里，
 * 点击卡片直接进入信件页面（LettersPage 消费 pendingLetterOpen，不进恋人空间主页）。
 * 样式仿亲密关系卡（couple-rel-bubble / couple-pact-bubble）的白底卡：
 * 左侧卡通信封缩略图 + 右侧「XX的情书」+ 信开头摘要 + 底部「情书」小字标签 / 「拆信」按钮。
 *
 * 本文件同时导出信封样式库 LETTER_ENVELOPES 与信封图形组件 EnvelopeArt，
 * 供恋人空间情书页（选样式/主视图/详情/寄出预览）复用同一套视觉。
 */

import type { CoupleLetterCardData } from '@/lib/ios/couple-letter-share';
import { navToLetter } from '@/lib/ios/couple-letter-share';
import { useUI } from '@/lib/ios/store';

// ---------------- 信封样式库（参考用户两张信封截图：粉色爪印兔子信封 / 黄色星星小狗信封） ----------------

export interface LetterEnvelopeStyle {
  key: string;
  name: string;
  body: string; // 信封底渐变
  flap: string; // 封口盖颜色
  seal: string; // 火漆印颜色
  sticker: string; // 火漆上的贴纸 emoji
  pets: string; // 底部一排小动物
  pattern: 'paw' | 'star' | 'heart' | 'cloud' | 'dot';
  patternColor: string; // 底纹颜色
  accent: string; // 强调色（选中描边等）
}

export const LETTER_ENVELOPES: LetterEnvelopeStyle[] = [
  { key: 'pinkbunny', name: '粉兔信笺', body: 'linear-gradient(160deg,#fbd9e2,#f6c3d2)', flap: '#f3b4c6', seal: '#e88ba4', sticker: '💌', pets: '🐰🐨🐰🐰', pattern: 'paw', patternColor: 'rgba(235,150,175,0.34)', accent: '#e88ba4' },
  { key: 'yellowpup', name: '暖黄小狗', body: 'linear-gradient(160deg,#fbe3a2,#f8d476)', flap: '#f5cd66', seal: '#e2b34c', sticker: '🌟', pets: '🐶⭐️🐶', pattern: 'star', patternColor: 'rgba(226,160,70,0.28)', accent: '#e2a03e' },
  { key: 'lavendrcat', name: '香芋小猫', body: 'linear-gradient(160deg,#e6dcf7,#d8c9f0)', flap: '#cdbcec', seal: '#a98fe0', sticker: '🌙', pets: '🐱🐭🐱', pattern: 'paw', patternColor: 'rgba(150,125,205,0.24)', accent: '#a98fe0' },
  { key: 'mintbear', name: '薄荷小熊', body: 'linear-gradient(160deg,#d4f2e2,#b8e8d0)', flap: '#a9e0c4', seal: '#6fc7a0', sticker: '🌿', pets: '🐻🐰🐻', pattern: 'dot', patternColor: 'rgba(100,180,145,0.22)', accent: '#6fc7a0' },
  { key: 'skybunny', name: '晴空云朵', body: 'linear-gradient(160deg,#cfe7fb,#b3d9f5)', flap: '#a8cef2', seal: '#7fb2e8', sticker: '☁️', pets: '🐰☁️🐰', pattern: 'cloud', patternColor: 'rgba(110,160,220,0.24)', accent: '#7fb2e8' },
  { key: 'kraft', name: '牛皮复古', body: 'linear-gradient(160deg,#ead9bd,#dcc39c)', flap: '#d3b98e', seal: '#b98a5a', sticker: '❤️', pets: '🐻🦊🐻', pattern: 'heart', patternColor: 'rgba(160,110,60,0.2)', accent: '#b98a5a' },
];

export function letterEnvelopeOf(key: string | undefined): LetterEnvelopeStyle {
  return LETTER_ENVELOPES.find((e) => e.key === key) ?? LETTER_ENVELOPES[0];
}

/** 信封底纹（爪印/星星/爱心/云朵/圆点，绝对定位铺满） */
function EnvelopePattern({ style }: { style: LetterEnvelopeStyle }) {
  const items = Array.from({ length: 10 }, (_, i) => i);
  const glyph = style.pattern === 'paw' ? '🐾' : style.pattern === 'star' ? '⭐️' : style.pattern === 'heart' ? '🤍' : style.pattern === 'cloud' ? '☁️' : '•';
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((i) => (
        <span
          key={i}
          className={style.pattern === 'dot' ? 'absolute rounded-full' : 'absolute select-none'}
          style={
            style.pattern === 'dot'
              ? { left: `${(i * 23 + 8) % 92}%`, top: `${(i * 37 + 10) % 78}%`, width: 5, height: 5, background: style.patternColor }
              : { left: `${(i * 23 + 6) % 88}%`, top: `${(i * 41 + 6) % 72}%`, fontSize: i % 3 === 0 ? 11 : 8, opacity: 0.9, color: style.patternColor, transform: `rotate(${(i * 53) % 40 - 20}deg)` }
          }
        >
          {style.pattern === 'dot' ? '' : glyph}
        </span>
      ))}
    </div>
  );
}

/**
 * 卡通信封图形（恋人空间情书页与聊天卡片共用）：
 * 信封身 + V 形封口盖 + 圆形火漆印（内嵌贴纸）+ 底部一排小动物。
 */
export function EnvelopeArt({ envKey, className = '', pets = true }: { envKey?: string; className?: string; pets?: boolean }) {
  const st = letterEnvelopeOf(envKey);
  return (
    <div aria-hidden="true" className={`relative overflow-hidden ${className}`} style={{ background: st.body, borderRadius: 10, containerType: 'inline-size' }}>
      <EnvelopePattern style={st} />
      {/* V 形封口盖 */}
      <div
        className="absolute inset-x-0 top-0"
        style={{ height: '58%', background: st.flap, clipPath: 'polygon(0 0, 100% 0, 50% 100%)', boxShadow: '0 1px 0 rgba(255,255,255,0.35) inset' }}
      />
      {/* 封口盖折边描边 */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0" style={{ height: '58%', clipPath: 'polygon(0 0, 100% 0, 50% 100%)', background: 'transparent', boxShadow: '0 -1.5px 0 rgba(255,255,255,0.5) inset' }} />
      {/* 火漆印 */}
      <div className="absolute left-1/2 top-1/2 flex h-[34%] w-[22%] -translate-x-1/2 -translate-y-[72%] items-center justify-center rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.18)]" style={{ background: st.seal, border: '2px solid rgba(255,255,255,0.75)' }}>
        <span style={{ fontSize: 'clamp(9px, 18cqw, 18px)', lineHeight: 1 }}>{st.sticker}</span>
      </div>
      {/* 底部小动物 */}
      {pets && <div className="absolute inset-x-0 bottom-0.5 text-center" style={{ fontSize: 'clamp(8px, 14cqw, 14px)', lineHeight: 1.15, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.08))' }}>{st.pets}</div>}
    </div>
  );
}

// ---------------- 聊天气泡 ----------------

export default function CoupleLetterBubble({ data, mine, testidPrefix = 'wx' }: { data: CoupleLetterCardData; mine: boolean; testidPrefix?: string }) {
  /** 点击卡片 → 进恋人空间信件页面（任何状态都直达信件详情；不进恋人空间主页） */
  const openLetter = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    navToLetter({
      letterId: data.letterId,
      from: data.from,
      envelope: data.envelope,
      snippet: data.snippet,
      replyToId: data.replyToId,
      channel: data.app,
      contactId: data.contactId,
    });
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };
  void mine;

  return (
    <div data-testid={`${testidPrefix}-letter-card`} className="w-[248px] select-none overflow-hidden rounded-[10px] bg-white shadow-sm dark:bg-[#1E1E1E]">
      {/* 卡片本体：信封缩略图 + 标题 + 摘要（点击进信件页面） */}
      <button
        type="button"
        data-testid={`${testidPrefix}-letter-card-body`}
        onClick={(e) => {
          e.stopPropagation();
          openLetter();
        }}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 pb-2.5 pt-3 text-left transition-opacity active:opacity-60"
      >
        <EnvelopeArt envKey={data.envelope} className="h-[64px] w-[52px] shrink-0 [container-type:inline-size]" pets={false} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-semibold leading-[1.35] text-black dark:text-white">{data.fromName}的情书</span>
          <span className="mt-1 block text-[12.5px] font-medium leading-[1.45] text-[#e0607e] dark:text-[#f9a8d4]">
            {data.from === 'ta' && data.replyToId ? '这是TA给你的回信' : data.from === 'ta' ? 'TA写给你的一封信' : '寄给TA的一封信'}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-[1.45] text-black/45 dark:text-white/45">{data.snippet}</span>
        </span>
      </button>

      {/* 底部：TA 寄来的出「拆信」按钮；我寄出的出状态行 */}
      {data.from === 'ta' ? (
        <button
          type="button"
          data-testid={`${testidPrefix}-letter-card-open`}
          onClick={(e) => {
            e.stopPropagation();
            openLetter();
          }}
          className="w-full border-t border-black/[0.06] py-2 text-[13.5px] font-medium text-[#e0607e] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
        >
          拆信
        </button>
      ) : (
        <div className="border-t border-black/[0.06] px-3 py-1.5 text-[12px] text-black/40 dark:border-white/[0.08] dark:text-white/40">已寄出 · 等 TA 拆信 · 情书</div>
      )}
    </div>
  );
}

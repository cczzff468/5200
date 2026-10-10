'use client';

/**
 * 淘宝内容匹配图组件：taobao.tsx / taobao-channels.tsx 全站共用。
 *
 * 图源为本地 kawaii 卡通插画（Task 59 落盘）：src 由 taobao-data.tbImg 产出
 * /goods/*.webp 本地图（原真实图库直链 /api/tb-img 链路已删除）；用户上传 dataURL
 * 等自定义图原样显示。本地图全链有图，前端仅做一次重试，再失败显示 emoji 兜底/占位；
 * 加载期 shimmer，弱网不再是大灰块。
 */
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { legacyImgUrl } from '@/lib/ios/goods-img';

/** 图挂时的暖色渐变 + emoji 兜底（与美团 FoodImg 同款体验，按图源文件名推断品类） */
const FALLBACK_EMOJI: Record<string, string> = {
  // 数码
  phone: '📱', earbuds: '🎧', laptop: '💻', tablet: '📱', watch: '⌚', keyboard: '⌨️',
  speaker: '🔊', powerbank: '🔋', camera: '📷', lock: '🔒',
  // 家电
  fridge: '🧊', washer: '🧺',
  // 服饰
  tshirt: '👕', jeans: '👖', dress: '👗', jacket: '🧥', hoodie: '🧥', coat: '🧥', shirt: '👔',
  hat: '🧢', sneakers: '👟', shoes: '👟', backpack: '🎒',
  // 美妆
  lipstick: '💄', perfume: '🌸', skincare: '🧴', makeup: '💅',
  // 家居
  sofa: '🛋️', bedding: '🛏️', lamp: '💡', mug: '☕', vase: '🏺', pillow: '🛏️', desk: '🪑',
  // 其他
  toy: '🧸', umbrella: '☂️', 'water-bottle': '🥤', snacks: '🍿', cookies: '🍪', tea: '🍵',
  books: '📚', book: '📚', fruit: '🍎', flower: '💐', gift: '🎁', kiosk: '🏧', temple: '⛩️',
  // 美团菜品（淘宝 AI 商品跨类复用）
  'milk-tea': '🧋', burger: '🍔', 'fried-chicken': '🍗', pizza: '🍕', hotpot: '🍲', noodles: '🍜',
  rice: '🍚', dessert: '🍰', 'ice-cream': '🍦', coffee: '☕', juice: '🧃', milk: '🥛', egg: '🍳',
  breakfast: '🍞', dumplings: '🥟', sushi: '🍣', barbecue: '🍢', 'chinese-food': '🥘', seafood: '🦀',
  beef: '🥩', salad: '🥗', soup: '🥣', cola: '🥤', medicine: '💊', store: '🛍️',
};

function fallbackEmojiOf(src: string | undefined): string | undefined {
  const m = src?.match(/\/goods\/([a-z0-9-]+)\.webp/i);
  if (!m) return undefined;
  if (m[1].startsWith('shop-')) return '🏪';
  return FALLBACK_EMOJI[m[1].replace(/^(tb|mt)-/, '')];
}

export function TbImg({
  src,
  emoji,
  cap,
  className = '',
  alt = '',
}: {
  src?: string;
  emoji?: string;
  /** 图内底部名字条（订单名/商品名，白字渐变贴片） */
  cap?: string;
  className?: string;
  alt?: string;
}) {
  return <TbImgInner key={src ?? 'none'} src={legacyImgUrl(src, 'tb')} emoji={emoji} cap={cap} className={className} alt={alt} />;
}

function TbImgInner({
  src,
  emoji,
  cap,
  className = '',
  alt = '',
}: {
  src?: string;
  emoji?: string;
  cap?: string;
  className?: string;
  alt?: string;
}) {
  // stage：0=主源首载 1=主源重试（延迟+cache-buster） 2=占位（本地静态图，占位仅极端故障出现）
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // 重试时追加 r= 查询参数绕过可能的负缓存/半程响应（Task 60：修复偶发单图 404 后同 URL 重试仍 404）
  const cur = stage === 0 ? src : stage === 1 ? `${src}${src?.includes('?') ? '&' : '?'}r=1` : undefined;
  // 未显式传 emoji 时按图源文件名推断兜底 emoji（与美团 FoodImg 同款暖色渐变兜底）
  const fb = emoji ?? fallbackEmojiOf(cur) ?? fallbackEmojiOf(src);
  if (!cur) {
    // 无图 + 有 emoji：暖色渐变 + emoji 大字兜底，不再是「加载失败」灰块
    if (fb) {
      return (
        <div
          className={`flex items-center justify-center bg-gradient-to-br from-[#FFE9B8] via-[#FFDF9E] to-[#FFD100]/70 ${className}`}
          aria-hidden="true"
        >
          <span className="text-[34px] leading-none drop-shadow-sm">{fb}</span>
        </div>
      );
    }
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-[#EBEDF0] ${className}`} aria-hidden="true">
        <ImageOff className="h-[30%] w-[30%] text-black/25" strokeWidth={1.8} />
        <span className="text-[10px] leading-none text-black/30">图片加载失败</span>
      </div>
    );
  }
  return (
    <span className={`relative block overflow-hidden bg-[#F5F6F7] ${className}`}>
      {/* 加载期 shimmer：弱网/首次解码时不再是大灰块 */}
      {!loaded && <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-black/[0.03] via-black/[0.07] to-black/[0.03]" aria-hidden="true" />}
      <img
        key={`${stage}-${cur}`}
        src={cur}
        alt={alt}
        referrerPolicy="no-referrer"
        draggable={false}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          if (stage === 0) {
            // 首败延迟重试：避开 dev 编译窗口/瞬时抖动（同帧立即重试会二次 404 直接落灰块）
            window.setTimeout(() => setStage(1), 400);
          } else {
            setStage(2); // 1→2 占位
          }
        }}
        className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* 图内底部名字条：这个订单/商品叫什么就显示什么（仿电商图的白字贴片） */}
      {cap ? (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 via-black/25 to-transparent px-1.5 pb-[3px] pt-5" aria-hidden="true">
          <span className="block truncate text-center text-[9px] font-medium leading-tight text-white drop-shadow-sm">{cap}</span>
        </span>
      ) : null}
    </span>
  );
}

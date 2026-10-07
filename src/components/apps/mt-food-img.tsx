'use client';

/**
 * 内容匹配图组件（共享版）：meituan.tsx 与 meituan-shangou.tsx 等多页共用。
 * /api/mt-img 全链有图（Foodiesfeed → TheMealDB → Pixabay/Pexels → Commons → 本地算法图）；
 * 前端仅做一次重试，再失败显示灰色+文字占位；加载期 shimmer，弱网不再是大灰块。
 */
import { useState } from 'react';
import { ImageOff } from 'lucide-react';

export function FoodImg({ src, className = '' }: { src?: string; emoji?: string; className?: string }) {
  return <FoodImgInner key={src ?? 'none'} src={src} className={className} />;
}

function FoodImgInner({ src, className = '' }: { src?: string; className?: string }) {
  // stage：0=主源首载 1=主源重试 2=灰色+文字占位（服务端永远 200，占位仅极端网络故障出现）
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const cur = stage <= 1 ? src : undefined;
  if (!cur) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-[#EBEDF0] ${className}`} aria-hidden="true">
        <ImageOff className="h-[30%] w-[30%] text-black/25" strokeWidth={1.8} />
        <span className="text-[10px] leading-none text-black/30">图片加载失败</span>
      </div>
    );
  }
  return (
    <span className={`relative block overflow-hidden bg-[#F5F6F7] ${className}`}>
      {/* 加载期 shimmer：弱网/预热未命中时不再是大灰块 */}
      {!loaded && <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-black/[0.03] via-black/[0.07] to-black/[0.03]" aria-hidden="true" />}
      <img
        key={`${stage}-${cur}`}
        src={cur}
        alt=""
        draggable={false}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setStage((s) => Math.min(2, s + 1));
        }}
        className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </span>
  );
}

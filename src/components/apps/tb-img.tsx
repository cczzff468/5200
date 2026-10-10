'use client';

/**
 * 淘宝内容匹配图组件：taobao.tsx / taobao-channels.tsx 全站共用。
 *
 * 图源为预生成本地 kawaii 卡通插画（Task 58）：src 由 taobao-data.tbImg 产出
 * /goods/*.webp 本地图（原真实图库直链 /api/tb-img 链路已删除）；用户上传 dataURL
 * 等自定义图原样显示。本地图全链有图，前端仅做一次重试，再失败显示 emoji 兜底/占位；
 * 加载期 shimmer，弱网不再是大灰块。
 */
import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { legacyImgUrl } from '@/lib/ios/goods-img';

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
  // stage：0=主源首载 1=主源重试 2=占位（本地静态图，占位仅极端故障出现）
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const cur = stage <= 1 ? src : undefined;
  if (!cur) {
    // 无图 + 有 emoji：暖色渐变 + emoji 大字兜底，不再是「加载失败」灰块
    if (emoji) {
      return (
        <div
          className={`flex items-center justify-center bg-gradient-to-br from-[#FFE9B8] via-[#FFDF9E] to-[#FFD100]/70 ${className}`}
          aria-hidden="true"
        >
          <span className="text-[34px] leading-none drop-shadow-sm">{emoji}</span>
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
          setStage((s) => s + 1); // 0→1 重试，1→2 占位
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

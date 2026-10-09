'use client';

/**
 * 内容匹配图组件（共享版）：meituan.tsx 与 meituan-shangou.tsx 等多页共用。
 *
 * 图源由「我的 → 图片样式」全站三选一驱动（mt-img-style.ts）：
 * - real    真实图片：/api/mt-img 真实图库链（Foodiesfeed → TheMealDB → Commons → 本地算法图），默认；
 * - ai      AI 生成：设置·图像生成 API 按品类词现场生成（生成中先显示默认插画，完成后自动替换）；
 * - default 默认图片：/api/mt-img?...&d=1 服务端本地算法插画直出（分类配色 + emoji SVG）。
 *
 * 仅对 /api/mt-img 链接做改写；用户上传 dataURL 等自定义图任何样式下原样显示。
 * /api/mt-img 全链有图（服务端永远 200），前端仅做一次重试，再失败显示灰色+文字占位；
 * 加载期 shimmer，弱网不再是大灰块。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ImageOff } from 'lucide-react';
import { useSettings } from '@/lib/ios/store';
import { imgGenConfigReady } from '@/lib/imggen';
import {
  aiFoodVersion,
  foodStyleVersion,
  mtEnqueueAiFood,
  mtGetAiFood,
  mtGetFoodStyle,
  subscribeAiFood,
  subscribeFoodStyle,
} from '@/lib/ios/mt-img-style';

/** /api/mt-img 链接解析：k=品类词（AI 提示词与缓存槽位）、p=c 门头图 / f 菜品图；非本链路返回 null */
function parseMtImg(src: string): { tag: string; kind: 'f' | 'c' } | null {
  if (!src.startsWith('/api/mt-img?')) return null;
  const qIdx = src.indexOf('?');
  if (qIdx < 0) return null;
  try {
    const sp = new URLSearchParams(src.slice(qIdx + 1));
    const k = sp.get('k');
    if (!k) return null;
    return { tag: k, kind: sp.get('p') === 'c' ? 'c' : 'f' };
  } catch {
    return null;
  }
}

export function FoodImg({ src, emoji, className = '' }: { src?: string; emoji?: string; className?: string }) {
  // 订阅全站样式版本 + AI 图缓存版本（切换样式 / 某张 AI 图生成完成 → 全部挂载中的图重算展示源）
  useSyncExternalStore(subscribeFoodStyle, foodStyleVersion);
  useSyncExternalStore(subscribeAiFood, aiFoodVersion);
  const cfg = useSettings((s) => s.imgGenConfig);
  const style = mtGetFoodStyle();

  const parsed = useMemo(() => (src ? parseMtImg(src) : null), [src]);

  // AI 模式：该品类尚无 AI 图 → 入队生成（队列内去重；未配置生图 API 由展示端回退默认插画）
  useEffect(() => {
    if (!parsed || style !== 'ai') return;
    if (mtGetAiFood(parsed.tag, parsed.kind)) return;
    if (!imgGenConfigReady(cfg)) return;
    mtEnqueueAiFood(parsed.tag, parsed.kind, cfg);
  }, [parsed, style, cfg]);

  // 按样式改写展示源：default 追加 d=1；ai 用缓存图（无则先显默认插画占位）；real / 自定义图原样
  let eff: string | undefined = src;
  if (parsed && src) {
    const defSrc = `${src}&d=1`;
    if (style === 'default') eff = defSrc;
    else if (style === 'ai') eff = mtGetAiFood(parsed.tag, parsed.kind) || defSrc;
  }

  return <FoodImgInner key={eff ?? 'none'} src={eff} emoji={emoji} className={className} />;
}

function FoodImgInner({ src, emoji, className = '' }: { src?: string; emoji?: string; className?: string }) {
  // stage：0=主源首载 1=主源重试 2=灰色+文字占位（服务端永远 200，占位仅极端网络故障出现）
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const cur = stage <= 1 ? src : undefined;
  if (!cur) {
    // 无图 + 有 emoji（商家入驻未上传图）：暖黄渐变 + emoji 大字兜底，不再是「加载失败」灰块
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

'use client';

/**
 * 淘宝内容匹配图组件（Task 46/50）：taobao.tsx / taobao-channels.tsx 全站共用。
 *
 * 图源由「我的淘宝 → 图片样式」全站三选一驱动（tb-img-style.ts，与美团同款交互）：
 * - real    真实图片：分类精准匹配真实图库直链（Task 50：客户端缓存 tb-real-img-store 优先 ——
 *           Pexels/StockSnap·Openverse/Wikimedia Commons/Foodiesfeed(食品) 直链热链，不转存，
 *           img title 带作者·许可版权信息；缓存为空时后台按需拉取一次，拉到前先用 /api/mt-img
 *           真实图链兜底显示；加载失败自动回退 mt-img 链）；
 * - ai      AI 生成：设置·图像生成 API 按品类词现场生成（生成中先显示默认插画，完成后自动替换）；
 * - default 默认图片：/api/mt-img?...&d=1 服务端本地算法插画直出（分类配色 + 品类字形）。
 *
 * 仅对 /api/mt-img 链接做改写；用户上传 dataURL 等自定义图任何样式下原样显示。
 * 加载期 shimmer，弱网不再是大灰块；两层兜底（真实直链 → mt-img 服务端图链 → 占位）。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ImageOff } from 'lucide-react';
import { useSettings } from '@/lib/ios/store';
import { imgGenConfigReady } from '@/lib/imggen';
import {
  subscribeTbRealImg,
  tbGetRealBase,
  tbGetRealImgs,
  tbRealImgCredit,
  tbRealImgVersion,
  tbEnsureRealImg,
  type TbRealImgItem,
} from '@/lib/ios/tb-real-img-store';
import {
  subscribeTbAiImg as subscribeAiImg,
  subscribeTbImgStyle as subscribeImgStyle,
  tbAiImgVersion,
  tbEnqueueAiImg,
  tbGetAiImg,
  tbGetImgStyle,
  tbImgStyleVersion,
} from './tb-img-style';

/** /api/mt-img 链接解析：k=品类词（AI 提示词与缓存槽位）、p=c 门头图 / f 商品图、s=变体；非本链路返回 null */
function parseTbImg(src: string): { tag: string; kind: 'f' | 'c'; s: number } | null {
  if (!src.startsWith('/api/mt-img?')) return null;
  const qIdx = src.indexOf('?');
  if (qIdx < 0) return null;
  try {
    const sp = new URLSearchParams(src.slice(qIdx + 1));
    const k = sp.get('k');
    if (!k) return null;
    const s = Number.parseInt(sp.get('s') ?? '0', 10);
    return { tag: k, kind: sp.get('p') === 'c' ? 'c' : 'f', s: Number.isFinite(s) ? Math.max(0, s) : 0 };
  } catch {
    return null;
  }
}

export function TbImg({
  src,
  emoji,
  className = '',
  alt = '',
}: {
  src?: string;
  emoji?: string;
  className?: string;
  alt?: string;
}) {
  // 订阅全站样式版本 + AI 图缓存版本 + 真实图缓存版本（切换样式 / 某张图就绪 → 全部挂载中的图重算展示源）
  useSyncExternalStore(subscribeImgStyle, tbImgStyleVersion);
  useSyncExternalStore(subscribeAiImg, tbAiImgVersion);
  useSyncExternalStore(subscribeTbRealImg, tbRealImgVersion);
  const cfg = useSettings((s) => s.imgGenConfig);
  const style = tbGetImgStyle();

  const parsed = useMemo(() => (src ? parseTbImg(src) : null), [src]);

  // AI 模式：该品类尚无 AI 图 → 入队生成（队列内去重；未配置生图 API 由展示端回退默认插画）
  useEffect(() => {
    if (!parsed || style !== 'ai') return;
    if (tbGetAiImg(parsed.tag, parsed.kind)) return;
    if (!imgGenConfigReady(cfg)) return;
    tbEnqueueAiImg(parsed.tag, parsed.kind, cfg);
  }, [parsed, style, cfg]);

  // 真实模式：缓存为空才按需后台拉一次（打开淘宝不自动更新 = 有缓存零请求）；拉到广播重渲染
  useEffect(() => {
    if (!parsed || style !== 'real') return;
    tbEnsureRealImg(parsed.tag);
  }, [parsed, style]);

  // 按样式改写展示源：default 追加 d=1；ai 用缓存图（无则先显默认插画占位）；
  // real 用分类缓存直链（同 tag 内按 轮换基点+s 变体取图，刷新推进基点=同分类整体换图；
  // 缓存为空时保留 mt-img 服务端真实图链兜底）
  let eff: string | undefined = src;
  let credit = '';
  if (parsed && src) {
    const defSrc = `${src}&d=1`;
    if (style === 'default') {
      eff = defSrc;
    } else if (style === 'ai') {
      eff = tbGetAiImg(parsed.tag, parsed.kind) || defSrc;
    } else {
      const list = tbGetRealImgs(parsed.tag);
      if (list.length > 0) {
        const pick: TbRealImgItem = list[(tbGetRealBase(parsed.tag) + parsed.s) % list.length];
        eff = pick.url;
        credit = tbRealImgCredit(pick);
      }
    }
  }

  return <TbImgInner key={eff ?? 'none'} src={eff} fallbackSrc={src} credit={credit} emoji={emoji} className={className} alt={alt} />;
}

function TbImgInner({
  src,
  fallbackSrc,
  credit,
  emoji,
  className = '',
  alt = '',
}: {
  src?: string;
  fallbackSrc?: string;
  credit?: string;
  emoji?: string;
  className?: string;
  alt?: string;
}) {
  // stage：0=主源（真实直链）首载 1=回退源（/api/mt-img 服务端图链，与主源相同则跳过） 2=灰色+文字占位
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const cur = stage === 0 ? src : stage === 1 ? (fallbackSrc && fallbackSrc !== src ? fallbackSrc : undefined) : undefined;
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
      {/* 加载期 shimmer：弱网/预热未命中时不再是大灰块 */}
      {!loaded && <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-black/[0.03] via-black/[0.07] to-black/[0.03]" aria-hidden="true" />}
      <img
        key={`${stage}-${cur}`}
        src={cur}
        alt={alt}
        title={credit ? `图：${credit}（仅作展示，点击图片不跳转）` : undefined}
        referrerPolicy="no-referrer"
        draggable={false}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setStage((s) => s + 1); // 0→1 回退 mt-img 图链，1→2 占位
        }}
        className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </span>
  );
}

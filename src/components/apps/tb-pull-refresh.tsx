'use client';

/**
 * 淘宝系页面通用「双向刷新」基建（Task 40 需求）：
 * - 顶部下拉、底部上拉，两个方向都触发 onRefresh(dir)；
 * - 刷新语义由调用方实现为「向列表顶部插入新内容」——旧内容一律原位保留、不重排、不清空；
 * - 底部上拉触发时自动做视口锚定：内容前插后按高度差补偿 scrollTop，画面不跳、更不会回顶；
 * - TbPullIndicator 悬浮胶囊：下拉在顶部随手指位移，上拉在底部，刷新中转圈。
 * 旧实现的问题（本轮修复）：淘票票刷新 rot() 重排导致旧内容消失 + scrollTo(top:0) 跳回顶部；
 * 首页刷新重洗牌 + setBatch(1) 折叠已加载列表——全部改为「前插保旧」。
 */

import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

export type TbPullDir = 'down' | 'up';

/** 双向刷新 Hook：bind 展开到滚动容器上，scrollRef 接滚动容器；onRefresh 可返回 Promise（等 AI 生成完再收尾） */
export function useTbPullRefresh(onRefresh: (dir: TbPullDir) => void | Promise<void>, opts?: { downThreshold?: number; upThreshold?: number; delay?: number }) {
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const downTH = opts?.downThreshold ?? 44;
  const upTH = opts?.upThreshold ?? 56;
  const delay = opts?.delay ?? 620;

  const [refreshing, setRefreshing] = useState<TbPullDir | null>(null);
  const [ghost, setGhost] = useState<{ dir: TbPullDir; dist: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const st = useRef({ y: 0, dir: 'down' as TbPullDir, active: false, dist: 0 });
  const busy = useRef(false);
  const anchorFrom = useRef(0);

  const onTouchStart = (e: React.TouchEvent) => {
    const el = scrollRef.current;
    if (!el || busy.current) {
      st.current.active = false;
      return;
    }
    if (el.scrollTop <= 0) st.current = { y: e.touches[0].clientY, dir: 'down', active: true, dist: 0 };
    else if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) st.current = { y: e.touches[0].clientY, dir: 'up', active: true, dist: 0 };
    else st.current.active = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = st.current;
    if (!s.active) return;
    const dy = s.y - e.touches[0].clientY; // 手指向上 dy>0
    const raw = s.dir === 'down' ? -dy : dy;
    s.dist = Math.max(0, raw);
    setGhost(s.dist > 10 ? { dir: s.dir, dist: Math.min(80, s.dist * 0.5) } : null);
  };
  const onTouchEnd = () => {
    const s = st.current;
    if (s.active && !busy.current && s.dist > (s.dir === 'down' ? downTH : upTH)) {
      busy.current = true;
      const dir = s.dir;
      const el = scrollRef.current;
      // up 方向：记录刷新前内容高度 → 前插内容后按差值补偿 scrollTop（视口锚定，不跳屏）
      if (dir === 'up' && el) anchorFrom.current = el.scrollHeight;
      setGhost(null);
      setRefreshing(dir);
      window.setTimeout(() => {
        const finish = () => {
          // 双 rAF 等 React 提交前插内容后再收尾
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const el2 = scrollRef.current;
              if (dir === 'up' && el2 && anchorFrom.current > 0) {
                const d = el2.scrollHeight - anchorFrom.current;
                if (d > 0) el2.scrollTop += d;
              }
              anchorFrom.current = 0;
              setRefreshing(null);
              busy.current = false;
            }),
          );
        };
        // Task 41：刷新回调返回 Promise（AI 生成）时等它完成再收尾，「正在刷新」不提前消失
        const ret = cb.current(dir) as unknown;
        if (ret && typeof (ret as Promise<void>).then === 'function') {
          (ret as Promise<void>).then(finish, finish);
        } else {
          finish();
        }
      }, delay);
    } else {
      setGhost(null);
    }
    st.current.active = false;
    st.current.dist = 0;
  };

  return { scrollRef, refreshing, ghost, bind: { onTouchStart, onTouchMove, onTouchEnd } };
}

export type TbPullRefresh = ReturnType<typeof useTbPullRefresh>;

/** 悬浮刷新胶囊：放在滚动区的同一 relative 父级内；down 顶部随手指、up 底部、刷新中转圈 */
export function TbPullIndicator({ h, light }: { h: TbPullRefresh; light?: boolean }) {
  const cur = h.refreshing ? { dir: h.refreshing, dist: 0 } : h.ghost;
  if (!cur) return null;
  const busy = h.refreshing != null;
  const down = cur.dir === 'down';
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-40 grid place-items-center ${down ? 'top-2' : 'bottom-5'}`}
      style={down && !busy && cur.dist > 0 ? { transform: `translateY(${cur.dist - 34}px)` } : undefined}
    >
      <div className={`flex h-9 items-center gap-2 rounded-full px-4 text-[13px] shadow-lg backdrop-blur ${light ? 'bg-white/25 text-white' : 'bg-black/55 text-white'}`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : down ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        {busy ? '正在刷新…' : down ? '松开刷新' : '松开更新'}
      </div>
    </div>
  );
}

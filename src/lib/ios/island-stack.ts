'use client';

/**
 * 灵动岛堆叠协调（用户需求：播放音乐时淘宝/美团灵动岛出现 → 音乐岛在左侧加歌曲封面小圆圈，
 * 右侧显示当前配送小窗；点小圆圈展开音乐大窗；大窗可堆叠——多个大窗同时显示，点大窗进对应界面）：
 * - order：当前展开的大窗 id（按展开先后排序）；heights：各大窗实测高度（ResizeObserver 回写）；
 * - expand/collapse/collapseAll：三个岛组件（音乐/淘宝/美团）共同读写；
 * - islandTopOf(id)：某大窗的垂直锚位 = 顶部锚位 + 在它之前展开的大窗高度之和 + 间隔；
 * - islandNextSlotTop()：下一个空闲槽位顶部——对方大窗展开时，小圆圈/配送小窗让位到这。
 * 音乐岛在组合模式只渲染左侧封面圆圈（配送小窗由淘宝/美团岛渲染在右侧），
 * 各自按本 store 计算的锚位绝对定位，互不重叠、随高度实测值平滑跟随。
 */

import { create } from 'zustand';

export type IslandId = 'music' | 'tb' | 'mt';

/** 堆叠顶部锚位（与三个岛组件的 PILL_TOP 同值：灵动岛胶囊原位） */
export const ISLAND_TOP = 11;
/** 堆叠项之间的间隔 */
export const ISLAND_GAP = 8;

interface IslandStackState {
  /** 当前展开的大窗（展开先后序）；空 = 都收着（小窗/圆圈形态） */
  order: IslandId[];
  /** 各大窗实测内容高度（px）；展开中的岛用 ResizeObserver 回写 */
  heights: Partial<Record<IslandId, number>>;
  expand: (id: IslandId) => void;
  collapse: (id: IslandId) => void;
  collapseAll: () => void;
  setHeight: (id: IslandId, h: number) => void;
}

export const useIslandStack = create<IslandStackState>((set) => ({
  order: [],
  heights: {},
  expand: (id) => set((s) => (s.order.includes(id) ? s : { order: [...s.order, id] })),
  collapse: (id) =>
    set((s) => {
      if (!s.order.includes(id) && s.heights[id] === undefined) return s;
      const heights = { ...s.heights };
      delete heights[id];
      return { order: s.order.filter((x) => x !== id), heights };
    }),
  collapseAll: () => set({ order: [], heights: {} }),
  setHeight: (id, h) =>
    set((s) => (s.heights[id] === h ? s : { heights: { ...s.heights, [id]: h } })),
}));

/** 某大窗的垂直锚位：顶部锚位 + 排在它前面的展开大窗高度 + 间隔 */
export function islandTopOf(
  order: IslandId[],
  heights: Partial<Record<IslandId, number>>,
  id: IslandId,
): number {
  let top = ISLAND_TOP;
  for (const x of order) {
    if (x === id) break;
    top += (heights[x] ?? 0) + ISLAND_GAP;
  }
  return top;
}

/** 下一个空闲槽位顶部：所有已展开大窗之下（小圆圈/配送小窗让位用） */
export function islandNextSlotTop(
  order: IslandId[],
  heights: Partial<Record<IslandId, number>>,
): number {
  let top = ISLAND_TOP;
  for (const x of order) top += (heights[x] ?? 0) + ISLAND_GAP;
  return top;
}

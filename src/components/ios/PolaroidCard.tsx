'use client';

/**
 * 拍立得照片小组件（col-span-4 整行 2 行高 ≈342×168）：三张白框拍立得微微
 * 斜排、顶部各压一截米色胶带（用户参考图），照片可在编辑器逐张更换/恢复默认。
 * 点击（主屏）打开编辑弹层；数据存 localStorage，图片经 canvas 压缩控制体积。
 * 照片主体透明无底卡——直接浮在壁纸上（与参考图一致）。
 */
import { useRef, useState } from 'react';
import { fileToScaledDataURL } from './ProfileCard';

/** 拍立得小组件数据：三张照片 dataURL；null = 用内置默认图 */
export interface PolaroidCardData {
  photos: [string | null, string | null, string | null];
}

/** 存储键（v1） */
export const POLAROID_CARD_KEY = 'home.polaroidCard.v1';

/** 内置默认照片（雨洼小花 / 玻璃雨滴望海 / 雪夜街景——阴郁胶片感，贴近参考图） */
export const POLAROID_PHOTO_DEFAULTS: [string, string, string] = [
  '/images/polaroid-1.png',
  '/images/polaroid-2.png',
  '/images/polaroid-3.png',
];

export const DEFAULT_POLAROID_CARD: PolaroidCardData = { photos: [null, null, null] };

/** 读取持久化数据（损坏/缺失时回退默认值；长度恒补齐 3） */
export function loadPolaroidCard(): PolaroidCardData {
  try {
    const raw = localStorage.getItem(POLAROID_CARD_KEY);
    if (!raw) return DEFAULT_POLAROID_CARD;
    const p = JSON.parse(raw) as Partial<PolaroidCardData>;
    const arr = Array.isArray(p.photos) ? p.photos : [];
    return {
      photos: [0, 1, 2].map((i) => (typeof arr[i] === 'string' ? (arr[i] as string) : null)) as PolaroidCardData['photos'],
    };
  } catch {
    return DEFAULT_POLAROID_CARD;
  }
}

/** 三张的倾斜/下沉/胶带角度（错落感，均控制在卡片圆角裁切范围内） */
const FRAMES = [
  { rot: -6.5, y: 7, tape: -6 },
  { rot: 1.5, y: 0, tape: 4 },
  { rot: 7, y: 9, tape: -5 },
];

export function PolaroidCardWidget({ data }: { data: PolaroidCardData }) {
  return (
    <div className="relative flex h-[168px] w-full select-none items-center justify-center gap-[12px] overflow-hidden rounded-[24px]">
      {FRAMES.map((f, i) => (
        <div key={i} className="relative" style={{ transform: `rotate(${f.rot}deg) translateY(${f.y}px)` }}>
          {/* 米色胶带（压在白框上缘） */}
          <span
            aria-hidden="true"
            className="absolute -top-[8px] left-1/2 z-10 h-[15px] w-[46px] rounded-[2px] bg-[#ece4cd]/90 shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
            style={{ transform: `translateX(-50%) rotate(${f.tape}deg)` }}
          />
          {/* 白框拍立得（下缘留白更宽）；未自定义时回退内置胶片照 */}
          <div className="w-[100px] rounded-[5px] bg-white p-[5px] pb-[17px] shadow-[0_5px_14px_rgba(0,0,0,0.3)]">
            <img
              src={data.photos[i] || POLAROID_PHOTO_DEFAULTS[i]}
              alt={`拍立得照片 ${i + 1}`}
              draggable={false}
              className="h-[104px] w-full select-none rounded-[2px] object-cover"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 编辑器（主屏根层级底部弹窗）：三张照片逐张更换 / 恢复默认，保存写回 localStorage。
 *  由父组件按需条件渲染（open 时才挂载），因此草稿直接用当前数据初始化。 */
export function PolaroidCardEditor({
  data,
  onClose,
  onSave,
}: {
  data: PolaroidCardData;
  onClose: () => void;
  onSave: (d: PolaroidCardData) => void;
}) {
  const [draft, setDraft] = useState<PolaroidCardData>(data);
  const inputs = useRef<(HTMLInputElement | null)[]>([null, null, null]);
  /** 选图守卫：input.click() 合成 click 会冒泡、真机选图后有幽灵 click——段时间窗内忽略遮罩点击 */
  const pickGuardUntil = useRef(0);

  const openPicker = (i: number) => {
    pickGuardUntil.current = Date.now() + 1500;
    inputs.current[i]?.click();
  };

  const setPhoto = (i: number, u: string | null) =>
    setDraft((d) => {
      const next = [...d.photos] as PolaroidCardData['photos'];
      next[i] = u;
      return { photos: next };
    });

  return (
    <div
      data-editor-overlay
      role="dialog"
      aria-modal="true"
      aria-label="编辑拍立得小组件"
      className="absolute inset-0 z-[70] flex flex-col bg-black/55 backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        if (Date.now() < pickGuardUntil.current) return;
        onClose();
      }}
    >
      <div className="mt-auto px-2 pb-3" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-[24px] bg-[#1d1d1f]/95 p-4 text-white shadow-[0_-8px_40px_rgba(0,0,0,0.5)] ring-1 ring-white/10">
          {/* 顶栏 */}
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={onClose} className="text-[15px] text-white/65 transition-opacity active:opacity-50">
              取消
            </button>
            <p className="text-[15px] font-semibold">编辑拍立得</p>
            <button
              type="button"
              onClick={() => onSave(draft)}
              className="rounded-full bg-white px-4 py-[5px] text-[14px] font-semibold text-black transition-transform active:scale-95"
            >
              保存
            </button>
          </div>

          <div className="no-scrollbar max-h-[42vh] space-y-3.5 overflow-y-auto pr-0.5">
            <p className="text-[12px] leading-relaxed text-white/50">
              三张照片均可更换（自动压缩存本地），恢复默认即用内置胶片照。
            </p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <img
                  src={draft.photos[i] || POLAROID_PHOTO_DEFAULTS[i]}
                  alt={`照片 ${i + 1} 预览`}
                  className="h-[56px] w-[44px] shrink-0 rounded-[4px] object-cover ring-1 ring-white/15"
                />
                <div className="flex flex-col items-start gap-[6px]">
                  <button
                    type="button"
                    onClick={() => openPicker(i)}
                    className="rounded-full bg-white/12 px-3 py-[5px] text-[12px] font-medium transition-colors active:bg-white/20"
                  >
                    更换照片 {i + 1}
                  </button>
                  {draft.photos[i] && (
                    <button
                      type="button"
                      onClick={() => setPhoto(i, null)}
                      className="text-[11px] text-white/50 transition-colors active:text-white/80"
                    >
                      恢复默认
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 隐藏文件选择器 ×3（放在弹层内部：合成 click 只冒泡到弹层，不会误触遮罩关弹窗） */}
        {[0, 1, 2].map((i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="file"
            accept="image/*"
            className="hidden"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              fileToScaledDataURL(f, 480, 0.82)
                .then((u) => setPhoto(i, u))
                .catch(() => undefined);
            }}
          />
        ))}
      </div>
    </div>
  );
}

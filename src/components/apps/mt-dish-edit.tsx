'use client';

/**
 * 添加 / 编辑菜品（独立全屏页，替代旧版底部弹窗）：
 * - 菜品图片（大图上传位）、基本信息（名称/价格/一句话描述）；
 * - 快捷规格模板：奶茶模板（杯型定价+温度+小料+糖度）/ 小菜模板（多选加价），
 *   图标全部使用 Lucide 线条图标（无 emoji）；
 * - 规格组管理：编辑 / 删除 / 自定义（规格组编辑弹层）；
 * - 编辑态支持删除菜品（二次确认按钮态）；保存回调给宿主页面持久化。
 */
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  CupSoda,
  ImagePlus,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { mtAutoEmoji, type MtDish, type MtDishSpec } from '@/lib/ios/meituan-data';
import { readImageFile } from './wechat';

const MT_YELLOW = '#FFD100';
const MT_PRICE = '#FF4B33';

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
};
const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const inputCls =
  'h-11 w-full rounded-xl bg-[#F4F5F7] px-3 text-[14px] text-black/85 outline-none placeholder:text-black/25 focus:bg-white focus:ring-1 focus:ring-[#FFD100]';

/** 奶茶模板：杯型定价 + 温度 + 小料（多选加价）+ 糖度（填充后每项可再编辑） */
function milkTeaTemplate(): MtDishSpec[] {
  return [
    { name: '规格', options: [{ label: '大杯', price: 0 }, { label: '中杯', price: -1 }, { label: '小杯', price: -2 }] },
    { name: '温度', options: [{ label: '正常冰' }, { label: '少冰' }, { label: '常温' }, { label: '温热' }, { label: '热' }] },
    {
      name: '小料',
      multi: true,
      max: 2,
      options: [
        { label: '珍珠', price: 1 },
        { label: '椰果', price: 1 },
        { label: '布丁', price: 2 },
        { label: '脆啵啵', price: 1 },
        { label: '红豆', price: 2 },
        { label: '奶盖', price: 3 },
      ],
    },
    { name: '糖度', options: [{ label: '正常糖' }, { label: '七分糖' }, { label: '五分糖' }, { label: '三分糖' }, { label: '不额外加糖' }] },
  ];
}

/** 小菜模板：多选加价配菜（米饭/小食…） */
function sideDishTemplate(): MtDishSpec[] {
  return [
    {
      name: '小菜',
      multi: true,
      max: 3,
      options: [
        { label: '米饭', price: 2 },
        { label: '鸡蛋', price: 2 },
        { label: '青菜', price: 2 },
        { label: '可乐', price: 3 },
        { label: '辣条', price: 1 },
      ],
    },
  ];
}

// ================================ 规格组编辑弹层 ================================

interface SpecDraft {
  name: string;
  multi: boolean;
  max: number;
  options: { label: string; price: number }[];
}

export function SpecEditSheet({
  initial,
  onClose,
  onDone,
}: {
  initial: SpecDraft | null;
  onClose: () => void;
  onDone: (d: SpecDraft) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [multi, setMulti] = useState(initial?.multi ?? false);
  const [max, setMax] = useState(String(initial?.max ?? 2));
  const [opts, setOpts] = useState<{ label: string; price: string }[]>(
    initial?.options.map((o) => ({ label: o.label, price: o.price ? String(o.price) : '0' })) ?? [{ label: '', price: '0' }]
  );
  const valid = name.trim().length > 0 && opts.some((o) => o.label.trim().length > 0);

  return (
    <motion.div
      key="mt-spec-edit"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[70]"
      data-testid="mt-spec-sheet"
    >
      <button type="button" aria-label="关闭规格组编辑" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
        className="absolute inset-x-0 bottom-0 flex max-h-[88%] flex-col rounded-t-3xl bg-white"
      >
        <div className="flex shrink-0 flex-col items-center pt-2.5">
          <span className="h-1 w-9 rounded-full bg-black/10" />
        </div>
        <div className="relative flex shrink-0 items-center justify-center px-4 pb-3 pt-2">
          <p className="text-[16px] font-bold text-black/85">{initial ? '编辑规格组' : '添加规格组'}</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full bg-[#F4F5F7] active:bg-black/[0.08]">
            <X className="h-4 w-4 text-black/55" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          <p className="mb-1.5 text-[12px] text-black/45">组名（如 规格 / 小料 / 小菜 / 辣度）</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：小料" className={inputCls} maxLength={6} />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMulti(false)}
              className={`h-8 rounded-full px-4 text-[13px] transition-colors ${!multi ? 'bg-[#FFD100] font-semibold text-black/85' : 'bg-[#F4F5F7] text-black/50'}`}
            >
              单选
            </button>
            <button
              type="button"
              onClick={() => setMulti(true)}
              className={`h-8 rounded-full px-4 text-[13px] transition-colors ${multi ? 'bg-[#FFD100] font-semibold text-black/85' : 'bg-[#F4F5F7] text-black/50'}`}
            >
              多选
            </button>
            {multi && (
              <span className="ml-auto flex items-center gap-1 text-[12px] text-black/45">
                最多选
                <input
                  value={max}
                  onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 1))}
                  className="h-7 w-9 rounded-lg bg-[#F4F5F7] text-center text-[13px] outline-none focus:ring-1 focus:ring-[#FFD100]"
                  inputMode="numeric"
                />
                份
              </span>
            )}
          </div>
          <p className="mb-1.5 mt-3.5 text-[12px] text-black/45">选项（加价 0 表示不加价，可填负数表示减价）</p>
          <div className="flex flex-col gap-2">
            {opts.map((o, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-[#FAFAFB] p-1.5 ring-1 ring-black/[0.04]">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#FFF3C4] text-[11px] font-bold text-[#8A6A00]">{i + 1}</span>
                <input
                  value={o.label}
                  onChange={(e) => setOpts((p) => p.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
                  placeholder={`选项 ${i + 1}（如 大杯 / 珍珠）`}
                  className={`${inputCls} !h-9 flex-1`}
                  maxLength={10}
                />
                <span className="shrink-0 text-[13px] font-medium" style={{ color: MT_PRICE }}>¥</span>
                <input
                  value={o.price}
                  onChange={(e) => setOpts((p) => p.map((x, k) => (k === i ? { ...x, price: e.target.value.replace(/[^\d.-]/g, '') } : x)))}
                  className={`${inputCls} !h-9 w-[62px] shrink-0 text-center`}
                  inputMode="decimal"
                />
                {opts.length > 1 && (
                  <button type="button" aria-label="删除选项" onClick={() => setOpts((p) => p.filter((_, k) => k !== i))} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-black/35 active:bg-black/5">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpts((p) => [...p, { label: '', price: '0' }])}
            className="mt-2.5 flex h-10 w-full items-center justify-center gap-1 rounded-xl border border-dashed border-black/15 text-[13px] text-black/50 active:bg-black/[0.03]"
          >
            <Plus className="h-4 w-4" />
            加选项
          </button>
        </div>
        <div className="shrink-0 border-t border-black/5 bg-white p-4 pb-7">
          <button
            type="button"
            disabled={!valid}
            data-testid="mt-spec-done"
            onClick={() => {
              const maxN = Math.max(1, parseInt(max || '2', 10) || 2);
              onDone({
                name: name.trim(),
                multi,
                max: multi ? maxN : 1,
                options: opts
                  .filter((o) => o.label.trim())
                  .map((o) => ({ label: o.label.trim(), price: num(o.price) })),
              });
            }}
            className={`h-12 w-full rounded-full text-[15px] font-bold ${valid ? 'text-black/85 active:opacity-85' : 'opacity-40'}`}
            style={{ background: MT_YELLOW }}
          >
            完成
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ================================ 菜品编辑（全屏页） ================================

export default function DishEditPage({
  catName,
  initial,
  onBack,
  onSave,
  onDelete,
}: {
  /** 所属分区名 */
  catName: string;
  initial: MtDish | null;
  onBack: () => void;
  onSave: (d: MtDish) => void;
  /** 仅编辑态传入：删除该菜品 */
  onDelete?: (d: MtDish) => void;
}) {
  const [dName, setDName] = useState(initial?.name ?? '');
  const [dPrice, setDPrice] = useState(initial ? money(initial.price) : '');
  const [dImg, setDImg] = useState<string | undefined>(initial?.img);
  const [dDesc, setDDesc] = useState(initial?.desc ?? '');
  const [dSpecs, setDSpecs] = useState<MtDishSpec[]>(initial?.specs ?? []);
  const [specEdit, setSpecEdit] = useState<number | null>(null); // 编辑中的规格组下标（-1 = 新增）
  const [specDraft, setSpecDraft] = useState<SpecDraft | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);

  const valid = dName.trim().length > 0 && Number.isFinite(num(dPrice)) && num(dPrice) >= 0;

  const pickImg = async (f: File | null | undefined) => {
    if (!f) return;
    setImgBusy(true);
    try {
      setDImg(await readImageFile(f, 720));
    } catch {
      /* 忽略：保留原图 */
    }
    setImgBusy(false);
  };

  return (
    <div className="flex h-full flex-col bg-[#F7F8FA]" data-testid="mt-dish-page">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 bg-white px-3 pb-3 pt-[54px]">
        <button type="button" aria-label="返回" data-testid="mt-dish-page-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-5 w-5 text-black/70" />
        </button>
        <p className="text-[16px] font-bold text-black/85">{initial ? '编辑菜品' : '添加菜品'}</p>
        <span className="ml-auto flex max-w-[110px] items-center gap-1 truncate rounded-full bg-[#FFF3C4] px-2.5 py-1 text-[11px] text-black/60">
          <UtensilsCrossed className="h-3 w-3 shrink-0 text-[#8A6A00]" />
          <span className="truncate">{catName}</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 菜品图片 */}
        <div className="rounded-2xl bg-white p-3.5 ring-1 ring-black/[0.03]">
          <p className="text-[14px] font-bold text-black/80">菜品图片</p>
          <p className="mt-0.5 text-[11px] text-black/35">不上传也可以，会按菜名自动配一个线条图标</p>
          <button
            type="button"
            data-testid="mt-dish-img"
            onClick={() => imgRef.current?.click()}
            className="relative mt-2.5 block h-[150px] w-full overflow-hidden rounded-xl active:opacity-90"
            aria-label="上传菜品图片"
          >
            {dImg ? (
              <>
                <img src={dImg} alt="菜品图" className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/55 to-transparent pb-1.5 pt-6 text-[11px] text-white">
                  <ImagePlus className="h-3.5 w-3.5" />
                  更换图片
                </span>
              </>
            ) : (
              <span className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-black/15 bg-[#FAFAFB] text-black/35">
                {imgBusy ? (
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-black/15 border-t-[#FFD100]" />
                ) : (
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[#FFF3C4]">
                    <ImagePlus className="h-5 w-5 text-[#8A6A00]" strokeWidth={1.8} />
                  </span>
                )}
                <span className="text-[12px]">上传菜品图片</span>
              </span>
            )}
          </button>
          <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { void pickImg(e.target.files?.[0]); e.target.value = ''; }} />
        </div>

        {/* 基本信息 */}
        <div className="mt-3 rounded-2xl bg-white p-3.5 ring-1 ring-black/[0.03]">
          <p className="text-[14px] font-bold text-black/80">基本信息</p>
          <div className="mt-2.5 flex flex-col gap-2.5">
            <div>
              <p className="mb-1.5 text-[12px] text-black/45">菜品名称</p>
              <input value={dName} onChange={(e) => setDName(e.target.value)} placeholder="例：杨枝甘露 / 珍珠奶茶" data-testid="mt-dish-name" className={inputCls} maxLength={14} />
            </div>
            <div>
              <p className="mb-1.5 text-[12px] text-black/45">售价（元）</p>
              <div className="flex h-11 items-center rounded-xl bg-[#FFF0EB] px-3">
                <span className="text-[15px] font-bold" style={{ color: MT_PRICE }}>¥</span>
                <input
                  value={dPrice}
                  onChange={(e) => setDPrice(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0.00"
                  data-testid="mt-dish-price"
                  className="h-full w-full bg-transparent pl-1.5 text-[15px] font-semibold outline-none placeholder:text-[#FF4B33]/30"
                  style={{ color: MT_PRICE }}
                  inputMode="decimal"
                />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[12px] text-black/45">一句话描述（可选）</p>
              <input value={dDesc} onChange={(e) => setDDesc(e.target.value)} placeholder="例：大颗芒果 + 浓稠酸奶" className={inputCls} maxLength={30} />
            </div>
          </div>
        </div>

        {/* 快捷模板 */}
        <div className="mt-3 rounded-2xl bg-white p-3.5 ring-1 ring-black/[0.03]">
          <p className="text-[14px] font-bold text-black/80">快捷规格模板</p>
          <p className="mt-0.5 text-[11px] text-black/35">一键生成整组规格，填充后每一项都能改价格 / 内容</p>
          <div className="mt-2.5 flex gap-2.5">
            <button
              type="button"
              data-testid="mt-dish-tea-template"
              onClick={() => setDSpecs(milkTeaTemplate())}
              className="flex flex-1 items-center gap-2.5 rounded-xl bg-[#FFFDF2] p-3 text-left ring-1 ring-[#FFD100]/55 active:opacity-80"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FFF3C4] to-[#FFD100]/70">
                <CupSoda className="h-5 w-5 text-[#8A4B00]" strokeWidth={1.8} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-black/85">奶茶模板</span>
                <span className="block text-[10px] leading-snug text-black/40">大中小杯定价 · 温度 · 小料 · 糖度</span>
              </span>
            </button>
            <button
              type="button"
              data-testid="mt-dish-side-template"
              onClick={() => setDSpecs(sideDishTemplate())}
              className="flex flex-1 items-center gap-2.5 rounded-xl bg-[#FAFAFB] p-3 text-left ring-1 ring-black/[0.05] active:opacity-80"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#F4F5F7]">
                <UtensilsCrossed className="h-5 w-5 text-black/55" strokeWidth={1.8} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-black/85">小菜模板</span>
                <span className="block text-[10px] leading-snug text-black/40">米饭 / 鸡蛋 / 可乐等多选加价</span>
              </span>
            </button>
          </div>
        </div>

        {/* 规格组 */}
        <div className="mt-3 rounded-2xl bg-white p-3.5 ring-1 ring-black/[0.03]">
          <div className="flex items-center">
            <p className="text-[14px] font-bold text-black/80">规格组（{dSpecs.length}）</p>
            <span className="ml-auto text-[11px] text-black/35">奶茶的小料、杯型，食物的小菜都在这里</span>
          </div>
          <div className="mt-2.5 flex flex-col gap-2">
            {dSpecs.map((s, i) => (
              <div key={`${s.name}-${i}`} className="flex items-center gap-2 rounded-xl bg-[#FAFAFB] px-3 py-2.5 ring-1 ring-black/[0.04]">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-black/80">
                    {s.name}
                    <span className="rounded bg-[#FFF3C4] px-1 py-px text-[9px] font-normal text-[#8A6A00]">{s.multi ? `多选 · 最多${s.max ?? 1}份` : '单选'}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-black/40">
                    {s.options.map((o) => `${o.label}${o.price ? `+${money(o.price)}` : ''}`).join(' / ')}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`编辑规格组${s.name}`}
                  onClick={() => {
                    setSpecDraft({ name: s.name, multi: !!s.multi, max: s.max ?? 1, options: s.options.map((o) => ({ label: o.label, price: o.price ?? 0 })) });
                    setSpecEdit(i);
                  }}
                  className="grid h-8 w-8 place-items-center rounded-full bg-white text-black/45 ring-1 ring-black/[0.06] active:bg-black/5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label={`删除规格组${s.name}`} onClick={() => setDSpecs((p) => p.filter((_, k) => k !== i))} className="grid h-8 w-8 place-items-center rounded-full bg-white text-black/35 ring-1 ring-black/[0.06] active:bg-black/5">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              data-testid="mt-dish-add-spec"
              onClick={() => {
                setSpecDraft({ name: '', multi: false, max: 1, options: [{ label: '', price: 0 }] });
                setSpecEdit(-1);
              }}
              className="flex h-10 items-center justify-center gap-1 rounded-xl border border-dashed border-black/15 text-[13px] text-black/50 active:bg-black/[0.03]"
            >
              <Plus className="h-4 w-4" />
              自定义规格组
            </button>
          </div>
        </div>

        {/* 删除菜品（编辑态） */}
        {initial && onDelete && (
          <button
            type="button"
            data-testid="mt-dish-delete"
            onClick={() => {
              if (!confirmDel) {
                setConfirmDel(true);
                window.setTimeout(() => setConfirmDel(false), 3000);
                return;
              }
              onDelete(initial);
            }}
            className={`mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-full text-[14px] font-medium transition-colors ${confirmDel ? 'bg-[#FF4B33] text-white' : 'bg-white text-[#FF4B33] ring-1 ring-[#FF4B33]/25'}`}
          >
            <Trash2 className="h-4 w-4" />
            {confirmDel ? '再点一次确认删除' : '删除这道菜'}
          </button>
        )}
      </div>

      {/* 底部保存 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 pb-7 pt-3">
        <button
          type="button"
          disabled={!valid}
          data-testid="mt-dish-save"
          onClick={() => {
            onSave({
              id: initial?.id ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
              name: dName.trim(),
              price: num(dPrice),
              emoji: mtAutoEmoji(dName),
              img: dImg,
              desc: dDesc.trim() || undefined,
              monthSale: initial?.monthSale ?? 88,
              sig: initial?.sig,
              specs: dSpecs.length > 0 ? dSpecs : undefined,
            });
          }}
          className={`h-12 w-full rounded-full text-[15px] font-bold ${valid ? 'text-black/85 active:opacity-85' : 'opacity-40'}`}
          style={{ background: MT_YELLOW }}
        >
          保存菜品
        </button>
      </div>

      {/* 规格组编辑弹层 */}
      <AnimatePresence>
        {specEdit !== null && specDraft && (
          <SpecEditSheet
            key="mt-spec-layer"
            initial={specEdit >= 0 ? specDraft : null}
            onClose={() => setSpecEdit(null)}
            onDone={(d) => {
              setDSpecs((p) => {
                const next = [...p];
                const row = { name: d.name, multi: d.multi, max: d.multi ? d.max : undefined, options: d.options };
                if (specEdit >= 0) next[specEdit] = row;
                else next.push(row);
                return next;
              });
              setSpecEdit(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

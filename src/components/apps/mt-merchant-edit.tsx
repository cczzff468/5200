'use client';

/**
 * 商家入驻 / 编辑店铺（美团「我的-入驻美团」）：
 * - 店铺信息：店名、店铺背景图（上传压缩 dataURL）、分类多选、公告、地址、起送价、配送费；
 * - 菜单管理：分区（可增删）+ 菜品（名称/价格/图片/描述）+ 规格组编辑器：
 *   「🧋 奶茶模板」一键生成 大杯/中杯/小杯定价 + 温度 + 小料(多选加价) + 糖度，
 *   「＋小菜模板」生成多选加价小菜组；每项价格均可再编辑（规格组编辑器）；
 * - 店铺优惠券：满 X 减 Y 自建（保存后详情页可领，自动派生首页满减角标）；
 * - 保存 → mtSaveShops（按账号隔离）+ mtRegisterAiMerchant（详情页/搜索/AI 代点即时生效）。
 */
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  ChevronLeft,
  ImagePlus,
  Pencil,
  Plus,
  Store,
  Ticket,
  Trash2,
  X,
} from 'lucide-react';
import {
  mtAutoEmoji,
  mtRegisterAiMerchant,
  type MtDish,
  type MtDishSpec,
  type MtMerchant,
  type MtShopCouponDef,
} from '@/lib/ios/meituan-data';
import {
  mtCurAddrId,
  mtLoadAddresses,
  mtLoadShops,
  mtSaveShops,
  mtUidOf,
  type MtSession,
} from '@/lib/ios/meituan-store';
import { readImageFile } from './wechat';

const MT_YELLOW = '#FFD100';
const MT_PRICE = '#FF4B33';

/** 入驻可选分类（首页分类宫格映射的商家筛选 id 子集） */
const JOIN_CATS: { id: string; name: string }[] = [
  { id: 'waimai', name: '外卖' },
  { id: 'meishi', name: '美食' },
  { id: 'yinyin', name: '甜点饮品' },
  { id: 'hamburg', name: '汉堡披萨' },
  { id: 'mala', name: '麻辣烫' },
  { id: 'zaocan', name: '早餐' },
  { id: 'chaoshi', name: '超市便利' },
  { id: 'shuiguo', name: '水果' },
];

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

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
};
const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const inputCls =
  'h-10 w-full rounded-xl bg-[#F4F5F7] px-3 text-[14px] text-black/85 outline-none placeholder:text-black/25 focus:bg-white focus:ring-1 focus:ring-[#FFD100]';

// ================================ 规格组编辑弹层 ================================

interface SpecDraft {
  name: string;
  multi: boolean;
  max: number;
  options: { label: string; price: number }[];
}

function SpecEditSheet({
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
      <button type="button" aria-label="关闭规格组编辑" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
        className="absolute inset-x-0 bottom-0 flex max-h-[88%] flex-col rounded-t-2xl bg-white"
      >
        <div className="relative flex shrink-0 items-center justify-center border-b border-black/5 py-3.5">
          <p className="text-[15px] font-bold text-black/85">{initial ? '编辑规格组' : '添加规格组'}</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full active:bg-black/5">
            <X className="h-5 w-5 text-black/50" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-1.5 text-[12px] text-black/45">组名（如 规格 / 小料 / 小菜 / 辣度）</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：小料" className={inputCls} maxLength={6} />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMulti(false)}
              className={`h-8 rounded-full px-4 text-[13px] ${!multi ? 'bg-[#FFF3C4] font-semibold text-black/85 ring-1 ring-[#FFD100]' : 'bg-[#F4F5F7] text-black/50'}`}
            >
              单选
            </button>
            <button
              type="button"
              onClick={() => setMulti(true)}
              className={`h-8 rounded-full px-4 text-[13px] ${multi ? 'bg-[#FFF3C4] font-semibold text-black/85 ring-1 ring-[#FFD100]' : 'bg-[#F4F5F7] text-black/50'}`}
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
          <p className="mb-1.5 mt-3 text-[12px] text-black/45">选项（加价 0 表示不加价，可填负数表示减价）</p>
          <div className="flex flex-col gap-2">
            {opts.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={o.label}
                  onChange={(e) => setOpts((p) => p.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
                  placeholder={`选项 ${i + 1}（如 大杯 / 珍珠）`}
                  className={`${inputCls} flex-1`}
                  maxLength={10}
                />
                <span className="text-[13px] text-black/40">¥</span>
                <input
                  value={o.price}
                  onChange={(e) => setOpts((p) => p.map((x, k) => (k === i ? { ...x, price: e.target.value.replace(/[^\d.-]/g, '') } : x)))}
                  className={`${inputCls} !h-10 w-[62px] text-center`}
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
            className="mt-2.5 flex h-9 w-full items-center justify-center gap-1 rounded-xl border border-dashed border-black/15 text-[13px] text-black/50 active:bg-black/[0.03]"
          >
            <Plus className="h-4 w-4" />
            加选项
          </button>
        </div>
        <div className="shrink-0 border-t border-black/5 p-4 pb-7">
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
            className={`h-11 w-full rounded-full text-[15px] font-semibold ${valid ? 'text-black/85 active:opacity-85' : 'opacity-40'}`}
            style={{ background: MT_YELLOW }}
          >
            完成
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ================================ 菜品编辑弹层 ================================

function DishEditSheet({
  catName,
  initial,
  onClose,
  onSave,
}: {
  catName: string;
  initial: MtDish | null;
  onClose: () => void;
  onSave: (d: MtDish) => void;
}) {
  const [dName, setDName] = useState(initial?.name ?? '');
  const [dPrice, setDPrice] = useState(initial ? money(initial.price) : '');
  const [dImg, setDImg] = useState<string | undefined>(initial?.img);
  const [dDesc, setDDesc] = useState(initial?.desc ?? '');
  const [dSpecs, setDSpecs] = useState<MtDishSpec[]>(initial?.specs ?? []);
  const [specEdit, setSpecEdit] = useState<number | null>(null); // 编辑中的规格组下标（-1 = 新增）
  const [specDraft, setSpecDraft] = useState<SpecDraft | null>(null);
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
    <motion.div
      key="mt-dish-edit"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[60]"
      data-testid="mt-dish-sheet"
    >
      <button type="button" aria-label="关闭菜品编辑" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
        className="absolute inset-x-0 bottom-0 flex max-h-[90%] flex-col rounded-t-2xl bg-white"
      >
        <div className="relative flex shrink-0 items-center justify-center border-b border-black/5 py-3.5">
          <p className="text-[15px] font-bold text-black/85">{initial ? '编辑菜品' : '添加菜品'} · {catName}</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full active:bg-black/5">
            <X className="h-5 w-5 text-black/50" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* 图片 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => imgRef.current?.click()}
              className="relative grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-xl bg-[#F4F5F7] active:opacity-80"
              aria-label="上传菜品图片"
            >
              {dImg ? (
                <img src={dImg} alt="菜品图" className="h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-black/35">
                  {imgBusy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/20 border-t-black/50" /> : <Camera className="h-6 w-6" strokeWidth={1.6} />}
                  <span className="text-[10px]">上传图片</span>
                </span>
              )}
              {dImg && !imgBusy && (
                <span className="absolute bottom-0 inset-x-0 bg-black/45 py-0.5 text-center text-[9px] text-white">更换</span>
              )}
            </button>
            <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { void pickImg(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="min-w-0 flex-1">
              <input value={dName} onChange={(e) => setDName(e.target.value)} placeholder="菜品名称（如 杨枝甘露）" className={inputCls} maxLength={14} />
              <div className="mt-2 flex items-center rounded-xl bg-[#FFF0EB] px-3">
                <span className="text-[13px] font-semibold" style={{ color: MT_PRICE }}>¥</span>
                <input
                  value={dPrice}
                  onChange={(e) => setDPrice(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0.00"
                  className="h-10 w-full bg-transparent pl-1 text-[14px] font-semibold outline-none placeholder:text-[#FF4B33]/30"
                  style={{ color: MT_PRICE }}
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>
          <input value={dDesc} onChange={(e) => setDDesc(e.target.value)} placeholder="一句话描述（可选，如 大颗芒果+浓稠酸奶）" className={`${inputCls} mt-2.5`} maxLength={30} />

          {/* 快捷模板 */}
          <p className="mb-1.5 mt-3.5 text-[12px] text-black/45">快捷规格模板（填充后每一项都能改价格/内容）</p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="mt-dish-tea-template"
              onClick={() => setDSpecs(milkTeaTemplate())}
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-[#FFF3C4] text-[13px] font-medium text-black/80 ring-1 ring-[#FFD100]/60 active:opacity-80"
            >
              🧋 奶茶模板
            </button>
            <button
              type="button"
              data-testid="mt-dish-side-template"
              onClick={() => setDSpecs(sideDishTemplate())}
              className="flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-[#F4F5F7] text-[13px] font-medium text-black/70 active:opacity-80"
            >
              🍚 小菜模板
            </button>
          </div>

          {/* 规格组列表 */}
          <p className="mb-1.5 mt-3.5 text-[12px] text-black/45">规格组（{dSpecs.length}）— 奶茶的小料、杯型，食物的小菜都在这里</p>
          <div className="flex flex-col gap-2">
            {dSpecs.map((s, i) => (
              <div key={`${s.name}-${i}`} className="flex items-center gap-2 rounded-xl bg-[#FAFAFB] px-3 py-2.5 ring-1 ring-black/[0.04]">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-black/80">
                    {s.name}
                    <span className="rounded bg-black/[0.05] px-1 py-px text-[9px] font-normal text-black/45">{s.multi ? `多选·最多${s.max ?? 1}份` : '单选'}</span>
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
                  className="grid h-8 w-8 place-items-center rounded-full text-black/45 active:bg-black/5"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" aria-label={`删除规格组${s.name}`} onClick={() => setDSpecs((p) => p.filter((_, k) => k !== i))} className="grid h-8 w-8 place-items-center rounded-full text-black/35 active:bg-black/5">
                  <Trash2 className="h-4 w-4" />
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
              className="flex h-9 items-center justify-center gap-1 rounded-xl border border-dashed border-black/15 text-[13px] text-black/50 active:bg-black/[0.03]"
            >
              <Plus className="h-4 w-4" />
              自定义规格组
            </button>
          </div>
        </div>

        <div className="shrink-0 border-t border-black/5 p-4 pb-7">
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
            className={`h-11 w-full rounded-full text-[15px] font-semibold ${valid ? 'text-black/85 active:opacity-85' : 'opacity-40'}`}
            style={{ background: MT_YELLOW }}
          >
            保存菜品
          </button>
        </div>
      </motion.div>

      {/* 规格组编辑（叠在菜品弹层之上） */}
      <AnimatePresence>
        {specEdit !== null && specDraft && (
          <SpecEditSheet
            key="mt-spec-layer"
            initial={specEdit >= 0 ? specDraft : null}
            onClose={() => setSpecEdit(null)}
            onDone={(d) => {
              setDSpecs((p) => {
                const next = [...p];
                if (specEdit >= 0) next[specEdit] = { name: d.name, multi: d.multi, max: d.multi ? d.max : undefined, options: d.options };
                else next.push({ name: d.name, multi: d.multi, max: d.multi ? d.max : undefined, options: d.options });
                return next;
              });
              setSpecEdit(null);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ================================ 入驻 / 编辑主页 ================================

export default function MerchantEditPage({
  session,
  editId,
  onBack,
  onSaved,
  onToast,
}: {
  session: MtSession;
  /** 有值 = 编辑已有店铺；空 = 新入驻 */
  editId: string | null;
  onBack: () => void;
  /** 保存成功（id） */
  onSaved: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const uidKey = mtUidOf(session);
  const editing = editId ? mtLoadShops(uidKey).find((s) => s.id === editId) : undefined;
  const defAddr = (() => {
    try {
      const addrs = mtLoadAddresses(uidKey);
      return addrs.find((a) => a.id === mtCurAddrId(uidKey))?.text ?? addrs[0]?.text ?? '';
    } catch {
      return '';
    }
  })();

  const [name, setName] = useState(editing?.name ?? '');
  const [cover, setCover] = useState<string | undefined>(editing?.cover);
  const [cats, setCats] = useState<string[]>(editing?.cats?.filter((c) => JOIN_CATS.some((j) => j.id === c)) ?? []);
  const [notice, setNotice] = useState(editing?.notice ?? '');
  const [addr, setAddr] = useState(editing?.addr ?? defAddr);
  const [minOrder, setMinOrder] = useState(editing ? money(editing.minOrder) : '0');
  const [deliveryFee, setDeliveryFee] = useState(editing ? money(editing.deliveryFee) : '2');
  const [sections, setSections] = useState<{ cat: string; dishes: MtDish[] }[]>(
    editing?.sections ?? [
      { cat: '招牌推荐', dishes: [] },
      { cat: '热销爆款', dishes: [] },
    ]
  );
  const [coupons, setCoupons] = useState<MtShopCouponDef[]>(editing?.coupons ?? []);
  const [cName, setCName] = useState('店铺满减券');
  const [cMin, setCMin] = useState('');
  const [cAmount, setCAmount] = useState('');
  const [newCat, setNewCat] = useState('');
  const [dishSheet, setDishSheet] = useState<{ catIdx: number; dish: MtDish | null } | null>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const [bgBusy, setBgBusy] = useState(false);

  const pickBg = async (f: File | null | undefined) => {
    if (!f) return;
    setBgBusy(true);
    try {
      setCover(await readImageFile(f, 1280));
    } catch {
      onToast('图片读取失败，换一张试试');
    }
    setBgBusy(false);
  };

  const save = () => {
    const n = name.trim();
    if (!n) {
      onToast('先给店铺起个名字吧');
      return;
    }
    if (cats.length === 0) {
      onToast('至少选择一个店铺分类');
      return;
    }
    const dishCount = sections.reduce((acc, s) => acc + s.dishes.length, 0);
    if (dishCount === 0) {
      onToast('至少添加一道菜品');
      return;
    }
    const cleanSections = sections
      .map((s) => ({ cat: s.cat.trim(), dishes: s.dishes }))
      .filter((s) => s.cat && s.dishes.length > 0);
    if (cleanSections.length === 0) {
      onToast('菜品分区不能为空');
      return;
    }
    const minO = num(minOrder);
    const fee = num(deliveryFee);
    const shop: MtMerchant = {
      id: editing?.id ?? `my-shop-${Date.now().toString(36)}`,
      name: n,
      emoji: editing?.emoji ?? mtAutoEmoji(n),
      cover,
      cats,
      rating: editing?.rating ?? 4.8,
      monthSale: editing?.monthSale ?? 88,
      minOrder: Number.isFinite(minO) && minO >= 0 ? minO : 0,
      deliveryFee: Number.isFinite(fee) && fee >= 0 ? fee : 2,
      distanceKm: editing?.distanceKm ?? 0.6,
      deliveryMin: editing?.deliveryMin ?? 28,
      notice: notice.trim() || undefined,
      deals: coupons.map((c) => `满${money(c.min)}减${money(c.amount)}`),
      hours: '10:00 - 22:00',
      addr: addr.trim() || '附近',
      sections: cleanSections,
      reviews: editing?.reviews ?? [],
      mine: true,
      coupons,
      mtStatus: editing?.mtStatus ?? 'open',
    };
    const list = mtLoadShops(uidKey);
    mtSaveShops(uidKey, editing ? list.map((s) => (s.id === editing.id ? shop : s)) : [shop, ...list]);
    // 即时注册进运行时注册表：详情页/搜索/AI 代点不需要重启就生效（同 id 覆盖）
    mtRegisterAiMerchant(shop);
    onToast(editing ? '店铺已保存' : '入驻成功，店铺已上架到首页');
    onSaved(shop.id);
  };

  const addCoupon = () => {
    const mn = num(cMin);
    const am = num(cAmount);
    if (!Number.isFinite(mn) || mn <= 0 || !Number.isFinite(am) || am <= 0) {
      onToast('先填好「满」和「减」金额');
      return;
    }
    if (am > mn) {
      onToast('减免金额不能超过使用门槛');
      return;
    }
    setCoupons((p) => [...p, { id: `sc${Date.now().toString(36)}${p.length}`, name: cName.trim() || '店铺满减券', amount: am, min: mn }]);
    setCMin('');
    setCAmount('');
    setCName('店铺满减券');
  };

  const dishTotal = sections.reduce((acc, s) => acc + s.dishes.length, 0);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/5 bg-white px-3 pb-3 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-5 w-5 text-black/70" />
        </button>
        <p className="text-[16px] font-bold text-black/85">{editing ? '编辑店铺' : '入驻美团'}</p>
        <span className="ml-auto rounded-full bg-[#FFF3C4] px-2 py-0.5 text-[10px] text-black/55">开店后店铺会出现在首页</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* 店铺信息 */}
        <div className="px-4 pt-4">
          <p className="flex items-center gap-1.5 text-[15px] font-bold text-black/85">
            <Store className="h-4 w-4 text-black/60" strokeWidth={1.9} />
            店铺信息
          </p>
          {/* 背景图 */}
          <button
            type="button"
            data-testid="mt-shop-bg"
            onClick={() => bgRef.current?.click()}
            className="relative mt-3 block h-28 w-full overflow-hidden rounded-2xl bg-[#F4F5F7] ring-1 ring-black/[0.04] active:opacity-90"
            aria-label="上传店铺背景图"
          >
            {cover ? (
              <>
                <img src={cover} alt="店铺背景" className="h-full w-full object-cover" />
                <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white">更换背景图</span>
              </>
            ) : (
              <span className="flex h-full flex-col items-center justify-center gap-1.5 border border-dashed border-black/15 text-black/35">
                {bgBusy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/15 border-t-black/45" /> : <ImagePlus className="h-6 w-6" strokeWidth={1.6} />}
                <span className="text-[12px]">上传店铺背景图</span>
              </span>
            )}
          </button>
          <input ref={bgRef} type="file" accept="image/*" hidden onChange={(e) => { void pickBg(e.target.files?.[0]); e.target.value = ''; }} />

          <div className="mt-3">
            <p className="mb-1.5 text-[12px] text-black/45">店铺名称</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：琳琳的奶茶铺" data-testid="mt-shop-name" className={inputCls} maxLength={16} />
          </div>

          <p className="mb-1.5 mt-3 text-[12px] text-black/45">店铺分类（可多选）</p>
          <div className="flex flex-wrap gap-2">
            {JOIN_CATS.map((c) => {
              const on = cats.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`mt-cat-${c.id}`}
                  onClick={() => setCats((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  className={`h-8 rounded-full px-3.5 text-[13px] transition-colors ${on ? 'bg-[#FFF3C4] font-semibold text-black/85 ring-1 ring-[#FFD100]' : 'bg-[#F4F5F7] text-black/50'}`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            <p className="mb-1.5 text-[12px] text-black/45">店铺公告（可选）</p>
            <input value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="例：新店开业，全场上新价" className={inputCls} maxLength={24} />
          </div>
          <div className="mt-3">
            <p className="mb-1.5 text-[12px] text-black/45">店铺地址</p>
            <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="例：望京街道方恒国际中心B座" className={inputCls} maxLength={30} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-[12px] text-black/45">起送价（¥）</p>
              <input value={minOrder} onChange={(e) => setMinOrder(e.target.value.replace(/[^\d.]/g, ''))} className={`${inputCls} text-center`} inputMode="decimal" placeholder="0" />
            </div>
            <div>
              <p className="mb-1.5 text-[12px] text-black/45">配送费（¥）</p>
              <input value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value.replace(/[^\d.]/g, ''))} className={`${inputCls} text-center`} inputMode="decimal" placeholder="2" />
            </div>
          </div>
        </div>

        {/* 菜单管理 */}
        <div className="mt-6 px-4">
          <div className="flex items-center">
            <p className="text-[15px] font-bold text-black/85">菜单管理</p>
            <span className="ml-2 text-[12px] text-black/35">共 {dishTotal} 道菜</span>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {sections.map((sec, si) => (
              <div key={si} className="rounded-2xl bg-[#FAFAFB] ring-1 ring-black/[0.04]">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: MT_YELLOW }} />
                  <input
                    value={sec.cat}
                    onChange={(e) => setSections((p) => p.map((s, k) => (k === si ? { ...s, cat: e.target.value } : s)))}
                    className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-black/85 outline-none"
                    maxLength={8}
                  />
                  <span className="text-[11px] text-black/35">{sec.dishes.length}道</span>
                  <button
                    type="button"
                    data-testid={`mt-sec-add-dish-${si}`}
                    onClick={() => setDishSheet({ catIdx: si, dish: null })}
                    className="flex h-7 items-center gap-0.5 rounded-full px-2.5 text-[12px] font-medium text-black/70 active:bg-black/5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    加菜
                  </button>
                  <button
                    type="button"
                    aria-label={`删除分区${sec.cat}`}
                    onClick={() => {
                      setSections((p) => p.filter((_, k) => k !== si));
                      if (sec.dishes.length > 0) onToast(`已删除分区「${sec.cat}」及 ${sec.dishes.length} 道菜`);
                    }}
                    className="grid h-7 w-7 place-items-center rounded-full text-black/30 active:bg-black/5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {sec.dishes.length > 0 && (
                  <div className="flex flex-col gap-1 px-3 pb-2.5">
                    {sec.dishes.map((d) => (
                      <div key={d.id} className="flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2 ring-1 ring-black/[0.04]">
                        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-[#F4F5F7]">
                          {d.img ? (
                            <img src={d.img} alt={d.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="grid h-full w-full place-items-center text-[18px]">{d.emoji}</span>
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-black/85">
                            {d.name}
                            {d.specs && d.specs.length > 0 && <span className="ml-1.5 rounded bg-[#FFF3C4] px-1 py-px text-[9px] text-black/55">{d.specs.length}组规格</span>}
                          </p>
                          <p className="text-[11px] text-black/40">
                            ¥{money(d.price)}
                            {d.specs && d.specs.length > 0 && ` · ${d.specs.map((s) => s.name).join('/')}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`编辑菜品${d.name}`}
                          onClick={() => setDishSheet({ catIdx: si, dish: d })}
                          className="grid h-7 w-7 place-items-center rounded-full text-black/40 active:bg-black/5"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除菜品${d.name}`}
                          onClick={() => setSections((p) => p.map((s, k) => (k === si ? { ...s, dishes: s.dishes.filter((x) => x.id !== d.id) } : s)))}
                          className="grid h-7 w-7 place-items-center rounded-full text-black/30 active:bg-black/5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* 加分区 */}
          <div className="mt-3 flex items-center gap-2">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newCat.trim()) {
                  setSections((p) => [...p, { cat: newCat.trim(), dishes: [] }]);
                  setNewCat('');
                }
              }}
              placeholder="新分区名（如 主食 / 小吃 / 饮品）"
              className={inputCls}
              maxLength={8}
            />
            <button
              type="button"
              data-testid="mt-add-section"
              onClick={() => {
                if (!newCat.trim()) {
                  onToast('先填分区名');
                  return;
                }
                setSections((p) => [...p, { cat: newCat.trim(), dishes: [] }]);
                setNewCat('');
              }}
              className="flex h-10 shrink-0 items-center gap-1 rounded-xl bg-[#F4F5F7] px-4 text-[13px] font-medium text-black/70 active:bg-black/[0.06]"
            >
              <Plus className="h-4 w-4" />
              加分区
            </button>
          </div>
        </div>

        {/* 店铺优惠券 */}
        <div className="mt-6 px-4">
          <p className="flex items-center gap-1.5 text-[15px] font-bold text-black/85">
            <Ticket className="h-4 w-4 text-black/60" strokeWidth={1.9} />
            店铺优惠券
            <span className="ml-1 text-[11px] font-normal text-black/35">买家在店铺里领取，下单自动抵扣</span>
          </p>
          {coupons.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {coupons.map((c) => (
                <div key={c.id} className="flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#FFF3C4] to-[#FFEDAD] px-3 py-2.5 ring-1 ring-[#FFD100]/50">
                  <span className="text-[18px] font-bold text-[#8A4B00]">¥{money(c.amount)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-[#5A4200]">{c.name}</p>
                    <p className="text-[10px] text-[#5A4200]/65">满 ¥{money(c.min)} 可用 · 领取后 7 天有效</p>
                  </div>
                  <button type="button" aria-label={`删除优惠券${c.name}`} onClick={() => setCoupons((p) => p.filter((x) => x.id !== c.id))} className="grid h-7 w-7 place-items-center rounded-full text-[#5A4200]/50 active:bg-black/5">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <input value={cName} onChange={(e) => setCName(e.target.value)} className={`${inputCls} !h-9 w-[104px] shrink-0 !px-2.5 !text-[12px]`} maxLength={8} />
            <span className="shrink-0 text-[12px] text-black/45">满</span>
            <input value={cMin} onChange={(e) => setCMin(e.target.value.replace(/[^\d.]/g, ''))} placeholder="20" className={`${inputCls} !h-9 !w-[58px] shrink-0 !px-2 text-center !text-[13px]`} inputMode="decimal" data-testid="mt-coupon-min" />
            <span className="shrink-0 text-[12px] text-black/45">减</span>
            <input value={cAmount} onChange={(e) => setCAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="5" className={`${inputCls} !h-9 !w-[58px] shrink-0 !px-2 text-center !text-[13px]`} inputMode="decimal" data-testid="mt-coupon-amount" />
            <button
              type="button"
              data-testid="mt-coupon-add"
              onClick={addCoupon}
              className="flex h-9 shrink-0 items-center gap-0.5 rounded-xl bg-[#F4F5F7] px-3 text-[13px] font-medium text-black/70 active:bg-black/[0.06]"
            >
              <Plus className="h-4 w-4" />
              添加
            </button>
          </div>
        </div>

        <p className="px-6 pb-2 pt-5 text-center text-[11px] leading-relaxed text-black/25">
          提交后店铺立即上架到首页瀑布流顶部，买家可以点进店铺下单；
          <br />
          店铺、菜单、券都保存在本机，按账号隔离。
        </p>
      </div>

      {/* 底部提交 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 pb-7 pt-3">
        <button
          type="button"
          data-testid="mt-shop-submit"
          onClick={save}
          className="h-12 w-full rounded-full text-[15px] font-bold text-black/85 active:opacity-85"
          style={{ background: MT_YELLOW }}
        >
          {editing ? '保存修改' : '提交入驻'}
        </button>
      </div>

      {/* 菜品编辑弹层 */}
      <AnimatePresence>
        {dishSheet && sections[dishSheet.catIdx] && (
          <DishEditSheet
            key={`dish-${dishSheet.catIdx}-${dishSheet.dish?.id ?? 'new'}`}
            catName={sections[dishSheet.catIdx].cat}
            initial={dishSheet.dish}
            onClose={() => setDishSheet(null)}
            onSave={(d) => {
              setSections((p) =>
                p.map((s, k) => {
                  if (k !== dishSheet.catIdx) return s;
                  const exists = s.dishes.some((x) => x.id === d.id);
                  return { ...s, dishes: exists ? s.dishes.map((x) => (x.id === d.id ? d : x)) : [...s.dishes, d] };
                })
              );
              setDishSheet(null);
              onToast('菜品已保存');
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

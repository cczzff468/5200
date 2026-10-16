'use client';

/**
 * 美团「创建订单」入库页（首页宫格入口）：
 * 任意类型订单都能添加（外卖/奶茶/数码/充值/电影票…自由填写）——
 * 图片可上传（相册文件选择，压缩落库）或用「设置 › 图像生成」配置的模型按自定义提示词生成；
 * 可填 类型 / 优惠券（名称+金额） / 规格选项组（小菜、奶茶小料、手机内存等，组名+值自由组合）/ 备注；
 * 保存 = 真实落库 mt-orders:<uid>（已完成状态），订单列表/详情立即可见。
 */

import { useRef, useState } from 'react';
import { ChevronLeft, ImagePlus, Loader2, PackagePlus, Plus, Trash2, Wand2, X } from 'lucide-react';
import { compressImageSrc, generateFreePhoto } from '@/lib/imggen';
import type { ImgGenConfig } from '@/lib/ios/store';
import { customSpecText, type OrderCustomOptionGroup } from '@/lib/ios/order-custom';
import { mtLoadAddresses, mtLoadOrders, mtSaveOrders, mtUidOf, type MtSession } from '@/lib/ios/meituan-store';
import { OrderImgGenSheet } from './order-img-gen';

/** 类型快捷选项 */
const TYPE_CHIPS = ['外卖', '奶茶甜饮', '团购', '手机数码', '充值缴费', '电影票', '生鲜果蔬', '日用百货', '其他'];
/** 规格组名快捷选项 */
const GROUP_CHIPS = ['小菜', '奶茶小料', '手机内存', '杯型', '温度', '颜色', '尺寸', '套餐'];

const fmtMoney = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function MtOrderCreatePage({
  session,
  onBack,
  onSaved,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  /** 保存成功（入库后跳订单列表） */
  onSaved: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const fileRef = useRef<HTMLInputElement>(null);
  // 图片（dataURL）
  const [img, setImg] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  // 表单
  const [itemName, setItemName] = useState('');
  const [type, setType] = useState('');
  const [shopName, setShopName] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState(1);
  const [couponName, setCouponName] = useState('');
  const [couponAmt, setCouponAmt] = useState('');
  const [note, setNote] = useState('');
  const [groups, setGroups] = useState<OrderCustomOptionGroup[]>([]);
  // 生图弹层
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState('');

  const itemTotal = Math.max(0, (parseFloat(price) || 0) * qty);
  const cut = Math.min(parseFloat(couponAmt) || 0, itemTotal);
  const total = Math.max(0, itemTotal - cut);

  const pickFile = async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      onToast('请选择图片文件');
      return;
    }
    setImgBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('读取失败'));
        fr.readAsDataURL(f);
      });
      const src = await compressImageSrc(dataUrl, 640, 0.88);
      setImg(src);
    } catch {
      onToast('图片读取失败，请重试');
    } finally {
      setImgBusy(false);
    }
  };

  const genImage = async (prompt: string, cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' }) => {
    setGenBusy(true);
    setGenErr('');
    try {
      const src = await generateFreePhoto(cfg, prompt);
      setImg(src);
      setGenOpen(false);
      onToast('图片已生成');
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setGenBusy(false);
    }
  };

  const setGroup = (i: number, patch: Partial<OrderCustomOptionGroup>) => {
    setGroups((gs) => gs.map((g, gi) => (gi === i ? { ...g, ...patch } : g)));
  };

  const save = () => {
    const name = itemName.trim();
    const shop = shopName.trim();
    const p = parseFloat(price);
    if (!name) {
      onToast('请填写商品名称');
      return;
    }
    if (!shop) {
      onToast('请填写店铺名称');
      return;
    }
    if (!Number.isFinite(p) || p < 0) {
      onToast('请填写正确的单价');
      return;
    }
    const spec = customSpecText(groups);
    const now = Date.now();
    const discount = Math.round(cut * 100) / 100;
    const order = {
      id: `mtc-${now.toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
      uid,
      merchantId: 'custom',
      merchantName: shop,
      merchantEmoji: '🛍️',
      merchantImg: img ?? undefined,
      items: [
        {
          dishId: `custom-${now.toString(36)}`,
          name,
          price: Math.round(p * 100) / 100,
          qty,
          emoji: '🛍️',
          img: img ?? undefined,
          ...(spec ? { spec } : {}),
        },
      ],
      itemTotal: Math.round(itemTotal * 100) / 100,
      deliveryFee: 0,
      discount,
      ...(couponName.trim() && discount > 0 ? { couponId: `custom-coupon-${now.toString(36)}`, couponAmount: discount } : {}),
      total: Math.round(total * 100) / 100,
      ...(note.trim() ? { note: note.trim() } : {}),
      kind: 'waimai' as const,
      address: mtLoadAddresses(uid)[0],
      status: 'completed' as const,
      createdAt: now,
      paidAt: now,
      statusLog: [
        { status: 'pendingAccept' as const, at: now },
        { status: 'completed' as const, at: now },
      ],
      custom: {
        ...(type.trim() ? { type: type.trim() } : {}),
        ...(couponName.trim() && discount > 0 ? { couponLabel: couponName.trim() } : {}),
        ...(groups.length > 0 ? { optionGroups: groups.filter((g) => g.name.trim() && g.values.length > 0) } : {}),
      },
    };
    // 前插入库（真实落库 + 广告刷新事件）
    mtSaveOrders(uid, [order, ...mtLoadOrders(uid)]);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onToast('订单已入库');
    onSaved();
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶栏 */}
      <div className="shrink-0 bg-white px-2 pb-2 pt-[54px]">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <span className="text-[17px] font-bold text-black/90">创建订单</span>
          <span className="ml-1.5 rounded-full bg-[#FFF3DC] px-2 py-0.5 text-[11px] font-medium text-[#B77900]">自建订单入库</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-6">
        {/* 图片卡 */}
        <div className="rounded-xl bg-white p-4">
          <p className="text-[15px] font-bold text-black/85">商品图片</p>
          <div className="mt-2.5 flex items-center gap-3">
            {img ? (
              <span className="relative block h-[84px] w-[84px] overflow-hidden rounded-lg bg-[#F5F6F7]">
                                <img src={img} alt="商品图片" className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="移除图片"
                  onClick={() => setImg(null)}
                  className="absolute right-1 top-1 grid h-[22px] w-[22px] place-items-center rounded-full bg-black/55 text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                data-testid="mt-create-upload"
                onClick={() => fileRef.current?.click()}
                className="grid h-[84px] w-[84px] place-items-center rounded-lg border border-dashed border-black/20 bg-[#FAFAFA] text-black/35 active:bg-black/[0.04]"
              >
                {imgBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-6 w-6" strokeWidth={1.8} />}
              </button>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-1.5 rounded-full border border-black/12 bg-white py-2 text-[13px] text-black/70 active:bg-black/[0.04]"
              >
                <ImagePlus className="h-4 w-4" strokeWidth={1.9} />
                上传图片
              </button>
              <button
                type="button"
                data-testid="mt-create-gen"
                onClick={() => setGenOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[#FFD100] py-2 text-[13px] font-medium text-black/85 active:opacity-85"
              >
                <Wand2 className="h-4 w-4" strokeWidth={2} />
                AI 生成图片
              </button>
              <p className="text-[10.5px] leading-[1.5] text-black/35">上传本机图片，或用 设置 › 图像生成 的模型按提示词生成</p>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>

        {/* 基本信息 */}
        <div className="mt-2.5 rounded-xl bg-white px-4 py-4">
          <p className="text-[15px] font-bold text-black/85">基本信息</p>
          <Field label="商品名称" required>
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              maxLength={30}
              placeholder="如：厚芋泥波波奶茶 / iPhone 256G"
              data-testid="mt-create-name"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
          <Field label="类型" required>
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              maxLength={12}
              placeholder="自由填写，如 外卖 / 充值缴费"
              data-testid="mt-create-type"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TYPE_CHIPS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] ${type === t ? 'bg-[#FFD100] font-medium text-black/85' : 'bg-[#F5F6F7] text-black/55'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>
          <Field label="单价（¥）" required>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              data-testid="mt-create-price"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
          <Field label="数量">
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <button type="button" aria-label="减少" onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid h-7 w-7 place-items-center rounded-full text-[18px] leading-none text-black/45 active:bg-black/5">
                <span className="mt-[-2px]">−</span>
              </button>
              <span className="grid h-[30px] min-w-[40px] place-items-center rounded-[5px] border border-black/15 bg-white px-1 text-[14px] font-medium">{qty}</span>
              <button type="button" aria-label="增加" onClick={() => setQty((q) => Math.min(99, q + 1))} className="grid h-7 w-7 place-items-center rounded-full text-[18px] leading-none text-black/45 active:bg-black/5">
                <span className="mt-[-2px]">＋</span>
              </button>
            </div>
          </Field>
          <Field label="店铺名称" required>
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              maxLength={20}
              placeholder="如：霸王茶姬（吾悦广场店）"
              data-testid="mt-create-shop"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
        </div>

        {/* 规格选项组 */}
        <div className="mt-2.5 rounded-xl bg-white px-4 py-4">
          <div className="flex items-center">
            <p className="text-[15px] font-bold text-black/85">规格选项</p>
            <span className="ml-1.5 text-[11px] text-black/35">小菜 / 奶茶小料 / 手机内存 等自由组合</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {GROUP_CHIPS.filter((g) => !groups.some((x) => x.name === g)).map((g) => (
              <button key={g} type="button" onClick={() => setGroups((gs) => [...gs, { name: g, values: [] }])} className="rounded-full border border-dashed border-black/20 px-2.5 py-1 text-[11.5px] text-black/55 active:bg-black/[0.04]">
                + {g}
              </button>
            ))}
          </div>
          {groups.map((g, i) => (
            <div key={i} className="mt-3 rounded-lg bg-[#FAFAFA] p-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={g.name}
                  onChange={(e) => setGroup(i, { name: e.target.value })}
                  maxLength={8}
                  placeholder="组名"
                  className="h-8 w-[96px] rounded-md border border-black/10 bg-white px-2 text-[12.5px] text-black/85 outline-none placeholder:text-black/30"
                />
                <button type="button" aria-label="删除该组" onClick={() => setGroups((gs) => gs.filter((_, gi) => gi !== i))} className="ml-auto grid h-7 w-7 place-items-center rounded-full text-black/35 active:bg-black/5">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input
                value={g.values.join('、')}
                onChange={(e) => setGroup(i, { values: e.target.value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean) })}
                placeholder="选项用、分隔，如：珍珠、椰果、芋圆"
                className="mt-2 h-9 w-full rounded-md border border-black/10 bg-white px-2 text-[12.5px] text-black/85 outline-none placeholder:text-black/30"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setGroups((gs) => [...gs, { name: '', values: [] }])}
            className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-black/15 py-2 text-[12.5px] text-black/45 active:bg-black/[0.03]"
          >
            <Plus className="h-3.5 w-3.5" />
            添加选项组
          </button>
        </div>

        {/* 优惠券 + 备注 */}
        <div className="mt-2.5 rounded-xl bg-white px-4 py-4">
          <p className="text-[15px] font-bold text-black/85">优惠与备注</p>
          <Field label="优惠券名称">
            <input
              value={couponName}
              onChange={(e) => setCouponName(e.target.value)}
              maxLength={16}
              placeholder="如：神券节满减券"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
          <Field label="优惠金额（¥）">
            <input
              value={couponAmt}
              onChange={(e) => setCouponAmt(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className="h-10 w-full rounded-lg bg-[#F5F6F7] px-3 text-[13.5px] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
          <Field label="备注">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={60}
              placeholder="订单备注（少冰 / 不要香菜…）"
              className="w-full resize-none rounded-lg bg-[#F5F6F7] px-3 py-2 text-[13.5px] leading-[1.6] text-black/85 outline-none placeholder:text-black/30"
            />
          </Field>
        </div>
      </div>

      {/* 底部合计 + 保存 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[13px] text-black/45">
            合计 <span className="text-[20px] font-bold text-black/90">¥{fmtMoney(total)}</span>
            {cut > 0 && <span className="ml-1.5 text-[11.5px] text-[#FF4B33]">已优惠 ¥{fmtMoney(cut)}</span>}
          </span>
          <button
            type="button"
            data-testid="mt-create-save"
            onClick={save}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#FFC300] to-[#FF9500] px-7 text-[15px] font-semibold text-black/90 active:opacity-85"
          >
            <PackagePlus className="h-[17px] w-[17px]" strokeWidth={2.1} />
            保存订单
          </button>
        </div>
      </div>

      {/* AI 生图弹层 */}
      <OrderImgGenSheet
        open={genOpen}
        title="AI 生成商品图片"
        initialPrompt={itemName.trim() ? `${itemName.trim()}${type.trim() ? `（${type.trim()}）` : ''} 商品实拍图，干净背景` : ''}
        busy={genBusy}
        error={genErr}
        accent="#FF6000"
        onSubmit={(p, cfg) => void genImage(p, cfg)}
        onClose={() => (genBusy ? undefined : setGenOpen(false))}
      />
    </div>
  );
}

/** 表单行（label 上、控件下的白卡内行） */
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-[12.5px] text-black/55">
        {label}
        {required && <span className="ml-0.5 text-[#F53F3F]">*</span>}
      </p>
      {children}
    </div>
  );
}

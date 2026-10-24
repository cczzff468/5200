'use client';

/* eslint-disable react-hooks/immutability -- R3F 动画需要每帧原地修改 three 对象 */

/**
 * 拾光小屋 3D —— Q版萌系小人 v2（纯程序化建模，自研造型）
 *
 * 设计目标「好看的头身比 + 精致的脸」：
 * - 约 2.2 头身：大圆头（微扁）+ 圆润短身短手短腿，无脖颈衔接的软萌轮廓；
 * - 脸：竖椭圆大眼睛（眼白+深棕瞳仁+双层高光+上眼线）、细弯眉、
 *   径向渐变腮红、小巧鼻子、微笑弧线嘴；随机眨眼 + 待机歪头；
 * - 发型（女主衣柜 v6.2）：双马尾 / 高马尾 / 短发 / 长直发 / 大波浪，干净中分八字刘海露眉眼（v6.3 重修：
 *   额心无发、删波波头式两侧垂发、背发贴脑勺）；
 *   男主衣柜 v6.3：顺滑短发 / 蓬松卷发 / 中分刘海 / 活力刺猬；
 * - 服装（女主 v6.2 + 男生 v6.3 + 调色盘）：连衣裙 ×4 / 分体上衣 ×4 / 半裙·短裤·长裤 / 鞋 ×4，
 *   男生上衣/裤子/鞋 ×4，hair/dress/top/bottom/shoes 均可自选色（wear.tints / wear2.tints），
 *   经 wear / wear2 prop 驱动，泡澡/淋浴自动脱衣；
 * - 骨架与姿势系统沿用 v5.4+：走路摆臂迈腿弹跳 / 呼吸 / 坐 / 躺 / 泡澡 / 淋浴 /
 *   做饭 / 吃饭 / 喝东西 / 弹琴 / 弹吉他 / 化妆 / 照镜子 / 看书，全部阻尼过渡；
 * - 道具：咖啡/冰饮（右手，站着会周期性举杯咪一口）、书（翻页）、Zzz、
 *   泡澡/淋浴泡沫、化妆星星、访客头顶名牌；弹琴/扫弦手部随音符脉冲。
 * - 朝向与移动由 GameLoop 每帧写 rt（与旧 Char3D 同接口，含 guest 访客）。
 */

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { onNote } from '../instrument';
import type { BoyWear, CharPose, CharRT, GirlWear } from '../types';
import { BOY_BOTTOMS, BOY_SHOES, BOY_TOPS, BOTTOMS, DRESSES, SHOES, TOPS } from '../wardrobe-data';

export interface CharChibi3DProps {
  rt: CharRT;
  who: 'me' | 'partner' | 'guest';
  /** 隐藏（第一人称时隐藏「我」） */
  hide?: boolean;
  /** 姿势（「我」专属；partner/访客永远站立） */
  poseRef?: RefObject<{ pose: CharPose; y: number }>;
  /** 手持物（true = 右手握小水杯，拿饮料/咖啡后端着到处逛；coffee = 咖啡款冒热气） */
  carryRef?: RefObject<{ cup: boolean; coffee?: boolean }>;
  /** 访客名牌（头顶浮名字牌；缺省不挂） */
  guestName?: string;
  /** 女主衣柜穿搭（who = 'me' 时生效：发型 + 连衣裙/分体 + 鞋 + 调色盘） */
  wear?: GirlWear;
  /** 男生衣柜穿搭（who = 'partner' 时生效：发型 + 上衣/裤子/鞋 + 调色盘） */
  wear2?: BoyWear;
}

/** 穿搭色板：skin 肤色 / hair 发色 / top 上衣(裙) / bottom 短裤(男主) / sock 袜 / shoes 鞋 / bow 发饰 / blush 腮红 */
interface Palette {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  sock: string;
  shoes: string;
  bow: string;
  blush: string;
}

const OUTFITS: Record<'me' | 'partner' | 'guest', Palette[]> = {
  me: [
    // 樱粉连衣裙（默认）
    { skin: '#ffe9dc', hair: '#6b4a38', top: '#f7c6d2', bottom: '#f7c6d2', sock: '#ffffff', shoes: '#b06a5a', bow: '#f591ac', blush: '#f7a8b4' },
    // 薄荷奶昔
    { skin: '#ffe9dc', hair: '#6b4a38', top: '#c2e4d2', bottom: '#c2e4d2', sock: '#ffffff', shoes: '#8fae9c', bow: '#8fd0b4', blush: '#f7a8b4' },
    // 奶油杏子
    { skin: '#ffe9dc', hair: '#6b4a38', top: '#f6dfb2', bottom: '#f6dfb2', sock: '#fff8ee', shoes: '#c78d64', bow: '#f0b45c', blush: '#f7a8b4' },
  ],
  partner: [
    // 奶油卫衣 + 藏蓝短裤（默认）
    { skin: '#ffe4cf', hair: '#2f2b29', top: '#f7f1e3', bottom: '#46536b', sock: '#ffffff', shoes: '#fbfaf7', bow: '#f7f1e3', blush: '#f4b3aa' },
    // 燕麦暖男
    { skin: '#ffe4cf', hair: '#2f2b29', top: '#cdb69c', bottom: '#5d544a', sock: '#f6f2ea', shoes: '#fbfaf7', bow: '#cdb69c', blush: '#f4b3aa' },
    // 雾蓝清爽
    { skin: '#ffe4cf', hair: '#2f2b29', top: '#a8bccb', bottom: '#3e4d5c', sock: '#f4f8fa', shoes: '#fbfaf7', bow: '#a8bccb', blush: '#f4b3aa' },
  ],
  // 访客：按名牌哈希取色，同一人每次来访穿同色
  guest: [
    { skin: '#ffe9dc', hair: '#5a3a2e', top: '#e8b8b0', bottom: '#6a5a4e', sock: '#f4f2ee', shoes: '#fbfaf7', bow: '#e8b8b0', blush: '#f4b3aa' },
    { skin: '#ffe4cf', hair: '#2e2e34', top: '#b8cec6', bottom: '#4a5568', sock: '#f6f5f2', shoes: '#fbfaf7', bow: '#b8cec6', blush: '#f4b3aa' },
    { skin: '#ffe9dc', hair: '#6a4a30', top: '#cfc0e0', bottom: '#5a5a66', sock: '#f4ede4', shoes: '#fbfaf7', bow: '#cfc0e0', blush: '#f6b1b8' },
    { skin: '#ffe4cf', hair: '#3a3230', top: '#e5c58e', bottom: '#4e5a52', sock: '#f6f5f2', shoes: '#fbfaf7', bow: '#e5c58e', blush: '#f4b3aa' },
  ],
};

/** Q版身材参数（约 2.2 头身，总高 ≈ 0.92m） */
const P = {
  hipY: 0.29,
  thighLen: 0.13,
  calfLen: 0.11,
  thighR: 0.055,
  calfR: 0.048,
  legX: 0.08,
  torsoY: 0.4,
  torsoR: 0.16,
  torsoLen: 0.11,
  shoulderY: 0.49,
  shoulderX: 0.175,
  upperLen: 0.075,
  upperR: 0.048,
  foreLen: 0.07,
  foreR: 0.04,
  headY: 0.64,
  headR: 0.26,
  eyeR: 0.05,
  eyeX: 0.098,
  eyeY: -0.03,
  shoeS: 0.058,
};

/**
 * 水滴发束几何（全角色共享，极省内存）：
 * 单位造型 —— 发根 y≈0、发梢 y=-1、最大半径 1（在 45% 高度处），
 * 用 mesh.scale(r, len, r*扁平度) 摆成任意粗细长短的发束。
 * 用 LatheGeometry 车出圆润发根 + 尖细发梢（比球体像「一撮头发」而不是「一颗球」）。
 */
const HAIR_LOCK_GEO = new THREE.LatheGeometry(
  (
    [
      [0.0, -1.0], // 梢尖
      [0.22, -0.975],
      [0.55, -0.9],
      [0.86, -0.72],
      [1.0, -0.45], // 最宽处
      [0.88, -0.22],
      [0.62, -0.06],
      [0.3, 0.0],
      [0.0, 0.02], // 发根圆心
    ] as [number, number][]
  ).map(([r, y]) => new THREE.Vector2(r, y)),
  10,
);

interface CharRig {
  root: THREE.Group;
  lieWrap: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  head: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  hairDyn: THREE.Group;
  skirt: THREE.Group | null;
  hipY: number;
  /** 泡澡时隐藏的衣物网格 */
  clothes: THREE.Mesh[];
  /** 泡澡素体（肤色躯干，平时隐藏） */
  skinTorso: THREE.Mesh;
  /** 泡澡/淋浴泡泡（脱衣遮挡，平时隐藏） */
  foam: THREE.Group;
  /** 睡觉 Zzz */
  zzz: THREE.Group;
  zzzSprites: THREE.Sprite[];
  /** 化妆星星 */
  spark: THREE.Group;
  sparkSprites: THREE.Sprite[];
  /** 手持小水杯 */
  cup: THREE.Group;
  cupCoffee: THREE.Mesh;
  cupJuice: THREE.Mesh;
  cupStraw: THREE.Mesh;
  cupSteam: THREE.Sprite;
  /** 看书的书 */
  book: THREE.Group;
  bookFlip: THREE.Group;
}

const stdMat = (c: string, rough = 0.8, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, ...extra });

/** 腮红径向渐变贴图（边缘柔化，比生硬圆片自然） */
function makeBlushTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(247,160,172,0.92)');
  g.addColorStop(0.55, 'rgba(247,160,172,0.55)');
  g.addColorStop(1, 'rgba(247,160,172,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 化妆星星贴图（四角星光） */
function makeSparkTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  const cx = 48;
  const cy = 48;
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 42);
  g.addColorStop(0, 'rgba(255,236,246,0.98)');
  g.addColorStop(0.4, 'rgba(247,183,208,0.9)');
  g.addColorStop(1, 'rgba(247,183,208,0)');
  const star = (long: number, wide: number, rot: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -long);
    ctx.quadraticCurveTo(wide, -wide, long, 0);
    ctx.quadraticCurveTo(wide, wide, 0, long);
    ctx.quadraticCurveTo(-wide, wide, -long, 0);
    ctx.quadraticCurveTo(-wide, -wide, 0, -long);
    ctx.fill();
    ctx.restore();
  };
  ctx.fillStyle = g;
  star(40, 7, 0);
  star(24, 5, Math.PI / 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Zzz 字贴图 */
function makeZzzTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.font = '900 92px "PingFang SC", "Nunito", ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(179,168,204,0.95)';
  ctx.strokeText('Z', 64, 70);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Z', 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 组装 Q版小人（纯几何，无外部依赖）。
 * 结构：root(起伏/前倾) → lieWrap(躺姿旋转) → [腿×2(髋→膝), 裙摆(女), 躯干, 臂×2(肩→肘), 头+脸+发]
 */
function buildChar(who: 'me' | 'partner' | 'guest', outfit = 0, wear?: GirlWear, wear2?: BoyWear): CharRig {
  const pal = OUTFITS[who];
  const o = pal[outfit % pal.length];
  const g = new THREE.Group();
  const clothes: THREE.Mesh[] = [];
  const isGirl = who === 'me';
  // —— 女主衣柜穿搭解析（v6.2：缺省 = 双马尾 + 樱粉连衣裙 + 棕色小皮鞋） ——
  const W: GirlWear = wear ?? { hair: 'twin', dress: 0, top: 0, bottom: 0, shoes: 0 };
  // —— 男生衣柜穿搭解析（v6.3：缺省 = 顺滑短发 + 奶白连帽卫衣 + 藏蓝短裤 + 白圆头鞋） ——
  const BW: BoyWear = wear2 ?? { hair: 'smooth', top: 0, bottom: 0, shoes: 0 };
  // —— 调色盘自选色（非法/缺省 → 款式默认色） ——
  const tintHex = (base: string, t?: string | null) => (t && /^#[0-9a-fA-F]{6}$/.test(t) ? t : base);
  const GT = W.tints;
  const BT = BW.tints;
  const dressRec = W.dress >= 0 ? DRESSES[Math.min(Math.max(W.dress, 0), DRESSES.length - 1)] : null;
  const topRec = TOPS[Math.min(Math.max(W.top, 0), TOPS.length - 1)];
  const botRec = BOTTOMS[Math.min(Math.max(W.bottom, 0), BOTTOMS.length - 1)];
  const shoeRec = SHOES[Math.min(Math.max(W.shoes, 0), SHOES.length - 1)];
  // 下装形态：连衣裙/裙 → 露腿+过膝袜；短裤 → 大腿裤色；长裤 → 全腿裤色
  const legWear: 'skirt' | 'short' | 'long' = dressRec ? 'skirt' : botRec.kind;
  const topCol = tintHex(dressRec ? dressRec.c : topRec.c, dressRec ? GT?.dress : GT?.top);
  const bowCol = dressRec ? dressRec.bow : topRec.bow;
  // 男生衣柜目录（v6.3）
  const bTop = BOY_TOPS[Math.min(Math.max(BW.top, 0), BOY_TOPS.length - 1)];
  const bBot = BOY_BOTTOMS[Math.min(Math.max(BW.bottom, 0), BOY_BOTTOMS.length - 1)];
  const bShoe = BOY_SHOES[Math.min(Math.max(BW.shoes, 0), BOY_SHOES.length - 1)];

  const mesh = (
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    parent: THREE.Object3D = g,
  ) => {
    const mm = new THREE.Mesh(geo, m);
    mm.position.set(x, y, z);
    mm.castShadow = true;
    parent.add(mm);
    return mm;
  };

  // ---------- 躺姿包裹层 ----------
  const lieWrap = new THREE.Group();
  g.add(lieWrap);

  const skinMat = stdMat(o.skin, 0.62);
  const hairCol = tintHex(o.hair, GT?.hair);
  const hairMat = stdMat(hairCol, 0.7);
  const topMat = stdMat(isGirl ? topCol : tintHex(bTop.c, BT?.top), 0.82);
  const botMat = stdMat(isGirl ? tintHex(botRec.c, GT?.bottom) : tintHex(bBot.c, BT?.bottom), 0.8); // 分体下装/男裤（自选色）
  const girlSockMat = stdMat('#ffffff', 0.72); // 女主白过膝袜

  // ---------- 腿（髋 pivot → 大腿 → 膝 pivot → 小腿 + 袜 + 圆头鞋） ----------
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  const kneeL = new THREE.Group();
  const kneeR = new THREE.Group();
  for (const [pivot, knee, sx] of [
    [legL, kneeL, -1],
    [legR, kneeR, 1],
  ] as const) {
    pivot.position.set(P.legX * sx, P.hipY, 0);
    lieWrap.add(pivot);
    // 大腿：女主裙/连衣裙露肤、分体裤装上裤色 / 男主裤色（短裤长裤同色，长裤时小腿同色）
    const thigh = mesh(
      new THREE.CapsuleGeometry(P.thighR, P.thighLen - P.thighR * 1.1, 6, 12),
      isGirl ? (legWear === 'skirt' ? skinMat : botMat) : botMat,
      0,
      -P.thighLen / 2,
      0,
      pivot,
    );
    if (isGirl ? legWear !== 'skirt' : true) clothes.push(thigh);
    knee.position.set(0, -P.thighLen, 0);
    pivot.add(knee);
    // 小腿：女主过膝袜（长裤时上裤色）/ 男主肤色（长裤时上裤色）
    const calf = mesh(
      new THREE.CapsuleGeometry(P.calfR, P.calfLen - P.calfR * 1.1, 6, 12),
      isGirl ? (legWear === 'long' ? botMat : girlSockMat) : bBot.kind === 'long' ? botMat : skinMat,
      0,
      -P.calfLen / 2,
      0,
      knee,
    );
    if (isGirl ? legWear === 'long' : bBot.kind === 'long') clothes.push(calf);
    // 男主短袜（脚踝上一小截白；长裤时藏进裤管不渲染）
    if (!isGirl && bBot.kind === 'short') {
      const sock = mesh(
        new THREE.CylinderGeometry(P.calfR * 1.06, P.calfR * 1.1, 0.045, 10),
        stdMat(o.sock, 0.72),
        0,
        -P.calfLen + 0.028,
        0,
        knee,
      );
      clothes.push(sock);
    }
    // 圆头小鞋（椭球，前伸）+ 鞋款配件
    const shoe = mesh(
      new THREE.SphereGeometry(P.calfR * 1.12, 14, 12),
      stdMat(isGirl ? tintHex(shoeRec.c, GT?.shoes) : tintHex(bShoe.c, BT?.shoes), 0.6),
      0,
      -P.calfLen - 0.006,
      0.022,
      knee,
    );
    shoe.scale.set(0.82, 0.62, 1.35);
    clothes.push(shoe);
    // 男生鞋底描边（薄一圈鞋底色，subtle）
    if (!isGirl) {
      const sole = mesh(new THREE.TorusGeometry(P.calfR * 1.0, 0.007, 6, 16), stdMat(tintHex(bShoe.trim, BT?.shoes), 0.7), 0, -P.calfLen - 0.034, 0.024, knee);
      sole.rotation.x = Math.PI / 2;
      sole.scale.set(0.9, 1.35, 1);
      clothes.push(sole);
    }
    // 女主鞋款：帆布鞋包边 / 玛丽珍袢带 / 短靴靴筒
    if (isGirl && W.shoes === 1) {
      const band = mesh(new THREE.TorusGeometry(P.calfR * 1.0, 0.0065, 6, 14), stdMat(shoeRec.trim, 0.72), 0, -P.calfLen + 0.036, 0, knee);
      band.rotation.x = Math.PI / 2;
      clothes.push(band);
    } else if (isGirl && W.shoes === 2) {
      const strap = mesh(new THREE.TorusGeometry(P.calfR * 0.98, 0.0075, 6, 14, Math.PI), stdMat(shoeRec.trim, 0.6), 0, -P.calfLen + 0.056, 0.026, knee);
      strap.rotation.y = Math.PI / 2;
      clothes.push(strap);
    } else if (isGirl && W.shoes === 3) {
      const boot = mesh(new THREE.CylinderGeometry(P.calfR * 1.1, P.calfR * 1.16, 0.058, 12), stdMat(tintHex(shoeRec.c, GT?.shoes), 0.62), 0, -P.calfLen + 0.046, 0, knee);
      clothes.push(boot);
      const bootTrim = mesh(new THREE.CylinderGeometry(P.calfR * 1.18, P.calfR * 1.18, 0.012, 12), stdMat(shoeRec.trim, 0.7), 0, -P.calfLen + 0.081, 0, knee);
      clothes.push(bootTrim);
    }
  }

  // ---------- 裙摆（女主）：连衣裙/半身裙 —— 圆锥裙，走路时后飘 ----------
  let skirt: THREE.Group | null = null;
  if (isGirl && legWear === 'skirt') {
    skirt = new THREE.Group();
    skirt.position.set(0, 0.36, 0);
    lieWrap.add(skirt);
    const skirtCol = dressRec ? dressRec.c : botRec.c;
    const cone = mesh(new THREE.ConeGeometry(0.205, 0.17, 20, 1, true), stdMat(skirtCol, 0.8), 0, -0.085, 0, skirt);
    // 内侧也渲染（从下往上看不穿帮）
    (cone.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    clothes.push(cone);
    // 裙摆白边（连衣裙用裙色配套装饰边）
    const hem = mesh(new THREE.TorusGeometry(0.196, 0.009, 8, 24), stdMat(dressRec ? dressRec.trim : '#ffffff', 0.7), 0, -0.158, 0, skirt);
    hem.rotation.x = Math.PI / 2;
    clothes.push(hem);
    // 连衣裙腰线装饰（分体裙不加）
    if (dressRec) {
      const belt = mesh(new THREE.TorusGeometry(0.172, 0.0075, 8, 22), stdMat(dressRec.trim, 0.7), 0, -0.115, 0, skirt);
      belt.rotation.x = Math.PI / 2;
      clothes.push(belt);
    }
  }

  // ---------- 躯干（上衣）----------
  const torso = mesh(new THREE.CapsuleGeometry(P.torsoR, P.torsoLen, 8, 18), topMat, 0, P.torsoY, 0, lieWrap);
  clothes.push(torso);
  // 男主兜帽（脑后半环；仅连帽款）
  if (!isGirl && bTop.hood) {
    const hood = mesh(new THREE.TorusGeometry(0.098, 0.038, 10, 18, Math.PI * 1.1), topMat, 0, P.torsoY + P.torsoLen / 2 + P.torsoR * 0.42, -P.torsoR * 0.55, lieWrap);
    hood.rotation.x = Math.PI * 0.62;
    hood.rotation.z = Math.PI * 0.45;
    clothes.push(hood);
  } else {
    // 女主胸前小白心
    const heart = new THREE.Group();
    heart.position.set(0, P.torsoY + 0.075, P.torsoR + 0.008);
    const hm = stdMat('#fff5f6', 0.6);
    for (const sx of [-1, 1]) {
      const lob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), hm);
      lob.position.set(0.012 * sx, 0.008, 0);
      lob.castShadow = false;
      heart.add(lob);
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.036, 10), hm);
    tip.rotation.z = Math.PI;
    tip.position.y = -0.012;
    tip.castShadow = false;
    heart.add(tip);
    lieWrap.add(heart);
  }
  // 泡澡素体（肤色躯干，平时隐藏）
  const skinTorso = mesh(new THREE.CapsuleGeometry(P.torsoR * 0.94, P.torsoLen, 8, 16), skinMat, 0, P.torsoY, 0, lieWrap);
  skinTorso.visible = false;

  // ---------- 泡澡/淋浴泡泡（脱衣遮挡，平时隐藏） ----------
  const foam = new THREE.Group();
  foam.visible = false;
  lieWrap.add(foam);
  const foamMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.22, transparent: true, opacity: 0.94 });
  const foamAdd = (x: number, y: number, z: number, r: number) => {
    const fm = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), foamMat);
    fm.position.set(x, y, z);
    fm.castShadow = false;
    foam.add(fm);
  };
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    foamAdd(Math.cos(a) * (P.torsoR + 0.03), P.torsoY - P.torsoLen * 0.2 + (i % 2) * 0.04, Math.sin(a) * (P.torsoR + 0.03), 0.05 + (i % 3) * 0.013);
  }
  foamAdd(-P.torsoR * 0.7, P.torsoY + P.torsoLen * 0.4, P.torsoR * 0.6, 0.045);
  foamAdd(P.torsoR * 0.7, P.torsoY + P.torsoLen * 0.4, P.torsoR * 0.6, 0.05);
  foamAdd(-P.headR * 0.42, P.headY + P.headR * 0.72, P.headR * 0.18, 0.05);
  foamAdd(P.headR * 0.46, P.headY + P.headR * 0.78, -P.headR * 0.12, 0.055);
  foamAdd(0, P.headY + P.headR * 0.9, P.headR * 0.28, 0.045);

  // ---------- 睡觉 Zzz（躺床时头在 -z 床头侧，从头上方飘起） ----------
  const zzz = new THREE.Group();
  zzz.visible = false;
  g.add(zzz);
  const zzzTex = makeZzzTexture();
  const zzzSprites: THREE.Sprite[] = [];
  for (let i = 0; i < 3; i++) {
    const sm = new THREE.SpriteMaterial({ map: zzzTex, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    sp.scale.setScalar(0.1 + i * 0.04);
    sp.position.set(0.15 + i * 0.03, 0.36 + i * 0.14, -(P.headY + 0.08 + i * 0.1));
    zzz.add(sp);
    zzzSprites.push(sp);
  }

  // ---------- 化妆星星 ----------
  const spark = new THREE.Group();
  spark.visible = false;
  g.add(spark);
  const sparkTex = makeSparkTexture();
  const sparkSprites: THREE.Sprite[] = [];
  for (let i = 0; i < 5; i++) {
    const sm = new THREE.SpriteMaterial({ map: sparkTex, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    sp.scale.setScalar(0.09 + (i % 2) * 0.04);
    spark.add(sp);
    sparkSprites.push(sp);
  }

  // ---------- 手臂（肩 pivot → 上臂(袖) → 肘 pivot → 前臂(肤) + 圆手） ----------
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  const foreL = new THREE.Group();
  const foreR = new THREE.Group();
  for (const [pivot, fore, sx] of [
    [armL, foreL, -1],
    [armR, foreR, 1],
  ] as const) {
    pivot.position.set(P.shoulderX * sx, P.shoulderY, 0);
    pivot.rotation.z = sx * 0.16; // 微微外张
    lieWrap.add(pivot);
    // 泡泡袖（肩头小球，女主）
    if (isGirl) {
      const puff = mesh(new THREE.SphereGeometry(P.upperR * 1.15, 12, 10), topMat, 0, -P.upperR * 0.2, 0, pivot);
      clothes.push(puff);
    }
    const sleeve = mesh(
      new THREE.CapsuleGeometry(P.upperR * (isGirl ? 0.8 : 1), P.upperLen, 6, 10),
      topMat,
      0,
      -P.upperLen / 2 - P.upperR * 0.25,
      0,
      pivot,
    );
    clothes.push(sleeve);
    fore.position.set(0, -P.upperLen - P.upperR * 0.45, 0);
    pivot.add(fore);
    mesh(
      new THREE.CapsuleGeometry(P.foreR, P.foreLen, 6, 10),
      skinMat,
      0,
      -P.foreLen / 2 - P.foreR * 0.2,
      0,
      fore,
    );
    // 圆手（比前臂略大的小球，萌感）
    mesh(new THREE.SphereGeometry(P.foreR * 1.3, 12, 10), skinMat, 0, -P.foreLen - P.foreR * 0.7, 0, fore);
  }

  // ---------- 手持小水杯（挂右前臂手心，平时隐藏） ----------
  const cup = new THREE.Group();
  cup.visible = false;
  const cupGlass = new THREE.MeshStandardMaterial({
    color: '#cfeaf4',
    roughness: 0.2,
    metalness: 0.05,
    transparent: true,
    opacity: 0.62,
  });
  const cupBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.072, 12), cupGlass);
  cupBody.castShadow = false;
  cup.add(cupBody);
  const cupJuice = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.021, 0.052, 12), stdMat('#f2b7c6', 0.35));
  cupJuice.position.y = -0.004;
  cupJuice.castShadow = false;
  cup.add(cupJuice);
  const cupStraw = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.085, 8), stdMat('#f4a7b9', 0.5));
  cupStraw.position.set(0.012, 0.052, 0);
  cupStraw.rotation.z = 0.18;
  cupStraw.castShadow = false;
  cup.add(cupStraw);
  const cupCoffee = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.021, 0.05, 12), stdMat('#7a4a28', 0.4));
  cupCoffee.position.y = -0.005;
  cupCoffee.visible = false;
  cup.add(cupCoffee);
  const cupHandle = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 6, 12), stdMat('#f7f5ef', 0.5));
  cupHandle.position.set(-0.032, 0.003, 0);
  cupHandle.castShadow = false;
  cupCoffee.add(cupHandle);
  const steamTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const c2 = cv.getContext('2d')!;
    const gr = c2.createRadialGradient(32, 32, 3, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = gr;
    c2.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const cupSteam = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0, depthWrite: false }));
  cupSteam.scale.setScalar(0.05);
  cupSteam.position.set(0.004, 0.07, 0);
  cup.add(cupSteam);
  cup.position.set(0, -P.foreLen - P.foreR * 0.9, 0.03);
  foreR.add(cup);

  // ---------- 看书的书（封面+书页+翻页页角；仅 read 姿势可见） ----------
  const book = new THREE.Group();
  book.visible = false;
  const bookCoverMat = stdMat(isGirl ? '#e8a3b3' : '#7a9ec2', 0.55);
  const bookPaperMat = stdMat('#faf7f0', 0.85);
  const coverL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.14), bookCoverMat);
  coverL.position.set(-0.05, 0, 0);
  coverL.rotation.z = 0.12;
  coverL.castShadow = false;
  book.add(coverL);
  const coverR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.14), bookCoverMat);
  coverR.position.set(0.05, 0, 0);
  coverR.rotation.z = -0.12;
  coverR.castShadow = false;
  book.add(coverR);
  const pageL = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.016, 0.128), bookPaperMat);
  pageL.position.set(-0.045, 0.012, 0);
  pageL.rotation.z = 0.1;
  book.add(pageL);
  const pageR = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.016, 0.128), bookPaperMat);
  pageR.position.set(0.045, 0.012, 0);
  pageR.rotation.z = -0.1;
  book.add(pageR);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 0.142), bookCoverMat);
  spine.position.set(0, 0.006, 0);
  book.add(spine);
  const bookFlip = new THREE.Group();
  bookFlip.position.set(0, 0.024, 0);
  const flipMesh = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.003, 0.126), bookPaperMat);
  flipMesh.position.x = 0.043;
  flipMesh.castShadow = false;
  bookFlip.add(flipMesh);
  book.add(bookFlip);
  book.position.set(0, 0.31, 0.23);
  book.rotation.x = -0.42;
  g.add(book);

  // ---------- 头 + 脸 + 发型 ----------
  const head = new THREE.Group();
  head.position.set(0, P.headY, 0);
  lieWrap.add(head);
  // 大圆头（微扁更萌）
  const skull = mesh(new THREE.SphereGeometry(P.headR, 28, 24), skinMat, 0, 0, 0, head);
  skull.scale.set(1, 0.96, 0.97);

  // —— 眼睛（竖椭圆大眼 + 双层高光 + 上眼线，可眨眼） ——
  const eyeLG = new THREE.Group();
  const eyeRG = new THREE.Group();
  const eyeWhiteMat = stdMat('#ffffff', 0.25);
  const pupilMat = stdMat('#453129', 0.3);
  for (const [eg, sx] of [
    [eyeLG, -1],
    [eyeRG, 1],
  ] as const) {
    eg.position.set(P.eyeX * sx, P.eyeY, P.headR * 0.78);
    head.add(eg);
    // 眼白
    const ew = new THREE.Mesh(new THREE.SphereGeometry(P.eyeR, 14, 12), eyeWhiteMat);
    ew.scale.set(0.95, 1.28, 0.42);
    ew.castShadow = false;
    eg.add(ew);
    // 瞳仁（深棕，偏内下）
    const pu = new THREE.Mesh(new THREE.SphereGeometry(P.eyeR * 0.74, 12, 10), pupilMat);
    pu.scale.set(0.9, 1.18, 0.4);
    pu.position.set(-0.006 * sx, -0.006, 0.016);
    pu.castShadow = false;
    eg.add(pu);
    // 大高光（上内侧）
    const hi1 = new THREE.Mesh(new THREE.SphereGeometry(P.eyeR * 0.3, 8, 8), stdMat('#ffffff', 0.15));
    hi1.position.set(0.016 * sx, 0.02, 0.036);
    hi1.castShadow = false;
    eg.add(hi1);
    // 小高光（下外侧）
    const hi2 = new THREE.Mesh(new THREE.SphereGeometry(P.eyeR * 0.16, 8, 8), stdMat('#ffffff', 0.15));
    hi2.position.set(-0.019 * sx, -0.018, 0.032);
    hi2.castShadow = false;
    eg.add(hi2);
    // 上眼线（细弧，发色）
    const lash = new THREE.Mesh(new THREE.TorusGeometry(P.eyeR * 1.02, 0.0075, 6, 16, Math.PI * 0.72), stdMat(hairCol, 0.5));
    lash.rotation.z = Math.PI * 0.14;
    lash.position.z = 0.008;
    lash.castShadow = false;
    eg.add(lash);
  }

  // —— 眉毛（细弯弧，发色） ——
  for (const sx of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0058, 6, 14, Math.PI * 0.62), stdMat(hairCol, 0.55));
    brow.position.set(P.eyeX * sx, P.eyeY + 0.085, P.headR * 0.84);
    brow.rotation.z = Math.PI * (sx > 0 ? 0.19 : 0.19);
    // 弧口朝下（拱眉）
    brow.rotation.x = Math.PI;
    brow.rotation.z = Math.PI * 0.81;
    brow.castShadow = false;
    head.add(brow);
  }

  // —— 腮红（径向渐变贴图，柔边） ——
  const blushTex = makeBlushTexture();
  for (const sx of [-1, 1]) {
    const blush = new THREE.Mesh(
      new THREE.CircleGeometry(0.052, 14),
      new THREE.MeshBasicMaterial({ map: blushTex, transparent: true, depthWrite: false }),
    );
    blush.position.set((P.eyeX + 0.075) * sx, -0.095, P.headR * 0.72);
    blush.rotation.y = sx * 0.5;
    head.add(blush);
  }

  // —— 小鼻子 ——
  const nose = mesh(new THREE.SphereGeometry(0.0085, 8, 8), stdMat('#f6c8b2', 0.6), 0, -0.062, P.headR * 0.97, head);
  nose.castShadow = false;

  // —— 嘴（微笑弧线） ——
  const smile = mesh(
    new THREE.TorusGeometry(0.032, 0.0072, 6, 16, Math.PI * 0.8),
    stdMat(isGirl ? '#e08e8e' : '#c98a80', 0.6),
    0,
    -0.108,
    P.headR * 0.9,
    head,
  );
  smile.rotation.x = Math.PI * 0.06;
  smile.rotation.z = Math.PI + Math.PI * 0.1;

  // —— 发型 ——
  const hairDyn = new THREE.Group(); // 动态发（马尾/呆毛）挂这里做摆动
  head.add(hairDyn);

  /** 蝴蝶结（双层翼 + 中心结 + 飘带）：(kx,ky,kz) 结中心，sx = ±1 翼展开向，scale 尺寸系数 */
  const buildBowAt = (parent: THREE.Object3D, kx: number, ky: number, kz: number, sx: number, scale: number, col: string) => {
    const bm = stdMat(col, 0.55);
    const wingA = mesh(new THREE.SphereGeometry(P.headR * 0.145 * scale, 12, 10), bm, kx + sx * P.headR * 0.11, ky + P.headR * 0.02, kz - P.headR * 0.06, parent);
    wingA.scale.set(1.25, 0.85, 0.6);
    wingA.rotation.z = 0.5 * sx;
    wingA.castShadow = false;
    const wingB = mesh(new THREE.SphereGeometry(P.headR * 0.13 * scale, 12, 10), bm, kx - sx * P.headR * 0.11, ky + P.headR * 0.04, kz - P.headR * 0.04, parent);
    wingB.scale.set(1.2, 0.8, 0.6);
    wingB.rotation.z = 0.5 * sx;
    wingB.castShadow = false;
    const knot = mesh(new THREE.SphereGeometry(P.headR * 0.06 * scale, 10, 8), bm, kx, ky, kz, parent);
    knot.castShadow = false;
    const rib = mesh(new THREE.ConeGeometry(P.headR * 0.035 * scale, P.headR * 0.24 * scale, 8), bm, kx + sx * P.headR * 0.02, ky - P.headR * 0.16 * scale, kz + P.headR * 0.02, parent);
    rib.rotation.x = Math.PI;
    rib.rotation.z = 0.25 * sx;
    rib.castShadow = false;
  };

  if (isGirl) {
    // 女主发丝更亮泽一点（低粗糙度 → 灯光下有柔和反光）
    hairMat.roughness = 0.58;
    // 发梢渐变色（暖焦糖色，比主发色亮一档：动漫系「发尾挑染」；自选发色时同步跟随）
    const hairTipMat = stdMat(`#${new THREE.Color(hairCol).lerp(new THREE.Color('#f2c9a4'), 0.5).getHexString()}`, 0.55);

    // 头盖（发际线抬高到眉上方，不再压住眼睛；前缘再上抬给八字刘海留出额头中分）
    const cap = mesh(new THREE.SphereGeometry(P.headR * 1.07, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.46), hairMat, 0, P.headR * 0.05, -P.headR * 0.05, head);
    cap.rotation.x = -0.2;
    // 发际线填充带：与头盖同倾角的球带（左右各一条，中分缝 ±8° 除外），
    // 填满刘海束之间的头皮缝隙，远看是一整片蓬松刘海
    const capTilt = new THREE.Group();
    capTilt.position.set(0, P.headR * 0.05, -P.headR * 0.05);
    capTilt.rotation.x = -0.2;
    head.add(capTilt);
    const d2r = (d: number) => (d * Math.PI) / 180;
    mesh(new THREE.SphereGeometry(P.headR * 1.075, 14, 8, d2r(18), d2r(72), Math.PI * 0.4, Math.PI * 0.12), hairMat, 0, 0, 0, capTilt);
    mesh(new THREE.SphereGeometry(P.headR * 1.075, 14, 8, d2r(90), d2r(72), Math.PI * 0.4, Math.PI * 0.12), hairMat, 0, 0, 0, capTilt);
    // —— 八字刘海 v6.5「花瓣刘海」：每侧 5 束细长水滴发沿发际线弧线排开，
    //    发梢尖细向下、微向外斜扫，额心中分缝完全无发；
    //    发根全部埋进头盖里（盖掉旧的“头盔沿”），眉毛瞳孔全露，
    //    眼睛正上方两束收短（不压眼），眼尾以外三束渐长 ——
    const FRINGE: [number, number, number, number, number][] = [
      // [离正中角度°, 发根y, 束长, 束宽, 向外斜扫弧度]
      [13, 0.125, 0.062, 0.047, 0.12], // 内撮：中分线旁，发梢止于眉头上方
      [24, 0.12, 0.07, 0.049, 0.16],  // 次撮：眼睛正上方收短，不碰睫毛
      [38, 0.115, 0.13, 0.051, 0.2],  // 中撮：眼尾外轻扫（框眼不遮瞳）
      [52, 0.105, 0.16, 0.052, 0.22], // 外撮：贴颊侧垂到太阳穴下
      [66, 0.09, 0.15, 0.049, 0.24],  // 边撮：耳前收笔，与鬓发相连
    ];
    for (const sx of [-1, 1]) {
      FRINGE.forEach(([deg, ry, len, r, lean], i) => {
        const rad = (deg * Math.PI) / 180;
        const rx = sx * Math.sin(rad) * 0.25;
        const rz = Math.cos(rad) * 0.222 + 0.006;
        const lock = mesh(HAIR_LOCK_GEO, hairMat, rx, ry, rz, head);
        lock.scale.set(r, len, r * 0.55);
        lock.rotation.z = sx * lean;
        lock.rotation.x = 0.12;
        lock.rotation.y = -sx * rad * 0.3; // 扁面沿头型微扇，包住额角
        // 外侧三束加焦糖挑染发梢（细尖渐变发尾，不呈球状）
        if (i >= 2) {
          const tip = mesh(
            HAIR_LOCK_GEO,
            hairTipMat,
            rx + sx * Math.sin(lean) * len * 0.78,
            ry - Math.cos(lean) * len * 0.78,
            rz + 0.006,
            head,
          );
          tip.scale.set(r * 0.55, len * 0.42, r * 0.36);
          tip.rotation.z = sx * lean;
          tip.rotation.x = 0.12;
          tip.rotation.y = -sx * rad * 0.3;
          tip.castShadow = false;
        }
      });
    }
    // 两侧鬓发：细长水滴贴脸垂直落到下巴，上接边撮刘海、下框脸颊（替换旧款细面条“龙须”）
    for (const sx of [-1, 1]) {
      const lock = mesh(HAIR_LOCK_GEO, hairMat, 0.256 * sx, 0.05, 0.05, head);
      lock.scale.set(0.054, 0.3, 0.046);
      lock.rotation.z = sx * 0.05;
      lock.rotation.x = 0.04;
      lock.rotation.y = -sx * 0.35;
      const tip = mesh(HAIR_LOCK_GEO, hairTipMat, 0.259 * sx, -0.2, 0.047, head);
      tip.scale.set(0.03, 0.13, 0.026);
      tip.rotation.z = sx * 0.06;
      tip.castShadow = false;
    }
    // 后脑基底（补齐头盖后缘与脖颈间的缝隙，所有发型共用）
    const backBase = mesh(new THREE.SphereGeometry(P.headR * 0.99, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.44), hairMat, 0, 0, -P.headR * 0.04, head);
    backBase.rotation.x = -0.08;

    // —— 发型分支（衣柜 v6.2 / v6.3 修：双马尾与高马尾删掉波波头式两侧垂发，背发贴脑勺） ——
    if (W.hair === 'high') {
      // 高马尾：颅顶高扎一束 + 扎点大蝴蝶结（两侧无垂发，只留后脑小发髻）
      const nape = mesh(new THREE.SphereGeometry(P.headR * 0.92, 16, 12), hairMat, 0, -P.headR * 0.32, -P.headR * 0.4, head);
      nape.scale.set(1.02, 0.82, 0.62);
      const tail = new THREE.Group();
      tail.position.set(0, P.headR * 1.0, -P.headR * 0.6);
      tail.rotation.x = 0.52; // 向后弧线垂落
      hairDyn.add(tail);
      const tie = mesh(new THREE.TorusGeometry(P.headR * 0.11, P.headR * 0.034, 8, 14), stdMat(bowCol, 0.55), 0, 0, 0, tail);
      tie.rotation.x = Math.PI / 2.2;
      tie.castShadow = false;
      // 马尾主体：水滴发束（上粗下细自然锥形，替换旧胶囊+球）
      const strand = mesh(HAIR_LOCK_GEO, hairMat, 0, 0, 0, tail);
      strand.scale.set(P.headR * 0.42, P.headR * 2.05, P.headR * 0.36);
      const tailTip = mesh(HAIR_LOCK_GEO, hairTipMat, 0, -P.headR * 1.62, 0.005, tail);
      tailTip.scale.set(P.headR * 0.24, P.headR * 0.72, P.headR * 0.2);
      tailTip.castShadow = false;
      buildBowAt(tail, 0, P.headR * 0.02, P.headR * 0.02, -1, 0.95, bowCol);
    } else if (W.hair === 'bob') {
      // 短发：圆润波波头，两侧齐下巴 + 内扣发尾
      for (const sx of [-1, 1]) {
        const lock = mesh(new THREE.CapsuleGeometry(P.headR * 0.2, P.headR * 0.55, 6, 10), hairMat, P.headR * 0.94 * sx, -P.headR * 0.52, P.headR * 0.18, head);
        lock.rotation.z = sx * -0.05;
        lock.scale.set(1, 1, 0.85);
        const tip = mesh(new THREE.SphereGeometry(P.headR * 0.17, 10, 8), hairTipMat, P.headR * 0.96 * sx, -P.headR * 0.94, P.headR * 0.2, head);
        tip.scale.set(1, 0.82, 0.9);
        tip.castShadow = false;
      }
      const backHair = mesh(new THREE.SphereGeometry(P.headR * 1.02, 18, 14), hairMat, 0, -P.headR * 0.28, -P.headR * 0.36, head);
      backHair.scale.set(1.04, 0.95, 0.72);
      for (const [wx, wy] of [[-0.55, -0.95], [-0.19, -1.04], [0.19, -1.04], [0.55, -0.95]] as const) {
        const wave = mesh(new THREE.SphereGeometry(P.headR * 0.16, 10, 8), hairMat, wx * P.headR, wy * P.headR, -P.headR * 0.34, head);
        wave.scale.set(1, 0.75, 0.66);
      }
      const curl = mesh(new THREE.TorusGeometry(P.headR * 0.075, P.headR * 0.02, 8, 16, Math.PI * 1.5), hairMat, 0.03 * P.headR, P.headR * 1.08, -0.02 * P.headR, hairDyn);
      curl.rotation.set(0.5, 0.3, 0.6);
      curl.castShadow = false;
    } else if (W.hair === 'straight') {
      // 长直发：两侧垂顺发束 + 后背长直发片，发尾平齐到腰
      for (const sx of [-1, 1]) {
        const lock = mesh(new THREE.CapsuleGeometry(P.headR * 0.17, P.headR * 1.25, 6, 10), hairMat, P.headR * 0.97 * sx, -P.headR * 0.75, P.headR * 0.22, head);
        lock.rotation.z = sx * -0.03;
        lock.scale.set(0.95, 1, 0.8);
        const tip = mesh(new THREE.SphereGeometry(P.headR * 0.15, 10, 8), hairTipMat, P.headR * 1.0 * sx, -P.headR * 1.52, P.headR * 0.24, head);
        tip.castShadow = false;
      }
      const backHair = mesh(new THREE.CapsuleGeometry(P.headR * 0.26, P.headR * 1.05, 6, 12), hairMat, 0, -P.headR * 0.72, -P.headR * 0.42, head);
      backHair.scale.set(1.12, 1, 0.52);
      for (const wx of [-0.5, -0.17, 0.17, 0.5]) {
        const wave = mesh(new THREE.SphereGeometry(P.headR * 0.13, 10, 8), hairMat, wx * P.headR, -P.headR * 1.42, -P.headR * 0.4, head);
        wave.scale.set(1.05, 0.6, 0.5);
      }
    } else if (W.hair === 'wave') {
      // 大波浪：两侧各两束长水滴发交错（微 S 走向）+ 后脑大波浪披发，发尾挑染
      for (const sx of [-1, 1]) {
        const upper = mesh(HAIR_LOCK_GEO, hairMat, 0.9 * P.headR * sx, -0.16 * P.headR, 0.2 * P.headR, head);
        upper.scale.set(P.headR * 0.42, P.headR * 1.15, P.headR * 0.36);
        upper.rotation.z = sx * 0.14;
        upper.rotation.y = -sx * 0.3;
        const lower = mesh(HAIR_LOCK_GEO, hairMat, 1.0 * P.headR * sx, -0.92 * P.headR, 0.23 * P.headR, head);
        lower.scale.set(P.headR * 0.4, P.headR * 1.05, P.headR * 0.34);
        lower.rotation.z = sx * -0.08; // 反向微弯 → S 波浪走向
        lower.rotation.y = -sx * 0.3;
        const tip = mesh(HAIR_LOCK_GEO, hairTipMat, 1.0 * P.headR * sx, -1.68 * P.headR, 0.26 * P.headR, head);
        tip.scale.set(P.headR * 0.26, P.headR * 0.55, P.headR * 0.22);
        tip.rotation.z = sx * 0.06;
        tip.castShadow = false;
      }
      const backHair = mesh(new THREE.SphereGeometry(P.headR, 18, 14), hairMat, 0, -P.headR * 0.62, -P.headR * 0.48, head);
      backHair.scale.set(1.05, 1.28, 0.58);
      for (const [wx, wy] of [[-0.5, -1.42], [-0.18, -1.55], [0.18, -1.55], [0.5, -1.42]] as const) {
        const wave = mesh(new THREE.SphereGeometry(P.headR * 0.15, 10, 8), hairMat, wx * P.headR, wy * P.headR, -P.headR * 0.52, head);
        wave.scale.set(1, 0.8, 0.55);
      }
    } else {
      // 双马尾（默认）：齐颈背发贴脑勺 + 两束马尾 + 双蝴蝶结 + 小卷呆毛（v6.3 删波波头式侧发）
      const backHair = mesh(new THREE.SphereGeometry(P.headR, 18, 14), hairMat, 0, -P.headR * 0.16, -P.headR * 0.48, head);
      backHair.scale.set(1.0, 0.72, 0.55);
      // 后颈发尾（小而含蓄，齐颈窝即止，不再是垂到胸口的波波头）
      for (const [wx, wy] of [
        [-0.42, -0.85],
        [0, -0.93],
        [0.42, -0.85],
      ] as const) {
        const wave = mesh(new THREE.SphereGeometry(P.headR * 0.12, 10, 8), hairMat, wx * P.headR, wy * P.headR, -P.headR * 0.5, head);
        wave.scale.set(1, 0.68, 0.6);
      }
      for (const sx of [-1, 1]) {
        const tail = new THREE.Group();
        tail.position.set(P.headR * 0.76 * sx, P.headR * 0.5, -P.headR * 0.42);
        tail.rotation.z = sx * 0.34; // 向外微张（收住外摆，贴脸侧垂落）
        tail.rotation.x = 0.18;
        hairDyn.add(tail);
        // 扎点小蝴蝶结（替换旧款圆球发绳——截图里的“黄小球”就是它）
        buildBowAt(tail, 0, P.headR * 0.02, 0, sx, 0.72, bowCol);
        // 马尾主体：水滴发束（上粗下细自然锥形）+ 细尖挑染发尾（无中段珠球）
        const strand = mesh(HAIR_LOCK_GEO, hairMat, 0, 0, 0, tail);
        strand.scale.set(P.headR * 0.36, P.headR * 1.8, P.headR * 0.3);
        const tailTip = mesh(HAIR_LOCK_GEO, hairTipMat, P.headR * 0.02 * sx, -P.headR * 1.42, 0.01, tail);
        tailTip.scale.set(P.headR * 0.2, P.headR * 0.62, P.headR * 0.17);
        tailTip.castShadow = false;
      }
      const curl = mesh(new THREE.TorusGeometry(P.headR * 0.075, P.headR * 0.02, 8, 16, Math.PI * 1.5), hairMat, 0.03 * P.headR, P.headR * 1.08, -0.02 * P.headR, hairDyn);
      curl.rotation.set(0.5, 0.3, 0.6);
      curl.castShadow = false;
    }
  } else {
    // —— 男主发型（衣柜 v6.3：顺滑 / 蓬松卷 / 中分 / 刺猬；全部进 head，呆毛挂 hairDyn） ——
    if (BW.hair === 'fluffy') {
      // 蓬松卷发：加大头盖 + 抱团圆润发团（压扁更软）+ 小卷弧 + 微呆毛
      const cap = mesh(new THREE.SphereGeometry(P.headR * 1.12, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, P.headR * 0.07, -P.headR * 0.04, head);
      cap.rotation.x = -0.16;
      const puffs: [number, number, number, number][] = [
        [-0.52, 0.92, 0.42, 0.19],
        [0.52, 0.92, 0.42, 0.19],
        [-0.98, 0.5, 0.05, 0.18],
        [0.98, 0.5, 0.05, 0.18],
        [0, 1.12, 0, 0.2],
        [0, 0.62, 0.78, 0.16],
      ];
      for (const [px, py, pz, pr] of puffs) {
        const p = mesh(new THREE.SphereGeometry(P.headR * pr, 12, 10), hairMat, px * P.headR, py * P.headR, pz * P.headR, head);
        p.scale.set(1, 0.8, 0.9);
      }
      // 小卷弧（顶上 2 圈 + 侧后 1 圈）
      for (const [cx, cy, cz, cr] of [
        [-0.42, 1.2, 0.28, 0.11],
        [0.46, 1.12, 0.34, 0.1],
        [-0.88, 0.88, -0.22, 0.09],
      ] as const) {
        const curl = mesh(new THREE.TorusGeometry(P.headR * cr, P.headR * 0.024, 8, 14, Math.PI * 1.25), hairMat, cx * P.headR, cy * P.headR, cz * P.headR, head);
        curl.rotation.set(0.6, 0.4, -0.5);
        curl.castShadow = false;
      }
      for (const sx of [-1, 1]) {
        const sb = mesh(new THREE.SphereGeometry(P.headR * 0.14, 10, 8), hairMat, P.headR * 0.94 * sx, -P.headR * 0.1, -P.headR * 0.04, head);
        sb.scale.set(0.5, 1.3, 0.7);
        sb.rotation.z = sx * 0.1;
      }
      const back = mesh(new THREE.SphereGeometry(P.headR * 0.99, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.44), hairMat, 0, 0, -P.headR * 0.04, head);
      back.rotation.x = -0.08;
      const ahoge = new THREE.Group();
      ahoge.position.set(0.05, P.headR * 1.18, 0.02);
      hairDyn.add(ahoge);
      const aCone = mesh(new THREE.ConeGeometry(0.016, 0.08, 8), hairMat, 0.012, 0.04, 0.008, ahoge);
      aCone.rotation.z = -0.5;
      aCone.rotation.x = 0.15;
    } else if (BW.hair === 'middle') {
      // 中分刘海：圆盖 + 两侧各 2 撮粗短中分刘海（干净中缝）+ 鬓角 + 后脑补发（无呆毛）
      const cap = mesh(new THREE.SphereGeometry(P.headR * 1.08, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.56), hairMat, 0, P.headR * 0.07, -P.headR * 0.04, head);
      cap.rotation.x = -0.16;
      const curtain: [number, number, number, number][] = [
        [0.15, 0.14, 0.205, 0.046],
        [0.235, 0.055, 0.16, 0.047],
      ];
      for (const sx of [-1, 1]) {
        for (const [fx, fy, fz, fr] of curtain) {
          const b = mesh(new THREE.SphereGeometry(fr, 12, 12), hairMat, fx * sx, fy, fz, head);
          b.scale.set(0.85, 1.5, 0.6);
          b.rotation.z = sx * 0.8;
          b.rotation.x = 0.12;
        }
        const sb = mesh(new THREE.SphereGeometry(P.headR * 0.15, 10, 8), hairMat, P.headR * 0.94 * sx, -P.headR * 0.12, -P.headR * 0.06, head);
        sb.scale.set(0.5, 1.6, 0.7);
        sb.rotation.z = sx * 0.1;
      }
      const back = mesh(new THREE.SphereGeometry(P.headR * 0.99, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.44), hairMat, 0, 0, -P.headR * 0.04, head);
      back.rotation.x = -0.08;
    } else if (BW.hair === 'spiky') {
      // 活力刺猬：圆盖 + 前顶一圈外翘小尖刺 + 鬓角 + 后脑补发
      const cap = mesh(new THREE.SphereGeometry(P.headR * 1.08, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, P.headR * 0.07, -P.headR * 0.04, head);
      cap.rotation.x = -0.16;
      const spikes: [number, number, number][] = [
        [-0.68, 0.72, 0.52],
        [-0.34, 0.9, 0.62],
        [0, 1.0, 0.66],
        [0.34, 0.9, 0.62],
        [0.68, 0.72, 0.52],
        [0.88, 0.52, 0.05],
      ];
      for (const [px, py, pz] of spikes) {
        const sp = mesh(new THREE.ConeGeometry(0.024, 0.1, 7), hairMat, px * P.headR, py * P.headR, pz * P.headR, head);
        sp.rotation.z = -px * 0.85; // 尖端向外翘
        sp.rotation.x = -0.3; // 稍向前仰
      }
      for (const sx of [-1, 1]) {
        const sb = mesh(new THREE.SphereGeometry(P.headR * 0.14, 10, 8), hairMat, P.headR * 0.94 * sx, -P.headR * 0.12, -P.headR * 0.06, head);
        sb.scale.set(0.5, 1.5, 0.7);
        sb.rotation.z = sx * 0.1;
      }
      const back = mesh(new THREE.SphereGeometry(P.headR * 0.99, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.44), hairMat, 0, 0, -P.headR * 0.04, head);
      back.rotation.x = -0.08;
    } else {
      // 顺滑短发（默认）：圆盖 + 前帘刘海 + 鬓角 + 后脑补发 + 小呆毛（v6.2 造型）
      const cap = mesh(new THREE.SphereGeometry(P.headR * 1.08, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, P.headR * 0.07, -P.headR * 0.04, head);
      cap.rotation.x = -0.16;
      // 前帘刘海（4 撮扁宽发束勾出刘海线）
      const fringe: [number, number, number][] = [
        [-0.42, 0.48, 0.68],
        [-0.14, 0.53, 0.74],
        [0.14, 0.53, 0.74],
        [0.42, 0.48, 0.68],
      ];
      for (const [fx, fy, fz] of fringe) {
        const f = mesh(new THREE.SphereGeometry(P.headR * 0.16, 10, 8), hairMat, fx * P.headR, fy * P.headR, fz * P.headR, head);
        f.scale.set(1.2, 0.62, 0.6);
      }
      // 鬓角（贴面扁发束，不再是小球）
      for (const sx of [-1, 1]) {
        const sb = mesh(new THREE.SphereGeometry(P.headR * 0.15, 10, 8), hairMat, P.headR * 0.94 * sx, -P.headR * 0.12, -P.headR * 0.06, head);
        sb.scale.set(0.5, 1.6, 0.7);
        sb.rotation.z = sx * 0.1;
      }
      // 后脑补发
      const back = mesh(new THREE.SphereGeometry(P.headR * 0.99, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.44), hairMat, 0, 0, -P.headR * 0.04, head);
      back.rotation.x = -0.08;
      // 头顶呆毛（小锥；挂 hairDyn 做弹跳）
      const ahoge = new THREE.Group();
      ahoge.position.set(0.06, P.headR * 1.04, 0.02);
      hairDyn.add(ahoge);
      const aCone = mesh(new THREE.ConeGeometry(0.02, 0.11, 8), hairMat, 0.012, 0.055, 0.008, ahoge);
      aCone.rotation.z = -0.5;
      aCone.rotation.x = 0.15;
    }
  }

  return { root: g, lieWrap, armL, armR, foreL, foreR, legL, legR, kneeL, kneeR, head, eyeL: eyeLG, eyeR: eyeRG, hairDyn, skirt, hipY: P.hipY, clothes, skinTorso, foam, zzz, zzzSprites, spark, sparkSprites, cup, cupCoffee, cupJuice, cupStraw, cupSteam, book, bookFlip };
}

const dampN = THREE.MathUtils.damp;

export default function CharChibi3D({ rt, who, hide, poseRef, carryRef, guestName, wear, wear2 }: CharChibi3DProps) {
  // 访客按名牌哈希固定取一套配色（同一人每次来访穿同色）
  const guestOutfit = useMemo(() => {
    if (who !== 'guest' || !guestName) return 0;
    let h = 0;
    for (let i = 0; i < guestName.length; i++) h = (h * 31 + guestName.charCodeAt(i)) >>> 0;
    return h % 4;
  }, [who, guestName]);
  // 配色板索引：guest 哈希取色 / partner 默认 / me 走 wear 衣柜（不走色板）
  const effOutfit = who === 'guest' ? guestOutfit : 0;
  const rig = useMemo(
    () => buildChar(who, effOutfit, who === 'me' ? wear : undefined, who === 'partner' ? wear2 : undefined),
    [who, effOutfit, wear, wear2],
  );
  const holder = useRef<THREE.Group>(null);
  /** 音符事件（弹琴/扫弦的手部脉冲同步） */
  const noteFx = useRef({ pianoSide: 1, pianoAt: 0, guitarAt: 0 });
  useEffect(() => {
    if (who !== 'me') return;
    return onNote((e) => {
      if (e.kind === 'piano') {
        noteFx.current.pianoSide *= -1;
        noteFx.current.pianoAt = performance.now();
      } else {
        noteFx.current.guitarAt = performance.now();
      }
    });
  }, [who]);
  /** 看书翻页计时 */
  const flipAt = useRef(0);
  /** 眨眼节律 */
  const blink = useRef({ next: 2 + Math.random() * 2, at: -10 });
  /** 待机歪头节律 */
  const tilt = useRef({ next: 5 + Math.random() * 3, v: 0 });

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const h = holder.current;
    if (!h || !rt) return;
    h.visible = !hide;
    h.position.set(rt.x, 0, rt.z);
    h.rotation.y = rt.heading;

    const t = state.clock.elapsedTime;
    const { root, lieWrap, armL, armR, foreL, foreR, legL, legR, kneeL, kneeR, head, eyeL, eyeR, hairDyn, skirt, clothes, skinTorso, foam, zzz, zzzSprites, spark, sparkSprites, hipY, cup, cupCoffee, cupJuice, cupStraw, cupSteam, book, bookFlip } = rig;
    const pose: CharPose = who === 'me' ? (poseRef?.current?.pose ?? 'stand') : 'stand';
    const poseY = poseRef?.current?.y ?? 0;

    // —— 眨眼（随机 2.5~5.5s 一次，120ms 完成） ——
    const bl = blink.current;
    if (t >= bl.next) {
      bl.at = t;
      bl.next = t + 2.5 + Math.random() * 3;
    }
    const bph = t - bl.at;
    const blinkScale = bph < 0.055 ? 1 - (bph / 0.055) * 0.94 : bph < 0.13 ? 0.06 + ((bph - 0.055) / 0.075) * 0.94 : 1;
    eyeL.scale.y = blinkScale;
    eyeR.scale.y = blinkScale;

    // —— 手持水杯 ——
    const carry = who === 'me' && carryRef?.current?.cup === true;
    const carryCoffee = carry && carryRef?.current?.coffee === true;
    cup.visible = carry && pose !== 'lie' && pose !== 'bath' && pose !== 'shower';
    cupCoffee.visible = carryCoffee;
    cupJuice.visible = !carryCoffee;
    cupStraw.visible = !carryCoffee;
    if (carryCoffee) {
      const sp = cupSteam.material as THREE.SpriteMaterial;
      const ph = (t * 0.55) % 1;
      cupSteam.position.y = 0.06 + ph * 0.1;
      cupSteam.scale.setScalar(0.04 + ph * 0.05);
      sp.opacity = Math.sin(ph * Math.PI) * 0.6;
    } else {
      (cupSteam.material as THREE.SpriteMaterial).opacity = 0;
    }
    // —— 看书翻页 ——
    book.visible = pose === 'read';
    if (pose === 'read') {
      if (t - flipAt.current > 2.8) flipAt.current = t;
      const fp = Math.min(1, Math.max(0, (t - flipAt.current) / 0.55));
      bookFlip.rotation.z = fp < 1 ? -Math.PI * (1 - Math.cos(fp * Math.PI)) / 2 : 0;
    }
    // —— 化妆星星 ——
    spark.visible = pose === 'makeup';
    if (pose === 'makeup') {
      sparkSprites.forEach((sp, i) => {
        const a = t * 1.25 + (i / sparkSprites.length) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.3, 0.78 + Math.sin(t * 2.1 + i * 1.4) * 0.055, Math.sin(a) * 0.3);
        (sp.material as THREE.SpriteMaterial).opacity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.9));
      });
    }
    // —— 泡澡/淋浴脱衣 ——
    const undressed = pose === 'bath' || pose === 'shower';
    for (const m of clothes) m.visible = !undressed;
    skinTorso.visible = undressed;
    foam.visible = undressed;
    // —— 睡觉 Zzz ——
    zzz.visible = pose === 'lie';
    if (pose === 'lie') {
      zzzSprites.forEach((sp, i) => {
        const ph = (t * 0.42 + i * 0.34) % 1;
        sp.position.y = 0.36 + i * 0.14 + ph * 0.3;
        (sp.material as THREE.SpriteMaterial).opacity = Math.sin(ph * Math.PI) * 0.95;
      });
    }

    if (pose === 'stand') {
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      if (rt.moving) {
        // —— 走路：迈腿摆臂 + 大弹跳 + 头微晃 + 裙摆后飘 + 马尾/呆毛摇摆 ——
        const s = Math.sin(t * 10);
        legL.rotation.x = dampN(legL.rotation.x, s * 0.66, 22, dt);
        legR.rotation.x = dampN(legR.rotation.x, -s * 0.66, 22, dt);
        kneeL.rotation.x = dampN(kneeL.rotation.x, Math.max(0, -s) * 0.92, 22, dt);
        kneeR.rotation.x = dampN(kneeR.rotation.x, Math.max(0, s) * 0.92, 22, dt);
        armL.rotation.x = dampN(armL.rotation.x, -s * 0.6, 20, dt);
        armL.rotation.z = dampN(armL.rotation.z, -0.16, 14, dt);
        foreL.rotation.x = dampN(foreL.rotation.x, -0.38, 14, dt);
        armR.rotation.z = dampN(armR.rotation.z, 0.16, 14, dt);
        foreR.rotation.x = dampN(foreR.rotation.x, -0.38, 14, dt);
        root.position.y = Math.abs(Math.sin(t * 10)) * 0.042;
        root.rotation.x = dampN(root.rotation.x, 0.06, 12, dt);
        root.rotation.z = dampN(root.rotation.z, s * 0.04, 14, dt);
        head.rotation.x = dampN(head.rotation.x, 0.03, 12, dt);
        head.rotation.z = dampN(head.rotation.z, -s * 0.05, 12, dt);
        if (skirt) {
          skirt.rotation.x = dampN(skirt.rotation.x, -0.14, 10, dt);
          skirt.rotation.z = dampN(skirt.rotation.z, s * 0.05, 12, dt);
        }
        hairDyn.rotation.z = dampN(hairDyn.rotation.z, s * 0.07, 12, dt);
        hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0.05, 12, dt);
        if (carry) {
          armR.rotation.x = dampN(armR.rotation.x, -0.68, 14, dt);
          armR.rotation.z = dampN(armR.rotation.z, 0.2, 12, dt);
          foreR.rotation.x = dampN(foreR.rotation.x, -1.04, 14, dt);
        } else {
          armR.rotation.x = dampN(armR.rotation.x, s * 0.6, 20, dt);
        }
      } else {
        // —— 待机：呼吸 + 手臂微晃 + 随机歪头 + 头发轻摆 ——
        const tl = tilt.current;
        if (t >= tl.next) {
          tl.v = (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.07);
          tl.next = t + 4 + Math.random() * 4;
        }
        legL.rotation.x = dampN(legL.rotation.x, 0, 10, dt);
        legR.rotation.x = dampN(legR.rotation.x, 0, 10, dt);
        kneeL.rotation.x = dampN(kneeL.rotation.x, 0, 10, dt);
        kneeR.rotation.x = dampN(kneeR.rotation.x, 0, 10, dt);
        armL.rotation.x = dampN(armL.rotation.x, Math.sin(t * 1.7) * 0.05, 8, dt);
        armL.rotation.z = dampN(armL.rotation.z, -0.16, 10, dt);
        foreL.rotation.x = dampN(foreL.rotation.x, -0.14, 8, dt);
        armR.rotation.z = dampN(armR.rotation.z, 0.16, 10, dt);
        foreR.rotation.x = dampN(foreR.rotation.x, -0.14, 8, dt);
        root.position.y = Math.sin(t * 2.2) * 0.009 + 0.004;
        root.rotation.x = dampN(root.rotation.x, 0, 10, dt);
        root.rotation.z = dampN(root.rotation.z, 0, 10, dt);
        head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
        head.rotation.z = dampN(head.rotation.z, tl.v, 2.2, dt);
        if (skirt) {
          skirt.rotation.x = dampN(skirt.rotation.x, 0, 10, dt);
          skirt.rotation.z = dampN(skirt.rotation.z, 0, 10, dt);
        }
        hairDyn.rotation.z = dampN(hairDyn.rotation.z, Math.sin(t * 1.3) * 0.03, 8, dt);
        hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0, 8, dt);
        if (carry) {
          // 站着端杯：周期性举到嘴边咪一小口再放回来
          const ph = (t % 4.8) / 4.8;
          const sip = ph > 0.52 ? Math.sin(((ph - 0.52) / 0.48) * Math.PI) : 0;
          armR.rotation.x = dampN(armR.rotation.x, -0.28 - sip * 1.78, 9, dt);
          armR.rotation.z = dampN(armR.rotation.z, 0.2, 10, dt);
          foreR.rotation.x = dampN(foreR.rotation.x, -0.5 - sip * 0.72, 9, dt);
          head.rotation.x = dampN(head.rotation.x, -sip * 0.16, 7, dt);
        } else {
          armR.rotation.x = dampN(armR.rotation.x, -Math.sin(t * 1.7) * 0.05, 8, dt);
        }
      }
      return;
    }

    // —— 姿势（坐下 / 躺床 / 泡澡） ——
    if (pose === 'lie') {
      // 躺平：头朝家具 -z（床头/枕头侧），脸朝天
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, -Math.PI / 2, 8, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 8, dt);
      root.position.y = dampN(root.position.y, poseY + 0.07, 8, dt);
      root.rotation.x = dampN(root.rotation.x, 0, 8, dt);
      root.rotation.z = dampN(root.rotation.z, 0, 8, dt);
      legL.rotation.x = dampN(legL.rotation.x, 0.06, 8, dt);
      legR.rotation.x = dampN(legR.rotation.x, -0.04, 8, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 0.1, 8, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 0.1, 8, dt);
      armL.rotation.x = dampN(armL.rotation.x, 0.1, 8, dt);
      armR.rotation.x = dampN(armR.rotation.x, 0.1, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, 0.35, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, -0.35, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.15, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.15, 8, dt);
      head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
      head.rotation.z = dampN(head.rotation.z, 0, 8, dt);
      root.position.y += Math.sin(t * 1.6) * 0.006;
      return;
    }

    if (pose === 'shower') {
      // —— 站姿淋浴：双臂抬搓头发 + 微微仰头 + 身体轻晃 ——
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      root.position.y = dampN(root.position.y, Math.max(0.02, poseY), 9, dt);
      root.rotation.x = dampN(root.rotation.x, 0, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 1.4) * 0.035, 8, dt);
      legL.rotation.x = dampN(legL.rotation.x, 0.03, 8, dt);
      legR.rotation.x = dampN(legR.rotation.x, -0.03, 8, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 0, 8, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 0, 8, dt);
      const washUp = -2.45 + Math.sin(t * 2.1) * 0.07;
      armL.rotation.x = dampN(armL.rotation.x, washUp, 7, dt);
      armR.rotation.x = dampN(armR.rotation.x, washUp + Math.sin(t * 2.3) * 0.06, 7, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.3, 7, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.3, 7, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.55, 7, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.62, 7, dt);
      head.rotation.x = dampN(head.rotation.x, -0.16, 6, dt);
      head.rotation.z = dampN(head.rotation.z, 0, 6, dt);
      foam.children.forEach((f, i) => {
        f.position.y += Math.sin(t * 2.2 + i * 1.3) * 0.00035;
      });
      return;
    }

    // —— v5.6 姿势（做饭 / 吃饭 / 喝东西 / 弹琴 / 弹吉他 / 化妆 / 照镜子 / 看书） ——
    const standBase = () => {
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      root.position.y = dampN(root.position.y, Math.sin(t * 2.2) * 0.009 + 0.004, 10, dt);
      root.rotation.x = dampN(root.rotation.x, 0, 10, dt);
      legL.rotation.x = dampN(legL.rotation.x, 0, 10, dt);
      legR.rotation.x = dampN(legR.rotation.x, 0, 10, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 0, 10, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 0, 10, dt);
      if (skirt) {
        skirt.rotation.x = dampN(skirt.rotation.x, 0, 10, dt);
        skirt.rotation.z = dampN(skirt.rotation.z, 0, 10, dt);
      }
      hairDyn.rotation.z = dampN(hairDyn.rotation.z, 0, 8, dt);
      hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0, 8, dt);
    };
    const sitBase = () => {
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      root.position.y = dampN(root.position.y, Math.max(0.02, poseY - hipY), 9, dt);
      root.rotation.x = dampN(root.rotation.x, 0.03, 8, dt);
      root.rotation.z = dampN(root.rotation.z, 0, 8, dt);
      legL.rotation.x = dampN(legL.rotation.x, -1.55, 10, dt);
      legR.rotation.x = dampN(legR.rotation.x, -1.55, 10, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 1.48, 10, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 1.48, 10, dt);
      if (skirt) {
        skirt.rotation.x = dampN(skirt.rotation.x, -0.08, 10, dt);
        skirt.rotation.z = dampN(skirt.rotation.z, 0, 10, dt);
      }
      hairDyn.rotation.z = dampN(hairDyn.rotation.z, 0, 8, dt);
      hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0, 8, dt);
    };

    if (pose === 'cook') {
      // —— 做饭：站灶台前，一手持铲推拉颠勺，一手叉腰，微前倾 ——
      standBase();
      root.rotation.x = dampN(root.rotation.x, 0.1, 8, dt);
      armL.rotation.x = dampN(armL.rotation.x, -1.02 + Math.sin(t * 5.2) * 0.3, 12, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.14, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.4 + Math.sin(t * 5.2 + 0.6) * 0.16, 12, dt);
      armR.rotation.x = dampN(armR.rotation.x, -0.22, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.92, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.55, 8, dt);
      head.rotation.x = dampN(head.rotation.x, -0.12, 8, dt);
      head.rotation.z = dampN(head.rotation.z, 0, 8, dt);
      return;
    }
    if (pose === 'eat') {
      // —— 吃饭：坐餐桌边，一手循环舀饭送嘴 + 咀嚼 ——
      sitBase();
      const lift = Math.max(0, Math.sin(((t * 0.82) % 1) * Math.PI));
      armR.rotation.x = dampN(armR.rotation.x, -0.5 - lift * 1.42, 14, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.16, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.5 - lift * 0.78, 14, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.35, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.18, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.85, 8, dt);
      head.rotation.x = dampN(head.rotation.x, 0.14 - lift * 0.16, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 7) * 0.02, 10, dt);
      return;
    }
    if (pose === 'drink') {
      // —— 喝东西：站冰箱前举杯仰头咕咚咕咚 ——
      standBase();
      armR.rotation.x = dampN(armR.rotation.x, -2.02, 9, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.2, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.88, 9, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.08, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.12, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.14, 8, dt);
      head.rotation.x = dampN(head.rotation.x, -0.1 + Math.sin(t * 6) * 0.012, 8, dt);
      head.rotation.z = dampN(head.rotation.z, 0, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 1.6) * 0.02, 8, dt);
      return;
    }
    if (pose === 'piano') {
      // —— 弹钢琴：坐琴凳，双臂前伸，前臂交替敲键；音符驱动对应侧手 ——
      sitBase();
      const nowMs = performance.now();
      const sinceNote = nowMs - noteFx.current.pianoAt;
      const pulse = sinceNote < 220 ? 1 - sinceNote / 220 : 0;
      const noteSideL = noteFx.current.pianoSide > 0;
      const kL = Math.max(Math.max(0, Math.sin(t * 5.4)) * 0.55, pulse * (noteSideL ? 1 : 0));
      const kR = Math.max(Math.max(0, Math.sin(t * 5.4 + Math.PI)) * 0.55, pulse * (noteSideL ? 0 : 1));
      armL.rotation.x = dampN(armL.rotation.x, -1.26, 10, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.26, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.22, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.22, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.44 - kL * 0.4, 20, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.44 - kR * 0.4, 20, dt);
      head.rotation.x = dampN(head.rotation.x, 0.18, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 2.6) * 0.03, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 2.6) * 0.028, 8, dt);
      return;
    }
    if (pose === 'guitar') {
      // —— 弹吉他：站姿抱琴，一手扫弦一手按弦，扫弦音符驱动右手 ——
      standBase();
      const nowMs = performance.now();
      const sinceStrum = nowMs - noteFx.current.guitarAt;
      const strum = sinceStrum < 260 ? Math.sin((1 - sinceStrum / 260) * Math.PI) : 0;
      armR.rotation.x = dampN(armR.rotation.x, -0.88, 10, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.34, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -1.12 + Math.sin(t * 7.2) * 0.16 - strum * 0.34, 22, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.78, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.52, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.5, 10, dt);
      head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 3.4) * 0.06, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 3.4) * 0.035, 8, dt);
      root.position.y = dampN(root.position.y, Math.abs(Math.sin(t * 3.4)) * 0.012 + 0.004, 10, dt);
      return;
    }
    if (pose === 'read') {
      // —— 看书：坐姿抱书，双手托书，偶尔翻页 ——
      sitBase();
      armL.rotation.x = dampN(armL.rotation.x, -1.08, 10, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.08, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.3, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.3, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.86, 10, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.86, 10, dt);
      head.rotation.x = dampN(head.rotation.x, 0.32, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 0.7) * 0.03, 8, dt);
      book.position.y = 0.31 + Math.sin(t * 1.8) * 0.006;
      return;
    }
    if (pose === 'makeup') {
      // —— 化妆：坐梳妆台小凳，一手持粉扑轻拍脸颊，歪头照镜子 ——
      sitBase();
      armR.rotation.x = dampN(armR.rotation.x, -1.6 + Math.sin(t * 2.9) * 0.16, 12, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.3, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -1.02, 10, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.3, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.16, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.72, 8, dt);
      head.rotation.x = dampN(head.rotation.x, 0.05, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 1.9) * 0.1, 8, dt);
      return;
    }
    if (pose === 'mirror') {
      // —— 照镜子：一手叉腰一手撩头发，左右打量自己 ——
      standBase();
      armL.rotation.x = dampN(armL.rotation.x, -0.2, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.98, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.6, 8, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.52 + Math.sin(t * 1.8) * 0.12, 9, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.34, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.92, 9, dt);
      head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 1.4) * 0.12, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 0.9) * 0.04, 8, dt);
      return;
    }

    // sit / bath：屈髋屈膝坐姿
    lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
    lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
    const baseY = pose === 'bath' ? poseY : Math.max(0.02, poseY - hipY);
    root.position.y = dampN(root.position.y, baseY, 9, dt);
    root.rotation.x = dampN(root.rotation.x, pose === 'bath' ? 0.12 : 0.03, 8, dt);
    root.rotation.z = dampN(root.rotation.z, 0, 8, dt);
    const thigh = pose === 'bath' ? -1.38 : -1.55;
    legL.rotation.x = dampN(legL.rotation.x, thigh, 10, dt);
    legR.rotation.x = dampN(legR.rotation.x, thigh, 10, dt);
    kneeL.rotation.x = dampN(kneeL.rotation.x, -thigh * 0.95, 10, dt);
    kneeR.rotation.x = dampN(kneeR.rotation.x, -thigh * 0.95, 10, dt);
    const armX = pose === 'bath' ? -1.05 : -0.4;
    armL.rotation.x = dampN(armL.rotation.x, armX, 9, dt);
    armR.rotation.x = dampN(armR.rotation.x, armX, 9, dt);
    armL.rotation.z = dampN(armL.rotation.z, -0.12, 8, dt);
    armR.rotation.z = dampN(armR.rotation.z, 0.12, 8, dt);
    foreL.rotation.x = dampN(foreL.rotation.x, pose === 'bath' ? -0.5 : -0.7, 9, dt);
    foreR.rotation.x = dampN(foreR.rotation.x, pose === 'bath' ? -0.5 : -0.7, 9, dt);
    head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
    head.rotation.z = dampN(head.rotation.z, 0, 8, dt);
    if (skirt) {
      skirt.rotation.x = dampN(skirt.rotation.x, pose === 'bath' ? -0.12 : -0.08, 10, dt);
      skirt.rotation.z = dampN(skirt.rotation.z, 0, 10, dt);
    }
    hairDyn.rotation.z = dampN(hairDyn.rotation.z, 0, 8, dt);
    hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0, 8, dt);
    // 坐着端杯：右手把杯子端在胸前（只对 sit）
    if (pose === 'sit' && carry) {
      armR.rotation.x = dampN(armR.rotation.x, -1.02, 9, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.18, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.95, 9, dt);
    }
    // 泡澡轻轻晃悠
    if (pose === 'bath') {
      root.position.y += Math.sin(t * 2.4) * 0.006;
      foam.children.forEach((f, i) => {
        f.position.y += Math.sin(t * 2.2 + i * 1.3) * 0.00035;
      });
    }
  });

  return (
    <group ref={holder} scale={1}>
      <primitive object={rig.root} />
      {/* 访客名牌：头顶浮名字牌 */}
      {who === 'guest' && guestName && <GuestTag name={guestName} />}
    </group>
  );
}

/** 访客头顶名牌（canvas 纹理） */
function GuestTag({ name }: { name: string }) {
  const tex = useMemo(() => {
    const W = 256;
    const H = 96;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    const r = 24;
    ctx.fillStyle = 'rgba(255,253,248,0.94)';
    ctx.strokeStyle = '#f2b3c2';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(r + 3, 3);
    ctx.arcTo(W - 3, 3, W - 3, H - 3, r);
    ctx.arcTo(W - 3, H - 3, 3, H - 3, r);
    ctx.arcTo(3, H - 3, 3, 3, r);
    ctx.arcTo(3, 3, W - 3, 3, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4a4a4e';
    ctx.font = '600 46px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.slice(0, 6), W / 2, H / 2 + 3);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [name]);
  return (
    <group position={[0, 1.08, 0]}>
      <sprite scale={[0.5, 0.19, 1]}>
        <spriteMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
      </sprite>
    </group>
  );
}

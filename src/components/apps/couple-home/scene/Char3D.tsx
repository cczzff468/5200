'use client';

/* eslint-disable react-hooks/immutability -- R3F 动画需要每帧原地修改 three 对象 */

/**
 * 情侣小家 3D —— 小人（v5.4 全新可动骨架，程序化建模）
 *
 * - 两个角色 × 两种画风（参照豆包立绘）：
 *   me      = 女主：深棕长卷发 + 白背心 + 奶油开衫 + 深蓝喇叭牛仔裤 + 小白鞋；
 *   partner = 男主：柔黑蓬松短发 + 黑夹克 + 黑T + 黑牛仔裤 + 小白鞋；
 *   cartoon = Q版大头（头大身圆，~0.95m）；real = 拟真比例（头小身长，同高更纤细）；
 * - 四级关节（肩/肘/髋/膝）：走路摆臂迈腿 + 身体起伏；待机呼吸 + 手臂微晃；
 * - 姿势（阻尼过渡）：sit 坐下 / lie 躺床（头朝床头、脸朝天）/ bath 脱衣泡澡（衣服隐藏 + 素体）；
 * - 朝向由 GameLoop 每帧写入 rt 并贴到 holder；第一人称时 hide。
 */

import { useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { CharPose, CharRT } from '../types';

export interface Char3DProps {
  rt: CharRT;
  who: 'me' | 'partner';
  /** 隐藏（第一人称时隐藏「我」） */
  hide?: boolean;
  /** 画风：cartoon Q版 / real 拟真 */
  style?: 'cartoon' | 'real';
  /** 姿势（「我」专属；partner 永远站立） */
  poseRef?: RefObject<{ pose: CharPose; y: number }>;
  /** 穿搭编号（衣柜换装；0=默认，1/2=换色套装；partner 固定 0） */
  outfit?: number;
}

/** 穿搭色板（两角色 × 三套；0 为默认，衣柜换装循环切换） */
const OUTFITS: Record<'me' | 'partner', Record<'skin' | 'hair' | 'tank' | 'jacket' | 'jeans' | 'shoes' | 'blush', string>[]> = {
  me: [
    {
      skin: '#ffe3cd',
      hair: '#4a342a',
      tank: '#f7f5f1',
      jacket: '#efe8da',
      jeans: '#3e4d5c',
      shoes: '#f4f2ee',
      blush: '#f6b1b8',
    },
    {
      // 樱粉家居服：粉开衫 + 奶白背心 + 米色阔腿裤
      skin: '#ffe3cd',
      hair: '#4a342a',
      tank: '#fbf6ee',
      jacket: '#f2c1cd',
      jeans: '#dcc9b0',
      shoes: '#f4ede4',
      blush: '#f6b1b8',
    },
    {
      // 薄荷慵懒风：薄荷开衫 + 白背心 + 焦糖裤
      skin: '#ffe3cd',
      hair: '#4a342a',
      tank: '#f9f7f2',
      jacket: '#bcdcc8',
      jeans: '#b08968',
      shoes: '#efe8dc',
      blush: '#f6b1b8',
    },
  ],
  partner: [
    {
      skin: '#ffdfc6',
      hair: '#26262c',
      tank: '#1e1e24',
      jacket: '#2c2c33',
      jeans: '#33333b',
      shoes: '#f6f5f2',
      blush: '#f2b9b0',
    },
    {
      // 燕麦暖男：燕麦夹克 + 白 T + 灰棕牛仔裤
      skin: '#ffdfc6',
      hair: '#26262c',
      tank: '#f5f2ec',
      jacket: '#8a7563',
      jeans: '#5a544c',
      shoes: '#f6f5f2',
      blush: '#f2b9b0',
    },
    {
      // 雾蓝清爽：雾蓝夹克 + 杏色 T + 深蓝牛仔裤
      skin: '#ffdfc6',
      hair: '#26262c',
      tank: '#f2e8d8',
      jacket: '#6d7f8c',
      jeans: '#3e4d5c',
      shoes: '#f6f5f2',
      blush: '#f2b9b0',
    },
  ],
};

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
  hipY: number;
  /** 泡澡时隐藏的衣物网格（背心/开衫/袖子/裤腿） */
  clothes: THREE.Mesh[];
  /** 泡澡素体（肤色躯干，平时隐藏） */
  skinTorso: THREE.Mesh;
  /** 泡澡/淋浴泡泡（脱衣遮挡，腰圈 + 头顶洗发沫，平时隐藏） */
  foam: THREE.Group;
  /** 睡觉 Zzz（躺床时从头顶飘起，平时隐藏） */
  zzz: THREE.Group;
  zzzSprites: THREE.Sprite[];
  /** 化妆星星（化妆时绕头部旋转闪烁，平时隐藏） */
  spark: THREE.Group;
  sparkSprites: THREE.Sprite[];
}

const stdMat = (c: string, rough = 0.8, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, ...extra });

/**
 * 组装一只有关节的小人（纯几何，无外部依赖）。
 * 结构：root(起伏/前倾) → lieWrap(躺姿旋转) → [腿×2(髋→膝), 躯干+开衫, 臂×2(肩→肘), 头+发型]
 */
function buildChar(who: 'me' | 'partner', style: 'cartoon' | 'real', outfit = 0): CharRig {
  const o = OUTFITS[who][outfit % OUTFITS[who].length];
  const g = new THREE.Group();
  const clothes: THREE.Mesh[] = [];

  // 比例参数（两套画风）
  const P =
    style === 'cartoon'
      ? {
          hipY: 0.34,
          thighLen: 0.17,
          calfLen: 0.15,
          thighR: 0.054,
          calfR: 0.046,
          legX: 0.075,
          torsoY: 0.47,
          torsoR: 0.15,
          torsoLen: 0.18,
          shoulderY: 0.575,
          shoulderX: 0.165,
          upperLen: 0.1,
          upperR: 0.042,
          foreLen: 0.09,
          foreR: 0.036,
          headY: 0.78,
          headR: 0.19,
          shoeW: 0.095,
          shoeL: 0.16,
          eyeR: 0.027,
          eyeX: 0.07,
          eyeY: 0.005,
        }
      : {
          hipY: 0.5,
          thighLen: 0.21,
          calfLen: 0.19,
          thighR: 0.045,
          calfR: 0.037,
          legX: 0.062,
          torsoY: 0.66,
          torsoR: 0.105,
          torsoLen: 0.3,
          shoulderY: 0.775,
          shoulderX: 0.125,
          upperLen: 0.14,
          upperR: 0.031,
          foreLen: 0.13,
          foreR: 0.027,
          headY: 0.925,
          headR: 0.115,
          shoeW: 0.08,
          shoeL: 0.21,
          eyeR: 0.013,
          eyeX: 0.043,
          eyeY: 0.0,
        };

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

  // ---------- 躺姿包裹层（平时零旋转） ----------
  const lieWrap = new THREE.Group();
  g.add(lieWrap);

  // ---------- 腿（髋 pivot → 大腿 → 膝 pivot → 小腿 + 鞋） ----------
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
    // 大腿（牛仔裤色）
    mesh(
      new THREE.CapsuleGeometry(P.thighR, P.thighLen - P.thighR * 1.2, 6, 12),
      stdMat(o.jeans),
      0,
      -P.thighLen / 2,
      0,
      pivot,
    );
    // 膝
    knee.position.set(0, -P.thighLen, 0);
    pivot.add(knee);
    // 小腿
    mesh(
      new THREE.CapsuleGeometry(P.calfR, P.calfLen - P.calfR * 1.2, 6, 12),
      stdMat(o.jeans),
      0,
      -P.calfLen / 2,
      0,
      knee,
    );
    // 小白鞋（圆头）
    const shoe = mesh(
      new THREE.BoxGeometry(P.shoeW, 0.05, P.shoeL, 2, 2, 3),
      stdMat(o.shoes, 0.65),
      0,
      -P.calfLen - 0.005,
      P.shoeL * 0.18,
      knee,
    );
    shoe.geometry.translate(0, 0, 0);
    clothes.push(shoe);
  }

  // ---------- 躯干（背心）+ 开衫/夹克（背板 + 两片前襟） ----------
  const torsoMat = stdMat(o.tank);
  const torso = mesh(new THREE.CapsuleGeometry(P.torsoR, P.torsoLen, 8, 16), torsoMat, 0, P.torsoY, 0, lieWrap);
  clothes.push(torso);
  const jacketMat = stdMat(o.jacket, 0.85);
  const jw = P.torsoR * 1.04; // 开衫包在躯干外侧
  // 背板
  const backPanel = mesh(
    new THREE.BoxGeometry(jw * 1.7, P.torsoLen * 1.05, 0.05),
    jacketMat,
    0,
    P.torsoY,
    -P.torsoR * 0.78,
    lieWrap,
  );
  clothes.push(backPanel);
  // 两片前襟（中间留出背心）
  for (const sx of [-1, 1]) {
    const lapel = mesh(
      new THREE.BoxGeometry(0.055, P.torsoLen * 1.02, P.torsoR * 1.5),
      jacketMat,
      (P.torsoR + 0.02) * sx,
      P.torsoY,
      0,
      lieWrap,
    );
    clothes.push(lapel);
  }
  // 泡澡素体（肤色躯干，平时隐藏）
  const skinTorso = mesh(
    new THREE.CapsuleGeometry(P.torsoR * 0.94, P.torsoLen, 8, 16),
    stdMat(o.skin, 0.65),
    0,
    P.torsoY,
    0,
    lieWrap,
  );
  skinTorso.visible = false;

  // ---------- 泡澡/淋浴泡泡（脱衣遮挡：腰圈 + 肩头 + 头顶洗发沫，平时隐藏） ----------
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
    foamAdd(Math.cos(a) * (P.torsoR + 0.035), P.torsoY - P.torsoLen * 0.28 + (i % 2) * 0.04, Math.sin(a) * (P.torsoR + 0.035), 0.05 + (i % 3) * 0.013);
  }
  foamAdd(-P.torsoR * 0.7, P.torsoY + P.torsoLen * 0.42, P.torsoR * 0.6, 0.045);
  foamAdd(P.torsoR * 0.7, P.torsoY + P.torsoLen * 0.42, P.torsoR * 0.6, 0.05);
  foamAdd(-P.headR * 0.42, P.headY + P.headR * 0.72, P.headR * 0.18, 0.05);
  foamAdd(P.headR * 0.46, P.headY + P.headR * 0.78, -P.headR * 0.12, 0.055);
  foamAdd(0, P.headY + P.headR * 0.9, P.headR * 0.28, 0.045);

  // ---------- 睡觉 Zzz（挂 root：躺姿时头部在局部 -z 床头侧，Zzz 从头上方飘起） ----------
  const zzz = new THREE.Group();
  zzz.visible = false;
  g.add(zzz);
  const zzzTex = makeZzzTexture();
  const zzzSprites: THREE.Sprite[] = [];
  for (let i = 0; i < 3; i++) {
    const sm = new THREE.SpriteMaterial({ map: zzzTex, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    sp.scale.setScalar(0.11 + i * 0.045);
    sp.position.set(0.14 + i * 0.03, 0.72 + i * 0.16, -0.78 - i * 0.07);
    zzz.add(sp);
    zzzSprites.push(sp);
  }

  // ---------- 化妆星星（挂 root：化妆时绕头部旋转闪烁） ----------
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

  // 脖子（拟真风露出脖颈）
  if (style === 'real') {
    mesh(new THREE.CylinderGeometry(0.034, 0.04, 0.07, 10), stdMat(o.skin, 0.65), 0, P.torsoY + P.torsoLen / 2 + P.torsoR + 0.02, 0, lieWrap);
  }

  // ---------- 手臂（肩 pivot → 上臂(袖) → 肘 pivot → 前臂(肤) + 手） ----------
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  const foreL = new THREE.Group();
  const foreR = new THREE.Group();
  for (const [pivot, fore, sx] of [
    [armL, foreL, -1],
    [armR, foreR, 1],
  ] as const) {
    pivot.position.set((P.torsoR + P.upperR * 0.6) * sx, P.shoulderY, 0);
    pivot.rotation.z = sx * 0.12; // 微微外张
    lieWrap.add(pivot);
    const sleeve = mesh(
      new THREE.CapsuleGeometry(P.upperR, P.upperLen, 6, 10),
      stdMat(o.jacket, 0.85),
      0,
      -P.upperLen / 2 - P.upperR * 0.2,
      0,
      pivot,
    );
    clothes.push(sleeve);
    fore.position.set(0, -P.upperLen - P.upperR * 0.4, 0);
    pivot.add(fore);
    mesh(
      new THREE.CapsuleGeometry(P.foreR, P.foreLen, 6, 10),
      stdMat(o.skin, 0.65),
      0,
      -P.foreLen / 2 - P.foreR * 0.2,
      0,
      fore,
    );
    mesh(new THREE.SphereGeometry(P.foreR * 1.25, 10, 8), stdMat(o.skin, 0.65), 0, -P.foreLen - P.foreR * 0.6, 0, fore);
  }

  // ---------- 头 + 脸 + 发型 ----------
  const head = new THREE.Group();
  head.position.set(0, P.headY, 0);
  lieWrap.add(head);
  const faceMat = stdMat(o.skin, 0.62);
  mesh(new THREE.SphereGeometry(P.headR, 26, 22), faceMat, 0, 0, 0, head);

  const eyeMat = stdMat('#3a3134', 0.35);
  const eyeR = P.eyeR;
  for (const sx of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(eyeR, 12, 10), eyeMat, P.eyeX * sx, P.eyeY, P.headR * 0.86, head);
    eye.scale.set(1, style === 'cartoon' ? 1.15 : 1, 0.7);
    // 高光
    mesh(
      new THREE.SphereGeometry(eyeR * 0.32, 8, 8),
      stdMat('#ffffff', 0.2),
      P.eyeX * sx + eyeR * 0.28,
      P.eyeY + eyeR * 0.34,
      P.headR * 0.86 + eyeR * 0.5,
      head,
    );
    // 眉毛（细细一条）
    if (style === 'real') {
      const brow = mesh(new THREE.BoxGeometry(0.035, 0.006, 0.008), stdMat(o.hair, 0.6), P.eyeX * sx, P.eyeY + eyeR * 1.9, P.headR * 0.92, head);
      brow.rotation.z = sx * 0.08;
    } else {
      const brow = mesh(new THREE.BoxGeometry(0.05, 0.011, 0.01), stdMat(o.hair, 0.6), P.eyeX * sx, P.eyeY + eyeR * 1.8, P.headR * 0.9, head);
      brow.rotation.z = sx * -0.12;
    }
    // 腮红
    const blush = mesh(
      new THREE.CircleGeometry(P.headR * 0.14, 12),
      stdMat(o.blush, 1, { transparent: true, opacity: 0.8 }),
      (P.eyeX + P.headR * 0.32) * sx,
      -P.headR * 0.18,
      P.headR * 0.78,
      head,
    );
    blush.rotation.y = sx * 0.42;
  }
  // 嘴（微笑弧线：小弯管）
  const smile = mesh(
    new THREE.TorusGeometry(P.headR * 0.13, 0.008, 6, 14, Math.PI * 0.85),
    stdMat(who === 'me' ? '#e2908e' : '#c98a80', 0.6),
    0,
    -P.headR * 0.36,
    P.headR * 0.88,
    head,
  );
  smile.rotation.x = Math.PI * 0.08;
  smile.rotation.z = Math.PI + Math.PI * 0.075;

  // 发型
  const hairMat = stdMat(o.hair, 0.72);
  if (who === 'me') {
    // —— 女主：深棕长卷发 ——
    const cap = mesh(new THREE.SphereGeometry(P.headR * 1.06, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat, 0, P.headR * 0.06, -P.headR * 0.06, head);
    cap.rotation.x = -0.22;
    // 后脑长发披到背
    const backHair = mesh(new THREE.SphereGeometry(P.headR, 18, 14), hairMat, 0, -P.headR * 0.55, -P.headR * 0.62, head);
    backHair.scale.set(1.02, style === 'cartoon' ? 1.75 : 2.3, 0.62);
    // 波浪卷：后发上缀几颗小球
    for (const [bx, by, bz, br] of [
      [-0.09, -0.16, -0.1, 0.05],
      [0.09, -0.2, -0.1, 0.055],
      [-0.06, -0.3, -0.09, 0.045],
      [0.07, -0.34, -0.08, 0.05],
    ] as const) {
      const curl = mesh(new THREE.SphereGeometry(br * (P.headR / 0.19), 10, 8), hairMat, bx * (P.headR / 0.19), by * (P.headR / 0.19), bz, head);
      curl.scale.set(1, 1.2, 1);
    }
    // 两侧长发垂胸
    for (const sx of [-1, 1]) {
      const lock = mesh(
        new THREE.CapsuleGeometry(P.headR * 0.24, P.headR * (style === 'cartoon' ? 1.1 : 1.6), 6, 10),
        hairMat,
        P.headR * 0.94 * sx,
        -P.headR * (style === 'cartoon' ? 0.9 : 1.3),
        P.headR * 0.1,
        head,
      );
      lock.rotation.x = 0.06;
      lock.rotation.z = sx * -0.06;
      // 发梢卷
      mesh(new THREE.SphereGeometry(P.headR * 0.2, 10, 8), hairMat, P.headR * 0.96 * sx, -P.headR * (style === 'cartoon' ? 1.62 : 2.2), P.headR * 0.14, head);
    }
    // 刘海（三撮）
    for (const [fx, fz] of [[0, 0.8], [-0.5, 0.68], [0.5, 0.68]] as const) {
      const bang = mesh(new THREE.SphereGeometry(P.headR * 0.3, 10, 8), hairMat, fx * P.headR, P.headR * 0.62, fz * P.headR, head);
      bang.scale.set(1, 0.62, 0.8);
    }
  } else {
    // —— 男主：柔黑蓬松短发 ——
    const cap = mesh(new THREE.SphereGeometry(P.headR * 1.07, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, P.headR * 0.08, -P.headR * 0.04, head);
    cap.rotation.x = -0.18;
    // 蓬松顶：一排绒球
    const fluffN = style === 'cartoon' ? 5 : 4;
    for (let i = 0; i < fluffN; i++) {
      const fx = (i / (fluffN - 1) - 0.5) * 1.35;
      const puff = mesh(new THREE.SphereGeometry(P.headR * (0.3 + 0.08 * Math.sin(i * 2.1)), 12, 10), hairMat, fx * P.headR, P.headR * (0.82 + 0.1 * Math.cos(i * 1.7)), -P.headR * 0.12, head);
      puff.scale.set(1.05, 0.85, 1);
    }
    // 前帘（盖眉）
    const fringe = mesh(new THREE.SphereGeometry(P.headR * 0.98, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.34), hairMat, 0, P.headR * 0.34, P.headR * 0.06, head);
    fringe.rotation.x = 0.32;
    // 鬓角
    for (const sx of [-1, 1]) {
      mesh(new THREE.SphereGeometry(P.headR * 0.24, 10, 8), hairMat, P.headR * 0.92 * sx, -P.headR * 0.05, -P.headR * 0.2, head);
    }
    // 后脑勺补发
    const back = mesh(new THREE.SphereGeometry(P.headR * 0.98, 18, 12, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.4), hairMat, 0, 0, -P.headR * 0.05, head);
    back.rotation.x = -0.1;
  }

  return { root: g, lieWrap, armL, armR, foreL, foreR, legL, legR, kneeL, kneeR, head, hipY: P.hipY, clothes, skinTorso, foam, zzz, zzzSprites, spark, sparkSprites };
}

const dampN = THREE.MathUtils.damp;

/** 化妆星星贴图（四角星光，樱粉渐变） */
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
  ctx.fillStyle = g;
  // 四角星（两条交叉的菱形光芒）
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

/** Zzz 字贴图（睡觉特效用，白字 + 雾紫描边） */
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

export default function Char3D({ rt, who, hide, style = 'cartoon', poseRef, outfit = 0 }: Char3DProps) {
  const rig = useMemo(() => buildChar(who, style, outfit), [who, style, outfit]);
  const holder = useRef<THREE.Group>(null);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const h = holder.current;
    if (!h) return;
    h.visible = !hide;
    h.position.set(rt.x, 0, rt.z);
    h.rotation.y = rt.heading;

    const t = state.clock.elapsedTime;
    const { root, lieWrap, armL, armR, foreL, foreR, legL, legR, kneeL, kneeR, head, clothes, skinTorso, foam, zzz, zzzSprites, spark, sparkSprites, hipY } = rig;
    const pose: CharPose = who === 'me' ? (poseRef?.current?.pose ?? 'stand') : 'stand';
    const poseY = poseRef?.current?.y ?? 0;

    // 化妆星星：仅化妆时可见旋转闪烁
    spark.visible = pose === 'makeup';
    if (pose === 'makeup') {
      sparkSprites.forEach((sp, i) => {
        const a = t * 1.25 + (i / sparkSprites.length) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.3, 0.98 + Math.sin(t * 2.1 + i * 1.4) * 0.055, Math.sin(a) * 0.3);
        (sp.material as THREE.SpriteMaterial).opacity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.9));
      });
    }

    // 泡澡/淋浴：脱衣（隐藏衣物 + 素体可见 + 泡泡遮挡）
    const undressed = pose === 'bath' || pose === 'shower';
    for (const m of clothes) m.visible = !undressed;
    skinTorso.visible = undressed;
    foam.visible = undressed;
    // 睡觉 Zzz：躺床时从头顶飘起
    zzz.visible = pose === 'lie';
    if (pose === 'lie') {
      zzzSprites.forEach((sp, i) => {
        const ph = (t * 0.42 + i * 0.34) % 1;
        sp.position.y = 0.72 + i * 0.15 + ph * 0.32;
        (sp.material as THREE.SpriteMaterial).opacity = Math.sin(ph * Math.PI) * 0.95;
      });
    }

    if (pose === 'stand') {
      // 躺姿包裹复位
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      if (rt.moving) {
        // —— 走路：摆臂 + 迈腿 + 起伏 ——
        const s = Math.sin(t * 9.5);
        legL.rotation.x = dampN(legL.rotation.x, s * 0.62, 22, dt);
        legR.rotation.x = dampN(legR.rotation.x, -s * 0.62, 22, dt);
        kneeL.rotation.x = dampN(kneeL.rotation.x, Math.max(0, -s) * 0.85, 22, dt);
        kneeR.rotation.x = dampN(kneeR.rotation.x, Math.max(0, s) * 0.85, 22, dt);
        armL.rotation.x = dampN(armL.rotation.x, -s * 0.55, 20, dt);
        armR.rotation.x = dampN(armR.rotation.x, s * 0.55, 20, dt);
        foreL.rotation.x = dampN(foreL.rotation.x, -0.35, 14, dt);
        foreR.rotation.x = dampN(foreR.rotation.x, -0.35, 14, dt);
        root.position.y = Math.abs(Math.sin(t * 9.5)) * (style === 'cartoon' ? 0.038 : 0.026);
        root.rotation.x = dampN(root.rotation.x, 0.07, 12, dt);
        root.rotation.z = dampN(root.rotation.z, s * 0.035, 14, dt);
      } else {
        // —— 待机：呼吸 + 手臂微晃 ——
        legL.rotation.x = dampN(legL.rotation.x, 0, 10, dt);
        legR.rotation.x = dampN(legR.rotation.x, 0, 10, dt);
        kneeL.rotation.x = dampN(kneeL.rotation.x, 0, 10, dt);
        kneeR.rotation.x = dampN(kneeR.rotation.x, 0, 10, dt);
        armL.rotation.x = dampN(armL.rotation.x, Math.sin(t * 1.7) * 0.04, 8, dt);
        armR.rotation.x = dampN(armR.rotation.x, -Math.sin(t * 1.7) * 0.04, 8, dt);
        foreL.rotation.x = dampN(foreL.rotation.x, -0.12, 8, dt);
        foreR.rotation.x = dampN(foreR.rotation.x, -0.12, 8, dt);
        root.position.y = Math.sin(t * 2.2) * 0.008 + 0.004;
        root.rotation.x = dampN(root.rotation.x, 0, 10, dt);
        root.rotation.z = dampN(root.rotation.z, 0, 10, dt);
      }
      head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
      return;
    }

    // —— 姿势（坐下 / 躺床 / 泡澡） ——
    if (pose === 'lie') {
      // 躺平：头朝家具 -z（床头/枕头侧），脸朝天（Rx(-π/2)：+y 头→-z、+z 脸→+y）
      // ⚑ v5.5 修复「躺反」：旧版 (π/2, π) 头朝 +z 正好躺在床尾，翻转为头在枕头侧
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, -Math.PI / 2, 8, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 8, dt);
      root.position.y = dampN(root.position.y, poseY + 0.06, 8, dt);
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
      // 睡觉呼吸（胸口起伏更明显）
      root.position.y += Math.sin(t * 1.6) * 0.006;
      return;
    }

    if (pose === 'shower') {
      // —— 站姿淋浴：双臂抬搓头发 + 微微仰头 + 身体轻晃（水从花洒落下） ——
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
      // 泡泡轻轻浮动
      foam.children.forEach((f, i) => {
        f.position.y += Math.sin(t * 2.2 + i * 1.3) * 0.00035;
      });
      return;
    }

    // —— v5.6 新姿势（做饭 / 吃饭 / 喝东西 / 弹琴 / 弹吉他 / 化妆 / 照镜子） ——
    /** 站姿基底： lieWrap 复位 + 直腿 + 呼吸起伏 */
    const standBase = () => {
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      root.position.y = dampN(root.position.y, Math.sin(t * 2.2) * 0.008 + 0.004, 10, dt);
      root.rotation.x = dampN(root.rotation.x, 0, 10, dt);
      legL.rotation.x = dampN(legL.rotation.x, 0, 10, dt);
      legR.rotation.x = dampN(legR.rotation.x, 0, 10, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 0, 10, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 0, 10, dt);
    };
    /** 坐姿基底： eat/piano/makeup 共用（屈髋屈膝 + 落座高度） */
    const sitBase = () => {
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      root.position.y = dampN(root.position.y, Math.max(0.02, poseY - hipY), 9, dt);
      root.rotation.x = dampN(root.rotation.x, 0.03, 8, dt);
      root.rotation.z = dampN(root.rotation.z, 0, 8, dt);
      legL.rotation.x = dampN(legL.rotation.x, -1.5, 10, dt);
      legR.rotation.x = dampN(legR.rotation.x, -1.5, 10, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 1.44, 10, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 1.44, 10, dt);
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
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 1.6) * 0.02, 8, dt);
      return;
    }
    if (pose === 'piano') {
      // —— 弹钢琴：坐琴凳，双臂前伸，前臂交替敲键，身体随节奏轻摇 ——
      sitBase();
      const kL = Math.max(0, Math.sin(t * 5.4));
      const kR = Math.max(0, Math.sin(t * 5.4 + Math.PI));
      armL.rotation.x = dampN(armL.rotation.x, -1.26, 10, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.26, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.22, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.22, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.44 - kL * 0.4, 16, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.44 - kR * 0.4, 16, dt);
      head.rotation.x = dampN(head.rotation.x, 0.18, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 2.6) * 0.028, 8, dt);
      return;
    }
    if (pose === 'guitar') {
      // —— 弹吉他：站姿抱琴，一手扫弦一手按弦，身体摇摆点脚 ——
      standBase();
      armR.rotation.x = dampN(armR.rotation.x, -0.88, 10, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.34, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -1.12 + Math.sin(t * 7.2) * 0.24, 14, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.78, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.52, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.5, 10, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 3.4) * 0.06, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 3.4) * 0.035, 8, dt);
      root.position.y = dampN(root.position.y, Math.abs(Math.sin(t * 3.4)) * 0.012 + 0.004, 10, dt);
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
    const thigh = pose === 'bath' ? -1.35 : -1.5;
    legL.rotation.x = dampN(legL.rotation.x, thigh, 10, dt);
    legR.rotation.x = dampN(legR.rotation.x, thigh, 10, dt);
    kneeL.rotation.x = dampN(kneeL.rotation.x, -thigh * 0.96, 10, dt);
    kneeR.rotation.x = dampN(kneeR.rotation.x, -thigh * 0.96, 10, dt);
    const armX = pose === 'bath' ? -1.05 : -0.4;
    armL.rotation.x = dampN(armL.rotation.x, armX, 9, dt);
    armR.rotation.x = dampN(armR.rotation.x, armX, 9, dt);
    armL.rotation.z = dampN(armL.rotation.z, -0.12, 8, dt);
    armR.rotation.z = dampN(armR.rotation.z, 0.12, 8, dt);
    foreL.rotation.x = dampN(foreL.rotation.x, pose === 'bath' ? -0.5 : -0.7, 9, dt);
    foreR.rotation.x = dampN(foreR.rotation.x, pose === 'bath' ? -0.5 : -0.7, 9, dt);
    head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
    // 泡澡时轻轻晃悠 + 呼噜泡泡般的上下浮动
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
    </group>
  );
}

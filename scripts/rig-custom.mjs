/**
 * 自动绑骨脚本：把静态人形雕塑 GLB 绑定到 KayKit 兼容骨架
 *
 * 原理：
 * 1) 按模型实测比例生成人形骨架（骨骼命名/局部四元数与 KayKit Rig_Medium 完全一致，
 *    骨长按本模型比例），T-pose 为绑定姿态。
 * 2) 在 A-pose（双臂下垂，与雕塑一致）下用胶囊段算每顶点蒙皮权重（top4 归一化）。
 * 3) 用 A-pose 骨骼世界矩阵求逆 → inverseBindMatrices；这样 T-pose 静止时
 *    LBS 会自动把 A-pose 网格摆成 T-pose，播放 KayKit T-pose 动画也正确。
 * 4) 手臂区域顶点先按权重做 A→T 旋转（绕肩关节），与蒙皮公式一致。
 * 5) 离线 FK 采样关键动画（坐/躺/泡澡）在骨架上的锚点，供 CharCustom3D 使用。
 *
 * 用法: bun scripts/rig-custom.mjs <in.glb> <out.glb> [tag]
 */
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import * as THREE from 'three';

const IN = process.argv[2];
const OUT = process.argv[3];
const TAG = process.argv[4] || 'x';

if (!IN || !OUT) {
  console.error('usage: bun scripts/rig-custom.mjs <in.glb> <out.glb> [tag]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions([EXTTextureWebP, KHRMeshQuantization]);
const doc = await io.read(IN);

const mesh = doc.getRoot().listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const posAcc = prim.getAttribute('POSITION');
const N = posAcc.getCount();
const tmp3 = [0, 0, 0];

// 找到 mesh 节点并把它的世界变换烘进顶点（Blender 导出常把 Z→Y 旋转放在节点上），
// 然后把节点变换复位为单位阵，保证蒙皮 bind 矩阵为单位。
const meshNode = doc.getRoot().listNodes().find((n) => n.getMesh() === mesh);
const nodeWorld = new THREE.Matrix4().identity();
if (meshNode) {
  // 沿父链累积
  const chain = [];
  let cur = meshNode;
  while (cur) {
    chain.unshift(cur);
    cur = cur.getParentNode();
  }
  nodeWorld.identity();
  for (const n of chain) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...n.getTranslation()),
      new THREE.Quaternion(...n.getRotation()),
      new THREE.Vector3(...n.getScale())
    );
    nodeWorld.multiply(m);
  }
  console.log(`[${TAG}] mesh 节点世界矩阵:`, nodeWorld.elements.map((v) => v.toFixed(2)).join(','));
}

const pos = new Float32Array(N * 3);
const vTmp = new THREE.Vector3();
for (let i = 0; i < N; i++) {
  posAcc.getElement(i, tmp3);
  vTmp.set(tmp3[0], tmp3[1], tmp3[2]).applyMatrix4(nodeWorld);
  pos[i * 3] = vTmp.x;
  pos[i * 3 + 1] = vTmp.y;
  pos[i * 3 + 2] = vTmp.z;
}
if (meshNode) {
  meshNode.setTranslation([0, 0, 0]);
  meshNode.setRotation([0, 0, 0, 1]);
  meshNode.setScale([1, 1, 1]);
}

/* ---------------- 包围盒与切片测量 ---------------- */
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
for (let i = 0; i < N; i++) {
  minX = Math.min(minX, pos[i * 3]); maxX = Math.max(maxX, pos[i * 3]);
  minY = Math.min(minY, pos[i * 3 + 1]); maxY = Math.max(maxY, pos[i * 3 + 1]);
  minZ = Math.min(minZ, pos[i * 3 + 2]); maxZ = Math.max(maxZ, pos[i * 3 + 2]);
}
const H = maxY - minY;
const W = maxX - minX;
console.log(`[${TAG}] bbox: H=${H.toFixed(4)} W=${W.toFixed(4)} D=${(maxZ - minZ).toFixed(4)}`);

/** 某高度带内 |x| 最大值（找肩宽/胯宽） */
function sliceMaxX(y0, y1) {
  let m = 0;
  for (let i = 0; i < N; i++) {
    const y = pos[i * 3 + 1] - minY;
    if (y >= y0 * H && y <= y1 * H) m = Math.max(m, Math.abs(pos[i * 3]));
  }
  return m;
}
const shoulderX = Math.max(sliceMaxX(0.835, 0.875) * 0.92, 0.1 * H); // 肩关节 x（去掉三角肌鼓包）
const hipJointX = Math.max(sliceMaxX(0.52, 0.6) * 0.5, 0.05 * H); // 髋关节 x（大腿中线）
console.log(`[${TAG}] shoulderX=${(shoulderX / H).toFixed(4)}H hipX=${(hipJointX / H).toFixed(4)}H`);

/* ---------------- 关节定义（A-pose 世界坐标，y 已含 minY 偏移） ---------------- */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const fr = (f) => f * H + minY;

const J = {};
J.hips = V(0, fr(0.530), 0);
J.spine = V(0, fr(0.615), 0);
J.chest = V(0, fr(0.745), 0);
J.head = V(0, fr(0.885), 0.008 * H);

const shoulderL = V(shoulderX, fr(0.845), 0);
// 绑定方向 = 20° 外张：介于自然垂放(6°)与 KayKit idle(39°) 之间。
// idle 动画经「以 their-idle 为基准」的重定向后手臂恰好回到绑定方向 → idle 零蒙皮变形。
const hangL = V(Math.sin(20 * Math.PI / 180) + 0.06, -Math.cos(20 * Math.PI / 180), 0.015).normalize();
const hang2L = V(0.05, -1.0, 0.03).normalize();
const upperArmLen = 0.175 * H;
const forearmLen = 0.155 * H;
const handLen = 0.052 * H;
J.upperarm_l = shoulderL;
J.lowerarm_l = shoulderL.clone().addScaledVector(hangL, upperArmLen);
J.wrist_l = J.lowerarm_l.clone().addScaledVector(hang2L, forearmLen);
J.hand_l = J.wrist_l.clone().addScaledVector(hang2L, handLen);

const shoulderR = V(-shoulderX, fr(0.845), 0);
const hangR = V(-Math.sin(20 * Math.PI / 180) - 0.06, -Math.cos(20 * Math.PI / 180), 0.015).normalize();
const hang2R = V(-0.05, -1.0, 0.03).normalize();
J.upperarm_r = shoulderR;
J.lowerarm_r = shoulderR.clone().addScaledVector(hangR, upperArmLen);
J.wrist_r = J.lowerarm_r.clone().addScaledVector(hang2R, forearmLen);
J.hand_r = J.wrist_r.clone().addScaledVector(hang2R, handLen);

J.upperleg_l = V(hipJointX, fr(0.548), 0);
J.lowerleg_l = V(hipJointX + 0.004 * H, fr(0.300), 0.005 * H);
J.foot_l = V(hipJointX + 0.006 * H, fr(0.055), -0.005 * H);
J.toes_l = V(hipJointX + 0.006 * H, fr(0.030), 0.070 * H);

J.upperleg_r = V(-hipJointX, fr(0.548), 0);
J.lowerleg_r = V(-hipJointX - 0.004 * H, fr(0.300), 0.005 * H);
J.foot_r = V(-hipJointX - 0.006 * H, fr(0.055), -0.005 * H);
J.toes_r = V(-hipJointX - 0.006 * H, fr(0.030), 0.070 * H);

/* ---------------- 骨架定义（局部变换） ----------------
 * quat 一律沿用 KayKit 原值（保证动画重定向姿态一致）；
 * translation 由本模型关节位置反推。 */

/** 由「局部 +Y 应指向的方向 dir（父骨骼空间）」求局部四元数 */
function quatYTo(dir) {
  const d = dir.clone().normalize();
  const axis = new THREE.Vector3(0, 1, 0).cross(d); // (0,1,0)×d
  const w = new THREE.Vector3(0, 1, 0).dot(d);
  const q = new THREE.Quaternion();
  if (axis.lengthSq() < 1e-10) {
    if (w > 0) q.identity();
    else q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else {
    q.setFromAxisAngle(axis.normalize(), Math.acos(THREE.MathUtils.clamp(w, -1, 1)));
  }
  return q;
}

// KayKit 原始局部四元数（dump 实测）
const KAY_Q = {
  upperarm_l: new THREE.Quaternion(-0.51, -0.49, -0.49, 0.51).normalize(),
  upperarm_r: new THREE.Quaternion(-0.51, 0.49, 0.49, 0.51).normalize(),
  lowerarm_l: new THREE.Quaternion(0, 0, -0.06, 1).normalize(),
  lowerarm_r: new THREE.Quaternion(0, 0, 0.06, 1).normalize(),
  wrist_l: new THREE.Quaternion(0, 0, 0.03, 1).normalize(),
  wrist_r: new THREE.Quaternion(0, 0, -0.03, 1).normalize(),
  upperleg_l: new THREE.Quaternion(1, 0, 0, 0.02).normalize(),
  upperleg_r: new THREE.Quaternion(1, 0, 0, 0.02).normalize(),
  lowerleg_l: new THREE.Quaternion(0.11, 0, 0, 0.99).normalize(),
  lowerleg_r: new THREE.Quaternion(0.11, 0, 0, 0.99).normalize(),
  foot_l: new THREE.Quaternion(-0.46, 0, 0, 0.89).normalize(),
  foot_r: new THREE.Quaternion(-0.46, 0, 0, 0.89).normalize(),
  toes_l: new THREE.Quaternion(0, 0.92, -0.39, 0).normalize(),
  toes_r: new THREE.Quaternion(0, -0.92, 0.39, 0).normalize(),
  handslot_l: new THREE.Quaternion(0, 0, -0.71, 0.71).normalize(),
  handslot_r: new THREE.Quaternion(0, 0, 0.71, 0.71).normalize(),
};

/** 骨架表：name, parent, A-pose 世界关节, T-pose 局部四元数, A-pose 局部四元数(可选) */
const RIG = [
  { name: 'root', parent: null },
  { name: 'hips', parent: 'root', j: 'hips' },
  { name: 'spine', parent: 'hips', j: 'spine' },
  { name: 'chest', parent: 'spine', j: 'chest' },
  { name: 'head', parent: 'chest', j: 'head' },
  { name: 'upperarm.l', parent: 'chest', j: 'upperarm_l' },
  { name: 'lowerarm.l', parent: 'upperarm.l', len: 'upperarmL' },
  { name: 'wrist.l', parent: 'lowerarm.l', len: 'forearmL' },
  { name: 'hand.l', parent: 'wrist.l', len: 'handL' },
  { name: 'handslot.l', parent: 'hand.l' },
  { name: 'upperarm.r', parent: 'chest', j: 'upperarm_r' },
  { name: 'lowerarm.r', parent: 'upperarm.r', len: 'upperarmR' },
  { name: 'wrist.r', parent: 'lowerarm.r', len: 'forearmR' },
  { name: 'hand.r', parent: 'wrist.r', len: 'handR' },
  { name: 'handslot.r', parent: 'hand.r' },
  { name: 'upperleg.l', parent: 'hips', j: 'upperleg_l' },
  { name: 'lowerleg.l', parent: 'upperleg.l', len: 'thighL' },
  { name: 'foot.l', parent: 'lowerleg.l', len: 'shinL' },
  { name: 'toes.l', parent: 'foot.l', len: 'footL' },
  { name: 'upperleg.r', parent: 'hips', j: 'upperleg_r' },
  { name: 'lowerleg.r', parent: 'upperleg.r', len: 'thighR' },
  { name: 'foot.r', parent: 'lowerleg.r', len: 'shinR' },
  { name: 'toes.r', parent: 'foot.r', len: 'footR' },
];

// 段长表（A-pose 下关节间距离 = 骨长）
const SEG = {
  upperarmL: J.lowerarm_l.distanceTo(J.upperarm_l),
  forearmL: J.wrist_l.distanceTo(J.lowerarm_l),
  handL: J.hand_l.distanceTo(J.wrist_l),
  upperarmR: J.lowerarm_r.distanceTo(J.upperarm_r),
  forearmR: J.wrist_r.distanceTo(J.lowerarm_r),
  handR: J.hand_r.distanceTo(J.wrist_r),
  thighL: J.lowerleg_l.distanceTo(J.upperleg_l),
  shinL: J.foot_l.distanceTo(J.lowerleg_l),
  footL: J.toes_l.distanceTo(J.foot_l),
  thighR: J.lowerleg_r.distanceTo(J.upperleg_r),
  shinR: J.foot_r.distanceTo(J.lowerleg_r),
  footR: J.toes_r.distanceTo(J.foot_r),
};

/** A-pose 局部变换（用于 IBM 与权重）；父链世界矩阵累积 */
function buildPose(mode) {
  // mode='A'：手臂四元数为下垂方向；mode='T'：KayKit T-pose 四元数
  const map = new Map();
  for (const b of RIG) {
    const g = new THREE.Group();
    g.name = b.name;
    if (b.name === 'root') {
      g.position.set(0, 0, 0);
      g.quaternion.identity();
    } else if (b.name === 'hips') {
      g.position.copy(J.hips);
      g.quaternion.identity();
    } else if (b.name === 'spine') {
      g.position.copy(J.spine).sub(J.hips);
      g.quaternion.identity();
    } else if (b.name === 'chest') {
      g.position.copy(J.chest).sub(J.spine);
      g.quaternion.identity();
    } else if (b.name === 'head') {
      g.position.copy(J.head).sub(J.chest);
      g.quaternion.identity();
    } else if (b.name.startsWith('upperarm')) {
      const side = b.name.endsWith('.l') ? 'l' : 'r';
      g.position.copy(J[`upperarm_${side}`]).sub(J.chest);
      g.quaternion.copy(mode === 'A'
        ? quatYTo(side === 'l' ? hangL : hangR)
        : KAY_Q[`upperarm_${side}`]);
    } else if (b.name === 'handslot.l' || b.name === 'handslot.r') {
      // 挂手上：沿手方向再往外一点（KayKit 比例缩放）
      g.position.set(0, 0.052 * H, -0.031 * H);
      g.quaternion.copy(KAY_Q[b.name.replace('.', '_')]);
    } else if (b.name.startsWith('lowerarm')) {
      const side = b.name.endsWith('.l') ? 'l' : 'r';
      g.position.set(0, SEG[`upperarm${side.toUpperCase()}`], 0);
      g.quaternion.copy(KAY_Q[`lowerarm_${side}`]);
    } else if (b.name.startsWith('wrist')) {
      const side = b.name.endsWith('.l') ? 'l' : 'r';
      g.position.set(0, SEG[`forearm${side.toUpperCase()}`], 0);
      g.quaternion.copy(KAY_Q[`wrist_${side}`]);
    } else if (b.name.startsWith('hand.')) {
      const side = b.name.endsWith('.l') ? 'l' : 'r';
      g.position.set(0, SEG[`hand${side.toUpperCase()}`], 0);
      g.quaternion.identity();
    } else if (b.name.startsWith('upperleg')) {
      const side = b.name.endsWith('.l') ? 'l' : 'r';
      g.position.copy(J[`upperleg_${side}`]).sub(J.hips);
      g.quaternion.copy(KAY_Q[`upperleg_${side}`]);
    } else if (b.name.startsWith('lowerleg')) {
      const side = b.name.endsWith('.l') ? 'l' : 'r';
      g.position.set(0, SEG[`thigh${side.toUpperCase()}`], 0);
      g.quaternion.copy(KAY_Q[`lowerleg_${side}`]);
    } else if (b.name.startsWith('foot')) {
      const side = b.name.endsWith('.l') ? 'l' : 'r';
      g.position.set(0, SEG[`shin${side.toUpperCase()}`], 0);
      g.quaternion.copy(KAY_Q[`foot_${side}`]);
    } else if (b.name.startsWith('toes')) {
      const side = b.name.endsWith('.l') ? 'l' : 'r';
      g.position.set(0, SEG[`foot${side.toUpperCase()}`], 0);
      g.quaternion.copy(KAY_Q[`toes_${side}`]);
    }
    if (b.parent) map.get(b.parent).add(g);
    map.set(b.name, g);
  }
  const root = map.get('root');
  root.updateMatrixWorld(true);
  return map;
}

const poseA = buildPose('A');
const poseT = buildPose('T'); // 仅用于对比验证，不再写入 GLB

// 验证 A-pose（=绑定姿态）关键世界位置
for (const n of ['hips', 'head', 'upperarm.l', 'toes.l']) {
  const p = new THREE.Vector3();
  poseA.get(n).getWorldPosition(p);
  console.log(`[${TAG}] A-pose(rest) ${n}: (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`);
}

/* ---------------- 胶囊权重 ---------------- */
const SEGMENTS = [
  ['hips', V(0, fr(0.48), 0), V(0, fr(0.585), 0), 0.095],
  ['spine', V(0, fr(0.585), 0), V(0, fr(0.675), 0), 0.09],
  ['chest', V(0, fr(0.675), 0), V(0, fr(0.845), 0), 0.095],
  ['head', V(0, fr(0.865), 0.005 * H), V(0, fr(1.02), 0.01 * H), 0.08],
  ['head', V(0, fr(0.80), -0.045 * H), V(0, fr(0.93), -0.055 * H), 0.055],
  ['upperarm.l', J.upperarm_l, J.lowerarm_l, 0.048],
  ['lowerarm.l', J.lowerarm_l, J.wrist_l, 0.04],
  ['wrist.l', J.wrist_l, J.hand_l, 0.028],
  ['hand.l', J.wrist_l, J.hand_l, 0.036],
  ['upperarm.r', J.upperarm_r, J.lowerarm_r, 0.048],
  ['lowerarm.r', J.lowerarm_r, J.wrist_r, 0.04],
  ['wrist.r', J.wrist_r, J.hand_r, 0.028],
  ['hand.r', J.wrist_r, J.hand_r, 0.036],
  ['upperleg.l', J.upperleg_l, J.lowerleg_l, 0.075],
  ['lowerleg.l', J.lowerleg_l, J.foot_l, 0.055],
  ['foot.l', J.foot_l, J.toes_l.clone().lerp(J.foot_l, 0.45), 0.042],
  ['toes.l', J.toes_l.clone().lerp(J.foot_l, 0.45), J.toes_l, 0.038],
  ['upperleg.r', J.upperleg_r, J.lowerleg_r, 0.075],
  ['lowerleg.r', J.lowerleg_r, J.foot_r, 0.055],
  ['foot.r', J.foot_r, J.toes_r.clone().lerp(J.foot_r, 0.45), 0.042],
  ['toes.r', J.toes_r.clone().lerp(J.foot_r, 0.45), J.toes_r, 0.038],
];

// 预处理胶囊
const capsules = SEGMENTS.map(([bone, a, b, r]) => ({
  bone, a, b, r: r * H, ab: b.clone().sub(a), len2: b.clone().sub(a).lengthSq(),
}));
function distToCapsule(p, c) {
  const t = THREE.MathUtils.clamp(p.clone().sub(c.a).dot(c.ab) / c.len2, 0, 1);
  return p.distanceTo(c.a.clone().addScaledVector(c.ab, t));
}

const boneIndex = new Map(RIG.map((b, i) => [b.name, i]));
const joints = new Uint8Array(N * 4);
const weights = new Float32Array(N * 4);

// 手臂骨骼集合（用于互斥分区：袖子/躯干交界带以外不互相渗透）
const ARM_SET = new Set(['upperarm.l', 'lowerarm.l', 'wrist.l', 'hand.l', 'upperarm.r', 'lowerarm.r', 'wrist.r', 'hand.r']);
const TORSO_SET = new Set(['hips', 'spine', 'chest']);
const HEAD_SET = new Set(['head']);

const pv = new THREE.Vector3();
const hairVolumeSet = new Set();
// 骨骼组：互斥分区用（同组骨骼共享影响，跨组按距离留过渡带）
const GROUP_OF = {
  'upperarm.l': 'armL', 'lowerarm.l': 'armL', 'wrist.l': 'armL', 'hand.l': 'armL',
  'upperarm.r': 'armR', 'lowerarm.r': 'armR', 'wrist.r': 'armR', 'hand.r': 'armR',
  'hips': 'torso', 'spine': 'torso', 'chest': 'torso',
  'head': 'head',
  'upperleg.l': 'legL', 'lowerleg.l': 'legL',
  'upperleg.r': 'legR', 'lowerleg.r': 'legR',
  'foot.l': 'footL', 'toes.l': 'footL',
  'foot.r': 'footR', 'toes.r': 'footR',
};
/* ---- 女生长发：按 baseColor 亮度识别头发顶点，直接绑头骨 ----
 * 长发丝垂在肩旁，几何上与袖子无法区分（距离更近手臂），
 * 但颜色可区分（深棕头发 vs 米白开衫）。仅 nv 开启。 */
let hairSampler = null;
if (TAG === 'nv') {
  try {
    const { PNG } = await import('pngjs');
    // rig 输入文件的贴图是 WebP；从 PNG 版本（resize 后、webp 前）读取
    const srcDoc = await io.read('/tmp/f-r.glb');
    const baseTex = srcDoc.getRoot().listMaterials()[0].getBaseColorTexture();
    const imgBytes = baseTex.getImage();
    const png = PNG.sync.read(Buffer.from(imgBytes));
    hairSampler = {
      w: png.width, h: png.height, data: png.data,
      sample(u, v) {
        const x = Math.min(this.w - 1, Math.max(0, Math.floor(u * this.w)));
        const y = Math.min(this.h - 1, Math.max(0, Math.floor((1 - v) * this.h)));
        const o = (y * this.w + x) * 4;
        return 0.2126 * this.data[o] + 0.7152 * this.data[o + 1] + 0.0722 * this.data[o + 2];
      },
    };
    console.log(`[${TAG}] 发色检测开启 base=${png.width}x${png.height}`);
  } catch (e) {
    console.log(`[${TAG}] 发色检测不可用: ${e}`);
  }
}

/** 语义兜底：胶囊没覆盖到的顶点按人体部位归属（绝不「就近胶囊」瞎绑） */
function semanticFallback(p) {
  const y = (p.y - minY) / H;
  const ax = Math.abs(p.x);
  if (y > 0.86) return 'head';
  if (y >= 0.585) return ax > shoulderX * 0.85 ? (p.x > 0 ? 'upperarm.l' : 'upperarm.r') : 'chest';
  if (y >= 0.42) return 'hips';
  if (y >= 0.10) return p.x > 0 ? 'upperleg.l' : 'upperleg.r';
  return p.x > 0 ? 'foot.l' : 'foot.r';
}

for (let i = 0; i < N; i++) {
  pv.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const vy = (pv.y - minY) / H;
  const ax = Math.abs(pv.x);

  // 组距离
  const dGroup = { armL: 1e9, armR: 1e9, torso: 1e9, head: 1e9, legL: 1e9, legR: 1e9, footL: 1e9, footR: 1e9 };
  let inf = [];
  for (const c of capsules) {
    const d = distToCapsule(pv, c);
    const g = GROUP_OF[c.bone];
    if (d < dGroup[g]) dGroup[g] = d;
    if (d < c.r) {
      const w = (1 - d / c.r) ** 4;
      inf.push([boneIndex.get(c.bone), w, g]);
    }
  }
  // 长发体积规则（仅 nv）：躯干柱范围内的肩高带顶点绑头骨（刚性、不撕裂）；
  // 袖子上方的发丝（|x| 更大）保持手臂权重 —— 与袖子同动才不撕
  if (TAG === 'nv' && vy >= 0.62 && vy <= 0.86 && ax < shoulderX * 0.72 && pv.z < 0.055 * H) {
    hairVolumeSet.add(i);
  }
  // 发色覆盖：头部以下、肩旁的深色顶点 = 长发 → 全权绑头骨
  if (hairSampler && vy > 0.58 && vy < 0.93) {
    const uvAcc = prim.getAttribute('TEXCOORD_0');
    const uvTmp = [0, 0];
    uvAcc.getElement(i, uvTmp);
    const lum = hairSampler.sample(uvTmp[0], uvTmp[1]);
    // 深色（头发/高光之间的暗部）且不在躯干中轴（避开背心阴影）→ 判定为头发
    if (lum < 140 && ax > shoulderX * 0.45) {
      inf = [[boneIndex.get('head'), 1, 'head']];
      dGroup.head = 0;
    }
  }
  // 组互斥：只保留离顶点最近组 ±band 内的影响
  const band = 0.008 * H;
  const dMin = Math.min(...Object.values(dGroup));
  inf = inf.filter(([, , g]) => dGroup[g] <= dMin + band);

  // 躯干柱状硬分区（袖子/躯干分界 = 肩宽折皱线）：
  // 躯干高度带内，|x| 明显小 → 纯躯干；明显大 → 纯手臂
  if (vy >= 0.60 && vy <= 0.95) {
    const az = Math.abs(pv.z - 0.01 * H) / H; // 躯干前后表面判定（z 轴）
    if (ax < shoulderX * 0.72 || az > 0.05) {
      const f = inf.filter(([, , g]) => g === 'torso' || g === 'head');
      if (f.length) inf = f;
    } else if (ax > shoulderX * 0.85 && az < 0.035) {
      const f = inf.filter(([, , g]) => g === 'armL' || g === 'armR');
      if (f.length) inf = f;
    }
  }

  // 体积规则最终覆盖
  if (hairVolumeSet.has(i)) {
    inf = [[boneIndex.get('head'), 1, 'head']];
    dGroup.head = 0;
  }
  inf.sort((a, b) => b[1] - a[1]);
  const top = inf.slice(0, 4);
  let sum = 0;
  for (const [, w] of top) sum += w;
  if (sum <= 0) {
    top.length = 0;
    top.push([boneIndex.get(semanticFallback(pv)), 1]);
    sum = 1;
  }
  for (let k = 0; k < 4; k++) {
    if (k < top.length) {
      joints[i * 4 + k] = top[k][0];
      weights[i * 4 + k] = top[k][1] / sum;
    } else {
      joints[i * 4 + k] = 0;
      weights[i * 4 + k] = 0;
    }
  }
}

/* ---------------- A→T 由蒙皮自动完成 ----------------
 * 网格保持 A-pose 原始数据；IBM 用 A-pose 骨骼世界矩阵求逆。
 * 静止（T-pose rest）时蒙皮公式 Σw·T·A⁻¹·v 自动把手臂从下垂摆到水平，
 * 与动画播放共用同一条变形路径，不会二次变形。 */

/* ---------------- 写入 GLB ---------------- */
const posAccNew = doc.createAccessor('positions_rigged')
  .setArray(new Float32Array(pos))
  .setType('VEC3')
  .setBuffer(doc.getRoot().listBuffers()[0]);
prim.setAttribute('POSITION', posAccNew);

const jointsAcc = doc.createAccessor('joints_0')
  .setArray(new Uint8Array(joints))
  .setType('VEC4')
  .setBuffer(doc.getRoot().listBuffers()[0]);
prim.setAttribute('JOINTS_0', jointsAcc);

const weightsAcc = doc.createAccessor('weights_0')
  .setArray(new Float32Array(weights))
  .setType('VEC4')
  .setBuffer(doc.getRoot().listBuffers()[0]);
prim.setAttribute('WEIGHTS_0', weightsAcc);

// 骨骼节点（A-pose 局部变换 = 绑定姿态；静止时蒙皮零变形，网格保持原状）
const nodeMap = new Map();
const armature = doc.createNode('Armature');
for (const b of RIG) {
  const n = doc.createNode(b.name);
  const g = poseA.get(b.name);
  n.setTranslation([g.position.x, g.position.y, g.position.z]);
  n.setRotation([g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w]);
  nodeMap.set(b.name, n);
  if (b.parent) nodeMap.get(b.parent).addChild(n);
  else armature.addChild(n);
}

// mesh 节点挂 skin
const meshNodes = doc.getRoot().listScenes()[0].listChildren().filter((n) => n.getMesh());
const skin = doc.createSkin('rig23');
for (const b of RIG) skin.addJoint(nodeMap.get(b.name));

// IBM：A-pose 世界矩阵的逆
const ibm = new Float32Array(RIG.length * 16);
for (let i = 0; i < RIG.length; i++) {
  const m = poseA.get(RIG[i].name).matrixWorld.clone().invert();
  ibm.set(m.elements, i * 16);
}
const ibmAcc = doc.createAccessor('ibm')
  .setArray(ibm)
  .setType('MAT4')
  .setBuffer(doc.getRoot().listBuffers()[0]);
skin.setInverseBindMatrices(ibmAcc);
skin.setSkeleton(armature);
if (meshNode) {
  meshNode.setTranslation([0, 0, 0]);
  meshNode.setRotation([0, 0, 0, 1]);
  meshNode.setScale([1, 1, 1]);
  meshNode.setSkin(skin);
} else {
  // 兜底：新建节点挂 mesh+skin
  const holder = doc.createNode('mesh_holder');
  holder.setMesh(mesh);
  holder.setSkin(skin);
  doc.getRoot().listScenes()[0].addChild(holder);
}

// Armature 节点加入场景
doc.getRoot().listScenes()[0].addChild(armature);

await io.write(OUT, doc);
console.log(`[${TAG}] 已写出 ${OUT}`);

/* ---------------- 离线 FK 采样动画锚点 ---------------- */
const KAY_REST = {
  root: [0, 0, 0], hips: [0, 0.406, 0], spine: [0, 0.192, 0], chest: [0, 0.375, 0], head: [0, 0.269, 0],
  'upperarm.l': [0.212, 0.134, 0], 'lowerarm.l': [0, 0.242, 0], 'wrist.l': [0, 0.260, 0], 'hand.l': [0, 0.074, 0],
  'handslot.l': [0, 0.096, -0.058], 'upperarm.r': [-0.212, 0.134, 0], 'lowerarm.r': [0, 0.242, 0],
  'wrist.r': [0, 0.260, 0], 'hand.r': [0, 0.074, 0], 'handslot.r': [0, 0.096, -0.058],
  'upperleg.l': [0.171, 0.114, 0], 'lowerleg.l': [0, 0.227, 0], 'foot.l': [0, 0.149, 0], 'toes.l': [0, 0.166, 0],
  'upperleg.r': [-0.171, 0.114, 0], 'lowerleg.r': [0, 0.227, 0], 'foot.r': [0, 0.149, 0], 'toes.r': [0, 0.166, 0],
};
function myRestLocal(name) {
  const g = poseA.get(name);
  return [g.position.x, g.position.y, g.position.z];
}
function kOf(name) {
  const my = myRestLocal(name), kay = KAY_REST[name];
  const ml = Math.hypot(...my), kl = Math.hypot(...kay);
  if (name === 'hips' || name === 'root') {
    // 骨盆位移按「腿可达高度比」缩放（myHipY / kayLegReach0.52）
    return J.hips.y / 0.52;
  }
  return kl > 1e-6 ? ml / kl : 1;
}

const ANIM_FILES = ['anim-core', 'anim-movement', 'anim-sim', 'anim-tools', 'anim-ours'];
const clips3 = [];
for (const f of ANIM_FILES) {
  const adoc = await io.read(`/home/z/my-project/public/couple-home/kit/${f}.glb`);
  for (const a of adoc.getRoot().listAnimations()) {
    const tracks = [];
    for (const ch of a.listChannels()) {
      const node = ch.getTargetNode();
      if (!node) continue;
      const bn = node.getName();
      const path = ch.getTargetPath();
      const samp = ch.getSampler();
      const timesAcc = samp.getInput();
      const valAcc = samp.getOutput();
      const tCount = timesAcc.getCount();
      const times = new Float32Array(tCount);
      const tt = [0];
      for (let i = 0; i < tCount; i++) { timesAcc.getElement(i, tt); times[i] = tt[0]; }
      const vSize = valAcc.getElementSize();
      const values = new Float32Array(tCount * vSize);
      const tv = new Array(vSize).fill(0);
      for (let i = 0; i < tCount; i++) {
        valAcc.getElement(i, tv);
        if (path === 'translation') {
          if (bn === 'hips' || bn === 'root') {
            // hips/root 位移定死 rest：姿势高度由组件按姿态程序化控制
            const my = myRestLocal(bn);
            values[i * 3] = my[0];
            values[i * 3 + 1] = my[1];
            values[i * 3 + 2] = my[2];
          } else {
            const my = myRestLocal(bn), kay = KAY_REST[bn] ?? [0, 0, 0];
            const k = kOf(bn);
            values[i * 3] = my[0] + (tv[0] - kay[0]) * k;
            values[i * 3 + 1] = my[1] + (tv[1] - kay[1]) * k;
            values[i * 3 + 2] = my[2] + (tv[2] - kay[2]) * k;
          }
        } else if (path === 'rotation') {
          values.set(tv, i * 4);
        } else if (path === 'scale') {
          values.set([1, 1, 1], i * 3);
        }
      }
      if (path === 'rotation') tracks.push(new THREE.QuaternionKeyframeTrack(`${bn}.quaternion`, times, values));
      else if (path === 'translation') tracks.push(new THREE.VectorKeyframeTrack(`${bn}.position`, times, values));
    }
    clips3.push(new THREE.AnimationClip(a.getName(), -1, tracks));
  }
}
console.log(`[${TAG}] 解析动画 clip：${clips3.map((c) => c.name).join(', ')}`);

/* ---- 世界空间重定向校正：corr(b) = W_A(b) · W_T(b)⁻¹ ----
 * W_A = 我的 A-pose 骨架世界旋转（GLB rest）；W_T = KayKit T-pose 骨架世界旋转。
 * 动画是按 KayKit T-pose rest 制作的：把源骨骼的世界旋转先经过 corr
 * 「从 T-pose 框架搬到 A-pose 框架」，再写回我的局部旋转，
 * 手臂自然下垂不动，躯干/腿（A=T）完全跟随。 */
const KAY_Q_ALL = {
  root: new THREE.Quaternion(), hips: new THREE.Quaternion(), spine: new THREE.Quaternion(),
  chest: new THREE.Quaternion(), head: new THREE.Quaternion(),
  upperarm_l: KAY_Q.upperarm_l, lowerarm_l: KAY_Q.lowerarm_l, wrist_l: KAY_Q.wrist_l,
  hand_l: new THREE.Quaternion(), handslot_l: KAY_Q.handslot_l,
  upperarm_r: KAY_Q.upperarm_r, lowerarm_r: KAY_Q.lowerarm_r, wrist_r: KAY_Q.wrist_r,
  hand_r: new THREE.Quaternion(), handslot_r: KAY_Q.handslot_r,
  upperleg_l: KAY_Q.upperleg_l, lowerleg_l: KAY_Q.lowerleg_l, foot_l: KAY_Q.foot_l, toes_l: KAY_Q.toes_l,
  upperleg_r: KAY_Q.upperleg_r, lowerleg_r: KAY_Q.lowerleg_r, foot_r: KAY_Q.foot_r, toes_r: KAY_Q.toes_r,
};
// KayKit FK 世界旋转
const kayWorld = new Map();
{
  const local = new Map();
  for (const b of RIG) {
    local.set(b.name, {
      parent: b.parent,
      q: (KAY_Q_ALL[b.name.replace('.', '_')] ?? new THREE.Quaternion()).clone(),
    });
  }
  const wq = (name) => {
    const e = local.get(name);
    const pw = e.parent ? wq(e.parent) : new THREE.Quaternion();
    return pw.clone().multiply(e.q);
  };
  for (const b of RIG) kayWorld.set(b.name, wq(b.name));
}
const corr = {};
for (const b of RIG) {
  const wa = poseA.get(b.name).getWorldQuaternion(new THREE.Quaternion());
  const c = wa.multiply(kayWorld.get(b.name).clone().invert());
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(c.w), 0, 1));
  if (angle > 0.01) console.log(`[${TAG}] corr ${b.name}: ${(angle * 180 / Math.PI).toFixed(1)}°`);
  corr[b.name] = c;
}

// 在骨架上采样（A-pose rest + 逐帧重定向校正）
const CHILDREN = new Map(RIG.map((b) => [b.name, []]));
for (const b of RIG) if (b.parent) CHILDREN.get(b.parent).push(b.name);

function buildTestSkeleton() {
  const root = new THREE.Group();
  const tMap = new Map();
  for (const b of RIG) {
    const g = new THREE.Group();
    g.name = b.name;
    const ga = poseA.get(b.name);
    g.position.copy(ga.position);
    g.quaternion.copy(ga.quaternion);
    if (b.parent) tMap.get(b.parent).add(g);
    else root.add(g);
    tMap.set(b.name, g);
  }
  return { root, tMap };
}

function applyRetarget(tMap) {
  const worldQ = new Map();
  const visit = (name, parentWorldQ) => {
    const g = tMap.get(name);
    const rawWorld = parentWorldQ.clone().multiply(g.quaternion);
    const c = corr[name];
    const corrected = c ? c.clone().multiply(rawWorld) : rawWorld;
    g.quaternion.copy(parentWorldQ.clone().invert().multiply(corrected));
    worldQ.set(name, corrected);
    for (const ch of CHILDREN.get(name)) visit(ch, corrected);
  };
  visit('root', new THREE.Quaternion());
}

function sample(clipName, at = 0.5) {
  const clip = clips3.find((c) => c.name === clipName);
  if (!clip) return null;
  const { root, tMap } = buildTestSkeleton();
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  mixer.update(at);
  applyRetarget(tMap);
  root.updateMatrixWorld(true);
  const wp = (n) => { const v = new THREE.Vector3(); tMap.get(n).getWorldPosition(v); return v; };
  return { hips: wp('hips'), head: wp('head'), footL: wp('foot.l') };
}

const anchors = {};
for (const [key, clip] of [
  ['idle', 'Idle_A'],
  ['sit', 'Sit_Chair_Idle'],
  ['lie', 'Lie_Idle'],
  ['floorSit', 'Sit_Floor_Idle'],
  ['cook', 'Working_B'],
]) {
  // 全 clip 扫描：取 hips 最低/最后 与 head 最远帧（避开过渡帧极值误判，取中位代表帧）
  const clipObj = clips3.find((c) => c.name === clip);
  if (!clipObj) continue;
  const dur = clipObj.duration;
  const frames = [];
  for (let f = 0; f <= 24; f++) {
    const r = sample(clip, (f / 24) * dur);
    if (r) frames.push(r);
  }
  if (!frames.length) continue;
  const pick = (sel) => frames.reduce((a, b) => (sel(b) < sel(a) ? b : a));
  let r;
  if (key === 'lie') r = pick((x) => x.head.z); // 头最靠后的帧 = 完全躺平
  else if (key === 'sit' || key === 'floorSit') r = pick((x) => -x.hips.z); // 臀部最靠后
  else r = frames[Math.floor(frames.length / 2)];
  anchors[key] = { hipY: r.hips.y, hipZ: r.hips.z, headZ: r.head.z, footY: r.footL.y };
  console.log(`[${TAG}] ${key}: hipY=${r.hips.y.toFixed(3)} hipZ=${r.hips.z.toFixed(3)} headZ=${r.head.z.toFixed(3)}`);
}

// 写出重定向参数 + 锚点 JSON 供运行时组件使用
const fs = await import('fs');
const remap = {};
for (const b of RIG) {
  remap[b.name] = { rest: myRestLocal(b.name), kay: KAY_REST[b.name], k: kOf(b.name) };
}

fs.writeFileSync(
  `/home/z/my-project/src/components/apps/couple-home/scene/char-custom-rig-${TAG}.json`,
  JSON.stringify({
    H, minY, anchors, remap,
    corr: Object.fromEntries(Object.entries(corr).map(([k, q]) => [k, [q.x, q.y, q.z, q.w]])),
    hierarchy: RIG.map((b) => ({ name: b.name, parent: b.parent })),
  }, null, 1)
);
console.log(`[${TAG}] 重定向参数已写入 char-custom-rig-${TAG}.json`);

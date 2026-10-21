'use client';

/* eslint-disable react-hooks/immutability -- R3F/游戏循环需要原地修改 three 对象（墙体遮挡淡出每帧写 visible/材质） */

/**
 * 情侣小家 3D —— 房屋外壳（v5.3 四室：客厅+卧室+厨房+卫生间）
 *
 * - 户型：客厅 9×6（北）+ 卧室 6×5（西南）+ 厨房 6×5（东南）+ 卫生间 4×5（厨房东侧），
 *   三道门洞（卧室门/厨房门在 z=3 南隔墙、卫生间门在 x=7.5 共墙），点击开门后小人可穿行；
 * - 门/窗数据驱动（catalog.DOORS / WINS）：编辑模式下点击 = 选中（可沿墙滑行/换颜色），不开合；
 *   生活模式下点击 = 开合；
 * - 天花板：四房间各一块，相机钻进屋子（低视角）才显示，俯瞰自动隐藏；颜色分开换；
 * - 墙壁：视线段遮挡淡出（方案A）——只隐藏「相机→对焦物」视线真正穿过的墙（slab 法 AABB 相交），
 *   材质 opacity 每帧阻尼淡入淡出（丝滑变透明而非硬切 visible）；门/窗/门梁与所在墙同隐同现；
 *   地板/墙色四房间分开自定义。
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  BAL_X0,
  BAL_X1,
  BAL_Z0,
  BAL_Z1,
  BATH_X0,
  BATH_X1,
  BATH_Z0,
  BATH_Z1,
  BED_X0,
  BED_X1,
  BED_W,
  BED_Z0,
  BED_Z1,
  DOOR_W,
  DOORS,
  KDOOR_X,
  KTCH_X1,
  ROOM_W,
  ROOM_D,
  WINS,
  WALL_H,
  WALL_T,
  ROOM_X,
  ROOM_Z,
} from '../catalog';

// ---------------- 地板/墙面纹理（E3：装修面板可选，颜色仍由材质 color 相乘生效） ----------------

/** 默认木纹条地板（与旧版一致） */
function makeFloorTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  // 底色：云白（自定义颜色通过材质 color 与本纹理相乘生效）
  ctx.fillStyle = '#f4f2ed';
  ctx.fillRect(0, 0, S, S);
  // 拼板：横向 4 条，微差灰白
  const plank = S / 4;
  for (let i = 0; i < 4; i++) {
    const shade = i % 2 === 0 ? 'rgba(214,212,205,0.5)' : 'rgba(206,204,197,0.45)';
    ctx.fillStyle = shade;
    ctx.fillRect(0, i * plank, S, plank);
    // 板间缝（浅灰）
    ctx.fillStyle = 'rgba(178,175,167,0.4)';
    ctx.fillRect(0, i * plank - 1.5, S, 3);
    // 竖向接缝（错缝）
    const seamX = ((i * 137) % S) + 40;
    ctx.fillRect(seamX, i * plank + 2, 2.5, plank - 4);
  }
  // 极淡哑光纹理
  ctx.strokeStyle = 'rgba(180,177,170,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * S;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(S * 0.3, y + 5, S * 0.6, y - 5, S, y + 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 大格瓷砖地板（素雅方格 + 细缝） */
function makeFloorCheckerTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#f6f4ef';
  ctx.fillRect(0, 0, S, S);
  const cell = S / 4;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if ((i + j) % 2 === 0) {
        ctx.fillStyle = 'rgba(224,220,210,0.55)';
        ctx.fillRect(i * cell, j * cell, cell, cell);
      }
    }
  }
  ctx.strokeStyle = 'rgba(190,186,176,0.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(S, i * cell);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 墙纸碎花（白底 + 淡粉小花点阵，颜色由材质 color 相乘） */
function makeWallDotTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  const dot = (x: number, y: number, r: number, c: string) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = i * 64 + (j % 2 ? 32 : 0) + 32;
      const y = j * 64 + 32;
      dot(x, y, 7, 'rgba(242,169,188,0.4)');
      dot(x + 14, y + 9, 3, 'rgba(242,169,188,0.25)');
      dot(x - 13, y - 8, 2.5, 'rgba(180,205,185,0.3)');
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 墙纸细竖条纹（白底 + 淡色竖条，颜色由材质 color 相乘） */
function makeWallStripeTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(213,206,194,0.4)' : 'rgba(226,221,210,0.32)';
    ctx.fillRect(i * 32, 0, 16, S);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------- 窗外风景纹理 ----------------

/** 白天：蓝天渐变 + 云朵 + 两只小帆船（呼应「拾光小屋」图标） */
function makeDaySkyTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 192;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#a7cfec');
  g.addColorStop(0.62, '#c8e4f4');
  g.addColorStop(1, '#eef7f2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 云
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [cx, cy, r] of [[52, 44, 16], [76, 50, 12], [186, 30, 13], [204, 36, 9]] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 海平线
  ctx.fillStyle = '#9fc6d8';
  ctx.fillRect(0, H * 0.72, W, H * 0.28);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  for (const y of [H * 0.78, H * 0.86, H * 0.93]) {
    ctx.beginPath();
    ctx.moveTo(W * 0.08, y);
    ctx.quadraticCurveTo(W * 0.5, y - 4, W * 0.92, y);
    ctx.stroke();
  }
  // 小帆船 ×2
  const boat = (bx: number, by: number, s: number) => {
    ctx.fillStyle = '#d97f6f';
    ctx.beginPath();
    ctx.moveTo(bx - 14 * s, by);
    ctx.lineTo(bx + 14 * s, by);
    ctx.lineTo(bx + 8 * s, by + 7 * s);
    ctx.lineTo(bx - 8 * s, by + 7 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2e6c8';
    ctx.beginPath();
    ctx.moveTo(bx, by - 16 * s);
    ctx.lineTo(bx, by - 1 * s);
    ctx.lineTo(bx - 11 * s, by - 1 * s);
    ctx.closePath();
    ctx.fill();
  };
  boat(W * 0.3, H * 0.7, 1);
  boat(W * 0.74, H * 0.66, 0.8);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 夜晚：深蓝星空 + 月亮 */
function makeNightSkyTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 192;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1c2748');
  g.addColorStop(0.62, '#2c3a63');
  g.addColorStop(1, '#3d4a72');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 星星
  ctx.fillStyle = '#e8eeff';
  for (let i = 0; i < 42; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H * 0.68;
    const r = Math.random() * 1.4 + 0.4;
    ctx.globalAlpha = 0.4 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 月亮
  ctx.fillStyle = '#f7f0d8';
  ctx.beginPath();
  ctx.arc(W * 0.72, H * 0.26, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(220,214,190,0.5)';
  for (const [mx, my, mr] of [[W * 0.69, H * 0.24, 3.4], [W * 0.75, H * 0.29, 2.4]] as const) {
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------- 墙体 ----------------

/** 相机对焦物（生活=小人 / 编辑=轨道中心）；墙体按「视线段是否穿过」判断隐藏 */
interface FocusPos {
  x: number;
  z: number;
}

interface WallDef {
  key: string;
  /** 墙中心位置 */
  pos: [number, number, number];
  /** 墙尺寸（含厚度） */
  size: [number, number, number];
  /** 朝室外的法线 */
  normal: THREE.Vector3;
  /** 是否画踢脚线（默认画） */
  baseboard?: boolean;
  /** 归属房间：四房间分开换色 */
  room: 'lr' | 'br' | 'kt' | 'ba';
}

/** 墙体世界 AABB（墙盒不旋转，中心±半尺寸） */
function boxOf(def: WallDef): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(def.pos[0] - def.size[0] / 2, def.pos[1] - def.size[1] / 2, def.pos[2] - def.size[2] / 2),
    new THREE.Vector3(def.pos[0] + def.size[0] / 2, def.pos[1] + def.size[1] / 2, def.pos[2] + def.size[2] / 2),
  );
}

const _segDir = new THREE.Vector3();

/**
 * 视线段 P0→P1 是否穿过 AABB（slab 法；t 限定 [0,1]）——
 * 只统计「相机与对焦物之间」的墙：对焦物身后（t>1）与相机身后（t<0）的墙一律不隐藏，
 * 杜绝「望穿小人身后的墙看到屋外」的过度剖面。
 */
function segHitsBox(p0: THREE.Vector3, p1: THREE.Vector3, b: THREE.Box3): boolean {
  let tmin = 0;
  let tmax = 1;
  _segDir.subVectors(p1, p0);
  for (const ax of ['x', 'y', 'z'] as const) {
    const d = _segDir[ax];
    if (Math.abs(d) < 1e-9) {
      if (p0[ax] < b.min[ax] || p0[ax] > b.max[ax]) return false;
    } else {
      let t1 = (b.min[ax] - p0[ax]) / d;
      let t2 = (b.max[ax] - p0[ax]) / d;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

const _focusP = new THREE.Vector3();
/** 材质淡出前的基准值（透明/深度写状态也要还原，玻璃/光晕等本就透明的材质不受影响） */
const _matBase = new WeakMap<THREE.Material, { o: number; t: boolean; d: boolean }>();
/** mesh 原始 raycast（淡出期间临时禁用射线，恢复时还原） */
const _rayBase = new WeakMap<THREE.Mesh, THREE.Mesh['raycast']>();
const _noopRaycast = () => {};

/**
 * 墙体遮挡淡出（方案 A 核心）：
 * - 遮挡判定 = 「相机→对焦物」视线段是否穿过墙体 AABB（boxes 任一命中即挡）；
 * - 命中 → 组内所有材质 opacity 每帧阻尼淡出（透明期 depthWrite=false 防排序瑕疵，
 *   接近全隐才 visible=false 跳过渲染）；移开 → 阻尼淡回，结束后按基准一次性还原交还声明式控制。
 * - ⚑ 淡出期间同步禁用组内 mesh 的 raycast（可见即可穿，点击穿透到身后家具）；
 *   否则半透明的门板/窗扇会挡住相机与家具之间的点击（真实 UX bug：看得见点不到）。
 * 旋转时墙「丝滑变透明」而非啪地消失；只藏真正挡住视线的墙。
 */
function useWallOcclusionFade(
  root: RefObject<THREE.Group | null>,
  boxes: THREE.Box3[],
  focusRef?: RefObject<FocusPos>,
) {
  const op = useRef(1);
  const fading = useRef(false);
  const _rayOn = useRef(true);
  useFrame(({ camera }, rawDt) => {
    const g = root.current;
    if (!g) return;
    const f = focusRef?.current;
    _focusP.set(f?.x ?? 0, 1, f?.z ?? 2.4);
    let blocked = false;
    for (const b of boxes) {
      if (segHitsBox(camera.position, _focusP, b)) {
        blocked = true;
        break;
      }
    }
    const dt = Math.min(rawDt, 0.05);
    op.current = THREE.MathUtils.damp(op.current, blocked ? 0 : 1, blocked ? 14 : 8, dt);
    const v = op.current;
    const vis = v > 0.015;
    if (g.visible !== vis) g.visible = vis;
    // ⚑ 可见即可穿：淡出中（含半透明过渡期）禁用射线；完全恢复才还原
    const wantRay = v > 0.95;
    if (wantRay !== _rayOn.current) {
      _rayOn.current = wantRay;
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (wantRay) {
          const orig = _rayBase.get(mesh);
          if (orig) mesh.raycast = orig;
        } else {
          if (!_rayBase.has(mesh)) _rayBase.set(mesh, mesh.raycast);
          mesh.raycast = _noopRaycast;
        }
      });
    }
    if (!vis) return; // 全隐：材质保持淡出态，恢复时阻尼淡回
    if (v < 0.998) {
      fading.current = true;
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mm = mesh.material as THREE.Material | THREE.Material[];
        for (const m of Array.isArray(mm) ? mm : [mm]) {
          let base = _matBase.get(m);
          if (!base) {
            base = { o: m.opacity, t: m.transparent, d: m.depthWrite };
            _matBase.set(m, base);
          }
          m.opacity = base.o * v;
          m.transparent = true;
          m.depthWrite = false;
        }
      });
    } else if (fading.current) {
      // 淡出结束：按基准一次性还原（透明/深度写状态也还原），交还声明式控制
      fading.current = false;
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mm = mesh.material as THREE.Material | THREE.Material[];
        for (const m of Array.isArray(mm) ? mm : [mm]) {
          const base = _matBase.get(m);
          if (base) {
            m.opacity = base.o;
            m.transparent = base.t;
            m.depthWrite = base.d;
          }
        }
      });
    }
  });
}

/**
 * 隔墙（带门洞）随门位动态重建：门挪 → 墙段跟随。
 * v5.4 户型：客厅 9×6（西北）+ 卫生间 4×6（客厅东侧）+ 卧室 6×5 / 厨房 6×5（南排）；
 * 卫生间门开在客厅东墙（x=4.5），厨房东墙变外墙（无门洞）。
 */
function buildWalls(doorBed: number, doorKt: number, doorBath: number, doorBal: number): WallDef[] {
  const H = WALL_H;
  return [
    // —— 客厅 ——
    { key: 'back', pos: [0, H / 2, -ROOM_Z - WALL_T / 2], size: [ROOM_W + WALL_T * 2, H, WALL_T], normal: new THREE.Vector3(0, 0, -1), room: 'lr' },
    { key: 'frontWest', pos: [(-ROOM_X - WALL_T + doorBed - DOOR_W / 2) / 2, H / 2, BED_Z0 + WALL_T / 2], size: [doorBed - DOOR_W / 2 - (-ROOM_X - WALL_T), H, WALL_T], normal: new THREE.Vector3(0, 0, 1), room: 'lr' },
    { key: 'frontEast', pos: [(doorBed + DOOR_W / 2 + BED_X1) / 2, H / 2, BED_Z0 + WALL_T / 2], size: [BED_X1 - (doorBed + DOOR_W / 2), H, WALL_T], normal: new THREE.Vector3(0, 0, 1), room: 'lr' },
    { key: 'left', pos: [-ROOM_X - WALL_T / 2, H / 2, 0], size: [WALL_T, H, ROOM_D], normal: new THREE.Vector3(-1, 0, 0), room: 'lr' },
    // 客厅东墙（= 卫生间西墙）：两段夹卫生间门洞
    { key: 'rightA', pos: [ROOM_X + WALL_T / 2, H / 2, (-ROOM_Z - WALL_T / 2 + doorBath - DOOR_W / 2) / 2], size: [WALL_T, H, doorBath - DOOR_W / 2 - (-ROOM_Z - WALL_T / 2)], normal: new THREE.Vector3(1, 0, 0), room: 'lr' },
    { key: 'rightB', pos: [ROOM_X + WALL_T / 2, H / 2, (doorBath + DOOR_W / 2 + ROOM_Z + WALL_T / 2) / 2], size: [WALL_T, H, ROOM_Z + WALL_T / 2 - (doorBath + DOOR_W / 2)], normal: new THREE.Vector3(1, 0, 0), room: 'lr' },
    // —— 卧室（隔墙南侧） ——
    { key: 'bedLeft', pos: [-ROOM_X - WALL_T / 2, H / 2, (BED_Z0 + BED_Z1) / 2], size: [WALL_T, H, BED_Z1 - BED_Z0], normal: new THREE.Vector3(-1, 0, 0), room: 'br' },
    // 卧室/厨房共墙
    { key: 'bedRight', pos: [BED_X1 + WALL_T / 2, H / 2, (BED_Z0 + BED_Z1) / 2], size: [WALL_T, H, BED_Z1 - BED_Z0], normal: new THREE.Vector3(1, 0, 0), room: 'br' },
    // 卧室南墙（= 阳台北墙 v5.7：两段夹阳台门洞）
    { key: 'bedBackWest', pos: [(BED_X0 - WALL_T + doorBal - DOOR_W / 2) / 2, H / 2, BED_Z1 + WALL_T / 2], size: [doorBal - DOOR_W / 2 - (BED_X0 - WALL_T), H, WALL_T], normal: new THREE.Vector3(0, 0, 1), room: 'br' },
    { key: 'bedBackEast', pos: [(doorBal + DOOR_W / 2 + BED_X1 + WALL_T) / 2, H / 2, BED_Z1 + WALL_T / 2], size: [BED_X1 + WALL_T - (doorBal + DOOR_W / 2), H, WALL_T], normal: new THREE.Vector3(0, 0, 1), room: 'br' },
    // —— 厨房（北墙两段夹门洞；北墙延伸到卫生间东缘，与卫生间南墙共面） ——
    { key: 'ktNorthWest', pos: [(BED_X1 + doorKt - DOOR_W / 2) / 2, H / 2, BED_Z0 + WALL_T / 2], size: [doorKt - DOOR_W / 2 - BED_X1, H, WALL_T], normal: new THREE.Vector3(0, 0, -1), room: 'kt' },
    { key: 'ktNorthMain', pos: [(doorKt + DOOR_W / 2 + BATH_X1 + WALL_T) / 2, H / 2, BED_Z0 + WALL_T / 2], size: [BATH_X1 + WALL_T - (doorKt + DOOR_W / 2), H, WALL_T], normal: new THREE.Vector3(0, 0, -1), room: 'kt' },
    // 厨房东墙（v5.4 变外墙，无门洞）
    { key: 'ktEast', pos: [KTCH_X1 + WALL_T / 2, H / 2, (BED_Z0 + BED_Z1) / 2], size: [WALL_T, H, BED_Z1 - BED_Z0], normal: new THREE.Vector3(1, 0, 0), room: 'kt' },
    { key: 'ktSouth', pos: [(BED_X1 + KTCH_X1) / 2, H / 2, BED_Z1 + WALL_T / 2], size: [KTCH_X1 - BED_X1 + WALL_T * 2, H, WALL_T], normal: new THREE.Vector3(0, 0, 1), room: 'kt' },
    // —— 卫生间（客厅东侧；北墙带窗，东墙带窗，南墙由 ktNorthMain 延伸段覆盖） ——
    { key: 'bathNorth', pos: [(BATH_X0 + BATH_X1) / 2, H / 2, BATH_Z0 - WALL_T / 2], size: [BATH_X1 - BATH_X0, H, WALL_T], normal: new THREE.Vector3(0, 0, -1), room: 'ba' },
    { key: 'bathEast', pos: [BATH_X1 + WALL_T / 2, H / 2, (BATH_Z0 + BATH_Z1) / 2], size: [WALL_T, H, BATH_Z1 - BATH_Z0 + WALL_T * 2], normal: new THREE.Vector3(1, 0, 0), room: 'ba' },
    // —— 阳台（v5.7：卧室南侧；西墙=建筑外墙，南/东面开放式栏杆单独渲染） ——
    { key: 'balWest', pos: [BAL_X0 - WALL_T / 2, H / 2, (BAL_Z0 + BAL_Z1) / 2], size: [WALL_T, H, BAL_Z1 - BAL_Z0], normal: new THREE.Vector3(-1, 0, 0), room: 'bal' },
  ];
}

/** 门洞上方的门头梁（与所在整墙同隐同现；无踢脚线） */
function DoorLintel({
  pos,
  alongAxis,
  wallCol,
  night,
  focusRef,
  hostBox,
  wallTexMap,
}: {
  pos: [number, number, number];
  alongAxis: 'x' | 'z';
  wallCol?: string;
  night: boolean;
  focusRef?: RefObject<FocusPos>;
  /** 所在整墙（含门洞跨度）的剖面盒：视线穿过墙上任意处 → 门梁随墙同隐 */
  hostBox: THREE.Box3;
  wallTexMap?: THREE.Texture;
}) {
  const ref = useRef<THREE.Group>(null);
  useWallOcclusionFade(ref, useMemo(() => [hostBox], [hostBox]), focusRef);
  const size: [number, number, number] = alongAxis === 'x' ? [DOOR_W + 0.04, WALL_H - 2.06, WALL_T] : [WALL_T, WALL_H - 2.06, DOOR_W + 0.04];
  return (
    <group ref={ref}>
      <mesh position={pos} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={wallCol ?? (night ? '#e9e4d8' : '#f7f3ec')} map={wallTexMap} roughness={0.95} />
      </mesh>
    </group>
  );
}
const DOOR_H = 2.06;

function Wall({ def, night, wallCol, wallTexMap, focusRef }: { def: WallDef; night: boolean; wallCol?: string; wallTexMap?: THREE.Texture; focusRef?: RefObject<FocusPos> }) {
  const ref = useRef<THREE.Group>(null);
  useWallOcclusionFade(ref, useMemo(() => [boxOf(def)], [def]), focusRef);

  return (
    <group ref={ref}>
      {/* 墙体：暖白（支持用户自定义色 + 墙纸纹理） */}
      <mesh position={def.pos} castShadow receiveShadow>
        <boxGeometry args={def.size} />
        <meshStandardMaterial color={wallCol ?? (night ? '#e9e4d8' : '#f7f3ec')} map={wallTexMap} roughness={0.95} />
      </mesh>
      {/* 踢脚线：浅灰（内侧面贴墙） */}
      {def.baseboard !== false && (
        <mesh
          position={[
            def.pos[0] - def.normal.x * (WALL_T / 2 + 0.012),
            0.055,
            def.pos[2] - def.normal.z * (WALL_T / 2 + 0.012),
          ]}
          castShadow
        >
          <boxGeometry
            args={[
              Math.max(def.size[0] * 0.998, 0.02),
              0.11,
              Math.max(def.size[2] * 0.998, 0.02),
            ]}
          />
          <meshStandardMaterial color="#e3e1da" roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

/**
 * 墙段碰撞盒（生活模式相机防钻墙钳制用；不含门洞区域——相机可从开着的门洞穿过）。
 * 随门位变化重建：门挪 → 墙段 AABB 跟随。
 */
export function buildWallBoxes(doorBed: number, doorKt: number, doorBath: number, doorBal: number): THREE.Box3[] {
  return buildWalls(doorBed, doorKt, doorBath, doorBal).map(boxOf);
}

// ---------------- 门牌（门洞上方：卧室 / 厨房 / 卫生间） ----------------

/** 门牌纹理：白底圆角 + 樱粉描边 + 中文标签（canvas 绘制，每标签只建一次） */
const signTexCache = new Map<string, THREE.CanvasTexture>();
function makeSignTexture(label: string): THREE.CanvasTexture {
  const hit = signTexCache.get(label);
  if (hit) return hit;
  const W = 256;
  const H = 112;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  // 白底圆角卡片
  ctx.fillStyle = '#fffdf8';
  ctx.strokeStyle = '#f2b3c2';
  ctx.lineWidth = 7;
  const r = 26;
  ctx.beginPath();
  ctx.moveTo(r + 4, 4);
  ctx.arcTo(W - 4, 4, W - 4, H - 4, r);
  ctx.arcTo(W - 4, H - 4, 4, H - 4, r);
  ctx.arcTo(4, H - 4, 4, 4, r);
  ctx.arcTo(4, 4, W - 4, 4, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 中文标签
  ctx.fillStyle = '#4a4a4e';
  ctx.font = '600 52px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W / 2, H / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  signTexCache.set(label, tex);
  return tex;
}

/** 门牌：挂在门洞正上方（面向门外走来的那一侧），随门位移动 */
function DoorSign({ label }: { label: string }) {
  const tex = useMemo(() => makeSignTexture(label), [label]);
  return (
    <group position={[0, DOOR_H + 0.21, -WALL_T / 2 - 0.015]} rotation={[0, Math.PI, 0]}>
      {/* 牌面（微微凸出墙面，双面均可读） */}
      <mesh position={[0, 0, 0.008]} castShadow>
        <boxGeometry args={[0.46, 0.21, 0.02]} />
        <meshStandardMaterial color="#fffdf8" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[0.44, 0.19]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, -0.008]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.44, 0.19]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------- 门（三扇：可开合可换色；编辑模式点击=选中不开门） ----------------

/**
 * 门：门框（三个边条，略压进门洞形成企口）+ 门板（铰链 pivot，向门后侧屋内摆开）+ 双面把手。
 * ry = 0 时门洞沿 x 走（z=3 隔墙）；ry = π/2 时门洞沿 z 走（x=7.5 共墙）。
 */
function HouseDoor({
  pos,
  ry,
  open,
  col,
  night,
  sign,
  onToggle,
  editMode,
  selected,
  onSelect,
  onEditPointerDown,
  focusRef,
  hostBox,
}: {
  pos: [number, number];
  ry: number;
  open: boolean;
  col?: string;
  night: boolean;
  /** 门牌标签（卧室/厨房/卫生间；空串不挂） */
  sign?: string;
  onToggle: () => void;
  editMode: boolean;
  selected: boolean;
  onSelect: () => void;
  onEditPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  focusRef?: RefObject<FocusPos>;
  /** 所在整墙（含门洞跨度）的剖面盒：视线穿过墙上任意处 → 门随墙同隐（不浮空） */
  hostBox: THREE.Box3;
}) {
  const panel = useRef<THREE.Group>(null);
  const doorRoot = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // 门遮挡盒：门洞区域（含门框包边）；视线穿过门洞 → 门随墙同隐；从开着的门洞看过去也淡出门板
  const doorBox = useMemo(() => {
    const hw = DOOR_W / 2 + 0.09;
    const ht = (WALL_T + 0.03) / 2 + 0.02;
    const top = DOOR_H + 0.08;
    return ry === 0
      ? new THREE.Box3(
          new THREE.Vector3(pos[0] - hw, 0, pos[1] - ht),
          new THREE.Vector3(pos[0] + hw, top, pos[1] + ht),
        )
      : new THREE.Box3(
          new THREE.Vector3(pos[0] - ht, 0, pos[1] - hw),
          new THREE.Vector3(pos[0] + ht, top, pos[1] + hw),
        );
  }, [pos[0], pos[1], ry]);
  useWallOcclusionFade(doorRoot, useMemo(() => [doorBox, hostBox], [doorBox, hostBox]), focusRef);

  useFrame((_, dt) => {
    if (!panel.current) return;
    // 关 = 与隔墙同面；开 = 向屋内（ry=0 → +z；ry=π/2 → +x 卫生间）摆开约 100°
    panel.current.rotation.y = THREE.MathUtils.damp(panel.current.rotation.y, open ? -1.78 : 0, 6, dt);
  });

  const doorCol = col ?? '#f3efe6';
  const frameCol = useMemo(() => new THREE.Color(doorCol).multiplyScalar(0.86), [doorCol]);
  const frameStr = `#${frameCol.getHexString()}`;
  /** 门板宽/高：比门洞各边小 2cm（藏在门垛/门头梁企口后面，不露缝） */
  const PANEL_W = DOOR_W - 0.04;
  const PANEL_H = DOOR_H - 0.03;

  const toggle = (e: { delta: number; stopPropagation: () => void }) => {
    if (e.delta > 8) return; // 拖动视角不算点击
    e.stopPropagation();
    if (editMode) onSelect();
    else onToggle();
  };

  const hoverProps = {
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      setHovered(true);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHovered(false);
      document.body.style.cursor = 'auto';
    },
  };

  return (
    <group position={[pos[0], 0, pos[1]]} rotation={[0, ry, 0]} ref={doorRoot}>
      {/* 门牌（门洞上方，随门位移动） */}
      {sign ? <DoorSign label={sign} /> : null}
      {/* 门框：左右门垛（0.07 宽，压进门洞 2cm 盖住门板边）+ 门头梁包边（压下 4.5cm） */}
      <mesh position={[-DOOR_W / 2 - 0.015, DOOR_H / 2 + 0.005, WALL_T / 2]} castShadow>
        <boxGeometry args={[0.07, DOOR_H + 0.01, WALL_T + 0.03]} />
        <meshStandardMaterial color={frameStr} roughness={0.8} />
      </mesh>
      <mesh position={[DOOR_W / 2 + 0.015, DOOR_H / 2 + 0.005, WALL_T / 2]} castShadow>
        <boxGeometry args={[0.07, DOOR_H + 0.01, WALL_T + 0.03]} />
        <meshStandardMaterial color={frameStr} roughness={0.8} />
      </mesh>
      <mesh position={[0, DOOR_H, WALL_T / 2]} castShadow>
        <boxGeometry args={[DOOR_W + 0.16, 0.09, WALL_T + 0.03]} />
        <meshStandardMaterial color={frameStr} roughness={0.8} />
      </mesh>

      {/* 门板（铰链在左侧门垛，往屋内方向开；点击开合 / 编辑模式选中） */}
      <group
        ref={panel}
        position={[-DOOR_W / 2 + 0.02, 0, WALL_T / 2]}
        onClick={toggle}
        onPointerDown={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          onEditPointerDown(e);
        }}
        {...hoverProps}
      >
        <group position={[DOOR_W / 2 - 0.02, 0, 0]}>
          {/* 门板主体（填满门洞，边缝全部藏进门框企口） */}
          <mesh position={[0, PANEL_H / 2 + 0.005, 0]} castShadow receiveShadow>
            <boxGeometry args={[PANEL_W, PANEL_H, 0.045]} />
            <meshStandardMaterial color={doorCol} roughness={0.75} />
          </mesh>
          {/* 门板凹凸造型线（上下两块嵌板） */}
          <mesh position={[0, PANEL_H * 0.7, 0.026]}>
            <boxGeometry args={[PANEL_W - 0.18, 0.62, 0.012]} />
            <meshStandardMaterial color={frameStr} roughness={0.8} />
          </mesh>
          <mesh position={[0, PANEL_H * 0.28, 0.026]}>
            <boxGeometry args={[PANEL_W - 0.18, 0.5, 0.012]} />
            <meshStandardMaterial color={frameStr} roughness={0.8} />
          </mesh>
          {/* 把手（双面） */}
          <mesh position={[PANEL_W / 2 - 0.11, PANEL_H * 0.47, 0.045]}>
            <sphereGeometry args={[0.032, 12, 10]} />
            <meshStandardMaterial color="#d9cfb8" metalness={0.55} roughness={0.35} />
          </mesh>
          <mesh position={[PANEL_W / 2 - 0.11, PANEL_H * 0.47, -0.045]}>
            <sphereGeometry args={[0.032, 12, 10]} />
            <meshStandardMaterial color="#d9cfb8" metalness={0.55} roughness={0.35} />
          </mesh>
          {/* 夜里门缝透出的暖光提示 */}
          {!open && night && (
            <mesh position={[PANEL_W / 2 - 0.03, PANEL_H / 2, 0.026]}>
              <boxGeometry args={[0.012, PANEL_H - 0.2, 0.004]} />
              <meshBasicMaterial color="#ffd98f" transparent opacity={0.35} toneMapped={false} />
            </mesh>
          )}
          {/* hover / 选中高亮 */}
          {(hovered || selected) && (
            <mesh position={[0, PANEL_H / 2, 0.03]}>
              <planeGeometry args={[PANEL_W - 0.03, PANEL_H - 0.03]} />
              <meshBasicMaterial color={selected ? '#f2a9bc' : '#ffffff'} transparent opacity={selected ? 0.3 : 0.14} depthWrite={false} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}

// ---------------- 窗户（上悬窗，向外上方打开；编辑模式点击=选中） ----------------

/** 窗：窗框（四边条，winCol 可自定义）+ 整扇上悬窗扇（顶部铰链，底部向外上翻） */
function Window({
  position,
  rotationY,
  night,
  open,
  col,
  onToggle,
  editMode,
  selected,
  onSelect,
  onEditPointerDown,
  focusRef,
  hostBox,
}: {
  position: [number, number, number];
  rotationY: number;
  night: boolean;
  open: boolean;
  col?: string;
  onToggle: () => void;
  editMode: boolean;
  selected: boolean;
  onSelect: () => void;
  onEditPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  focusRef?: RefObject<FocusPos>;
  /** 所在墙的剖面盒：墙被视线穿过时窗随墙同隐（避免墙隐了窗浮空） */
  hostBox: THREE.Box3 | null;
}) {
  const glow = useRef<THREE.PointLight>(null);
  const sashPivot = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const skyTex = useMemo(() => (night ? makeNightSkyTexture() : makeDaySkyTexture()), [night]);
  const frameCol = col ?? '#f0e7d4';

  // 窗遮挡盒：窗框范围；视线穿窗或穿所在墙 → 窗淡出
  const winBox = useMemo(
    () =>
      rotationY === 0
        ? new THREE.Box3(
            new THREE.Vector3(position[0] - 0.78, position[1] - 0.68, position[2] - 0.1),
            new THREE.Vector3(position[0] + 0.78, position[1] + 0.68, position[2] + 0.1),
          )
        : new THREE.Box3(
            new THREE.Vector3(position[0] - 0.1, position[1] - 0.68, position[2] - 0.78),
            new THREE.Vector3(position[0] + 0.1, position[1] + 0.68, position[2] + 0.78),
          ),
    [position[0], position[1], position[2], rotationY],
  );
  useWallOcclusionFade(root, useMemo(() => (hostBox ? [winBox, hostBox] : [winBox]), [winBox, hostBox]), focusRef);

  useFrame((_, dt) => {
    if (!sashPivot.current) return;
    // 上悬窗：关 = 竖直贴合；开 = 底部向外（窗外方向）上翻约 32°
    const target = open ? 0.56 : 0;
    sashPivot.current.rotation.x = THREE.MathUtils.damp(sashPivot.current.rotation.x, target, 7, dt);
    if (glow.current) {
      glow.current.intensity = THREE.MathUtils.damp(
        glow.current.intensity,
        night ? (open ? 0.22 : 0.5) : 0,
        5,
        dt,
      );
    }
  });

  /** 玻璃材质（微透，能看见窗外风景；夜里关窗透暖光） */
  const glassProps = {
    color: night ? '#e8dfc8' : '#dfeef2',
    transparent: true,
    opacity: 0.42,
    roughness: 0.15,
    metalness: 0.05,
    emissive: night ? '#ffd98f' : '#000000',
    emissiveIntensity: night && !open ? 0.32 : 0,
  } as const;

  const toggle = (e: { delta: number; stopPropagation: () => void }) => {
    if (e.delta > 8) return; // 拖动视角不算点击
    e.stopPropagation();
    if (editMode) onSelect();
    else onToggle();
  };

  const hoverProps = {
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      setHovered(true);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHovered(false);
      document.body.style.cursor = 'auto';
    },
  };

  return (
    <group position={position} rotation={[0, rotationY, 0]} ref={root}>
      {/* 窗外风景（凹进墙内，透过玻璃可见） */}
      <mesh position={[0, 0, -0.045]}>
        <planeGeometry args={[1.36, 1.14]} />
        <meshBasicMaterial map={skyTex} toneMapped={false} />
      </mesh>

      {/* 窗框（四边条，中空露出风景；winCol 自定义色） */}
      <mesh position={[0, 0.615, 0]} castShadow>
        <boxGeometry args={[1.5, 0.07, 0.1]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.615, 0]} castShadow>
        <boxGeometry args={[1.5, 0.07, 0.1]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>
      <mesh position={[-0.715, 0, 0]} castShadow>
        <boxGeometry args={[0.07, 1.3, 0.1]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>
      <mesh position={[0.715, 0, 0]} castShadow>
        <boxGeometry args={[0.07, 1.3, 0.1]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>

      {/* 上悬窗扇：铰链在顶部，整扇绕顶部向外上翻（点击开合 / 编辑模式选中） */}
      <group
        ref={sashPivot}
        position={[0, 0.57, 0.03]}
        onClick={toggle}
        onPointerDown={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          onEditPointerDown(e);
        }}
        {...hoverProps}
      >
        <group position={[0, -0.57, 0]}>
          {/* 玻璃 */}
          <mesh>
            <boxGeometry args={[1.3, 1.06, 0.035]} />
            <meshStandardMaterial {...glassProps} />
          </mesh>
          {/* 窗扇框（四边细条） */}
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[1.36, 0.05, 0.06]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          <mesh position={[0, -0.55, 0]}>
            <boxGeometry args={[1.36, 0.05, 0.06]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          <mesh position={[-0.66, 0, 0]}>
            <boxGeometry args={[0.05, 1.1, 0.06]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          <mesh position={[0.66, 0, 0]}>
            <boxGeometry args={[0.05, 1.1, 0.06]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          {/* 横棂（中分线） */}
          <mesh position={[0, 0, 0.012]}>
            <boxGeometry args={[1.3, 0.04, 0.03]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          {/* 十字竖棂 */}
          <mesh position={[0, 0, 0.012]}>
            <boxGeometry args={[0.04, 1.06, 0.03]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          {/* 下缘把手（开窗时随手扇外翻） */}
          <mesh position={[0.42, -0.6, 0.04]}>
            <boxGeometry args={[0.14, 0.035, 0.03]} />
            <meshStandardMaterial color="#cfc6b2" roughness={0.6} metalness={0.3} />
          </mesh>
          {/* hover / 选中高亮描边 */}
          {(hovered || selected) && (
            <mesh position={[0, 0, 0.03]}>
              <planeGeometry args={[1.42, 1.18]} />
              <meshBasicMaterial color={selected ? '#f2a9bc' : '#ffffff'} transparent opacity={selected ? 0.3 : 0.16} depthWrite={false} />
            </mesh>
          )}
        </group>
      </group>

      {/* 夜里窗边暖光（开窗后减弱，透进来的不是灯光而是夜色） */}
      {night && <pointLight ref={glow} position={[0, 0, 0.45]} color="#ffd98f" intensity={0} distance={3.5} decay={2} />}
    </group>
  );
}

// ---------------- 天花板（四房间；相机钻进屋内才显示，俯瞰自动隐藏） ----------------

function Ceiling({
  x0,
  x1,
  z0,
  z1,
  col,
  night,
}: {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  col?: string;
  night: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  useFrame(() => {
    if (!ref.current) return;
    const inside =
      camera.position.x > x0 - 0.15 &&
      camera.position.x < x1 + 0.15 &&
      camera.position.z > z0 - 0.15 &&
      camera.position.z < z1 + 0.15;
    ref.current.visible = inside && camera.position.y < WALL_H - 0.12;
  });
  return (
    <mesh ref={ref} position={[(x0 + x1) / 2, WALL_H, (z0 + z1) / 2]} rotation={[Math.PI / 2, 0, 0]}>
      <planeGeometry args={[x1 - x0, z1 - z0]} />
      <meshStandardMaterial color={col ?? (night ? '#e0ddd4' : '#fbf9f3')} roughness={0.96} />
    </mesh>
  );
}

// ---------------- 房间整体 ----------------

export interface RoomProps {
  night: boolean;
  onFloorTap?: () => void;
  /** 编辑模式（门窗点击 = 选中而非开合） */
  editMode?: boolean;
  /** 当前选中的门窗 id（'win-3' / 'door-bed'…） */
  selWall?: string | null;
  /** 编辑模式：点选门窗 / 按下开始拖拽 */
  onWallTap?: (id: string) => void;
  onWallPointerDown?: (e: ThreeEvent<PointerEvent>, id: string) => void;
  /** 九扇窗开态 */
  win?: boolean[];
  onToggleWin?: (i: number) => void;
  /** 每扇窗沿墙坐标（缺省 = 默认位） */
  winPos?: number[];
  /** 三/四扇门沿墙坐标 */
  doorPos?: { bed: number; kt: number; bath: number; bal?: number };
  /** 客厅地板/墙自定义色 */
  floorCol?: string;
  wallCol?: string;
  /** 卧室 / 厨房 / 卫生间 / 阳台地板墙自定义色（分开换色） */
  floorColBed?: string;
  wallColBed?: string;
  floorColK?: string;
  wallColK?: string;
  floorColB?: string;
  wallColB?: string;
  floorColBal?: string;
  wallColBal?: string;
  /** 天花板自定义色（四房间分开） */
  ceilCol?: string;
  ceilColBed?: string;
  ceilColK?: string;
  ceilColB?: string;
  /** 门色（#rrggbb；全屋三道门通用） */
  doorCol?: string;
  /** 窗框色（#rrggbb；缺省浅木白） */
  winCol?: string;
  /** 卧室门 / 厨房门 / 卫生间门 / 阳台门开态 */
  doorOpen?: boolean;
  kitchenDoorOpen?: boolean;
  bathDoorOpen?: boolean;
  balconyDoorOpen?: boolean;
  onToggleDoor?: () => void;
  onToggleKitchenDoor?: () => void;
  onToggleBathDoor?: () => void;
  onToggleBalconyDoor?: () => void;
  /** 相机对焦物（生活模式=小人，编辑模式=轨道中心）；隔墙用它判断是否挡在镜头与对焦物之间 */
  focusRef?: RefObject<FocusPos>;
  /** 地板纹理（全屋通用，颜色仍分房间）：wood 木纹（默认）/ plain 素色 / check 大格瓷砖 */
  floorTex?: 'plain' | 'wood' | 'check';
  /** 墙纸纹理（全屋通用，颜色仍分房间）：plain 素色（默认）/ dot 碎花 / stripe 细条纹 */
  wallTex?: 'plain' | 'dot' | 'stripe';
}

export default function Room({
  night,
  onFloorTap,
  editMode,
  selWall,
  onWallTap,
  onWallPointerDown,
  win,
  onToggleWin,
  winPos,
  doorPos,
  floorCol,
  wallCol,
  floorColBed,
  wallColBed,
  floorColK,
  wallColK,
  floorColB,
  wallColB,
  floorColBal,
  wallColBal,
  ceilCol,
  ceilColBed,
  ceilColK,
  ceilColB,
  doorCol,
  winCol,
  doorOpen,
  kitchenDoorOpen,
  bathDoorOpen,
  balconyDoorOpen,
  onToggleDoor,
  onToggleKitchenDoor,
  onToggleBathDoor,
  onToggleBalconyDoor,
  focusRef,
  floorTex = 'wood',
  wallTex = 'plain',
}: RoomProps) {
  const floorWoodTex = useMemo(() => makeFloorTexture(), []);
  const floorCheckTex = useMemo(() => makeFloorCheckerTexture(), []);
  const wallDotTex = useMemo(() => makeWallDotTexture(), []);
  const wallStripeTex = useMemo(() => makeWallStripeTexture(), []);
  /** 当前选用的地板/墙纸纹理（plain = 无贴图纯色） */
  const floorMap = floorTex === 'wood' ? floorWoodTex : floorTex === 'check' ? floorCheckTex : null;
  const wallMap = wallTex === 'dot' ? wallDotTex : wallTex === 'stripe' ? wallStripeTex : null;

  const doorBed = doorPos?.bed ?? DOORS[0].def;
  const doorKt = doorPos?.kt ?? DOORS[1].def;
  const doorBath = doorPos?.bath ?? DOORS[2].def;
  const doorBal = doorPos?.bal ?? DOORS[3].def;

  /** 墙段随门位动态重建（门挪 → 墙洞跟随） */
  const walls = useMemo(() => buildWalls(doorBed, doorKt, doorBath, doorBal), [doorBed, doorKt, doorBath, doorBal]);

  /** 门洞墙的「整墙剖面盒」（两段夹门洞的并集，含门洞跨度）：门/门梁随整墙同隐同现 */
  const slabs = useMemo(() => {
    const union = (a: string, b: string): THREE.Box3 => {
      const wa = walls.find((w) => w.key === a);
      const wb = walls.find((w) => w.key === b);
      if (!wa || !wb) return new THREE.Box3();
      return boxOf(wa).union(boxOf(wb));
    };
    return {
      bed: union('frontWest', 'frontEast'),
      kt: union('ktNorthWest', 'ktNorthMain'),
      bath: union('rightA', 'rightB'),
      bal: union('bedBackWest', 'bedBackEast'),
    };
  }, [walls]);

  /** 每扇窗所在墙的剖面盒（墙被视线穿过时窗随墙同隐，避免墙隐了窗浮空） */
  const winHosts = useMemo(() => {
    const boxes = walls.map(boxOf);
    return WINS.map((w, i) => {
      const along = winPos?.[i] ?? w.def;
      const cx = w.axis === 'z' ? along : w.at + w.side * 0.08;
      const cz = w.axis === 'z' ? w.at + w.side * 0.08 : along;
      const p = new THREE.Vector3(cx, 1.5, cz);
      for (const b of boxes) {
        if (b.clone().expandByScalar(0.18).containsPoint(p)) return b;
      }
      return null;
    });
  }, [walls, winPos]);

  /** 各房间地板材质（共享同一张纹理，颜色独立；plain = 素色无贴图） */
  const floorMat = (col?: string) => (
    <meshStandardMaterial
      map={floorMap ?? undefined}
      color={col ?? (night ? '#c9c5bb' : '#f5f2ec')}
      roughness={0.9}
    />
  );

  const floorTap = (e: { delta: number; stopPropagation: () => void }) => {
    if (e.delta > 8) return;
    e.stopPropagation();
    onFloorTap?.();
  };

  return (
    <group>
      {/* 客厅地板（接收阴影 + 点击空白处取消选择；滑动不算点击） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={floorTap}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        {floorMat(floorCol)}
      </mesh>

      {/* 卧室地板（颜色与客厅独立） */}
      <mesh
        position={[(BED_X0 + BED_X1) / 2, 0, (BED_Z0 + BED_Z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={floorTap}
      >
        <planeGeometry args={[BED_W, BED_Z1 - BED_Z0]} />
        {floorMat(floorColBed)}
      </mesh>

      {/* 厨房地板（颜色独立第三间） */}
      <mesh
        position={[(BED_X1 + KTCH_X1) / 2, 0, (BED_Z0 + BED_Z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={floorTap}
      >
        <planeGeometry args={[KTCH_X1 - BED_X1, BED_Z1 - BED_Z0]} />
        {floorMat(floorColK)}
      </mesh>

      {/* 卫生间地板（颜色独立第四间；v5.4 客厅东侧） */}
      <mesh
        position={[(BATH_X0 + BATH_X1) / 2, 0, (BATH_Z0 + BATH_Z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={floorTap}
      >
        <planeGeometry args={[BATH_X1 - BATH_X0, BATH_Z1 - BATH_Z0]} />
        {floorMat(floorColB)}
      </mesh>

      {/* 阳台地板（木色露台感；v5.7 卧室南侧） */}
      <mesh
        position={[(BAL_X0 + BAL_X1) / 2, 0, (BAL_Z0 + BAL_Z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={floorTap}
      >
        <planeGeometry args={[BAL_X1 - BAL_X0, BAL_Z1 - BAL_Z0]} />
        <meshStandardMaterial
          map={floorMap ?? undefined}
          color={floorColBal ?? (night ? '#c4b394' : '#e2d2b4')}
          roughness={0.92}
        />
      </mesh>

      {/* 地板外沿：浅灰围边（剖面观感） */}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_W + 0.6, ROOM_D + 0.6]} />
        <meshStandardMaterial color="#d4d1c9" roughness={0.95} />
      </mesh>
      <mesh position={[(BED_X0 + BED_X1) / 2, -0.05, (BED_Z0 + BED_Z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BED_W + 0.6, BED_Z1 - BED_Z0 + 0.6]} />
        <meshStandardMaterial color="#d4d1c9" roughness={0.95} />
      </mesh>
      <mesh position={[(BED_X1 + KTCH_X1) / 2, -0.05, (BED_Z0 + BED_Z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[KTCH_X1 - BED_X1 + 0.6, BED_Z1 - BED_Z0 + 0.6]} />
        <meshStandardMaterial color="#d4d1c9" roughness={0.95} />
      </mesh>
      <mesh position={[(BATH_X0 + BATH_X1) / 2, -0.05, (BATH_Z0 + BATH_Z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BATH_X1 - BATH_X0 + 0.6, BATH_Z1 - BATH_Z0 + 0.6]} />
        <meshStandardMaterial color="#d4d1c9" roughness={0.95} />
      </mesh>
      <mesh position={[(BAL_X0 + BAL_X1) / 2, -0.05, (BAL_Z0 + BAL_Z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BAL_X1 - BAL_X0 + 0.6, BAL_Z1 - BAL_Z0 + 0.6]} />
        <meshStandardMaterial color="#d4d1c9" roughness={0.95} />
      </mesh>

      {/* 各面墙（自动隐藏朝相机侧；分开换色；门位变化时墙段动态重建） */}
      {walls.map((def) => (
        <Wall
          key={def.key}
          def={def}
          night={night}
          wallCol={
            def.room === 'br'
              ? wallColBed
              : def.room === 'kt'
                ? wallColK
                : def.room === 'ba'
                  ? wallColB
                  : def.room === 'bal'
                    ? wallColBal
                    : wallCol
          }
          wallTexMap={wallMap ?? undefined}
          focusRef={focusRef}
        />
      ))}

      {/* 门洞上方的门头梁 ×4（与所在整墙同隐同现） */}
      <DoorLintel pos={[doorBed, DOOR_H + (WALL_H - DOOR_H) / 2, BED_Z0 + WALL_T / 2]} alongAxis="x" wallCol={wallCol} night={night} focusRef={focusRef} hostBox={slabs.bed} wallTexMap={wallMap ?? undefined} />
      <DoorLintel pos={[doorKt, DOOR_H + (WALL_H - DOOR_H) / 2, BED_Z0 + WALL_T / 2]} alongAxis="x" wallCol={wallColK} night={night} focusRef={focusRef} hostBox={slabs.kt} wallTexMap={wallMap ?? undefined} />
      <DoorLintel pos={[ROOM_X + WALL_T / 2, DOOR_H + (WALL_H - DOOR_H) / 2, doorBath]} alongAxis="z" wallCol={wallCol} night={night} focusRef={focusRef} hostBox={slabs.bath} wallTexMap={wallMap ?? undefined} />
      <DoorLintel pos={[doorBal, DOOR_H + (WALL_H - DOOR_H) / 2, BED_Z1 + WALL_T / 2]} alongAxis="x" wallCol={wallColBal ?? wallColBed} night={night} focusRef={focusRef} hostBox={slabs.bal} wallTexMap={wallMap ?? undefined} />

      {/* 四扇门（点击开合 / 编辑模式选中滑行；门牌挂门洞上方） */}
      <HouseDoor
        pos={[doorBed, BED_Z0]}
        ry={DOORS[0].ry}
        open={!!doorOpen}
        col={doorCol}
        night={night}
        sign="卧室"
        onToggle={() => onToggleDoor?.()}
        editMode={!!editMode}
        selected={selWall === 'door-bed'}
        onSelect={() => onWallTap?.('door-bed')}
        onEditPointerDown={(e) => onWallPointerDown?.(e, 'door-bed')}
        focusRef={focusRef}
        hostBox={slabs.bed}
      />
      <HouseDoor
        pos={[doorKt, BED_Z0]}
        ry={DOORS[1].ry}
        open={!!kitchenDoorOpen}
        col={doorCol}
        night={night}
        sign="厨房"
        onToggle={() => onToggleKitchenDoor?.()}
        editMode={!!editMode}
        selected={selWall === 'door-kt'}
        onSelect={() => onWallTap?.('door-kt')}
        onEditPointerDown={(e) => onWallPointerDown?.(e, 'door-kt')}
        focusRef={focusRef}
        hostBox={slabs.kt}
      />
      <HouseDoor
        pos={[ROOM_X, doorBath]}
        ry={DOORS[2].ry}
        open={!!bathDoorOpen}
        col={doorCol}
        night={night}
        sign="卫生间"
        onToggle={() => onToggleBathDoor?.()}
        editMode={!!editMode}
        selected={selWall === 'door-bath'}
        onSelect={() => onWallTap?.('door-bath')}
        onEditPointerDown={(e) => onWallPointerDown?.(e, 'door-bath')}
        focusRef={focusRef}
        hostBox={slabs.bath}
      />
      <HouseDoor
        pos={[doorBal, BED_Z1]}
        ry={DOORS[3].ry}
        open={!!balconyDoorOpen}
        col={doorCol}
        night={night}
        sign="阳台"
        onToggle={() => onToggleBalconyDoor?.()}
        editMode={!!editMode}
        selected={selWall === 'door-bal'}
        onSelect={() => onWallTap?.('door-bal')}
        onEditPointerDown={(e) => onWallPointerDown?.(e, 'door-bal')}
        focusRef={focusRef}
        hostBox={slabs.bal}
      />

      {/* —— 阳台栏杆（南/东两面玻璃护栏 + 木扶手；开放式阳台） —— */}
      <BalconyRail
        from={[BAL_X0, BAL_Z1]}
        to={[BAL_X1, BAL_Z1]}
        night={night}
      />
      <BalconyRail
        from={[BAL_X1, BAL_Z0]}
        to={[BAL_X1, BAL_Z1]}
        night={night}
      />

      {/* —— 九扇上悬窗（数据驱动，编辑模式可选中沿墙滑行） —— */}
      {WINS.map((w, i) => {
        const along = winPos?.[i] ?? w.def;
        const pos: [number, number, number] =
          w.axis === 'z' ? [along, 1.5, w.at + w.side * 0.08] : [w.at + w.side * 0.08, 1.5, along];
        return (
          <Window
            key={i}
            position={pos}
            rotationY={w.ry}
            night={night}
            open={win?.[i] ?? false}
            col={winCol}
            onToggle={() => onToggleWin?.(i)}
            editMode={!!editMode}
            selected={selWall === `win-${i}`}
            onSelect={() => onWallTap?.(`win-${i}`)}
            onEditPointerDown={(e) => onWallPointerDown?.(e, `win-${i}`)}
            focusRef={focusRef}
            hostBox={winHosts[i]}
          />
        );
      })}

      {/* —— 天花板 ×4（相机在屋内低视角才显示；颜色分开换；阳台开放式无顶） —— */}
      <Ceiling x0={-ROOM_X} x1={ROOM_X} z0={-ROOM_Z} z1={BED_Z0} col={ceilCol} night={night} />
      <Ceiling x0={-ROOM_X} x1={BED_X1} z0={BED_Z0} z1={BED_Z1} col={ceilColBed} night={night} />
      <Ceiling x0={BED_X1} x1={KTCH_X1} z0={BED_Z0} z1={BED_Z1} col={ceilColK} night={night} />
      <Ceiling x0={BATH_X0} x1={BATH_X1} z0={BATH_Z0} z1={BATH_Z1} col={ceilColB} night={night} />
    </group>
  );
}

// ---------------- 阳台玻璃栏杆（v5.7：开放式阳台，玻璃 + 木扶手） ----------------

function BalconyRail({ from, to, night }: { from: [number, number]; to: [number, number]; night: boolean }) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const cx = (from[0] + to[0]) / 2;
  const cz = (from[1] + to[1]) / 2;
  const ry = Math.atan2(dx, dz);
  const H = 1.02;
  const posts = Math.max(2, Math.round(len / 0.95) + 1);
  return (
    <group position={[cx, 0, cz]} rotation={[0, ry, 0]}>
      {/* 玻璃栏板（淡青透明） */}
      <mesh position={[0, H / 2, 0]} castShadow>
        <boxGeometry args={[len, H - 0.06, 0.025]} />
        <meshStandardMaterial
          color={night ? '#9fb4bd' : '#cfe4e8'}
          roughness={0.06}
          metalness={0.08}
          transparent
          opacity={0.3}
        />
      </mesh>
      {/* 木扶手（顶杆） */}
      <mesh position={[0, H, 0]} castShadow>
        <boxGeometry args={[len + 0.06, 0.06, 0.07]} />
        <meshStandardMaterial color={night ? '#a8946f' : '#d9c7a4'} roughness={0.7} />
      </mesh>
      {/* 底槛 */}
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[len, 0.06, 0.05]} />
        <meshStandardMaterial color={night ? '#9a8a6e' : '#cfc0a0'} roughness={0.8} />
      </mesh>
      {/* 立柱（等分） */}
      {Array.from({ length: posts }, (_, i) => {
        const x = -len / 2 + (len / (posts - 1)) * i;
        return (
          <mesh key={i} position={[x, H / 2, 0]} castShadow>
            <boxGeometry args={[0.045, H, 0.045]} />
            <meshStandardMaterial color={night ? '#8a7a5e' : '#c4b494'} roughness={0.7} metalness={0.15} />
          </mesh>
        );
      })}
    </group>
  );
}

'use client';

/**
 * 情侣小家 3D —— 程序化 Q 版宠物（v7.0 盲盒大头风）
 *
 * 参考用户三张图：Q 版大头黑柴插画 / 六连萌猫插画 / 3D 盲盒垂耳狗，核心特征：
 * - 超大圆头（≈55% 身高）+ 小圆身，黑豆大眼带双高光，ω 嘴，腮红，奶白肚皮口鼻，小短腿；
 * - 盲盒质感：MeshStandardMaterial 低粗糙度光滑表面，配场景暖光；
 * - 造型由 pet-models QPetSpec 驱动：配色 / 立耳圆耳 / 卷尾蓬尾长尾 / 眉点、帽、三花、
 *   奶牛、虎斑斑块 —— 8 个品种共用一套骨架两套比例（狗 / 猫）；
 * - 程序化萌系动画（tick 驱动，权重阻尼混合）：
 *   走路弹跳摇摆 + 对角小短腿倒腾 / 冲饭加速前倾 / 待机呼吸 + 随机眨眼 + 歪头 /
 *   吃饭点头 / 打盹整体压扁耷耳 / 撸宠连蹦 + 摇尾 + 果冻 squash&stretch。
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { QPetSpec } from '../pet-models';

export interface QPetState {
  walk: number;
  run: number;
  eat: number;
  nap: number;
  happy: number;
}

export interface QPetHandle {
  tick: (t: number, dt: number, s: QPetState) => void;
}

interface QPetProps {
  spec: QPetSpec;
  targetH: number;
}

/** 骨架尺寸（狗 / 猫两套；单位米，natural = 含耳尖自然站立高度） */
function skeleton(cat: boolean) {
  return cat
    ? {
        bodyR: 0.095, bodyY: 0.125, bodySY: 0.88, bodySZ: 1.1,
        legX: 0.048, legFZ: 0.055, legBZ: -0.05, legR: 0.026, legH: 0.05, pawR: 0.032, pawY: 0.022,
        headY: 0.205, headR: 0.135,
        earX: 0.072, earY: 0.21, earR: 0.047,
        tailY: 0.15, tailZ: -0.07,
        natural: 0.46,
      }
    : {
        bodyR: 0.105, bodyY: 0.14, bodySY: 0.85, bodySZ: 1.12,
        legX: 0.055, legFZ: 0.062, legBZ: -0.055, legR: 0.028, legH: 0.062, pawR: 0.036, pawY: 0.026,
        headY: 0.235, headR: 0.145,
        earX: 0.08, earY: 0.24, earR: 0.05,
        tailY: 0.16, tailZ: -0.08,
        natural: 0.52,
      };
}

const damp = THREE.MathUtils.damp;

const QPet = forwardRef<QPetHandle, QPetProps>(function QPet({ spec, targetH }, ref) {
  const cat = spec.ear === 'round';
  const P = useMemo(() => skeleton(cat), [cat]);

  // —— 材质（按 spec 缓存；组件卸载释放） ——
  const mats = useMemo(() => {
    const std = (color: string, roughness = 0.55) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    return {
      main: std(spec.main),
      belly: std(spec.belly),
      dark: std(spec.dark),
      tan: std(spec.tan),
      blush: std(spec.blush, 0.8),
      inner: std(spec.innerEar, 0.8),
      nose: std(spec.nose, 0.35),
      eye: std('#2b2624', 0.22),
      hi: std('#ffffff', 0.18),
      mouth: std('#7a5a48', 0.7),
    };
  }, [spec]);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
    },
    [mats],
  );

  // —— 蓬尾 / 长尾几何（TubeGeometry；卷尾用 JSX torus） ——
  const tail = useMemo(() => {
    const pivot: [number, number, number] = [0, P.tailY, P.tailZ];
    if (spec.tail === 'up') {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.1, -0.06),
        new THREE.Vector3(0.01, 0.19, -0.05),
      ]);
      return { pivot, tube: new THREE.TubeGeometry(curve, 16, 0.024, 8), tip: [0.01, 0.19, -0.05] as const, tipR: 0.031 };
    }
    if (spec.tail === 'long') {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.045, -0.085),
        new THREE.Vector3(0.025, 0.13, -0.105),
      ]);
      return { pivot, tube: new THREE.TubeGeometry(curve, 16, 0.02, 8), tip: [0.025, 0.13, -0.105] as const, tipR: 0.026 };
    }
    return { pivot, tube: null, tip: null, tipR: 0 };
  }, [spec.tail, P]);
  useEffect(
    () => () => {
      tail.tube?.dispose();
    },
    [tail],
  );

  // —— refs ——
  const root = useRef<THREE.Group>(null);
  const headG = useRef<THREE.Group>(null);
  const tailG = useRef<THREE.Group>(null);
  const legRefs = useRef<(THREE.Group | null)[]>([null, null, null, null]);
  const earRefs = useRef<(THREE.Group | null)[]>([null, null]);
  const eyeL = useRef<THREE.Group>(null);
  const eyeR = useRef<THREE.Group>(null);

  // —— 动画状态 ——
  const w = useRef({ walk: 0, run: 0, eat: 0, nap: 0, happy: 0 });
  const blink = useRef({ next: 2.2, t: 0 });
  const scaleBase = targetH / P.natural;

  useImperativeHandle(ref, () => ({
    tick(t, dt, s) {
      const W = w.current;
      W.walk = damp(W.walk, s.walk, 8, dt);
      W.run = damp(W.run, s.run, 8, dt);
      W.eat = damp(W.eat, s.eat, 6, dt);
      W.nap = damp(W.nap, s.nap, 4, dt);
      W.happy = damp(W.happy, s.happy, 9, dt);
      const g = root.current;
      if (!g) return;

      const move = Math.min(1.35, W.walk + W.run);
      const f = 8 + W.run * 4.5;
      const bounce = Math.abs(Math.sin(t * f));

      // 弹跳 + 左右摇摆 + 跑步前倾 + 开心扭身
      g.position.y = (0.02 * W.walk + 0.045 * W.run + 0.055 * W.happy) * bounce;
      g.rotation.z = (0.05 * W.walk - 0.015 * W.run) * Math.sin(t * f);
      g.rotation.x = 0.07 * W.run;
      g.rotation.y = W.happy * Math.sin(t * 9) * 0.35;

      // squash & stretch：打盹压扁 / 呼吸起伏 / 蹦跳果冻感
      const breathe = (1 - W.nap) * 0.016 * Math.sin(t * 2.4);
      const jelly = W.happy * 0.06 * Math.sin(t * f * 2);
      const sy = 1 - W.nap * 0.26 + breathe + jelly;
      g.scale.set((1 + W.nap * 0.12) * scaleBase, sy * scaleBase, (1 + W.nap * 0.12) * scaleBase);

      // 对角小短腿倒腾
      const amp = 0.55 * move;
      legRefs.current.forEach((lg, i) => {
        if (!lg) return;
        const ph = i === 1 || i === 2 ? Math.PI : 0;
        lg.rotation.x = Math.sin(t * f + ph) * amp;
      });

      // 尾巴摇
      if (tailG.current) {
        const wag = W.nap > 0.5 ? 0.14 : 0.26 + 0.3 * (W.walk + W.run * 0.6 + W.happy);
        tailG.current.rotation.y = Math.sin(t * (2.6 + 8 * move + 10 * W.happy)) * wag;
        tailG.current.rotation.x = -0.18 * move;
      }

      // 头：吃饭点头 / 打盹低头 / 待机歪头 / 开心晃头
      if (headG.current) {
        headG.current.rotation.x =
          0.34 * W.eat + 0.52 * W.nap + Math.sin(t * 7.5) * 0.18 * W.eat;
        headG.current.rotation.z =
          Math.sin(t * 0.55) * 0.03 * (1 - W.nap) + W.happy * Math.sin(t * 9) * 0.12;
        headG.current.position.y = P.headY - 0.045 * W.nap - 0.015 * W.eat;
      }

      // 眨眼（打盹直接闭眼）
      const b = blink.current;
      b.next -= dt;
      if (b.next <= 0) {
        b.t = 0.13;
        b.next = 2.4 + Math.random() * 2.8;
      }
      const closed = b.t > 0 || W.nap > 0.5;
      if (b.t > 0) b.t -= dt;
      const es = closed ? 0.12 : 1;
      eyeL.current?.scale.set(1, es, 1);
      eyeR.current?.scale.set(1, es, 1);

      // 耳朵：走路抖动 / 打盹耷拉
      earRefs.current.forEach((er, i) => {
        if (!er) return;
        const side = i === 0 ? 1 : -1;
        er.rotation.x = Math.sin(t * f + 1.2) * 0.07 * move - 0.28 * W.nap;
        er.rotation.z = side * 0.28 * W.nap;
      });
    },
  }));

  const headR = P.headR;

  return (
    <group ref={root} scale={scaleBase}>
      {/* —— 身体 —— */}
      <mesh position={[0, P.bodyY, 0]} scale={[1, P.bodySY, P.bodySZ]} castShadow>
        <sphereGeometry args={[P.bodyR, 24, 20]} />
        <primitive object={mats.main} attach="material" />
      </mesh>
      {/* 奶白肚皮 */}
      <mesh position={[0, P.bodyY - 0.012, P.bodyR * 0.52]} scale={[1, 0.9, 0.68]} castShadow>
        <sphereGeometry args={[P.bodyR * 0.74, 20, 16]} />
        <primitive object={mats.belly} attach="material" />
      </mesh>
      {/* 奶牛 / 三花 背部色斑 */}
      {(spec.patch === 'tux' || spec.patch === 'calico') && (
        <mesh position={[0, P.bodyY + P.bodyR * 0.42, -P.bodyR * 0.42]} scale={[1.1, 0.72, 0.75]} castShadow>
          <sphereGeometry args={[P.bodyR * 0.9, 20, 16]} />
          <primitive object={mats.dark} attach="material" />
        </mesh>
      )}

      {/* —— 四条小短腿（对角交替摆动） —— */}
      {([[P.legX, P.legFZ], [-P.legX, P.legFZ], [P.legX, P.legBZ], [-P.legX, P.legBZ]] as const).map(
        ([x, z], i) => (
          <group
            key={i}
            ref={(el) => {
              legRefs.current[i] = el;
            }}
            position={[x, 0, z]}
          >
            <mesh position={[0, P.legH * 0.72, 0]} castShadow>
              <cylinderGeometry args={[P.legR, P.legR * 1.12, P.legH, 12]} />
              <primitive object={mats.main} attach="material" />
            </mesh>
            {/* 小爪（奶白，微前伸） */}
            <mesh position={[0, P.pawY, 0.008]} scale={[1, 0.7, 1.2]} castShadow>
              <sphereGeometry args={[P.pawR, 14, 12]} />
              <primitive object={mats.belly} attach="material" />
            </mesh>
          </group>
        ),
      )}

      {/* —— 尾巴（pivot 在尾根，rotation.y 摇尾） —— */}
      <group
        ref={tailG}
        position={tail.pivot}
      >
        {spec.tail === 'curl' ? (
          // 柴犬卷尾：竖立圆环微后倾
          <mesh position={[0, 0.032, 0.005]} rotation={[-0.3, Math.PI / 2, 0.35]} castShadow>
            <torusGeometry args={[0.046, 0.023, 10, 24, 4.1]} />
            <primitive object={mats.main} attach="material" />
          </mesh>
        ) : (
          <>
            {/* 蓬尾 / 长尾：曲线管 + 奶白尾尖 */}
            {tail.tube && (
              <mesh geometry={tail.tube} castShadow>
                <primitive object={mats.main} attach="material" />
              </mesh>
            )}
            {tail.tip && (
              <mesh position={tail.tip as unknown as [number, number, number]} castShadow>
                <sphereGeometry args={[tail.tipR, 14, 12]} />
                <primitive object={mats.belly} attach="material" />
              </mesh>
            )}
          </>
        )}
      </group>

      {/* —— 大头（pivot 在颈部） —— */}
      <group ref={headG} position={[0, P.headY, 0.012]}>
        {/* 头球 */}
        <mesh position={[0, headR * 0.79, 0.005]} scale={[1, 0.92, 0.96]} castShadow>
          <sphereGeometry args={[headR, 28, 24]} />
          <primitive object={mats.main} attach="material" />
        </mesh>
        {/* 口鼻 */}
        <mesh position={[0, headR * 0.55, headR * 0.83]} scale={[1.2, 0.75, 0.85]} castShadow>
          <sphereGeometry args={[headR * 0.43, 18, 14]} />
          <primitive object={mats.belly} attach="material" />
        </mesh>
        {/* 鼻头 */}
        <mesh position={[0, headR * 0.76, headR * 1.19]} scale={[1.25, 0.85, 0.8]}>
          <sphereGeometry args={[headR * 0.115, 12, 10]} />
          <primitive object={mats.nose} attach="material" />
        </mesh>
        {/* ω 嘴（两段下半弧） */}
        {([-1, 1] as const).map((sx) => (
          <mesh key={sx} position={[sx * headR * 0.085, headR * 0.5, headR * 1.13]} rotation={[0.1, 0, Math.PI]}>
            <torusGeometry args={[headR * 0.1, 0.0032, 6, 12, Math.PI]} />
            <primitive object={mats.mouth} attach="material" />
          </mesh>
        ))}

        {/* 大黑豆眼 + 双高光（group scaleY = 眨眼） */}
        {([-1, 1] as const).map((sx) => (
          <group
            key={sx}
            ref={sx < 0 ? eyeL : eyeR}
            position={[sx * headR * 0.42, headR * 1.06, headR * 0.8]}
          >
            <mesh scale={[0.92, 1, 0.55]}>
              <sphereGeometry args={[headR * 0.23, 16, 14]} />
              <primitive object={mats.eye} attach="material" />
            </mesh>
            <mesh position={[headR * 0.075, headR * 0.082, headR * 0.1]}>
              <sphereGeometry args={[headR * 0.077, 10, 8]} />
              <primitive object={mats.hi} attach="material" />
            </mesh>
            <mesh position={[-headR * 0.05, -headR * 0.05, headR * 0.11]}>
              <sphereGeometry args={[headR * 0.035, 8, 8]} />
              <primitive object={mats.hi} attach="material" />
            </mesh>
          </group>
        ))}

        {/* 腮红 */}
        {([-1, 1] as const).map((sx) => (
          <mesh
            key={sx}
            position={[sx * headR * 0.72, headR * 0.54, headR * 0.66]}
            rotation={[0, sx * 0.66, 0]}
            scale={[1, 0.6, 0.3]}
          >
            <sphereGeometry args={[headR * 0.19, 14, 12]} />
            <primitive object={mats.blush} attach="material" />
          </mesh>
        ))}

        {/* 耳朵（立耳 / 圆耳；group 转角 = 抖动 + 打盹耷拉） */}
        {([-1, 1] as const).map((sx, i) => (
          <group
            key={sx}
            ref={(el) => {
              earRefs.current[i] = el;
            }}
            position={[sx * P.earX, P.earY, 0]}
            rotation={[-0.05, 0, sx * (cat ? -0.12 : -0.17)]}
          >
            {cat ? (
              <>
                <mesh scale={[1, 1.08, 0.5]} castShadow>
                  <sphereGeometry args={[P.earR, 14, 12]} />
                  <primitive object={mats.main} attach="material" />
                </mesh>
                <mesh position={[0, 0, P.earR * 0.32]} scale={[1, 1.05, 0.32]}>
                  <sphereGeometry args={[P.earR * 0.55, 12, 10]} />
                  <primitive object={mats.inner} attach="material" />
                </mesh>
              </>
            ) : (
              <>
                <mesh position={[0, P.earR * 0.85, 0]} rotation={[0, 0, sx * -0.06]} castShadow>
                  <coneGeometry args={[P.earR, P.earR * 1.7, 14]} />
                  <primitive object={mats.main} attach="material" />
                </mesh>
                <mesh position={[0, P.earR * 0.78, P.earR * 0.34]} rotation={[0, 0, sx * -0.06]}>
                  <coneGeometry args={[P.earR * 0.55, P.earR * 1.05, 12]} />
                  <primitive object={mats.inner} attach="material" />
                </mesh>
              </>
            )}
          </group>
        ))}

        {/* —— 头部斑块 —— */}
        {spec.patch === 'brows' && (
          <>
            {/* 焦糖橘眉点 ×2 */}
            {([-1, 1] as const).map((sx) => (
              <mesh
                key={`b${sx}`}
                position={[sx * headR * 0.34, headR * 1.44, headR * 0.68]}
                rotation={[0, sx * 0.34, 0]}
                scale={[1, 0.85, 0.42]}
              >
                <sphereGeometry args={[headR * 0.14, 12, 10]} />
                <primitive object={mats.tan} attach="material" />
              </mesh>
            ))}
            {/* 脸颊橘斑 ×2 */}
            {([-1, 1] as const).map((sx) => (
              <mesh
                key={`c${sx}`}
                position={[sx * headR * 0.66, headR * 0.74, headR * 0.62]}
                rotation={[0, sx * 0.72, 0]}
                scale={[1, 0.9, 0.4]}
              >
                <sphereGeometry args={[headR * 0.2, 14, 12]} />
                <primitive object={mats.tan} attach="material" />
              </mesh>
            ))}
          </>
        )}
        {spec.patch === 'cap' && (
          // 头顶灰帽（哈士奇）
          <mesh position={[0, headR * 1.18, -headR * 0.12]} scale={[1.12, 0.62, 1.05]} castShadow>
            <sphereGeometry args={[headR * 0.7, 20, 16]} />
            <primitive object={mats.dark} attach="material" />
          </mesh>
        )}
        {spec.patch === 'calico' && (
          <>
            {/* 橘斑（左） */}
            <mesh position={[-headR * 0.58, headR * 1.06, headR * 0.44]} rotation={[0, -0.5, 0]} scale={[0.95, 0.85, 0.5]} castShadow>
              <sphereGeometry args={[headR * 0.42, 16, 14]} />
              <primitive object={mats.tan} attach="material" />
            </mesh>
            {/* 黑斑（右，盖住耳朵根部） */}
            <mesh position={[headR * 0.6, headR * 0.98, headR * 0.36]} rotation={[0, 0.62, 0]} scale={[0.95, 0.85, 0.5]} castShadow>
              <sphereGeometry args={[headR * 0.4, 16, 14]} />
              <primitive object={mats.dark} attach="material" />
            </mesh>
          </>
        )}
        {spec.patch === 'tux' && (
          // 奶牛黑斑（右眼上方一块）
          <mesh position={[headR * 0.52, headR * 1.1, headR * 0.42]} rotation={[0, 0.55, 0]} scale={[0.95, 0.85, 0.5]} castShadow>
            <sphereGeometry args={[headR * 0.46, 16, 14]} />
            <primitive object={mats.dark} attach="material" />
          </mesh>
        )}
        {spec.patch === 'tabby' &&
          // 虎斑：额头三道竖纹
          (
            ([[0, headR * 1.56, headR * 0.74], [headR * 0.24, headR * 1.5, headR * 0.68], [-headR * 0.24, headR * 1.5, headR * 0.68]] as const).map(
              (pos, i) => (
                <mesh key={i} position={pos as unknown as [number, number, number]} rotation={[0, (i - 1) * 0.3, 0]} scale={[0.45, 2.3, 0.32]}>
                  <sphereGeometry args={[headR * 0.075, 10, 8]} />
                  <primitive object={mats.dark} attach="material" />
                </mesh>
              ),
            )
          )}
      </group>
    </group>
  );
});

export default QPet;

'use client';

/* 临时验证页：Q版小人 GLB 加载 + 动画切换预览（验证后删除） */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

function Model({ file, clipName }: { file: string; clipName: string | null }) {
  const gltf = useGLTF(`/couple-home/${file}.glb`);
  const ref = useRef<THREE.Group>(null);
  const inst = useMemo(() => {
    const c = skeletonClone(gltf.scene) as THREE.Group;
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
    });
    c.rotation.y = Math.PI;
    return c;
  }, [gltf]);

  useEffect(() => {
    const bbox = new THREE.Box3().setFromObject(inst);
    const H = Math.max(bbox.max.y - bbox.min.y, 0.1);
    inst.position.y = -bbox.min.y;
    const target = 1.0;
    ref.current?.scale.setScalar(target / H);
  }, [inst]);

  useEffect(() => {
    if (!clipName) return;
    const clip = gltf.animations.find((c) => c.name.toLowerCase() === clipName.toLowerCase());
    if (!clip) return;
    const mixer = new THREE.AnimationMixer(inst);
    const action = mixer.clipAction(clip);
    action.reset().play();
    let raf = 0;
    const clock = new THREE.Clock();
    const tick = () => { mixer.update(clock.getDelta()); raf = requestAnimationFrame(tick); };
    tick();
    return () => { cancelAnimationFrame(raf); mixer.stopAllAction(); };
  }, [inst, clipName, gltf]);

  return (
    <group ref={ref}>
      <primitive object={inst} />
    </group>
  );
}

const CLIPS_NAN = ['Idle', 'Walk', 'Sit', 'Jump', 'Victory', 'Alert', 'Dash'];
const CLIPS_NV = ['Idle', 'Walk', 'Run', 'Sit', 'Cutepose', 'Bye', 'Cry', 'Rei'];

export default function TestChibiPage() {
  const [clipNan, setClipNan] = useState<string | null>('Idle');
  const [clipNv, setClipNv] = useState<string | null>('Idle');
  const [info, setInfo] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/couple-home/chibi-nan.glb').then((r) => r.arrayBuffer()),
      fetch('/couple-home/chibi-nv.glb').then((r) => r.arrayBuffer()),
    ]).then(([a, b]) => {
      setInfo(`nan ${(a.byteLength / 1024 / 1024).toFixed(1)}MB, nv ${(b.byteLength / 1024 / 1024).toFixed(1)}MB`);
    }).catch((e) => setInfo('fetch err: ' + e.message));
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-lg font-bold">Q版小人预览 {info}</h1>
      <div className="flex gap-2 text-xs">
        <div>
          <div className="font-bold">男主 (M02)</div>
          {CLIPS_NAN.map((c) => (
            <button key={c} className={`m-0.5 rounded border px-2 py-1 ${clipNan === c ? 'bg-black text-white' : ''}`} onClick={() => setClipNan(c)}>{c}</button>
          ))}
        </div>
        <div>
          <div className="font-bold">女主 (Kazuko)</div>
          {CLIPS_NV.map((c) => (
            <button key={c} className={`m-0.5 rounded border px-2 py-1 ${clipNv === c ? 'bg-black text-white' : ''}`} onClick={() => setClipNv(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className="h-[500px] w-full">
        <Canvas shadows camera={{ position: [0, 1.1, 4.6], fov: 40 }}>
          <color attach="background" args={['#f3ede4']} />
          <ambientLight intensity={0.75} />
          <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow />
          <Suspense fallback={null}>
            <group position={[-0.85, 0, 0]}>
              <Model file="chibi-nan" clipName={clipNan} />
            </group>
            <group position={[0.85, 0, 0]}>
              <Model file="chibi-nv" clipName={clipNv} />
            </group>
            <mesh rotation-x={-Math.PI / 2} receiveShadow>
              <planeGeometry args={[20, 20]} />
              <meshStandardMaterial color="#e8e0d2" />
            </mesh>
          </Suspense>
          <OrbitControls target={[0, 0.5, 0]} />
        </Canvas>
      </div>
    </div>
  );
}

useGLTF.preload('/couple-home/chibi-nan.glb');
useGLTF.preload('/couple-home/chibi-nv.glb');

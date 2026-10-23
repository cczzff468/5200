'use client';

import { useRef, useState } from 'react';
import PhoneShell from '@/components/ios/PhoneShell';

interface UploadState {
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

function fmtSize(bytes: number) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

export default function Home() {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startUpload = async (files: File[]) => {
    const states: UploadState[] = files.map((f) => ({
      name: f.name,
      size: f.size,
      progress: 0,
      status: 'pending',
    }));
    setUploads((prev) => [...prev, ...states]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const idx = uploads.length + i;
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        const fd = new FormData();
        fd.append('file', file);
        xhr.open('POST', '/api/upload-glb');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploads((prev) =>
              prev.map((u, j) =>
                j === idx ? { ...u, progress: pct, status: 'uploading' } : u
              )
            );
          }
        };
        xhr.onload = () => {
          const ok = xhr.status >= 200 && xhr.status < 300;
          setUploads((prev) =>
            prev.map((u, j) =>
              j === idx
                ? {
                    ...u,
                    progress: 100,
                    status: ok ? 'done' : 'error',
                    error: ok ? undefined : `HTTP ${xhr.status}`,
                  }
                : u
            )
          );
          resolve();
        };
        xhr.onerror = () => {
          setUploads((prev) =>
            prev.map((u, j) => (j === idx ? { ...u, status: 'error', error: '网络错误' } : u))
          );
          resolve();
        };
        xhr.send(fd);
      });
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) startUpload(files);
    e.target.value = '';
  };

  return (
    <>
      {/* TEMP: GLB upload overlay — REMOVE after user uploads model */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          padding: 24,
          overflowY: 'auto',
        }}
      >
        <div style={{ fontSize: 40 }}>📦</div>
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>模型文件上传通道</div>
        <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 1.7, maxWidth: 460 }}>
          把您做好的 <b style={{ color: '#fbbf24' }}>GLB 模型文件</b>（70多MB那个）传到这里，
          文件会直接送达开发者工作台，无需网盘 / GitHub / 聊天上传。
          <br />
          支持 .glb / .fbx / .zip，可一次多选。
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length) startUpload(files);
          }}
          style={{
            marginTop: 8,
            width: '100%',
            maxWidth: 480,
            minHeight: 150,
            border: `2px dashed ${dragOver ? '#fbbf24' : '#475569'}`,
            borderRadius: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
            background: dragOver ? 'rgba(251,191,36,0.08)' : 'rgba(15,23,42,0.6)',
            transition: 'all .2s',
          }}
        >
          <span style={{ fontSize: 34 }}>⬆️</span>
          <span style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 600 }}>
            点击选择文件（或拖拽到此处）
          </span>
          <span style={{ color: '#64748b', fontSize: 12 }}>
            建议连 Wi-Fi 上传，大文件约需几十秒
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".glb,.fbx,.zip,.gltf"
            multiple
            onChange={onPick}
            style={{ display: 'none' }}
          />
        </label>

        <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {uploads.map((u, i) => (
            <div
              key={i}
              style={{
                background: 'rgba(30,41,59,0.8)',
                border: '1px solid #334155',
                borderRadius: 12,
                padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span
                  style={{
                    color: '#e2e8f0',
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {u.name}
                </span>
                <span style={{ color: '#64748b', fontSize: 12, flexShrink: 0 }}>{fmtSize(u.size)}</span>
              </div>
              <div style={{ marginTop: 8, height: 8, background: '#1e293b', borderRadius: 99, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${u.progress}%`,
                    height: '100%',
                    borderRadius: 99,
                    transition: 'width .2s',
                    background:
                      u.status === 'error'
                        ? '#ef4444'
                        : u.status === 'done'
                          ? '#22c55e'
                          : 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                  }}
                />
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: u.status === 'done' ? '#22c55e' : u.status === 'error' ? '#ef4444' : '#94a3b8' }}>
                {u.status === 'done'
                  ? '✅ 上传成功！文件已送达，回聊天里告诉我'
                  : u.status === 'error'
                    ? `❌ 失败：${u.error || '未知错误'}，请重试`
                    : u.status === 'uploading'
                      ? `上传中 ${u.progress}%`
                      : '等待上传…'}
              </div>
            </div>
          ))}
        </div>

        <div style={{ color: '#475569', fontSize: 12, marginTop: 10 }}>
          （此上传通道为临时页面，模型到手后会移除并恢复原界面）
        </div>
      </div>

      <PhoneShell />
    </>
  );
}

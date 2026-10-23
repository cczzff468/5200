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

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB 分片，绕过网关大请求限制

function fmtSize(bytes: number) {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

export default function Home() {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (idx: number, p: Partial<UploadState>) =>
    setUploads((prev) => prev.map((u, j) => (j === idx ? { ...u, ...p } : u)));

  const postForm = (
    fd: FormData,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<number> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload-glb');
      xhr.timeout = 120000;
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total);
        };
      }
      xhr.onload = () => resolve(xhr.status);
      xhr.onerror = () => reject(new Error('network'));
      xhr.ontimeout = () => reject(new Error('timeout'));
      xhr.send(fd);
    });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const uploadOne = async (file: File, idx: number) => {
    const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    let loadedBase = 0; // 已完成分片的字节数

    for (let seq = 0; seq < totalChunks; seq++) {
      const start = seq * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);

      let ok = false;
      let lastErr = '';
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const fd = new FormData();
          fd.append('uploadId', uploadId);
          fd.append('seq', String(seq));
          fd.append('chunk', blob, 'chunk');
          const status = await postForm(fd, (loaded, total) => {
            const pct = Math.min(
              99,
              Math.round(((loadedBase + loaded) / file.size) * 100)
            );
            patch(idx, { progress: pct, status: 'uploading' });
          });
          ok = status >= 200 && status < 300;
          if (!ok) lastErr = `HTTP ${status}`;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : '网络错误';
        }
        if (!ok) await sleep(600 * (attempt + 1));
      }
      if (!ok) throw new Error(`分片 ${seq + 1}/${totalChunks} 失败（${lastErr}）`);
      loadedBase = end;
      patch(idx, {
        progress: Math.min(99, Math.round((loadedBase / file.size) * 100)),
        status: 'uploading',
      });
    }

    // 通知服务器合并分片
    const fd = new FormData();
    fd.append('finish', '1');
    fd.append('uploadId', uploadId);
    fd.append('name', file.name);
    fd.append('total', String(totalChunks));
    const status = await postForm(fd);
    if (!(status >= 200 && status < 300)) {
      throw new Error(`合并失败 HTTP ${status}`);
    }
  };

  const startUpload = async (files: File[]) => {
    const base = uploads.length;
    setUploads((prev) => [
      ...prev,
      ...files.map((f) => ({
        name: f.name,
        size: f.size,
        progress: 0,
        status: 'pending' as const,
      })),
    ]);

    for (let i = 0; i < files.length; i++) {
      const idx = base + i;
      patch(idx, { status: 'uploading', progress: 0 });
      try {
        await uploadOne(files[i], idx);
        patch(idx, { status: 'done', progress: 100 });
      } catch (e) {
        patch(idx, { status: 'error', error: e instanceof Error ? e.message : '未知错误' });
      }
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
          <br />
          <span style={{ color: '#22c55e' }}>已升级为分片上传（2MB/片 + 断点自动重试），手机流量也能传。</span>
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

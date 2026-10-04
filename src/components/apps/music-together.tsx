'use client';

/**
 * 音乐 App「一起听」聊天视图：消息流（文字 + 推荐歌曲卡）+ 输入区 + 推荐按钮。
 * AI 回复/主动评论/记忆写入逻辑在 music-ai.ts；此组件纯视图 + 调用入口。
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Music4, SendHorizonal } from 'lucide-react';
import { useMusic } from '@/lib/ios/music-store';
import { sendTogetherText, togetherRecommend } from '@/lib/ios/music-ai';
import { CoverImg } from './music-shared';

export function TogetherChat() {
  const msgs = useMusic((s) => s.togetherMsgs);
  const together = useMusic((s) => s.together);
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const toggle = useMusic((s) => s.toggle);
  const playSong = useMusic((s) => s.playSong);
  const openPlayer = useMusic((s) => s.openPlayer);
  const [text, setText] = useState('');
  const [recBusy, setRecBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const cid = together?.contactId ?? '';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.length]);

  const send = () => {
    if (!text.trim() || !cid) return;
    sendTogetherText(text.trim());
    setText('');
  };

  const askRecommend = () => {
    if (!cid || recBusy) return;
    setRecBusy(true);
    void togetherRecommend(cid, '给我推荐几首歌吧').finally(() => setRecBusy(false));
  };

  if (!together) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-white/50">
        一起听已结束
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col" data-testid="music-tg-chat">
      {/* 正在听条 */}
      {current && (
        <button
          type="button"
          onClick={openPlayer}
          className="mx-4 mb-1 flex shrink-0 items-center gap-2.5 rounded-full bg-white/10 py-1.5 pl-1.5 pr-3 text-left active:scale-[0.99]"
          data-testid="music-tg-nowplaying"
        >
          <CoverImg src={current.album?.picUrl} className="h-8 w-8" rounded="rounded-full" alt={current.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] text-white/90">
              {current.name} <span className="text-white/40">- {current.artists?.[0]?.name ?? ''}</span>
            </span>
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                toggle();
              }
            }}
            className="shrink-0 text-[11px] text-white/60"
          >
            {playing ? '暂停' : '继续'}
          </span>
        </button>
      )}

      {/* 消息流 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-2" data-testid="music-tg-msgs">
        {msgs.length === 0 && (
          <p className="pt-6 text-center text-[12px] leading-relaxed text-white/40">
            {together.name} 接受了邀请，正在和你一起听歌
            <br />
            聊聊这首歌的感受吧
          </p>
        )}
        {msgs.map((m) => {
          const mine = m.role === 'me';
          return (
            <div key={m.id} className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              {mine ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] text-white/70">
                  我
                </span>
              ) : (
                <CoverImg src={together.avatar} className="h-8 w-8 shrink-0" rounded="rounded-full" alt={together.name} />
              )}
              <div className={`max-w-[72%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                {m.role === 'recs' && m.songs ? (
                  <div className="w-[240px] rounded-2xl rounded-bl-md bg-white/12 p-2.5">
                    <p className="px-0.5 pb-1.5 text-[12px] text-white/85">{m.text}</p>
                    <div className="space-y-1.5">
                      {m.songs.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            void playSong(
                              { id: s.id, name: s.name, fee: 0, artists: [{ id: 0, name: s.artist }], album: { id: 0, name: '', picUrl: s.picUrl } },
                              undefined,
                            )
                          }
                          data-testid={`music-tg-rec-${s.id}`}
                          className="flex w-full items-center gap-2 rounded-xl bg-white/8 p-1.5 text-left active:bg-white/15"
                        >
                          <CoverImg src={s.picUrl} className="h-9 w-9" rounded="rounded-md" alt={s.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] text-white/95">{s.name}</span>
                            <span className="block truncate text-[10px] text-white/45">{s.artist}</span>
                          </span>
                          <Music4 className="h-4 w-4 shrink-0 text-white/50" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p
                    className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                      mine
                        ? 'rounded-br-md bg-[#EC4141] text-white'
                        : 'rounded-bl-md bg-white/12 text-white/95'
                    } ${m.error ? 'opacity-60' : ''}`}
                  >
                    {m.text}
                  </p>
                )}
                <span className="mt-0.5 px-1 text-[9px] text-white/30">
                  {new Date(m.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-6 pt-1">
        <button
          type="button"
          onClick={askRecommend}
          disabled={recBusy}
          data-testid="music-tg-recommend"
          aria-label="让 TA 推荐歌曲"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 disabled:opacity-50 active:scale-95"
        >
          {recBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music4 className="h-4 w-4" />}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={`和 ${together.name} 聊聊…`}
          data-testid="music-tg-input"
          className="h-9 min-w-0 flex-1 rounded-full bg-white/12 px-4 text-[13px] text-white outline-none placeholder:text-white/35"
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim()}
          data-testid="music-tg-send"
          aria-label="发送"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EC4141] text-white disabled:opacity-40 active:scale-95"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ContactRecord } from '@/lib/contacts';

/**
 * 本地优先架构：所有用户数据(照片/录音/音乐/备忘/日程/聊天/联系人/设置)均存于浏览器 IndexedDB。
 * 关闭浏览器、重启设备后数据不丢失；服务端不再存任何用户数据。
 */

// ---------------- 记录类型 ----------------

export interface PhotoRecord {
  id: string;
  blob: Blob;
  name: string;
  createdAt: number;
}

export interface RecordingRecord {
  id: string;
  blob: Blob;
  name: string;
  /** 秒 */
  duration: number;
  createdAt: number;
}

export interface MusicRecord {
  id: string;
  blob: Blob;
  /** 原始文件名 */
  name: string;
  title: string;
  artist: string;
  album: string;
  /** 专辑封面图片 Blob（可为 null） */
  cover: Blob | null;
  /** 秒 */
  duration: number;
  createdAt: number;
}

export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  /** 置顶（金色版备忘录新增可选字段，IndexedDB 无需升版本） */
  pinned?: boolean;
  /** 分类：''=无分类 */
  category?: '' | 'personal' | 'work';
}

export interface CalendarEventRecord {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm，空字符串表示全天 */
  startTime: string;
  /** HH:mm */
  endTime: string;
  note: string;
  createdAt: number;
}

export interface ChatSessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 是否置顶（可选字段，旧数据无此字段视为未置顶） */
  pinned?: boolean;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface AlarmRecord {
  id: string;
  /** HH:mm 24小时制 */
  time: string;
  label: string;
  enabled: boolean;
  /** 重复的星期，0=周日；空数组表示仅一次 */
  repeat: number[];
  createdAt: number;
}

export interface WorldCityRecord {
  id: string;
  name: string;
  /** IANA 时区名，如 Asia/Shanghai */
  timezone: string;
}

export interface ReminderRecord {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
  flagged: boolean;
  /** YYYY-MM-DD，空字符串表示无日期 */
  dueDate: string;
  /** HH:mm，空字符串表示无时间 */
  dueTime: string;
  createdAt: number;
  completedAt: number | null;
}

export interface CallLogRecord {
  id: string;
  /** 对端号码（未知号码展示用） */
  number: string;
  /** 对端联系人 id（联系人删除后日志仍保留，头像/名字用快照） */
  contactId: string | null;
  /** 对端名字快照（联系人在时实时取，不在时用快照） */
  displayName: string;
  /** 对端类型：'char' | 'npc' | 'user' | 'unknown' */
  peerKind: 'char' | 'npc' | 'user' | 'unknown';
  /** 对端头像快照（data URL，可空） */
  avatar: string | null;
  /** 'out' 去电 | 'in' 来电 | 'missed' 未接 */
  direction: 'out' | 'in' | 'missed';
  /** 通话秒数（未接通为 0） */
  duration: number;
  createdAt: number;
}

/** 语音留言记录：呼叫未接通（拨号中挂断）时对端"转接语音信箱"自动生成，text 供 TTS 播报 */
export interface VoicemailRecord {
  id: string;
  /** 对端号码 */
  number: string;
  /** 对端联系人 id（联系人在时可实时取头像/名字） */
  contactId: string | null;
  /** 对端名字快照 */
  displayName: string;
  /** 对端类型：'char' | 'npc' | 'user' | 'unknown' */
  peerKind: 'char' | 'npc' | 'user' | 'unknown';
  /** 对端头像快照（data URL，可空） */
  avatar: string | null;
  /** 留言内容（TTS 播报文本）；kind='call' 时为整通电话的对话内容（我：…／对方：…），永久保存 */
  text: string;
  /** 记录来源：'voicemail'=对方未接听的语音留言（默认）；'call'=已接通电话的对话内容存档 */
  kind?: 'voicemail' | 'call';
  /** 预估时长（秒，按文本长度估算）；kind='call' 时为实际通话时长 */
  duration: number;
  /** 是否已读（播放过即已读） */
  read: boolean;
  createdAt: number;
}

export interface AppSettingRecord {
  key: string;
  value: unknown;
}

/** 通用 KV 记录（从 localStorage 迁移的中大容量模块用；key = 原 localStorage 键名） */
export interface KvRecord {
  key: string;
  value: unknown;
}

/** 联系人记录：CHAR（AI 角色）/ USER（我自己）/ NPC（配角），四 App 共享（存本地 IndexedDB） */
export type { ContactRecord };

// ---------------- Schema ----------------

interface IOSDB extends DBSchema {
  photos: { key: string; value: PhotoRecord; indexes: { createdAt: number } };
  recordings: { key: string; value: RecordingRecord; indexes: { createdAt: number } };
  music: { key: string; value: MusicRecord; indexes: { createdAt: number } };
  notes: { key: string; value: NoteRecord; indexes: { updatedAt: number } };
  events: { key: string; value: CalendarEventRecord; indexes: { date: string } };
  'chat-sessions': { key: string; value: ChatSessionRecord; indexes: { updatedAt: number } };
  'chat-messages': { key: string; value: ChatMessageRecord; indexes: { sessionId: string } };
  alarms: { key: string; value: AlarmRecord };
  cities: { key: string; value: WorldCityRecord };
  reminders: { key: string; value: ReminderRecord };
  'call-logs': { key: string; value: CallLogRecord; indexes: { createdAt: number } };
  voicemails: { key: string; value: VoicemailRecord; indexes: { createdAt: number } };
  contacts: { key: string; value: ContactRecord };
  settings: { key: string; value: AppSettingRecord };
  kv: { key: string; value: KvRecord };
}

export type IOSStoreName =
  | 'photos'
  | 'recordings'
  | 'music'
  | 'notes'
  | 'events'
  | 'chat-sessions'
  | 'chat-messages'
  | 'alarms'
  | 'cities'
  | 'reminders'
  | 'call-logs'
  | 'voicemails'
  | 'contacts'
  | 'settings'
  | 'kv';

const DB_NAME = 'ios-phone-db';
const DB_VERSION = 6;

let dbPromise: Promise<IDBPDatabase<IOSDB>> | null = null;

function getDB(): Promise<IDBPDatabase<IOSDB>> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB 仅在浏览器环境可用'));
  }
  if (!dbPromise) {
    dbPromise = openDB<IOSDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('createdAt', 'createdAt');
        const recordings = db.createObjectStore('recordings', { keyPath: 'id' });
        recordings.createIndex('createdAt', 'createdAt');
        const music = db.createObjectStore('music', { keyPath: 'id' });
        music.createIndex('createdAt', 'createdAt');
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('updatedAt', 'updatedAt');
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('date', 'date');
        const sessions = db.createObjectStore('chat-sessions', { keyPath: 'id' });
        sessions.createIndex('updatedAt', 'updatedAt');
        const messages = db.createObjectStore('chat-messages', { keyPath: 'id' });
        messages.createIndex('sessionId', 'sessionId');
        db.createObjectStore('alarms', { keyPath: 'id' });
        db.createObjectStore('cities', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (oldVersion < 2 && !db.objectStoreNames.contains('reminders')) {
          db.createObjectStore('reminders', { keyPath: 'id' });
        }
        if (oldVersion < 3 && !db.objectStoreNames.contains('call-logs')) {
          const callLogs = db.createObjectStore('call-logs', { keyPath: 'id' });
          callLogs.createIndex('createdAt', 'createdAt');
        }
        if (oldVersion < 4 && !db.objectStoreNames.contains('voicemails')) {
          const voicemails = db.createObjectStore('voicemails', { keyPath: 'id' });
          voicemails.createIndex('createdAt', 'createdAt');
        }
        if (oldVersion < 5 && !db.objectStoreNames.contains('contacts')) {
          // 联系人本地化（原服务端 SQLite → IndexedDB）：首次升版后由 migrateFromServer() 灌入旧数据
          db.createObjectStore('contacts', { keyPath: 'id' });
        }
        if (oldVersion < 6 && !db.objectStoreNames.contains('kv')) {
          // localStorage → IndexedDB 迁移目标（聊天消息/记忆/表情包/钱包等中大容量模块）
          db.createObjectStore('kv', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

// ---------------- 通用 CRUD ----------------

export const localDB = {
  async getAll<K extends IOSStoreName>(store: K): Promise<IOSDB[K]['value'][]> {
    const db = await getDB();
    return db.getAll(store);
  },

  async get<K extends IOSStoreName>(store: K, key: string): Promise<IOSDB[K]['value'] | undefined> {
    const db = await getDB();
    return db.get(store, key);
  },

  async put<K extends IOSStoreName>(store: K, value: IOSDB[K]['value']): Promise<void> {
    const db = await getDB();
    await db.put(store, value);
  },

  async delete<K extends IOSStoreName>(store: K, key: string): Promise<void> {
    const db = await getDB();
    await db.delete(store, key);
  },

  async clear<K extends IOSStoreName>(store: K): Promise<void> {
    const db = await getDB();
    await db.clear(store);
  },

  async count<K extends IOSStoreName>(store: K): Promise<number> {
    const db = await getDB();
    return db.count(store);
  },
};

// ---------------- 工具 ----------------

export function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** 秒 → "3:25" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

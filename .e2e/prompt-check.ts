/** 直测提示词函数的真实输出（不经过浏览器）：普通成员无权限段 / 管理员任命权说明 / 群主转让段 */
import { buildGroupAdminRules } from '../src/lib/ios/group-admin';
import { buildGroupInviteRules } from '../src/lib/ios/group-social';
import type { ChatGroup } from '../src/lib/ios/groups';
import type { ContactRecord } from '../src/lib/contacts';

const g = {
  id: 'g1', app: 'wx' as const, name: '测试群', remark: '', avatar: null,
  ownerId: 'c-liulian', memberIds: ['c-liulian', 'c-honghong'], adminIds: ['c-honghong'],
  mutes: { 'c-honghong': Date.now() + 600000 }, announcement: '', memoryInterop: false, createdAt: 0,
} as ChatGroup;
const char = { id: 'c-honghong' } as ContactRecord;
const liulian = { id: 'c-liulian' } as ContactRecord;
const nameOf = (id: string) => (id === 'c-liulian' ? '榴莲' : id === 'c-honghong' ? '红红' : '凡凡');

console.log('=== 普通成员 AI（榴莲降级后）的管理规则段 ===');
const g2 = { ...g, ownerId: 'c-honghong', adminIds: ['c-honghong'] } as ChatGroup;
for (const line of buildGroupAdminRules(g2, 'c-liulian', nameOf)) console.log(line, '\n');

console.log('=== 群主 AI（红红）的邀请/任命/转让段 ===');
const hong = { id: 'c-honghong', kind: 'npc', name: '红红' } as ContactRecord;
console.log(buildGroupInviteRules(g2, hong, 'wx', [liulian, char]), '\n');

console.log('=== 管理员 AI（榴莲）的任命权说明 ===');
const g3 = { ...g, ownerId: 'user-fanfan', adminIds: ['c-liulian'] } as ChatGroup;
const liu2 = { id: 'c-liulian', kind: 'char', name: '榴莲' } as ContactRecord;
console.log(buildGroupInviteRules(g3, liu2, 'wx', [liu2, char]));
console.log('\n=== 群主 AI（红红）的管理规则（含执行铁律） ===');
for (const line of buildGroupAdminRules(g2, 'c-honghong', nameOf)) console.log(line, '\n');

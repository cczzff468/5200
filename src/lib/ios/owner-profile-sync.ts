/**
 * 机主身份双向同步（联系人 ↔ 设置›个人信息）——「编辑了自己以后全 App 按最新的来」：
 *
 * 此前两条身份线完全独立、互不同步：
 * - 联系人 App 里的机主 USER 联系人（kind='user' 且非小号档案）——微信/QQ「我」、
 *   通话界面、AI 人设/记忆称谓的消费源；
 * - 设置 › 个人信息（useSettings.profile，锁屏「XXX的iPhone」/ App Store /
 *   视频通话关摄像头自画像 / 信息 App 名字头像的消费源）。
 * 在一边改了名字/头像，另一边以及对方的所有消费面全部停留旧值。
 *
 * 同步规则（双向镜像，只写名字/头像两个共有字段）：
 * - 联系人 → profile：机主联系人编辑保存（'contact-updated'）后镜像到 profile；
 * - profile → 联系人：设置›个人信息改名字/头像后镜像回机主联系人（走 updateContact，
 *   自动广播 contact-updated/contact-avatar-changed，微信/QQ/电话/信息等全端即时刷新）；
 * - 双向都先 diff 再写（值相同不落库）：回声（A→B 后 B→A 的回调）必然 diff 为空，
 *   自然收敛、无死循环；
 * - 设置侧头像须过 normalizeAvatar 校验（400KB 上限/格式）才写联系人，防止把设置里
 *   未压缩的大图写库后被静默清空；
 * - 开机初始对账只单向补空：profile 名字/头像为空时机主联系人值补位；
 *   两边都非空且不一致时不动（保留既有差异化设置，直到下一次任一侧编辑再自然同步）。
 *
 * 挂载点：PhoneShell 开机流程（ensureAccountOwnerContacts 之后、load 完成前后皆可），
 * 常驻监听，App 切换/卸载不受影响。
 */

import { normalizeAvatar } from '@/lib/contacts';
import { getContact, listContacts, updateContact } from './contacts-store';
import { useSettings, type Profile } from './store';

let started = false;

/** 机主 USER 联系人（kind='user' 且非小号/匿名号档案）；不存在返回 null */
async function mainOwnerContact(): Promise<Awaited<ReturnType<typeof listContacts>>[number] | null> {
  const all = await listContacts();
  return all.find((c) => c.kind === 'user' && !c.altOf) ?? null;
}

/** 两边共有字段的 diff（名字取 trim 后比较；头像 null 归一比较） */
function profilePatchFromContact(ownerName: string, ownerAvatar: string | null, profile: Profile): Partial<Profile> {
  const patch: Partial<Profile> = {};
  const name = ownerName.trim();
  if (name && name !== profile.name.trim()) patch.name = name;
  if ((ownerAvatar ?? null) !== (profile.avatar ?? null)) patch.avatar = ownerAvatar;
  return patch;
}

/** ① 联系人 → 设置 profile：机主联系人编辑保存后镜像。
 *  changed = updateContact 传来的本次实变字段；传 name/avatar 才镜像，
 *  避免改手机号等无关字段时把设置侧头像/名字反向覆盖（两边可各自保留尚未同步的旧差异） */
async function mirrorContactToProfile(contactId: string | null, changed?: string[]): Promise<void> {
  try {
    const owner = contactId ? await getContact(contactId) : await mainOwnerContact();
    if (!owner || owner.kind !== 'user' || owner.altOf) return;
    if (changed && !changed.includes('name') && !changed.includes('avatar')) return;
    const { profile, setProfile } = useSettings.getState();
    const patch = profilePatchFromContact(owner.name ?? '', owner.avatar ?? null, profile);
    if (Object.keys(patch).length > 0) setProfile(patch);
  } catch {
    // 同步失败静默（下次编辑会再对账）
  }
}

/** ② 设置 profile → 机主联系人：设置›个人信息改名字/头像后镜像回联系人（updateContact 自动全端广播） */
async function mirrorProfileToContact(): Promise<void> {
  try {
    const owner = await mainOwnerContact();
    if (!owner) return;
    const { profile } = useSettings.getState();
    const patch: { name?: string; avatar?: string | null } = {};
    const name = profile.name.trim();
    if (name && name !== (owner.name ?? '').trim()) patch.name = name;
    // 头像须过校验（格式/400KB）才写联系人——不合格直接跳过（联系人头像保持原值，不静默清空）
    if ((profile.avatar ?? null) !== (owner.avatar ?? null) && profile.avatar && normalizeAvatar(profile.avatar)) {
      patch.avatar = profile.avatar;
    }
    if (patch.name !== undefined || patch.avatar !== undefined) {
      await updateContact(owner.id, patch);
    }
  } catch {
    // 同步失败静默（下次编辑会再对账）
  }
}

/** 开机初始对账：只补空——profile 名字/头像为空时机主联系人值补位；两边都有值则不互相覆盖 */
async function initialReconcile(): Promise<void> {
  try {
    const owner = await mainOwnerContact();
    if (!owner) return;
    const { profile, setProfile } = useSettings.getState();
    const patch: Partial<Profile> = {};
    const name = (owner.name ?? '').trim();
    if (!profile.name.trim() && name) patch.name = name;
    if (!profile.avatar && owner.avatar) patch.avatar = owner.avatar;
    if (Object.keys(patch).length > 0) setProfile(patch);
  } catch {
    // 静默
  }
}

/** 启动双向同步（幂等；PhoneShell 开机调用一次） */
export function startOwnerProfileSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // 任意联系人编辑保存后：是机主本人且名字/头像实变 → 镜像到 profile（detail 缺失时按机主扫描兜底）
  window.addEventListener('contact-updated', (e) => {
    const detail = (e as CustomEvent<{ contactId?: string; changed?: string[] }>).detail;
    void mirrorContactToProfile(detail?.contactId ?? null, detail?.changed);
  });

  // 设置›个人信息改名/头像后：镜像回机主联系人
  useSettings.subscribe((state, prev) => {
    if (state.profile.name === prev.profile.name && state.profile.avatar === prev.profile.avatar) return;
    void mirrorProfileToContact();
  });

  void initialReconcile();
}

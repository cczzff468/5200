/** E2E 导航辅助：解锁 → 打开微信（图标在第 2 页，自动滚动+点击）。在页面上下文 eval 执行后 wait 一下即可。 */
(() => {
  window.__goto = async (appName) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 已在目标 App？
    if (document.body.innerText.includes(appName) && document.body.innerText.includes('通讯录') === false && appName === '微信') {
      // 无法简单判断，直接走流程
    }
    // 解锁：找到锁屏根节点派发 pointer 事件
    const lockText = [...document.querySelectorAll('p,div')].some((e) => e.childElementCount === 0 && (e.textContent || '').trim() === '向上轻扫以解锁');
    if (lockText) {
      const target = [...document.querySelectorAll('p,div')].find((e) => e.childElementCount === 0 && (e.textContent || '').trim() === '向上轻扫以解锁');
      const r = target.getBoundingClientRect();
      const opts = (x, y, phase) => new PointerEvent(phase, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: 1 });
      const el = document.elementFromPoint(r.x + r.width / 2, r.y - 200) || document.body;
      el.dispatchEvent(opts(r.x + r.width / 2, r.y - 200, 'pointerdown'));
      for (let y = r.y - 240; y > r.y - 620; y -= 60) el.dispatchEvent(opts(r.x + r.width / 2, y, 'pointermove'));
      el.dispatchEvent(opts(r.x + r.width / 2, r.y - 640, 'pointerup'));
      await sleep(900);
    }
    // 打开 App：图标文案元素 → 滚动进视图 → click 最近可点击祖先
    const label = [...document.querySelectorAll('div,span')].filter((e) => e.childElementCount === 0 && (e.textContent || '').trim() === appName).pop();
    if (!label) return 'label-not-found';
    label.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    await sleep(300);
    const clickable = label.closest('button') || label.closest('[role=button]') || label.parentElement;
    clickable.click();
    await sleep(1200);
    return 'opened:' + appName;
  };
  return 'goto-ready';
})()

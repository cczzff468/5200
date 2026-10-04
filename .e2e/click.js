((SEL, MODE) => {
  const all = [...document.querySelectorAll('button,[role=button]')];
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x > -20 && r.x < 460 && r.y > -20 && r.y < 950; };
  let el = null;
  if (MODE === 'tid') el = [...document.querySelectorAll(`[data-testid="${SEL}"]`)].filter(vis).pop() || null;
  else {
    const key = SEL;
    el = all.filter((b) => vis(b) && ((b.getAttribute('aria-label') || '').trim() === key || b.textContent.trim() === key || b.textContent.trim().startsWith(key))).pop() || null;
  }
  if (!el) return 'NOT_FOUND: ' + SEL;
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  return 'CLICKED: ' + SEL + ' @' + Math.round(r.x) + ',' + Math.round(r.y);
})("__SEL__", "__MODE__")

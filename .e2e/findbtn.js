(() => {
  const btns = [...document.querySelectorAll('button[aria-label], [data-testid]')].slice(0, 60)
    .map(e => e.tagName + ':' + (e.getAttribute('data-testid') || '') + ':' + (e.getAttribute('aria-label') || ''))
    .filter(s => !s.startsWith('DIV:'));
  return JSON.stringify(btns.slice(0, 40));
})()

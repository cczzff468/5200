(() => {
  const btns = [...document.querySelectorAll('button[data-testid]')].map(e => e.getAttribute('data-testid')).filter(t => t.includes('sheet') || t.includes('action') || t.includes('video') || t.includes('voice'));
  return JSON.stringify(btns.slice(0, 20));
})()

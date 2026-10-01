(() => {
  const btns = [...document.querySelectorAll('button[data-testid]')].map(e => e.getAttribute('data-testid')).filter(t => t.includes('profile') || t.includes('call') || t.includes('av'));
  return JSON.stringify(btns.slice(0, 20));
})()

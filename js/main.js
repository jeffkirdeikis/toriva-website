// CURSOR
const cur = document.getElementById('cursor');
const ring = document.getElementById('cursorRing');
let mx = 0, my = 0, rx = 0, ry = 0;
document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
(function animCur() {
  cur.style.left = mx + 'px'; cur.style.top = my + 'px';
  rx += (mx - rx) * .12; ry += (my - ry) * .12;
  ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
  requestAnimationFrame(animCur);
})();

// NAV SCROLL
window.addEventListener('scroll', () => document.getElementById('mainNav').classList.toggle('scrolled', window.scrollY > 40));

// MOBILE HAMBURGER
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
hamburger.addEventListener('click', () => {
  hamburger.classList.toggle('open');
  navLinks.classList.toggle('open');
});

// PAGE SYSTEM
function goPage(id, pushState) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.toggle('active', a.dataset.page === id));
  window.scrollTo(0, 0);
  if (pushState !== false) history.pushState(null, '', id === 'home' ? '/' : '/' + id);
  // Hide nav & footer for fullscreen pages (marketplace, deck)
  const isFullscreen = id === 'marketplace' || id === 'deck';
  document.getElementById('mainNav').style.display = isFullscreen ? 'none' : '';
  document.querySelector('footer').style.display = isFullscreen ? 'none' : '';
  if (id === 'home') initHeroCanvas();
  if (id === 'how') setTimeout(initNetworkCanvas, 100);
  if (id === 'token') setTimeout(animateBars, 300);
  observeReveals();
}
// Handle hash on load and back/forward
function loadFromHash() {
  // Support both /path and /#hash URLs
  const path = location.pathname.replace(/^\//, '').replace(/\/$/, '');
  const hash = location.hash.replace('#', '');
  const page = path || hash || 'home';
  const valid = ['home','how','pledge','token','projections','roadmap','team','marketplace','deck','privacy','terms'];
  // Backward compatibility: redirect /founder to /team
  if (page === 'founder') { goPage('team', true); return; }
  goPage(valid.includes(page) ? page : 'home', false);
}
window.addEventListener('popstate', loadFromHash);
loadFromHash();
document.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', e => {
  if (!a.dataset.page) return;
  e.preventDefault();
  goPage(a.dataset.page);
  hamburger.classList.remove('open');
  navLinks.classList.remove('open');
}));

// SCENARIO TABS
document.querySelectorAll('.s-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const k = btn.dataset.s;
    btn.closest('.scenario-tabs').querySelectorAll('.s-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.s-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('sp-' + k).classList.add('active');
  });
});

// REVEAL
function observeReveals() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: .1 });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
}
observeReveals();

// BARS
function animateBars() {
  document.querySelectorAll('.bar-fill').forEach(f => { f.style.width = f.dataset.width || '0%'; });
}
setTimeout(animateBars, 400);

// HERO CANVAS
function initHeroCanvas() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const nodes = [];
  for (let i = 0; i < 80; i++) nodes.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5, r: Math.random() * 1.5 + .5, p: Math.random() * Math.PI * 2 });
  if (window._hf) cancelAnimationFrame(window._hf);
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 160) { ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.strokeStyle = `rgba(201,168,76,${(1 - d / 160) * .1})`; ctx.lineWidth = .5; ctx.stroke(); }
    }
    nodes.forEach(n => { n.x += n.vx; n.y += n.vy; n.p += .02; if (n.x < 0 || n.x > canvas.width) n.vx *= -1; if (n.y < 0 || n.y > canvas.height) n.vy *= -1; const g = (Math.sin(n.p) + 1) * .5; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + g * .8, 0, Math.PI * 2); ctx.fillStyle = `rgba(201,168,76,${.25 + g * .35})`; ctx.fill(); });
    window._hf = requestAnimationFrame(draw);
  }
  draw();
  window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });
}
initHeroCanvas();

// NETWORK CANVAS
function initNetworkCanvas() {
  const canvas = document.getElementById('networkCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 520, H = 520; canvas.width = W; canvas.height = H;
  const hub = { x: W / 2, y: H / 2 };
  const mids = [];
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; mids.push({ x: W / 2 + Math.cos(a) * 130, y: H / 2 + Math.sin(a) * 130, a }); }
  const leaves = [];
  mids.forEach((m, i) => {
    for (let j = 0; j < 5; j++) {
      const a = m.a + (Math.random() - .5) * .7, d = 80 + Math.random() * 50;
      leaves.push({ x: m.x + Math.cos(a) * d, y: m.y + Math.sin(a) * d, r: 1.5 + Math.random(), pi: i, p: Math.random() * Math.PI * 2, active: Math.random() > .25 });
    }
  });
  let t = 0;
  function drawNet() {
    ctx.clearRect(0, 0, W, H); t += .015;
    mids.forEach(m => { ctx.beginPath(); ctx.moveTo(hub.x, hub.y); ctx.lineTo(m.x, m.y); ctx.strokeStyle = 'rgba(201,168,76,.2)'; ctx.lineWidth = 1; ctx.stroke(); });
    leaves.forEach(l => { if (!l.active) return; ctx.beginPath(); ctx.moveTo(mids[l.pi].x, mids[l.pi].y); ctx.lineTo(l.x, l.y); ctx.strokeStyle = 'rgba(201,168,76,.08)'; ctx.lineWidth = .5; ctx.stroke(); });
    leaves.forEach((l, i) => { if (!l.active) return; const pr = (t * .7 + i * .3) % 1, px = mids[l.pi].x + (hub.x - mids[l.pi].x) * (1 - pr) * .5, py = mids[l.pi].y + (hub.y - mids[l.pi].y) * (1 - pr) * .5; ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2); ctx.fillStyle = `rgba(201,168,76,${.4 * Math.sin(pr * Math.PI)})`; ctx.fill(); });
    leaves.forEach(l => { l.p += .04; const g = (Math.sin(l.p) + 1) * .5; ctx.beginPath(); ctx.arc(l.x, l.y, l.r + g * .5, 0, Math.PI * 2); ctx.fillStyle = l.active ? `rgba(201,168,76,${.35 + g * .3})` : 'rgba(242,237,230,.06)'; ctx.fill(); });
    mids.forEach(m => { ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(201,168,76,.75)'; ctx.fill(); });
    const hg = (Math.sin(t) + 1) * .5; ctx.beginPath(); ctx.arc(hub.x, hub.y, 8 + hg * 2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(201,168,76,.12)'; ctx.fill(); ctx.beginPath(); ctx.arc(hub.x, hub.y, 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(201,168,76,.9)'; ctx.fill();
    requestAnimationFrame(drawNet);
  }
  drawNet();
}

// MARQUEE DUPLICATION
const track = document.getElementById('marquee');
if (track) track.innerHTML += track.innerHTML;

// WAITLIST FORM
(function initWaitlist() {
  const form = document.getElementById('waitlistForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('waitlistEmail');
    const msg = document.getElementById('waitlistMsg');
    const btn = form.querySelector('button');
    const email = input.value.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = 'Please enter a valid email address.';
      msg.className = 'waitlist-msg error';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();

      if (res.ok) {
        msg.textContent = data.message || 'You\'re on the list. We\'ll be in touch.';
        msg.className = 'waitlist-msg success';
        input.value = '';
      } else {
        msg.textContent = data.error || 'Something went wrong. Try again.';
        msg.className = 'waitlist-msg error';
      }
    } catch (err) {
      msg.textContent = 'Network error. Please try again.';
      msg.className = 'waitlist-msg error';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Join Waitlist';
    }
  });
})();

// DECK SLIDESHOW
(function initDeck() {
  const total = 15;
  let current = 1;
  const img = document.getElementById('deck-slide-img');
  const counter = document.getElementById('deck-counter');
  const prev = document.getElementById('deck-prev');
  const next = document.getElementById('deck-next');
  if (!img || !prev || !next) return;

  function pad(n) { return String(n).padStart(3, '0'); }
  var overlay11 = document.getElementById('deck-slide-11-overlay');
  function show(n) {
    current = n;
    if (n === 11 && overlay11) {
      img.style.display = 'none';
      overlay11.style.display = 'flex';
    } else {
      img.style.display = 'block';
      if (overlay11) overlay11.style.display = 'none';
      img.src = 'img/deck/deck-images.' + pad(n) + '.jpeg';
    }
    img.alt = 'Slide ' + n + ' of ' + total;
    counter.textContent = n + ' / ' + total;
    prev.style.opacity = n === 1 ? '.3' : '1';
    next.style.opacity = n === total ? '.3' : '1';
  }
  prev.addEventListener('click', () => { if (current > 1) show(current - 1); });
  next.addEventListener('click', () => { if (current < total) show(current + 1); });
  document.addEventListener('keydown', e => {
    if (document.getElementById('page-deck').classList.contains('active')) {
      if (e.key === 'ArrowLeft' && current > 1) show(current - 1);
      if (e.key === 'ArrowRight' && current < total) show(current + 1);
    }
  });
})();

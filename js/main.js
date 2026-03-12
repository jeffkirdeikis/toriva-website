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

// PRODUCT DROPDOWN (mobile tap to expand)
document.querySelectorAll('.dropdown-toggle').forEach(toggle => {
  toggle.addEventListener('click', e => {
    e.preventDefault();
    const menu = toggle.nextElementSibling;
    menu.classList.toggle('open');
    toggle.querySelector('.dropdown-arrow').classList.toggle('open');
  });
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

// HERO CANVAS — NetworkSim v2
function initHeroCanvas() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const GOLD = '#C9A84C', CYAN = '#4CC9C9', GREEN = '#4CCA6E';

  const sim = { w: 0, h: 0, nodes: [], edges: [], taskPackets: [], paymentPackets: [], pulses: [], time: 0, mouse: { x: -999, y: -999 } };

  function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

  function initSim(w, h) {
    sim.w = w; sim.h = h; sim.nodes = []; sim.edges = []; sim.taskPackets = []; sim.paymentPackets = []; sim.pulses = []; sim.time = 0;
    const count = Math.min(Math.floor((w * h) / 16000), 55);
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * Math.min(w, h) * 0.44;
      const x = cx + Math.cos(angle) * radius * (0.5 + Math.random() * 0.9);
      const y = cy + Math.sin(angle) * radius * (0.5 + Math.random() * 0.7);
      sim.nodes.push({
        x: Math.max(60, Math.min(w - 60, x)), y: Math.max(60, Math.min(h - 60, y)),
        baseX: 0, baseY: 0, size: 2.5 + Math.random() * 4,
        processing: false, processTimer: 0, earning: false, earnTimer: 0,
        pulse: Math.random() * Math.PI * 2, activity: 0,
        type: Math.random() > 0.75 ? 'hub' : 'node',
      });
    }
    sim.nodes.forEach(n => { n.baseX = n.x; n.baseY = n.y; });
    const added = new Set();
    for (let i = 0; i < sim.nodes.length; i++) {
      const dists = [];
      for (let j = 0; j < sim.nodes.length; j++) { if (i !== j) dists.push({ j, d: dist(sim.nodes[i], sim.nodes[j]) }); }
      dists.sort((a, b) => a.d - b.d);
      const maxC = sim.nodes[i].type === 'hub' ? 5 : 3;
      for (let k = 0; k < Math.min(maxC, dists.length); k++) {
        if (dists[k].d < 280) {
          const key = Math.min(i, dists[k].j) + '-' + Math.max(i, dists[k].j);
          if (!added.has(key)) { added.add(key); sim.edges.push({ from: i, to: dists[k].j, active: false, flow: 0 }); }
        }
      }
    }
  }

  function spawnTask() {
    if (!sim.edges.length) return;
    const e = sim.edges[Math.floor(Math.random() * sim.edges.length)];
    const f = sim.nodes[e.from], t = sim.nodes[e.to];
    sim.taskPackets.push({ x: f.x, y: f.y, tx: t.x, ty: t.y, progress: 0, speed: 0.002 + Math.random() * 0.003, fromIdx: e.from, toIdx: e.to, size: 2.5 + Math.random() * 2, trail: [] });
    e.active = true; e.flow = 1;
  }

  function spawnPayment(fi, ti) {
    const f = sim.nodes[fi], t = sim.nodes[ti];
    sim.paymentPackets.push({ x: f.x, y: f.y, tx: t.x, ty: t.y, progress: 0, speed: 0.00375 + Math.random() * 0.0025, size: 2 + Math.random() * 1.5, trail: [] });
  }

  function spawnPulse(x, y, color, maxR) {
    sim.pulses.push({ x, y, radius: 0, maxRadius: (maxR || 10) * 0.25, opacity: 0.6, color });
  }

  function update() {
    sim.time += 0.016;
    if (Math.random() < 0.045) spawnTask();
    sim.nodes.forEach(n => {
      n.pulse += 0.015;
      n.x = n.baseX + Math.sin(sim.time * 0.075 + n.pulse) * 1.5;
      n.y = n.baseY + Math.cos(sim.time * 0.0625 + n.pulse * 1.3) * 1.25;
      const dx = n.x - sim.mouse.x, dy = n.y - sim.mouse.y, md = Math.sqrt(dx * dx + dy * dy);
      if (md < 160 && md > 0) { n.x += (dx / md) * ((160 - md) / 160) * 3; n.y += (dy / md) * ((160 - md) / 160) * 3; }
      if (n.processing) {
        n.processTimer -= 0.016; n.activity = Math.min(1, n.activity + 0.05);
        if (n.processTimer <= 0) { n.processing = false; n.earning = true; n.earnTimer = 0.5; spawnPulse(n.x, n.y, GREEN, 9); }
      } else if (n.earning) { n.earnTimer -= 0.016; if (n.earnTimer <= 0) n.earning = false; }
      else { n.activity = Math.max(0, n.activity - 0.01); }
    });
    sim.taskPackets = sim.taskPackets.filter(p => {
      p.progress += p.speed; const t = p.progress;
      const mx = (p.x + p.tx) / 2 + (p.ty - p.y) * 0.12 * Math.sin(t * Math.PI);
      const my = (p.y + p.ty) / 2 - (p.tx - p.x) * 0.12 * Math.sin(t * Math.PI);
      p.cx = (1 - t) ** 2 * p.x + 2 * (1 - t) * t * mx + t * t * p.tx;
      p.cy = (1 - t) ** 2 * p.y + 2 * (1 - t) * t * my + t * t * p.ty;
      p.trail.push({ x: p.cx, y: p.cy, age: 0 }); if (p.trail.length > 22) p.trail.shift();
      p.trail.forEach(tr => tr.age += 0.05);
      if (p.progress >= 1) {
        const node = sim.nodes[p.toIdx]; node.processing = true; node.processTimer = 0.3 + Math.random() * 0.5;
        spawnPulse(node.x, node.y, CYAN, 6);
        const fi = p.toIdx, ti = p.fromIdx;
        setTimeout(() => spawnPayment(fi, ti), 300 + Math.random() * 500);
        return false;
      }
      return true;
    });
    sim.paymentPackets = sim.paymentPackets.filter(p => {
      p.progress += p.speed;
      p.cx = p.x + (p.tx - p.x) * p.progress; p.cy = p.y + (p.ty - p.y) * p.progress;
      p.trail.push({ x: p.cx, y: p.cy, age: 0 }); if (p.trail.length > 15) p.trail.shift();
      p.trail.forEach(tr => tr.age += 0.06);
      if (p.progress >= 1) { spawnPulse(p.tx, p.ty, GOLD, 8); return false; }
      return true;
    });
    sim.pulses = sim.pulses.filter(p => { p.radius += 0.375; p.opacity -= 0.00375; return p.opacity > 0; });
    sim.edges.forEach(e => { e.flow = Math.max(0, e.flow - 0.008); if (e.flow <= 0) e.active = false; });
  }

  function draw() {
    const w = sim.w, h = sim.h;
    ctx.clearRect(0, 0, w, h);
    // Edges
    sim.edges.forEach(e => {
      const f = sim.nodes[e.from], t = sim.nodes[e.to], a = 0.035 + e.flow * 0.14;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = e.active ? `rgba(76,201,201,${a})` : `rgba(201,168,76,${a})`;
      ctx.lineWidth = 0.5 + e.flow * 1.2; ctx.stroke();
    });
    // Pulses
    sim.pulses.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      const c = p.color === GOLD ? '201,168,76' : p.color === CYAN ? '76,201,201' : '76,202,110';
      ctx.strokeStyle = `rgba(${c},${p.opacity})`; ctx.lineWidth = 1.5; ctx.stroke();
    });
    // Task trails
    sim.taskPackets.forEach(p => {
      for (let i = 0; i < p.trail.length; i++) {
        const tr = p.trail[i], a = (1 - tr.age) * (i / p.trail.length) * 0.6;
        if (a <= 0) continue;
        ctx.beginPath(); ctx.arc(tr.x, tr.y, p.size * (i / p.trail.length) * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(76,201,201,${a})`; ctx.fill();
      }
      if (p.cx != null) {
        ctx.beginPath(); ctx.arc(p.cx, p.cy, p.size, 0, Math.PI * 2); ctx.fillStyle = 'rgba(76,201,201,0.9)'; ctx.fill();
        ctx.beginPath(); ctx.arc(p.cx, p.cy, p.size * 3.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(76,201,201,0.06)'; ctx.fill();
      }
    });
    // Payment trails
    sim.paymentPackets.forEach(p => {
      for (let i = 0; i < p.trail.length; i++) {
        const tr = p.trail[i], a = (1 - tr.age) * (i / p.trail.length) * 0.7;
        if (a <= 0) continue;
        ctx.beginPath(); ctx.arc(tr.x, tr.y, p.size * (i / p.trail.length) * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(201,168,76,${a})`; ctx.fill();
      }
      if (p.cx != null) {
        ctx.beginPath(); ctx.arc(p.cx, p.cy, p.size, 0, Math.PI * 2); ctx.fillStyle = 'rgba(232,212,139,0.95)'; ctx.fill();
        ctx.beginPath(); ctx.arc(p.cx, p.cy, p.size * 3.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(201,168,76,0.08)'; ctx.fill();
      }
    });
    // Nodes
    sim.nodes.forEach(n => {
      const pf = 0.7 + 0.3 * Math.sin(n.pulse * 2);
      const sz = n.type === 'hub' ? n.size * 1.5 : n.size;
      const glow = sz * (3 + n.activity * 5);
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glow);
      if (n.processing) { grad.addColorStop(0, `rgba(76,201,201,${0.15 * pf})`); grad.addColorStop(1, 'rgba(76,201,201,0)'); }
      else if (n.earning) { grad.addColorStop(0, `rgba(76,202,110,${0.2 * pf})`); grad.addColorStop(1, 'rgba(76,202,110,0)'); }
      else { grad.addColorStop(0, `rgba(201,168,76,${(0.05 + n.activity * 0.12) * pf})`); grad.addColorStop(1, 'rgba(201,168,76,0)'); }
      ctx.beginPath(); ctx.arc(n.x, n.y, glow, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
      if (n.processing) {
        ctx.beginPath(); ctx.arc(n.x, n.y, sz * 2.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min((1 - n.processTimer / 0.8) * 2, 1));
        ctx.strokeStyle = 'rgba(76,201,201,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(n.x, n.y, sz * pf, 0, Math.PI * 2);
      ctx.fillStyle = n.processing ? `rgba(76,201,201,${0.6 + 0.4 * pf})` : n.earning ? `rgba(76,202,110,${0.6 + 0.4 * pf})` : `rgba(201,168,76,${(0.25 + n.activity * 0.5) * pf})`;
      ctx.fill();
      ctx.beginPath(); ctx.arc(n.x, n.y, sz * 0.35 * pf, 0, Math.PI * 2);
      ctx.fillStyle = n.processing ? 'rgba(160,235,235,0.9)' : n.earning ? 'rgba(160,235,180,0.9)' : `rgba(232,212,139,${0.35 + n.activity * 0.4})`;
      ctx.fill();
    });
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initSim(w, h);
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', e => { sim.mouse = { x: e.clientX, y: e.clientY }; });

  if (window._hf) cancelAnimationFrame(window._hf);
  function loop() { update(); draw(); window._hf = requestAnimationFrame(loop); }
  loop();
}
initHeroCanvas();

// HOW IT WORKS CANVAS — floating dots
function initHiwCanvas() {
  const canvas = document.getElementById('hiwCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let active = false, af;

  const particles = [];
  for (let i = 0; i < 30; i++) particles.push({ x: 0, y: 0, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.15, size: 1 + Math.random() * 2, pulse: Math.random() * Math.PI * 2 });

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px'; canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;
    particles.forEach(p => { p.x = Math.random() * w; p.y = Math.random() * h; });
  }

  const obs = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !active) { active = true; resize(); loop(); }
    else if (!e.isIntersecting && active) { active = false; cancelAnimationFrame(af); }
  }, { threshold: 0.05 });
  obs.observe(canvas.parentElement);

  function loop() {
    if (!active) return;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    particles.forEach(p => {
      p.pulse += 0.02; p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      const a = 0.15 + 0.1 * Math.sin(p.pulse);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(201,168,76,${a})`; ctx.fill();
    });
    for (let i = 0; i < particles.length; i++) for (let j = i + 1; j < particles.length; j++) {
      const d = Math.sqrt((particles[i].x - particles[j].x) ** 2 + (particles[i].y - particles[j].y) ** 2);
      if (d < 120) { ctx.beginPath(); ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y); ctx.strokeStyle = `rgba(201,168,76,${0.04 * (1 - d / 120)})`; ctx.lineWidth = 0.5; ctx.stroke(); }
    }
    af = requestAnimationFrame(loop);
  }
  window.addEventListener('resize', () => { if (active) resize(); });
}
initHiwCanvas();

// FLYWHEEL CANVAS
function initFlywheelCanvas() {
  const canvas = document.getElementById('flywheelCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let S = 420, active = false, af;

  const stages = 5, stageAngle = (Math.PI * 2) / stages;
  const labels = ['CUSTOMERS', 'REVENUE', 'PAYOUTS', 'CONTRIBUTORS', 'COMPUTE'];
  const icons = ['◆', '$', '↗', '◎', '⬡'];

  const particles = [];
  for (let i = 0; i < 35; i++) particles.push({ angle: Math.random() * Math.PI * 2, speed: 0.003 + Math.random() * 0.004, size: 1.2 + Math.random() * 1.8, radOffset: (Math.random() - 0.5) * 18, opacity: 0.3 + Math.random() * 0.5 });
  const bursts = [];
  let t = 0, fadeIn = 0;

  function resize() {
    const maxW = canvas.parentElement ? canvas.parentElement.getBoundingClientRect().width : 420;
    S = Math.min(420, maxW - 16);
    canvas.width = S * dpr; canvas.height = S * dpr;
    canvas.style.width = S + 'px'; canvas.style.height = S + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const obs = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !active) { active = true; resize(); loop(); }
    else if (!e.isIntersecting && active) { active = false; cancelAnimationFrame(af); }
  }, { threshold: 0.2 });
  obs.observe(canvas.parentElement);

  function loop() {
    if (!active) return;
    t += 0.016; fadeIn = Math.min(1, fadeIn + 0.012);
    const cx = S / 2, cy = S / 2, R = S * 0.37;
    ctx.clearRect(0, 0, S, S); ctx.globalAlpha = fadeIn;

    // Rings
    [R + 24, R, R - 24].forEach((r, i) => {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(201,168,76,' + (i === 1 ? 0.08 : 0.03) + ')';
      ctx.lineWidth = i === 1 ? 1.5 : 0.8; ctx.stroke();
    });

    // Arrows
    for (let i = 0; i < stages; i++) {
      const midAngle = -Math.PI / 2 + stageAngle * i + stageAngle / 2;
      const ax = cx + Math.cos(midAngle) * R, ay = cy + Math.sin(midAngle) * R;
      const tang = midAngle + Math.PI / 2, as = 5;
      ctx.beginPath();
      ctx.moveTo(ax + Math.cos(tang) * as, ay + Math.sin(tang) * as);
      ctx.lineTo(ax + Math.cos(tang + 2.6) * as, ay + Math.sin(tang + 2.6) * as);
      ctx.lineTo(ax + Math.cos(tang - 2.6) * as, ay + Math.sin(tang - 2.6) * as);
      ctx.closePath();
      ctx.fillStyle = 'rgba(201,168,76,' + (0.1 + 0.05 * Math.sin(t * 2 + i)) + ')'; ctx.fill();
    }

    // Particles
    particles.forEach(p => {
      p.angle += p.speed; if (p.angle > Math.PI * 2) p.angle -= Math.PI * 2;
      const pr = R + p.radOffset;
      const px = cx + Math.cos(p.angle - Math.PI / 2) * pr, py = cy + Math.sin(p.angle - Math.PI / 2) * pr;
      for (let i = 0; i < stages; i++) {
        const na = stageAngle * i;
        if (Math.abs(p.angle - na) < 0.03 && Math.random() < 0.12)
          bursts.push({ x: cx + Math.cos(na - Math.PI / 2) * R, y: cy + Math.sin(na - Math.PI / 2) * R, life: 1, size: 2.5 + Math.random() * 3.5 });
      }
      const glow = ctx.createRadialGradient(px, py, 0, px, py, p.size * 3.5);
      glow.addColorStop(0, 'rgba(201,168,76,' + (p.opacity * 0.25) + ')'); glow.addColorStop(1, 'rgba(201,168,76,0)');
      ctx.beginPath(); ctx.arc(px, py, p.size * 3.5, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, p.size, 0, Math.PI * 2); ctx.fillStyle = 'rgba(232,212,139,' + p.opacity + ')'; ctx.fill();
    });

    // Bursts
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]; b.life -= 0.025;
      if (b.life <= 0) { bursts.splice(i, 1); continue; }
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size * (1 - b.life) * 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(201,168,76,' + (b.life * 0.25) + ')'; ctx.lineWidth = 0.8; ctx.stroke();
    }

    // Nodes
    const fontSize = Math.max(8, S * 0.018);
    for (let i = 0; i < stages; i++) {
      const angle = -Math.PI / 2 + stageAngle * i;
      const nx = cx + Math.cos(angle) * R, ny = cy + Math.sin(angle) * R;
      const pulse = 0.7 + 0.3 * Math.sin(t * 1.5 + i * 1.2);
      const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, 28);
      ng.addColorStop(0, 'rgba(201,168,76,' + (0.1 * pulse) + ')'); ng.addColorStop(1, 'rgba(201,168,76,0)');
      ctx.beginPath(); ctx.arc(nx, ny, 28, 0, Math.PI * 2); ctx.fillStyle = ng; ctx.fill();
      ctx.beginPath(); ctx.arc(nx, ny, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,10,8,0.92)'; ctx.fill();
      ctx.strokeStyle = 'rgba(201,168,76,' + (0.25 + 0.15 * pulse) + ')'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(201,168,76,' + (0.45 + 0.25 * pulse) + ')';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icons[i], nx, ny + 0.5);
      const lR = R + 44, lx = cx + Math.cos(angle) * lR, ly = cy + Math.sin(angle) * lR;
      ctx.font = '600 ' + fontSize + 'px monospace'; ctx.fillStyle = 'rgba(201,168,76,' + (0.3 + 0.12 * pulse) + ')';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(labels[i], lx, ly);
    }

    // Center text
    const cFont = Math.max(14, S * 0.035);
    ctx.font = 'italic ' + cFont + 'px serif';
    ctx.fillStyle = 'rgba(201,168,76,' + (0.13 + 0.04 * Math.sin(t)) + ')';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('the cycle', cx, cy - cFont * 0.5);
    ctx.fillText('compounds', cx, cy + cFont * 0.6);

    ctx.globalAlpha = 1;
    af = requestAnimationFrame(loop);
  }
  window.addEventListener('resize', () => { if (active) { resize(); } });
}
initFlywheelCanvas();

// CHIP CANVAS — Apple Silicon viz
function initChipCanvas() {
  const canvas = document.getElementById('chipCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let active = false, af;

  const S = 320;
  canvas.width = S * dpr; canvas.height = S * dpr;
  canvas.style.width = S + 'px'; canvas.style.height = S + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cx = S / 2, cy = S / 2;
  let t = 0, fadeIn = 0;

  const gridSize = 6, cellSize = 28;
  const gridOffset = (gridSize * cellSize) / 2;
  const cores = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      cores.push({
        x: cx - gridOffset + c * cellSize + cellSize / 2,
        y: cy - gridOffset + r * cellSize + cellSize / 2,
        active: false, activeTimer: 0,
        pulse: Math.random() * Math.PI * 2,
        type: (r < 2) ? 'neural' : (r < 4) ? 'cpu' : 'gpu',
      });
    }
  }
  const streams = [];

  const obs = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !active) { active = true; loop(); }
    else if (!e.isIntersecting && active) { active = false; cancelAnimationFrame(af); }
  }, { threshold: 0.2 });
  obs.observe(canvas.parentElement);

  function loop() {
    if (!active) return;
    t += 0.016; fadeIn = Math.min(1, fadeIn + 0.01);
    ctx.clearRect(0, 0, S, S); ctx.globalAlpha = fadeIn;

    if (Math.random() < 0.06) {
      const c = cores[Math.floor(Math.random() * cores.length)];
      c.active = true; c.activeTimer = 0.4 + Math.random() * 0.6;
      const neighbors = cores.filter(n => Math.abs(n.x - c.x) <= cellSize && Math.abs(n.y - c.y) <= cellSize && n !== c);
      if (neighbors.length > 0) {
        const target = neighbors[Math.floor(Math.random() * neighbors.length)];
        streams.push({ x: c.x, y: c.y, tx: target.x, ty: target.y, progress: 0, speed: 0.04 + Math.random() * 0.03 });
      }
    }

    const chipW = gridSize * cellSize + 40;
    ctx.strokeStyle = 'rgba(201,168,76,' + (0.08 + 0.02 * Math.sin(t)) + ')';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - chipW / 2, cy - chipW / 2, chipW, chipW);

    for (let i = 0; i < gridSize; i++) {
      const pos = cx - gridOffset + i * cellSize + cellSize / 2;
      ctx.strokeStyle = 'rgba(201,168,76,0.06)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pos, cy - chipW / 2); ctx.lineTo(pos, cy - chipW / 2 - 16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pos, cy + chipW / 2); ctx.lineTo(pos, cy + chipW / 2 + 16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - chipW / 2, pos); ctx.lineTo(cx - chipW / 2 - 16, pos); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + chipW / 2, pos); ctx.lineTo(cx + chipW / 2 + 16, pos); ctx.stroke();
    }

    for (let i = streams.length - 1; i >= 0; i--) {
      const s = streams[i]; s.progress += s.speed;
      if (s.progress >= 1) { streams.splice(i, 1); continue; }
      const sx = s.x + (s.tx - s.x) * s.progress, sy = s.y + (s.ty - s.y) * s.progress;
      const a = Math.sin(s.progress * Math.PI) * 0.6;
      ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(76,201,201,' + a + ')'; ctx.fill();
    }

    cores.forEach(function(c) {
      c.pulse += 0.02;
      if (c.active) { c.activeTimer -= 0.016; if (c.activeTimer <= 0) c.active = false; }
      var pf = 0.6 + 0.4 * Math.sin(c.pulse), sz = cellSize * 0.35;
      ctx.fillStyle = c.active ? 'rgba(76,201,201,' + (0.12 * pf) + ')' : 'rgba(201,168,76,' + (0.03 * pf) + ')';
      ctx.fillRect(c.x - sz, c.y - sz, sz * 2, sz * 2);
      ctx.strokeStyle = c.active ? 'rgba(76,201,201,' + (0.3 * pf) + ')' : 'rgba(201,168,76,' + (0.08 * pf) + ')';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(c.x - sz, c.y - sz, sz * 2, sz * 2);
      if (c.active) {
        var g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, sz * 3);
        g.addColorStop(0, 'rgba(76,201,201,' + (0.08 * pf) + ')'); g.addColorStop(1, 'rgba(76,201,201,0)');
        ctx.beginPath(); ctx.arc(c.x, c.y, sz * 3, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      }
    });

    ctx.font = '600 7px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(201,168,76,0.15)';
    ctx.fillText('NEURAL ENGINE', cx, cy - gridOffset + cellSize - 4);
    ctx.fillText('CPU CORES', cx, cy - gridOffset + cellSize * 3 - 4);
    ctx.fillText('GPU CORES', cx, cy - gridOffset + cellSize * 5 - 4);
    ctx.font = '600 8px monospace';
    ctx.fillStyle = 'rgba(201,168,76,' + (0.2 + 0.05 * Math.sin(t * 0.8)) + ')';
    ctx.fillText('UNIFIED MEMORY', cx, cy + chipW / 2 + 32);

    ctx.globalAlpha = 1;
    af = requestAnimationFrame(loop);
  }
}
initChipCanvas();

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

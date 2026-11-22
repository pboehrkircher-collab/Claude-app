// Müllerball – ein Hügel-Flug-Spiel.
// Gedrückt halten = schwerer werden (abtauchen). Loslassen = leicht (fliegen).
// Lande sauber auf Abhängen, um Schwung zu holen. Bevor die Nacht kommt, so weit wie möglich!
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ---------- Assets ----------
  const ballImg = new Image();
  let ballReady = false;
  ballImg.onload = () => { ballReady = true; };
  ballImg.src = 'assets/ball.png';

  // ---------- Konstanten ----------
  const R = 30;                 // Ball-Radius (Welt-Einheiten)
  const G = 1000;               // normale Schwerkraft
  const G_DIVE = 3200;          // Schwerkraft beim Drücken
  const MIN_SPEED = 170;
  const MAX_SPEED = 2600;
  const DAY_LENGTH = 60;        // Sekunden Startzeit
  const STEP = 1 / 120;
  const PX_PER_M = 10;

  const PALETTES = [
    ['#ffb347', '#ff7a2f'], ['#7ed957', '#3fae4a'], ['#5ec8f2', '#2f8fd8'],
    ['#ff7eb6', '#e0458a'], ['#c59cff', '#8a5cf0'], ['#ffe066', '#f2b51d'],
  ];

  // ---------- Hilfen ----------
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mixColor(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
  }
  function gradientStops(stops, t) {
    // stops: [[t, colorTop, colorBottom], ...]
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, a0, b0] = stops[i], [t1, a1, b1] = stops[i + 1];
      if (t <= t1) { const k = (t - t0) / (t1 - t0); return [mixColor(a0, a1, k), mixColor(b0, b1, k)]; }
    }
    const l = stops[stops.length - 1]; return [l[1], l[2]];
  }
  function loadBest() { try { return +localStorage.getItem('muellerball-best') || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem('muellerball-best', String(v)); } catch (e) { /* egal */ } }

  // ---------- Gelände ----------
  class Terrain {
    constructor() {
      this.pts = [];
      this.hill = 0;
      // Start auf einem hohen Hügel, damit der Ball gleich losrollt
      this.pts.push({ x: -1200, y: 380, pal: 0 }, { x: -200, y: 420, pal: 0 });
      this.ensure(4000);
    }
    ensure(xMax) {
      while (this.pts[this.pts.length - 1].x < xMax) {
        const last = this.pts[this.pts.length - 1];
        const isPeakNext = last.y < 200;
        const diff = clamp(last.x / 60000, 0, 1);   // wird mit der Strecke schwieriger
        const dx = rand(380, 620) * lerp(1, 1.35, diff);
        let y;
        if (isPeakNext) { y = rand(260, 460) * lerp(1, 1.3, diff); this.hill++; }
        else y = rand(0, 70);
        this.pts.push({ x: last.x + dx, y, pal: this.hill % PALETTES.length });
      }
    }
    trim(xMin) {
      while (this.pts.length > 4 && this.pts[2].x < xMin) this.pts.shift();
    }
    seg(x) {
      const p = this.pts;
      let lo = 0, hi = p.length - 2;
      if (x <= p[0].x) return 0;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (p[mid].x <= x) lo = mid; else hi = mid - 1; }
      return lo;
    }
    height(x) {
      const i = this.seg(x), a = this.pts[i], b = this.pts[i + 1];
      const t = clamp((x - a.x) / (b.x - a.x), 0, 1);
      return a.y + (b.y - a.y) * (1 - Math.cos(Math.PI * t)) / 2;
    }
    slope(x) {
      const i = this.seg(x), a = this.pts[i], b = this.pts[i + 1];
      const t = clamp((x - a.x) / (b.x - a.x), 0, 1);
      return (b.y - a.y) * Math.PI * Math.sin(Math.PI * t) / (2 * (b.x - a.x));
    }
  }

  // ---------- Zustand ----------
  let W = 0, H = 0, DPR = 1;
  let state = 'menu';
  let terrain, ball, cam, timeLeft, score, bonus, perfectStreak, fever, nextCheckpoint, checkpointGap;
  let texts = [], particles = [], trail = [], clouds = [], stars = [];
  let pressing = false, best = loadBest(), stallTimer = 0, overTimer = 0, newBest = false;
  let elapsed = 0;

  function reset() {
    terrain = new Terrain();
    ball = { x: -900, y: terrain.height(-900) + R, vx: 350, vy: 0, angle: 0, spin: 0, ground: true, air: 0, maxAirY: 0 };
    cam = { x: 0, scale: 1, bottom: -120 };
    timeLeft = DAY_LENGTH; score = 0; bonus = 0; perfectStreak = 0; fever = 0;
    checkpointGap = 11000; nextCheckpoint = checkpointGap;
    texts = []; particles = []; trail = [];
    stallTimer = 0; overTimer = 0; newBest = false; elapsed = 0;
  }

  function initScenery() {
    clouds = [];
    for (let i = 0; i < 9; i++) clouds.push({ x: rand(0, 4000), y: rand(0.08, 0.45), s: rand(0.6, 1.4) });
    stars = [];
    for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random() * 0.7, r: rand(0.6, 1.8), p: rand(0, 6) });
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  }

  // ---------- Eingabe ----------
  let audio = null;
  function initAudio() {
    if (audio) return;
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
  }
  function beep(freq, dur = 0.12, type = 'sine', vol = 0.12) {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, audio.currentTime + dur);
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + dur);
  }

  function press() {
    initAudio();
    if (state === 'menu') { reset(); state = 'play'; return; }
    if (state === 'over') { if (overTimer > 0.8) { reset(); state = 'play'; } return; }
    pressing = true;
  }
  function release() { pressing = false; }

  canvas.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) press(); }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'Enter') release(); });
  window.addEventListener('resize', resize);

  // ---------- Effekte ----------
  function popText(msg, color = '#fff', size = 30) {
    texts.push({ msg, color, size, t: 0 });
  }
  function burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(80, 420);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 150, life: rand(0.5, 1.1), t: 0, c: colors[i % colors.length], r: rand(3, 7) });
    }
  }

  // ---------- Physik ----------
  function physics(dt) {
    const night = timeLeft <= 0;
    const g = (pressing && !night) ? G_DIVE : G;
    const wasAir = !ball.ground;

    ball.vy -= g * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    const gy = terrain.height(ball.x);
    const s = terrain.slope(ball.x);
    const len = Math.sqrt(1 + s * s);
    const dist = (ball.y - gy) / len;   // Abstand zur Oberfläche (genähert)

    if (dist <= R) {
      const tx = 1 / len, ty = s / len;
      const nx = -ty, ny = tx;
      const vn = ball.vx * nx + ball.vy * ny;
      let vt = ball.vx * tx + ball.vy * ty;
      const speed = Math.hypot(ball.vx, ball.vy);

      if (wasAir && ball.air > 0.35) landing(vn, speed, s);

      if (wasAir && ball.air > 0.35) {
        const q = Math.abs(vn) / Math.max(speed, 1);
        if (q < 0.28 && s < -0.05) vt *= fever > 0 ? 1.18 : 1.1;
        else if (q > 0.55) vt *= 0.72;
      }

      if (night) vt *= (1 - 0.9 * dt);       // nachts rollt der Ball aus
      vt = night ? Math.max(vt, 0) : Math.max(vt, MIN_SPEED);
      vt = Math.min(vt, MAX_SPEED);
      ball.vx = vt * tx; ball.vy = vt * ty;
      ball.y = gy + R * len;
      ball.ground = true; ball.air = 0;
      ball.spin = vt / R;
    } else {
      ball.ground = false; ball.air += dt;
      ball.maxAirY = Math.max(ball.maxAirY, ball.y - gy);
    }
    if (fever > 0 && !night) ball.vx = Math.max(ball.vx, 500);
    ball.angle += ball.spin * dt;
  }

  function landing(vn, speed, s) {
    const q = Math.abs(vn) / Math.max(speed, 1);
    const sx = ball.x, sy = ball.y - R;
    const airPts = Math.round(ball.air * 10) * 5;
    if (q < 0.28 && s < -0.05) {
      perfectStreak++;
      const pts = 50 * perfectStreak + airPts;
      bonus += pts;
      if (perfectStreak >= 3 && fever <= 0) {
        fever = 1; popText('FEVER!', '#ffe14d', 46); beep(880, 0.3, 'square', 0.08);
      } else {
        popText(perfectStreak > 1 ? `Perfekt ×${perfectStreak}  +${pts}` : `Perfekte Landung +${pts}`, '#fff7a8', 30);
      }
      burst(sx, sy, 18, ['#fff', '#ffd23f', '#ff7a2f']);
      beep(520 + perfectStreak * 80, 0.14);
    } else if (q > 0.55) {
      perfectStreak = 0; fever = 0;
      popText('Autsch!', '#ffb3b3', 26);
      beep(160, 0.18, 'triangle', 0.1);
    } else if (airPts > 0) {
      bonus += airPts;
    }
    if (ball.maxAirY > 900) { bonus += 300; popText('Riesensprung! +300', '#9ff0ff', 34); }
    else if (ball.maxAirY > 550) { bonus += 100; popText('Hoch hinaus! +100', '#9ff0ff', 28); }
    ball.maxAirY = 0;
  }

  // ---------- Update ----------
  let acc = 0;
  function update(dt) {
    elapsed += dt;
    if (state === 'play') {
      acc += dt;
      while (acc >= STEP) { physics(STEP); acc -= STEP; }

      timeLeft -= dt;
      const meters = Math.max(0, Math.floor(ball.x / PX_PER_M));
      score = meters + bonus;

      if (ball.x >= nextCheckpoint && timeLeft > 0) {
        timeLeft += 15;
        popText('Checkpoint! +15 s', '#b6ffb0', 38);
        beep(660, 0.25, 'square', 0.07);
        burst(ball.x, ball.y, 30, ['#7ed957', '#fff', '#5ec8f2']);
        checkpointGap += 2500; nextCheckpoint += checkpointGap;
      }
      if (timeLeft <= 0 && fever > 0) fever = 0;

      if (timeLeft <= 0) {
        const sp = Math.hypot(ball.vx, ball.vy);
        if (ball.ground && sp < 60) stallTimer += dt; else stallTimer = 0;
        if (stallTimer > 0.6 || timeLeft < -25) {
          state = 'over'; overTimer = 0; pressing = false;
          if (score > best) { best = score; newBest = true; saveBest(best); }
        }
      }

      // Kamera
      const gy = terrain.height(ball.x);
      const top = Math.max(ball.y + R * 4, 650);
      const viewH = top - cam.bottom;
      const base = clamp(H / 760, 0.45, 1.3);
      const target = Math.min(base, (H * 0.92) / viewH);
      cam.scale = lerp(cam.scale, target, 1 - Math.exp(-dt * 3));
      cam.x = ball.x - (W * 0.28) / cam.scale;

      terrain.ensure(cam.x + W / cam.scale + 1500);
      terrain.trim(cam.x - 1500);

      // Spur
      const sp = Math.hypot(ball.vx, ball.vy);
      if (!ball.ground || fever > 0 || sp > 1100) trail.push({ x: ball.x, y: ball.y, t: 0 });
      void gy;
    } else if (state === 'over') {
      overTimer += dt;
    } else {
      // Menü: Gelände langsam scrollen lassen
      if (!terrain) { reset(); }
      cam.scale = clamp(H / 760, 0.45, 1.3);
      cam.x += 120 * dt;
      terrain.ensure(cam.x + W / cam.scale + 1500);
    }

    if (fever > 0 && state === 'play') {
      particles.push({ x: ball.x - R * 0.6, y: ball.y + rand(-R, R) * 0.6, vx: rand(-80, -20), vy: rand(-40, 40), life: 0.5, t: 0, c: Math.random() < 0.5 ? '#ffe14d' : '#ff7a2f', r: rand(3, 6) });
    }
    for (const p of particles) { p.t += dt; p.vy -= 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    particles = particles.filter(p => p.t < p.life);
    for (const t of trail) t.t += dt;
    trail = trail.filter(t => t.t < 0.45);
    for (const t of texts) t.t += dt;
    texts = texts.filter(t => t.t < 1.4);
  }

  // ---------- Zeichnen ----------
  const toSX = x => (x - cam.x) * cam.scale;
  const toSY = y => H - (y - cam.bottom) * cam.scale;

  let stripePattern = null;
  function makeStripes() {
    const c = document.createElement('canvas'); c.width = c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(24, 0); g.lineTo(0, 24); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(48, 0); g.lineTo(48, 24); g.lineTo(24, 48); g.lineTo(0, 48); g.closePath(); g.fill();
    stripePattern = ctx.createPattern(c, 'repeat');
  }

  function dayPhase() {
    // 0 = Mittag, 1 = Nacht
    if (state !== 'play' && state !== 'over') return 0.05;
    return clamp(1 - timeLeft / DAY_LENGTH, 0, 1);
  }

  function drawSky(ph) {
    const [top, bot] = gradientStops([
      [0, '#4fb3ff', '#bfe9ff'],
      [0.55, '#5a8fe0', '#ffd9a0'],
      [0.8, '#6b4a9c', '#ff8a5c'],
      [1, '#120c2e', '#3a2363'],
    ], ph);
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);

    // Sterne
    const starA = clamp((ph - 0.7) / 0.3, 0, 1);
    if (starA > 0) {
      for (const s of stars) {
        ctx.globalAlpha = starA * (0.6 + 0.4 * Math.sin(elapsed * 2 + s.p));
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Sonne / Mond
    const sunY = lerp(H * 0.16, H * 0.95, clamp(ph / 0.95, 0, 1));
    const sunX = W * 0.78;
    const sr = Math.min(W, H) * 0.07;
    const glow = ctx.createRadialGradient(sunX, sunY, sr * 0.5, sunX, sunY, sr * 3);
    glow.addColorStop(0, ph < 0.6 ? 'rgba(255,250,200,0.55)' : 'rgba(255,170,90,0.5)');
    glow.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sunX, sunY, sr * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mixColor('#fff6b0', '#ff7a3a', clamp(ph / 0.85, 0, 1));
    ctx.beginPath(); ctx.arc(sunX, sunY, sr, 0, Math.PI * 2); ctx.fill();
    if (ph > 0.85) {
      ctx.globalAlpha = clamp((ph - 0.85) / 0.15, 0, 1);
      ctx.fillStyle = '#f4f1ff';
      ctx.beginPath(); ctx.arc(W * 0.2, H * 0.18, sr * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = gradientStops([[0, '#120c2e', '#120c2e'], [1, '#120c2e', '#120c2e']], 0)[0];
      ctx.beginPath(); ctx.arc(W * 0.2 + sr * 0.35, H * 0.18 - sr * 0.15, sr * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Wolken (Parallaxe)
    ctx.fillStyle = ph > 0.75 ? 'rgba(200,190,255,0.25)' : 'rgba(255,255,255,0.85)';
    for (const c of clouds) {
      const span = W + 400;
      let x = ((c.x - cam.x * 0.08 * c.s) % span + span) % span - 200;
      const y = c.y * H, s = c.s * Math.min(W, H) * 0.06;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.arc(x + s * 1.1, y - s * 0.4, s * 1.2, 0, Math.PI * 2);
      ctx.arc(x + s * 2.3, y, s * 0.95, 0, Math.PI * 2);
      ctx.rect(x, y, s * 2.3, s * 0.9);
      ctx.fill();
    }
  }

  function drawBackHills(ph, factor, height, base, colA, colB, seed) {
    ctx.fillStyle = mixColor(colA, colB, ph);
    ctx.beginPath(); ctx.moveTo(0, H);
    const off = cam.x * factor * cam.scale;
    for (let sx = 0; sx <= W + 8; sx += 8) {
      const u = (sx + off) / 260;
      const y = H * base - height * (0.55 * Math.sin(u + seed) + 0.3 * Math.sin(u * 2.3 + seed * 2) + 0.15 * Math.sin(u * 5.1));
      ctx.lineTo(sx, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }

  function drawTerrain(ph) {
    const p = terrain.pts;
    const x0 = cam.x, x1 = cam.x + W / cam.scale;
    const step = Math.max(3, 5 / cam.scale);
    const dark = clamp((ph - 0.6) / 0.4, 0, 1) * 0.6;

    // Jeder Hügel (Tal → Gipfel → Tal) bekommt seine Farbe
    let i = Math.max(0, terrain.seg(x0) - 1);
    while (i < p.length - 1 && p[i].x < x1) {
      const a = p[i], b = p[i + 1];
      const pal = PALETTES[(a.y > b.y ? a.pal : b.pal) % PALETTES.length];
      ctx.beginPath();
      ctx.moveTo(toSX(a.x), H + 2);
      for (let x = a.x; x < b.x; x += step) ctx.lineTo(toSX(x), toSY(terrain.height(x)));
      ctx.lineTo(toSX(b.x), toSY(b.y));
      ctx.lineTo(toSX(b.x) + 0.5, H + 2);
      ctx.closePath();
      const gr = ctx.createLinearGradient(0, toSY(450), 0, H);
      gr.addColorStop(0, mixColor(pal[0], '#1b1440', dark));
      gr.addColorStop(1, mixColor(pal[1], '#0d0a24', dark));
      ctx.fillStyle = gr; ctx.fill();
      i++;
    }

    // Streifen über dem ganzen Gelände
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, H + 2);
    for (let x = x0 - step; x <= x1 + step; x += step) ctx.lineTo(toSX(x), toSY(terrain.height(x)));
    ctx.lineTo(W, H + 2); ctx.closePath();
    if (stripePattern && stripePattern.setTransform) {
      const m = new DOMMatrix().translateSelf(-cam.x * cam.scale, H + cam.bottom * cam.scale).scaleSelf(cam.scale * 1.6);
      stripePattern.setTransform(m);
    }
    ctx.fillStyle = stripePattern || 'rgba(0,0,0,0)'; ctx.fill();
    // Kante
    ctx.lineWidth = Math.max(3, 7 * cam.scale);
    ctx.strokeStyle = mixColor('#fffbe6', '#7c6fb8', dark);
    ctx.beginPath();
    for (let x = x0 - step; x <= x1 + step; x += step) {
      const sx = toSX(x), sy = toSY(terrain.height(x));
      if (x === x0 - step) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawCheckpoint() {
    if (state !== 'play') return;
    const x = nextCheckpoint;
    const sx = toSX(x);
    if (sx < -50 || sx > W + 50) return;
    const gy = toSY(terrain.height(x));
    const h = 140 * cam.scale;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, 5 * cam.scale);
    ctx.beginPath(); ctx.moveTo(sx, gy); ctx.lineTo(sx, gy - h); ctx.stroke();
    ctx.fillStyle = '#ff3d6e';
    const wave = Math.sin(elapsed * 6) * 6 * cam.scale;
    ctx.beginPath(); ctx.moveTo(sx, gy - h); ctx.lineTo(sx + 60 * cam.scale, gy - h + 18 * cam.scale + wave); ctx.lineTo(sx, gy - h + 38 * cam.scale); ctx.fill();
  }

  function drawBall() {
    // Spur
    for (const t of trail) {
      const a = 1 - t.t / 0.45;
      ctx.fillStyle = fever > 0 ? `rgba(255,214,60,${a * 0.5})` : `rgba(255,255,255,${a * 0.35})`;
      ctx.beginPath(); ctx.arc(toSX(t.x), toSY(t.y), R * cam.scale * a * 0.8, 0, Math.PI * 2); ctx.fill();
    }

    const sx = toSX(ball.x), sy = toSY(ball.y), r = R * cam.scale;

    // Schatten auf dem Boden
    const gy = terrain.height(ball.x);
    const hAbove = ball.y - R - gy;
    const shA = clamp(1 - hAbove / 600, 0, 1) * 0.35;
    if (shA > 0.01) {
      ctx.fillStyle = `rgba(0,0,0,${shA})`;
      ctx.beginPath(); ctx.ellipse(sx, toSY(gy) - 2, r * (1 - hAbove / 1500), r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    }

    if (fever > 0) {
      const gl = ctx.createRadialGradient(sx, sy, r * 0.8, sx, sy, r * 2.2);
      gl.addColorStop(0, 'rgba(255,225,77,0.6)'); gl.addColorStop(1, 'rgba(255,225,77,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2); ctx.fill();
    }

    // Beim Drücken leicht gestaucht = "schwer"
    const squash = pressing && state === 'play' ? 0.92 : 1;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1 / squash, squash);
    ctx.rotate(ball.angle);
    if (ballReady) ctx.drawImage(ballImg, -r, -r, r * 2, r * 2);
    else { ctx.fillStyle = '#e8621f'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();

    // Ball außerhalb des Bildes (zu hoch)? Pfeil anzeigen
    if (sy < -r) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(sx, 8); ctx.lineTo(sx - 10, 26); ctx.lineTo(sx + 10, 26); ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(toSX(p.x), toSY(p.y), p.r * Math.max(cam.scale, 0.6), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function txt(s, x, y, size, color = '#fff', align = 'center', weight = 800) {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 7); ctx.strokeStyle = 'rgba(30,15,50,0.55)'; ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }

  function drawHUD() {
    const u = clamp(Math.min(W, H) / 400, 0.8, 1.6);
    const pad = 14 * u;
    txt(`${score}`, pad, pad + 16 * u, 30 * u, '#fff', 'left');
    txt(`${Math.max(0, Math.floor(ball.x / PX_PER_M))} m`, pad, pad + 46 * u, 15 * u, '#fff', 'left', 700);

    // Zeitbalken
    const bw = Math.min(W * 0.36, 260 * u), bh = 14 * u, bx = W - bw - pad, by = pad + 8 * u;
    ctx.fillStyle = 'rgba(30,15,50,0.45)';
    roundRect(bx - 3, by - 3, bw + 6, bh + 6, (bh + 6) / 2); ctx.fill();
    const f = clamp(timeLeft / DAY_LENGTH, 0, 1);
    ctx.fillStyle = f > 0.3 ? '#ffd23f' : '#ff6b4a';
    if (f > 0) { roundRect(bx, by, bw * f, bh, bh / 2); ctx.fill(); }
    txt(timeLeft > 0 ? `☀ ${Math.ceil(timeLeft)} s` : '☾ Nacht', bx + bw, by + bh + 16 * u, 14 * u, '#fff', 'right', 700);

    if (perfectStreak > 1 || fever > 0) {
      txt(fever > 0 ? 'FEVER' : `Serie ×${perfectStreak}`, W / 2, pad + 16 * u, 20 * u, fever > 0 ? '#ffe14d' : '#fff7a8');
    }

    // Popup-Texte
    let y = H * 0.3;
    for (const t of texts) {
      const a = t.t < 1 ? 1 : 1 - (t.t - 1) / 0.4;
      const sc = t.t < 0.12 ? 0.6 + t.t / 0.12 * 0.4 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      txt(t.msg, W / 2, y - t.t * 30 * u, t.size * u * 0.8 * sc, t.color);
      y += t.size * u;
    }
    ctx.globalAlpha = 1;

    if (elapsed < 4 && state === 'play') {
      ctx.globalAlpha = clamp(4 - elapsed, 0, 1);
      txt('Halten = abtauchen · Loslassen = fliegen', W / 2, H * 0.62, 17 * u, '#fff', 'center', 700);
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawMenu() {
    const u = clamp(Math.min(W, H) / 400, 0.8, 1.7);
    ctx.fillStyle = 'rgba(20,10,40,0.25)'; ctx.fillRect(0, 0, W, H);
    const bob = Math.sin(elapsed * 2.5) * 10 * u;
    const r = 60 * u;
    ctx.save(); ctx.translate(W / 2, H * 0.3 + bob); ctx.rotate(elapsed * 1.2);
    if (ballReady) ctx.drawImage(ballImg, -r, -r, r * 2, r * 2);
    ctx.restore();
    txt('Müllerball', W / 2, H * 0.3 + r + 40 * u, 46 * u, '#fff');
    txt('Hügelflug', W / 2, H * 0.3 + r + 80 * u, 22 * u, '#ffd23f');
    const pulse = 0.75 + 0.25 * Math.sin(elapsed * 4);
    ctx.globalAlpha = pulse;
    txt('Tippen zum Starten', W / 2, H * 0.78, 22 * u, '#fff', 'center', 700);
    ctx.globalAlpha = 1;
    txt('Halten = abtauchen · Loslassen = fliegen · sauber auf Abhängen landen', W / 2, H * 0.86, 13 * u, '#fff', 'center', 600);
    if (best > 0) txt(`Rekord: ${best}`, W / 2, H * 0.93, 15 * u, '#ffe14d', 'center', 700);
  }

  function drawOver() {
    const u = clamp(Math.min(W, H) / 400, 0.8, 1.7);
    const a = clamp(overTimer / 0.5, 0, 1);
    ctx.fillStyle = `rgba(15,8,35,${0.55 * a})`; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    txt('Gute Nacht!', W / 2, H * 0.28, 40 * u, '#fff');
    txt(`${score} Punkte`, W / 2, H * 0.43, 34 * u, '#ffd23f');
    txt(`${Math.max(0, Math.floor(ball.x / PX_PER_M))} m Strecke · ${bonus} Bonus`, W / 2, H * 0.52, 16 * u, '#fff', 'center', 600);
    txt(newBest ? '★ Neuer Rekord! ★' : `Rekord: ${best}`, W / 2, H * 0.61, 20 * u, newBest ? '#9ff0ff' : '#fff', 'center', 700);
    if (overTimer > 0.8) {
      ctx.globalAlpha = a * (0.75 + 0.25 * Math.sin(elapsed * 4));
      txt('Tippen für neue Runde', W / 2, H * 0.76, 22 * u, '#fff', 'center', 700);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const ph = dayPhase();
    drawSky(ph);
    drawBackHills(ph, 0.12, H * 0.16, 0.62, '#9fd3ff', '#2a2058', 1.3);
    drawBackHills(ph, 0.25, H * 0.13, 0.74, '#7cc4f0', '#21194a', 4.1);
    drawTerrain(ph);
    drawCheckpoint();
    if (state !== 'menu') { drawBall(); drawParticles(); }
    if (state === 'play') drawHUD();
    if (state === 'over') drawOver();
    if (state === 'menu') drawMenu();
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  resize();
  makeStripes();
  initScenery();
  reset();
  cam.x = -400;
  requestAnimationFrame(frame);
})();

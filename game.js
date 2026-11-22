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

  // Retro-Neon: [Leuchtlinie, Füll-Tönung]
  const PALETTES = [
    ['#ff2a6d', '#5a0a3a'], ['#05d9e8', '#06345a'], ['#b967ff', '#33105e'],
    ['#01ffc3', '#04443f'], ['#fffb96', '#4a3a1a'], ['#ff8a00', '#4f1e08'],
  ];
  const FONT = '"Orbitron", "Arial Black", system-ui, sans-serif';

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
  let texts = [], particles = [], trail = [], stars = [];
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
        fever = 1; popText('FEVER!', '#fffb96', 46); beep(880, 0.3, 'square', 0.08);
      } else {
        popText(perfectStreak > 1 ? `Perfekt ×${perfectStreak}  +${pts}` : `Perfekte Landung +${pts}`, '#fffb96', 30);
      }
      burst(sx, sy, 18, ['#fff', '#ff2a6d', '#05d9e8', '#fffb96']);
      beep(520 + perfectStreak * 80, 0.14);
    } else if (q > 0.55) {
      perfectStreak = 0; fever = 0;
      popText('Autsch!', '#ff2a6d', 26);
      beep(160, 0.18, 'triangle', 0.1);
    } else if (airPts > 0) {
      bonus += airPts;
    }
    if (ball.maxAirY > 900) { bonus += 300; popText('Riesensprung! +300', '#05d9e8', 34); }
    else if (ball.maxAirY > 550) { bonus += 100; popText('Hoch hinaus! +100', '#05d9e8', 28); }
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
        popText('Checkpoint! +15 s', '#01ffc3', 38);
        beep(660, 0.25, 'square', 0.07);
        burst(ball.x, ball.y, 30, ['#01ffc3', '#fff', '#05d9e8', '#b967ff']);
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
      particles.push({ x: ball.x - R * 0.6, y: ball.y + rand(-R, R) * 0.6, vx: rand(-80, -20), vy: rand(-40, 40), life: 0.5, t: 0, c: Math.random() < 0.5 ? '#ff2a6d' : '#05d9e8', r: rand(3, 6) });
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

  // ----- Retro-Neon Grafik -----
  let gridPattern = null, scanPattern = null, sunCanvas = null, sunSize = 0;

  function makePatterns() {
    const c = document.createElement('canvas'); c.width = c.height = 40;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 1); g.lineTo(40, 1); g.moveTo(1, 0); g.lineTo(1, 40); g.stroke();
    gridPattern = ctx.createPattern(c, 'repeat');

    const s = document.createElement('canvas'); s.width = 4; s.height = 4;
    const sg = s.getContext('2d');
    sg.fillStyle = 'rgba(0,0,0,0.22)'; sg.fillRect(0, 0, 4, 1);
    scanPattern = ctx.createPattern(s, 'repeat');
  }

  function makeSun(r) {
    // Klassische Synthwave-Sonne mit Streifen-Lücken in der unteren Hälfte
    sunSize = r;
    sunCanvas = document.createElement('canvas');
    sunCanvas.width = sunCanvas.height = Math.ceil(r * 2 * DPR);
    const g = sunCanvas.getContext('2d');
    g.scale(DPR, DPR);
    const gr = g.createLinearGradient(0, 0, 0, r * 2);
    gr.addColorStop(0, '#fffb96'); gr.addColorStop(0.45, '#ff9a3c'); gr.addColorStop(1, '#ff2a6d');
    g.fillStyle = gr; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) {
      const y = r * (1.0 + i * 0.14), h = r * (0.025 + i * 0.012);
      g.fillRect(0, y, r * 2, h);
    }
  }

  function dayPhase() {
    // 0 = Abendbeginn, 1 = tiefe Nacht
    if (state !== 'play' && state !== 'over') return 0.05;
    return clamp(1 - timeLeft / DAY_LENGTH, 0, 1);
  }

  const horizon = () => H * 0.6;

  function drawSky(ph) {
    const [top, bot] = gradientStops([
      [0, '#2b0b5e', '#ff4f8b'],
      [0.6, '#1a0640', '#c21e74'],
      [1, '#06010f', '#3a0a5c'],
    ], ph);
    const hz = horizon();
    const gr = ctx.createLinearGradient(0, 0, 0, hz);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, hz + 1);

    // Sterne (werden zur Nacht hin heller)
    for (const s of stars) {
      ctx.globalAlpha = (0.25 + 0.75 * ph) * (0.6 + 0.4 * Math.sin(elapsed * 2 + s.p));
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x * W, s.y * hz, s.r * 1.4, s.r * 1.4);
    }
    ctx.globalAlpha = 1;

    // Sonne sinkt hinter den Horizont
    const r = Math.min(W, H) * 0.22;
    if (!sunCanvas || Math.abs(sunSize - r) > 1) makeSun(r);
    const cx = W * 0.62, cy = lerp(hz - r * 0.55, hz + r * 1.05, ph);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, hz); ctx.clip();
    ctx.shadowColor = '#ff2a6d'; ctx.shadowBlur = 60;
    ctx.drawImage(sunCanvas, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  function drawFloor(ph) {
    // Perspektiv-Gitter unter dem Horizont
    const hz = horizon();
    const gr = ctx.createLinearGradient(0, hz, 0, H);
    gr.addColorStop(0, mixColor('#2a0845', '#0b0220', ph)); gr.addColorStop(1, '#05010d');
    ctx.fillStyle = gr; ctx.fillRect(0, hz, W, H - hz);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,42,109,0.55)'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#ff2a6d'; ctx.shadowBlur = 8;
    ctx.beginPath();
    const vp = W * 0.5, spacing = 60;
    const off = ((cam.x * 0.35 * cam.scale) % spacing + spacing) % spacing;
    for (let k = -40; k <= 40; k++) {
      const xh = vp + (k * spacing - off);
      ctx.moveTo(xh, hz); ctx.lineTo(vp + (xh - vp) * 6, H);
    }
    for (let i = 1; i < 14; i++) {
      const t = i / 14, y = hz + (H - hz) * t * t;
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.restore();
    // Horizontlinie
    ctx.fillStyle = '#ff6ec7'; ctx.fillRect(0, hz - 1, W, 2);
  }

  function drawBackHills(ph, factor, height, base, line, seed) {
    const off = cam.x * factor * cam.scale;
    const pts = [];
    for (let sx = -10; sx <= W + 10; sx += 10) {
      const u = (sx + off) / 240;
      // spitze Gipfel = Retro-Berge
      const v = (1 - Math.abs(Math.sin(u + seed))) * 0.65 + (1 - Math.abs(Math.sin(u * 2.1 + seed * 2))) * 0.35;
      pts.push([sx, H * base - height * v]);
    }
    ctx.beginPath(); ctx.moveTo(-10, H);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(W + 10, H); ctx.closePath();
    ctx.fillStyle = mixColor('#1d0638', '#0a0218', ph); ctx.fill();
    ctx.save();
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.shadowColor = line; ctx.shadowBlur = 12;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
    ctx.restore();
  }

  function drawTerrain(ph) {
    const p = terrain.pts;
    const x0 = cam.x, x1 = cam.x + W / cam.scale;
    const step = Math.max(3, 5 / cam.scale);
    const lw = Math.max(3, 6 * cam.scale);

    // Füllung pro Hügel: dunkel, leicht in Neonfarbe getönt
    let i = Math.max(0, terrain.seg(x0) - 1);
    const segs = [];
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
      gr.addColorStop(0, mixColor(pal[1], '#0a0218', ph * 0.4));
      gr.addColorStop(1, '#05010d');
      ctx.fillStyle = gr; ctx.fill();
      segs.push([a, b, pal[0]]);
      i++;
    }

    // Gitter über dem Gelände
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, H + 2);
    for (let x = x0 - step; x <= x1 + step; x += step) ctx.lineTo(toSX(x), toSY(terrain.height(x)));
    ctx.lineTo(W, H + 2); ctx.closePath();
    if (gridPattern && gridPattern.setTransform) {
      const m = new DOMMatrix().translateSelf(-cam.x * cam.scale, H + cam.bottom * cam.scale).scaleSelf(cam.scale * 1.5);
      gridPattern.setTransform(m);
    }
    ctx.fillStyle = gridPattern || 'rgba(0,0,0,0)'; ctx.fill();
    ctx.restore();

    // Leuchtende Kanten (pro Hügel eigene Farbe)
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [a, b, col] of segs) {
      ctx.beginPath();
      const xs = Math.max(a.x, x0 - step), xe = Math.min(b.x, x1 + step);
      for (let x = xs; x <= xe; x += step) {
        const sx = toSX(x), sy = toSY(terrain.height(x));
        if (x === xs) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.lineTo(toSX(xe), toSY(terrain.height(xe)));
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 18;
      ctx.lineWidth = lw; ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = lw * 0.3; ctx.stroke();
    }
    ctx.restore();
  }

  function drawCheckpoint() {
    if (state !== 'play') return;
    const x = nextCheckpoint;
    const sx = toSX(x);
    if (sx < -50 || sx > W + 50) return;
    const gy = toSY(terrain.height(x));
    const h = 140 * cam.scale;
    ctx.save();
    ctx.shadowColor = '#01ffc3'; ctx.shadowBlur = 16;
    ctx.strokeStyle = '#01ffc3'; ctx.lineWidth = Math.max(2, 5 * cam.scale);
    ctx.beginPath(); ctx.moveTo(sx, gy); ctx.lineTo(sx, gy - h); ctx.stroke();
    const wave = Math.sin(elapsed * 6) * 6 * cam.scale;
    ctx.beginPath(); ctx.moveTo(sx, gy - h); ctx.lineTo(sx + 60 * cam.scale, gy - h + 18 * cam.scale + wave); ctx.lineTo(sx, gy - h + 38 * cam.scale); ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawBall() {
    // Spur
    for (const t of trail) {
      const a = 1 - t.t / 0.45;
      ctx.fillStyle = fever > 0 ? `rgba(255,42,109,${a * 0.55})` : `rgba(5,217,232,${a * 0.4})`;
      ctx.beginPath(); ctx.arc(toSX(t.x), toSY(t.y), R * cam.scale * a * 0.8, 0, Math.PI * 2); ctx.fill();
    }

    const sx = toSX(ball.x), sy = toSY(ball.y), r = R * cam.scale;

    // Neon-Reflex auf dem Boden
    const gy = terrain.height(ball.x);
    const hAbove = ball.y - R - gy;
    const shA = clamp(1 - hAbove / 600, 0, 1) * 0.5;
    if (shA > 0.01) {
      ctx.fillStyle = `rgba(255,110,199,${shA})`;
      ctx.beginPath(); ctx.ellipse(sx, toSY(gy) - 2, r * (1 - hAbove / 1500), r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    }

    const squash = pressing && state === 'play' ? 0.92 : 1;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1 / squash, squash);
    ctx.shadowColor = fever > 0 ? '#fffb96' : '#ff6ec7';
    ctx.shadowBlur = fever > 0 ? 40 : 22;
    ctx.save();
    ctx.rotate(ball.angle);
    if (ballReady) ctx.drawImage(ballImg, -r, -r, r * 2, r * 2);
    else { ctx.fillStyle = '#e8621f'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.shadowBlur = 10;
    ctx.strokeStyle = fever > 0 ? '#fffb96' : '#05d9e8'; ctx.lineWidth = Math.max(1.5, 2.5 * cam.scale);
    ctx.beginPath(); ctx.arc(0, 0, r + 1, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    if (sy < -r) {
      ctx.fillStyle = '#05d9e8';
      ctx.beginPath(); ctx.moveTo(sx, 8); ctx.lineTo(sx - 10, 26); ctx.lineTo(sx + 10, 26); ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.c;
      const s = p.r * Math.max(cam.scale, 0.6) * 1.6;
      ctx.fillRect(toSX(p.x) - s / 2, toSY(p.y) - s / 2, s, s);   // eckige Pixel-Partikel
    }
    ctx.globalAlpha = 1;
  }

  function txt(s, x, y, size, color = '#fff', align = 'center', weight = 800) {
    ctx.save();
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = size * 0.6;
    ctx.fillStyle = color; ctx.fillText(s, x, y);
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.globalAlpha *= 0.55; ctx.fillText(s, x, y);
    ctx.restore();
  }

  function drawHUD() {
    const u = clamp(Math.min(W, H) / 400, 0.8, 1.6);
    const pad = 14 * u;
    txt(`${score}`, pad, pad + 16 * u, 28 * u, '#05d9e8', 'left', 900);
    txt(`${Math.max(0, Math.floor(ball.x / PX_PER_M))} M`, pad, pad + 46 * u, 13 * u, '#ff6ec7', 'left', 700);

    // Zeitbalken
    const bw = Math.min(W * 0.36, 260 * u), bh = 12 * u, bx = W - bw - pad, by = pad + 8 * u;
    const f = clamp(timeLeft / DAY_LENGTH, 0, 1);
    const col = f > 0.3 ? '#fffb96' : '#ff2a6d';
    ctx.save();
    ctx.strokeStyle = '#b967ff'; ctx.lineWidth = 2; ctx.shadowColor = '#b967ff'; ctx.shadowBlur = 10;
    ctx.strokeRect(bx - 4, by - 4, bw + 8, bh + 8);
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14;
    if (f > 0) ctx.fillRect(bx, by, bw * f, bh);
    ctx.restore();
    txt(timeLeft > 0 ? `ZEIT ${Math.ceil(timeLeft)}` : 'NACHT', bx + bw, by + bh + 18 * u, 12 * u, '#fff', 'right', 700);

    if (perfectStreak > 1 || fever > 0) {
      txt(fever > 0 ? 'FEVER' : `SERIE ×${perfectStreak}`, W / 2, pad + 16 * u, 18 * u, fever > 0 ? '#fffb96' : '#ff6ec7', 'center', 900);
    }

    let y = H * 0.3;
    for (const t of texts) {
      const a = t.t < 1 ? 1 : 1 - (t.t - 1) / 0.4;
      const sc = t.t < 0.12 ? 0.6 + t.t / 0.12 * 0.4 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      txt(t.msg.toUpperCase(), W / 2, y - t.t * 30 * u, t.size * u * 0.62 * sc, t.color, 'center', 900);
      y += t.size * u * 0.85;
    }
    ctx.globalAlpha = 1;

    if (elapsed < 4 && state === 'play') {
      ctx.globalAlpha = clamp(4 - elapsed, 0, 1);
      txt('HALTEN = ABTAUCHEN · LOSLASSEN = FLIEGEN', W / 2, H * 0.62, 13 * u, '#fff', 'center', 700);
      ctx.globalAlpha = 1;
    }
  }

  function drawMenu() {
    const u = clamp(Math.min(W, H) / 400, 0.8, 1.7);
    ctx.fillStyle = 'rgba(10,2,24,0.35)'; ctx.fillRect(0, 0, W, H);
    const bob = Math.sin(elapsed * 2.5) * 10 * u;
    const r = 52 * u;
    ctx.save(); ctx.translate(W / 2, H * 0.27 + bob);
    ctx.shadowColor = '#ff6ec7'; ctx.shadowBlur = 40;
    ctx.save(); ctx.rotate(elapsed * 1.2);
    if (ballReady) ctx.drawImage(ballImg, -r, -r, r * 2, r * 2);
    ctx.restore();
    ctx.strokeStyle = '#05d9e8'; ctx.lineWidth = 3; ctx.shadowColor = '#05d9e8'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    txt('MÜLLERBALL', W / 2, H * 0.27 + r + 40 * u, 38 * u, '#ff2a6d', 'center', 900);
    txt('HÜGELFLUG', W / 2, H * 0.27 + r + 74 * u, 18 * u, '#05d9e8', 'center', 700);
    ctx.globalAlpha = 0.6 + 0.4 * (Math.sin(elapsed * 5) > 0 ? 1 : 0);
    txt('TIPPEN ZUM STARTEN', W / 2, H * 0.77, 18 * u, '#fffb96', 'center', 800);
    ctx.globalAlpha = 1;
    txt('Halten = abtauchen · Loslassen = fliegen · sauber auf Abhängen landen', W / 2, H * 0.86, 11 * u, '#fff', 'center', 600);
    if (best > 0) txt(`HIGHSCORE ${best}`, W / 2, H * 0.93, 13 * u, '#01ffc3', 'center', 800);
  }

  function drawOver() {
    const u = clamp(Math.min(W, H) / 400, 0.8, 1.7);
    const a = clamp(overTimer / 0.5, 0, 1);
    ctx.fillStyle = `rgba(8,2,20,${0.6 * a})`; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    txt('GAME OVER', W / 2, H * 0.27, 36 * u, '#ff2a6d', 'center', 900);
    txt(`${score} PUNKTE`, W / 2, H * 0.42, 28 * u, '#fffb96', 'center', 900);
    txt(`${Math.max(0, Math.floor(ball.x / PX_PER_M))} m Strecke · ${bonus} Bonus`, W / 2, H * 0.51, 13 * u, '#fff', 'center', 600);
    txt(newBest ? '★ NEUER HIGHSCORE ★' : `HIGHSCORE ${best}`, W / 2, H * 0.6, 16 * u, newBest ? '#01ffc3' : '#05d9e8', 'center', 800);
    if (overTimer > 0.8) {
      ctx.globalAlpha = a * (0.6 + 0.4 * (Math.sin(elapsed * 5) > 0 ? 1 : 0));
      txt('TIPPEN FÜR NEUE RUNDE', W / 2, H * 0.76, 18 * u, '#fffb96', 'center', 800);
    }
    ctx.globalAlpha = 1;
  }

  function drawCRT() {
    if (scanPattern) { ctx.fillStyle = scanPattern; ctx.fillRect(0, 0, W, H); }
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const ph = dayPhase();
    drawSky(ph);
    drawFloor(ph);
    drawBackHills(ph, 0.1, H * 0.2, 0.6, '#b967ff', 1.3);
    drawBackHills(ph, 0.22, H * 0.12, 0.7, '#05d9e8', 4.1);
    drawTerrain(ph);
    drawCheckpoint();
    if (state !== 'menu') { drawBall(); drawParticles(); }
    if (state === 'play') drawHUD();
    if (state === 'over') drawOver();
    if (state === 'menu') drawMenu();
    drawCRT();
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
  makePatterns();
  initScenery();
  reset();
  cam.x = -400;
  requestAnimationFrame(frame);
})();

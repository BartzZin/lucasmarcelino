(() => {
  'use strict';

  const canvas = document.querySelector('#particles');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const TEXT_SELECTOR = 'header a, .intro .eyebrow, .intro h1, .intro p, .actions, .story h2, .story h3, .story p, .story small, .story time, #contato a, footer > *';
  const field = new Float32Array(12);
  const pointer = { x: 0, y: 0, active: false };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // Pre-render 3 soft luminous dot sprites (violet, lilac, mint) + 2 halo glow sprites
  // once at startup — replaces 325 arc()+fill() calls per frame with fast drawImage stamps.
  function makeDotSprite(coreHex, midRgba, outerRgba) {
    const off = document.createElement('canvas');
    off.width = off.height = 24;
    const g = off.getContext('2d');
    if (!g) return off;
    const grad = g.createRadialGradient(12, 12, 0, 12, 12, 12);
    grad.addColorStop(0, coreHex);
    grad.addColorStop(.32, coreHex);
    grad.addColorStop(.52, midRgba);
    grad.addColorStop(1, outerRgba);
    g.fillStyle = grad;
    g.fillRect(0, 0, 24, 24);
    return off;
  }

  function makeGlowSprite(centerHex, mid1, mid2, edge) {
    const off = document.createElement('canvas');
    off.width = off.height = 32;
    const g = off.getContext('2d');
    if (!g) return off;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, centerHex);
    grad.addColorStop(.2, mid1);
    grad.addColorStop(.56, mid2);
    grad.addColorStop(1, edge);
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return off;
  }

  const dotSprites = [
    makeDotSprite('#b78cd0', 'rgba(177,134,200,.42)', 'rgba(177,134,200,0)'), // 0: violet
    makeDotSprite('#e4c9fb', 'rgba(222,194,246,.46)', 'rgba(222,194,246,0)'), // 1: lilac
    makeDotSprite('#b5f7d4', 'rgba(171,243,203,.46)', 'rgba(171,243,203,0)')  // 2: mint
  ];
  const glowViolet = makeGlowSprite('#f6e6ff', 'rgba(228,191,255,.72)', 'rgba(198,137,241,.23)', 'rgba(185,126,224,0)');
  const glowMint = makeGlowSprite('#ecfff5', 'rgba(176,247,210,.74)', 'rgba(130,232,184,.24)', 'rgba(130,232,184,0)');

  const IDLE_INTERVAL = 1000 / 26;
  const CINEMA_INTERVAL = 1000 / 42;

  let width = 0, height = 0, ratio = 1, points = [];
  let cachedBlocks = [];
  const activeLeft = new Float32Array(256);
  const activeRight = new Float32Array(256);
  const activeTop = new Float32Array(256);
  const activeBottom = new Float32Array(256);
  let activeCount = 0;

  let frame = 0, lastPaint = null, nextPaint = 0, elapsed = 0, fieldTime = -Infinity;
  let scrollImpulse = 0, scrollPosition = window.scrollY;
  let cinemaPlaying = false, cinemaMix = 0, cinemaSpeed = 1, cinemaFlow = 0;
  let scrollVelocity = 0;
  let reducedDirty = true;

  function cacheTextBlocks() {
    const sy = window.scrollY;
    const nodes = document.querySelectorAll(TEXT_SELECTOR);
    const list = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const b = node.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const fixed = !!node.closest('header');
      list.push({
        left: b.left,
        right: b.right,
        top: fixed ? b.top : b.top + sy,
        bottom: fixed ? b.bottom : b.bottom + sy,
        fixed
      });
    }
    cachedBlocks = list;
    reducedDirty = true;
  }

  function layout() {
    const box = canvas.getBoundingClientRect();
    width = box.width;
    height = box.height;
    if (width < 1 || height < 1) return;

    ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1_600_000 / (width * height)));
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));

    // Stratified positions keep the quieter parts of the background populated.
    // Seeded jitter avoids a visible grid and keeps rotation/resizing stable.
    const count = clamp(Math.round(width * height / 4300), 35, width < 800 ? 104 : 325);
    const cols = Math.max(1, Math.round(Math.sqrt(count * width / height)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const gap = Math.min(width / cols, height / rows);
    let seed = 25421;
    function random() {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    points = Array.from({ length: count }, (_, i) => {
      const depth = .22 + .78 * random();
      const tint = random();
      const sprite = tint > .87 ? 2 : (depth > .62 ? 1 : 0);
      return {
        x: (i % cols + .12 + .76 * random()) * width / cols,
        y: (Math.floor(i / cols) + .12 + .76 * random()) * height / rows,
        dx: 0,
        dy: 0,
        pulse: 0,
        depth,
        sprite,
        phase: random() * 6.2832,
        twinkleRate: .68 + random() * .95,
        radius: Math.max(.65 / ratio, Math.min(2.5 / ratio, gap * (.009 + .012 * depth)))
      };
    });

    cacheTextBlocks();
    reducedDirty = true;
    schedule();
  }

  function updateActiveBlocks(sy) {
    let count = 0;
    const limit = Math.min(cachedBlocks.length, activeLeft.length);
    for (let i = 0; i < cachedBlocks.length && count < limit; i++) {
      const b = cachedBlocks[i];
      const top = b.fixed ? b.top : b.top - sy;
      const bottom = b.fixed ? b.bottom : b.bottom - sy;
      if (bottom < -40 || top > height + 40) continue;
      activeLeft[count] = b.left;
      activeRight[count] = b.right;
      activeTop[count] = top;
      activeBottom[count] = bottom;
      count++;
    }
    activeCount = count;
  }

  function readingRoom(x, y) {
    let distance = 40;
    for (let i = 0; i < activeCount; i++) {
      const dx = Math.max(activeLeft[i] - x, x - activeRight[i], 0);
      const dy = Math.max(activeTop[i] - y, y - activeBottom[i], 0);
      const d = dx > dy ? dx : dy;
      if (d <= 7) return 0;
      if (d < distance) distance = d;
    }
    return clamp((distance - 7) / 33, 0, 1);
  }

  function draw(time, dt) {
    const sy = window.scrollY;
    updateActiveBlocks(sy);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const gentle = reduced.matches;
    const travel = (gentle ? 0 : 1) * (width < 800 ? .73 : 1);
    const follow = gentle ? 1 : (1 - Math.exp(-dt * 7));
    const radius = clamp(width * .115, 78, 155);
    const active = !gentle && (time - fieldTime < 650);
    const cursorRadius = radius * .92;
    const cursorReachSq = cursorRadius * cursorRadius;

    for (let pIdx = 0; pIdx < points.length; pIdx++) {
      const point = points[pIdx];
      const d = point.depth;
      const phase = point.phase;

      // Subtle upward parallax starfield flow during cinema descent (seamless vertical wrap)
      let baseY = point.y
        - cinemaFlow * (.24 + d * .76)
        - scrollImpulse * (.10 + d * .47) * travel;
      if (baseY < 0 || baseY >= height) {
        baseY = ((baseY % height) + height) % height;
      }

      const room = readingRoom(point.x, baseY);
      if (room === 0) {
        point.dx *= 1 - follow;
        point.dy *= 1 - follow;
        point.pulse *= 1 - follow;
        continue;
      }

      const x = point.x + Math.sin(elapsed * (.15 + d * .10) + phase) * (2 + d * 5) * travel * room;
      const y = baseY + Math.cos(elapsed * (.11 + d * .11) + phase) * (2 + d * 4) * travel * room;

      let dx = 0, dy = 0, highlight = 0;
      if (!gentle && (active || pointer.active)) {
        // Indices 0..3 are puzzle sprite fields; index 4 is pointer cursor.
        for (let i = 0; i < 5; i++) {
          const mouse = i === 4;
          if (mouse ? !pointer.active : (!active || field[i * 3 + 2] <= 0)) continue;
          const cx = mouse ? pointer.x : field[i * 3];
          const cy = mouse ? pointer.y : field[i * 3 + 1];
          const reach = mouse ? cursorRadius : clamp(field[i * 3 + 2] * 1.35 + 22, 28, width * .21);
          const vx = x - cx;
          const vy = y - cy;
          const squared = vx * vx + vy * vy;
          if (squared >= (mouse ? cursorReachSq : reach * reach)) continue;
          const length = Math.sqrt(squared);
          const near = (1 - length / reach) ** 2;
          const push = near * (mouse ? 36 : 25) * (.45 + d);
          dx += push * (length > .01 ? vx / length : Math.cos(phase));
          dy += push * (length > .01 ? vy / length : Math.sin(phase));
          const h = near * (mouse ? 1 : .85);
          if (h > highlight) highlight = h;
        }
      }

      point.dx += (clamp(dx, -45, 45) * travel * room - point.dx) * follow;
      point.dy += (clamp(dy, -45, 45) * travel * room - point.dy) * follow;
      point.pulse += (highlight - point.pulse) * follow;

      const px = x + point.dx;
      const py = y + point.dy;

      // Skip redundant 2nd readingRoom() check when total displacement < 1px
      const mx = px - point.x;
      const my = py - baseY;
      const strength = (mx * mx + my * my < 1)
        ? room
        : Math.min(room, readingRoom(px, py));
      if (strength === 0) continue;

      // Delicate cinema mint/lilac twinkle harmonic
      let twinkleBoost = 0;
      if (!gentle && cinemaMix > .02 && point.sprite >= 1) {
        const wave = Math.sin(elapsed * (1.35 * point.twinkleRate) + phase * 2.1);
        if (wave > .65) {
          const peak = (wave - .65) / .35;
          twinkleBoost = peak * peak * cinemaMix * (point.sprite === 2 ? .52 : .28);
        }
      }

      const pulse = point.pulse * strength;
      const shimmer = gentle ? 0 : .047 * Math.sin(elapsed * .70 + phase);
      const alpha = Math.min(1, (.21 + .30 * d + shimmer) * strength + pulse * .27 + twinkleBoost * .34);
      const r = point.radius * (1 + pulse * .68 + twinkleBoost * .42);

      const glowIntensity = Math.max(pulse, twinkleBoost * .75);
      if (glowIntensity > .05) {
        const extent = Math.min(5 + strength * 24, Math.max(3 / ratio, r * 4.2));
        ctx.globalAlpha = glowIntensity * (gentle ? .28 : .56);
        const halo = point.sprite === 2 ? glowMint : glowViolet;
        ctx.drawImage(halo, px - extent, py - extent, extent * 2, extent * 2);
      }

      // Stamp pre-rendered luminous dot sprite (radius matches core via 2.45x sprite scale)
      const drawR = r * 2.45;
      ctx.globalAlpha = alpha;
      ctx.drawImage(dotSprites[point.sprite], px - drawR, py - drawR, drawR * 2, drawR * 2);
    }
    ctx.globalAlpha = 1;
  }

  function tick(time) {
    frame = 0;
    if (document.hidden || !points.length) return;

    if (reduced.matches) {
      reducedDirty = false;
      draw(time, .016);
      return;
    }

    const interval = cinemaPlaying ? CINEMA_INTERVAL : IDLE_INTERVAL;
    if (time >= nextPaint) {
      const dt = Math.min(lastPaint === null ? interval : time - lastPaint, 100) / 1000;
      lastPaint = time;
      nextPaint = nextPaint ? Math.max(time + .1, nextPaint + interval) : time + interval;

      const targetMix = cinemaPlaying ? 1 : 0;
      cinemaMix += (targetMix - cinemaMix) * (1 - Math.exp(-dt * 4));
      if (Math.abs(cinemaMix - targetMix) < .002) cinemaMix = targetMix;

      elapsed += dt * (1 + cinemaMix * .25);
      scrollImpulse *= Math.exp(-dt * 3.2);
      scrollVelocity *= Math.exp(-dt * 4.5);

      if (cinemaMix > .004) {
        cinemaFlow += dt * (18 * cinemaSpeed + scrollVelocity * 24) * cinemaMix;
      }

      draw(time, dt);
    }
    schedule();
  }

  function schedule() {
    if (!frame && !document.hidden && points.length) {
      if (reduced.matches && !reducedDirty) return;
      frame = requestAnimationFrame(tick);
    }
  }

  window.addEventListener('pointermove', e => {
    pointer.active = e.pointerType !== 'touch';
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.active = false; });
  window.addEventListener('blur', () => { pointer.active = false; });

  window.addEventListener('cv-puzzle-field', e => {
    const values = e.detail;
    if (!(values instanceof Float32Array) || values.length !== 12) return;
    field.set(values);
    fieldTime = performance.now();
  });

  window.addEventListener('curriculo:cinema', e => {
    const detail = e.detail;
    if (!detail) return;
    cinemaPlaying = detail.state === 'playing';
    if (Number.isFinite(detail.speed) && detail.speed > 0) cinemaSpeed = detail.speed;
    nextPaint = 0;
    reducedDirty = true;
    schedule();
  });

  window.addEventListener('curriculo:scroll', e => {
    const detail = e.detail;
    if (detail && Number.isFinite(detail.velocity)) {
      scrollVelocity = Math.max(scrollVelocity, clamp(detail.velocity, 0, 1));
    }
    reducedDirty = true;
    schedule();
  });

  window.addEventListener('cv-progress', () => {
    reducedDirty = true;
    schedule();
  });

  window.addEventListener('scroll', () => {
    const sy = window.scrollY;
    scrollImpulse = clamp(scrollImpulse + sy - scrollPosition, -65, 65);
    scrollPosition = sy;
    reducedDirty = true;
    schedule();
  }, { passive: true });

  window.addEventListener('resize', layout, { passive: true });
  window.addEventListener('load', cacheTextBlocks, { once: true });
  const main = document.querySelector('#principal') || document.body;
  if (window.ResizeObserver && main) new ResizeObserver(cacheTextBlocks).observe(main);
  document.fonts?.ready.then(() => { cacheTextBlocks(); schedule(); });

  reduced.addEventListener('change', () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastPaint = null;
    nextPaint = 0;
    reducedDirty = true;
    schedule();
  });

  document.addEventListener('visibilitychange', () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastPaint = null;
    nextPaint = 0;
    pointer.active = false;
    if (!document.hidden) {
      reducedDirty = true;
      schedule();
    }
  });

  document.documentElement.classList.add('particles-ready');
  layout();
})();

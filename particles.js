(() => {
  'use strict';

  const canvas = document.querySelector('#particles');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const textBlocks = [...document.querySelectorAll(
    'header a, .intro h1, .intro p, .actions, .story h2, .story h3, .story p, .story small, .story time, #contato a, footer > *'
  )];
  const field = new Float32Array(12);
  const pointer = { x: 0, y: 0, active: false };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const interval = 1000 / 29;
  const glow = document.createElement('canvas');
  glow.width = glow.height = 32;
  const light = glow.getContext('2d');
  if (light) {
    const gradient = light.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, '#f6e6ff');
    gradient.addColorStop(.2, 'rgba(228,191,255,.72)');
    gradient.addColorStop(.56, 'rgba(198,137,241,.23)');
    gradient.addColorStop(1, 'rgba(185,126,224,0)');
    light.fillStyle = gradient;
    light.fillRect(0, 0, 32, 32);
  }

  let width = 0, height = 0, ratio = 1, points = [], blocks = [];
  let frame = 0, lastPaint = null, nextPaint = 0, elapsed = 0, fieldTime = -Infinity;
  let scrollImpulse = 0, scrollPosition = window.scrollY, geometryDirty = true;

  function layout() {
    const box = canvas.getBoundingClientRect();
    width = box.width;
    height = box.height;
    if (width < 1 || height < 1) return;
    ratio = Math.min(window.devicePixelRatio || 1, 1.6, Math.sqrt(1750000 / (width * height)));
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
      return {
        x: (i % cols + .12 + .76 * random()) * width / cols,
        y: (Math.floor(i / cols) + .12 + .76 * random()) * height / rows,
        dx: 0, dy: 0, pulse: 0, depth,
        phase: random() * 6.2832,
        // At browser zoom-out, use the physical screen's density as a floor.
        radius: Math.max(.6 / ratio, Math.min(2.5 / ratio, gap * (.009 + .012 * depth)))
      };
    });
    geometryDirty = true;
    schedule();
  }

  function readingRoom(x, y) {
    let distance = 40;
    for (const b of blocks) {
      const dx = Math.max(b.left - x, x - b.right, 0);
      const dy = Math.max(b.top - y, y - b.bottom, 0);
      if (Math.max(dx, dy) <= 7) return 0;
      distance = Math.min(distance, Math.max(dx, dy));
    }
    return clamp((distance - 7) / 33, 0, 1);
  }

  function draw(time, dt) {
    if (geometryDirty) {
      blocks = textBlocks.map(node => node.getBoundingClientRect())
        .filter(b => b.bottom >= -40 && b.top <= height + 40 && b.width && b.height);
      geometryDirty = false;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const gentle = reduced.matches;
    const travel = (gentle ? .37 : 1) * (width < 800 ? .73 : 1);
    const follow = 1 - Math.exp(-dt * 7);
    const radius = clamp(width * .115, 78, 155);
    const active = time - fieldTime < 650;
    const cursorRadius = radius * .92;
    for (const point of points) {
      const d = point.depth, phase = point.phase;
      const baseY = point.y - scrollImpulse * (.10 + d * .47) * travel;
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
      // The last influence uses the cursor; the previous four are sprite fields.
      for (let i = 0; i < 5; i++) {
        const mouse = i === 4;
        if (mouse ? !pointer.active : !active || field[i * 3 + 2] <= 0) continue;
        const cx = mouse ? pointer.x : field[i * 3];
        const cy = mouse ? pointer.y : field[i * 3 + 1];
        const reach = mouse ? cursorRadius : clamp(field[i * 3 + 2] * 1.35 + 22, 28, width * .21);
        const vx = x - cx, vy = y - cy;
        const squared = vx * vx + vy * vy;
        if (squared >= reach * reach) continue;
        const length = Math.sqrt(squared);
        const near = (1 - length / reach) ** 2;
        const push = near * (mouse ? 36 : 25) * (.45 + d);
        dx += push * (length > .01 ? vx / length : Math.cos(phase));
        dy += push * (length > .01 ? vy / length : Math.sin(phase));
        highlight = Math.max(highlight, near * (mouse ? 1 : .85));
      }
      point.dx += (clamp(dx, -45, 45) * travel * room - point.dx) * follow;
      point.dy += (clamp(dy, -45, 45) * travel * room - point.dy) * follow;
      point.pulse += (highlight - point.pulse) * follow;
      const px = x + point.dx, py = y + point.dy;
      const strength = Math.min(room, readingRoom(px, py));
      if (strength === 0) continue;
      const pulse = point.pulse * strength;
      const alpha = (.20 + .29 * d + .047 * Math.sin(elapsed * .70 + phase)) * strength + pulse * .27;
      const r = point.radius * (1 + pulse * .7);
      if (pulse > .05 && light) {
        const extent = Math.min(5 + strength * 25, Math.max(3 / ratio, r * 4.2));
        ctx.globalAlpha = pulse * (gentle ? .31 : .55);
        ctx.drawImage(glow, px - extent, py - extent, extent * 2, extent * 2);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = d > .64 ? '#dec2f6' : '#b186c8';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function tick(time) {
    frame = 0;
    if (document.hidden || !points.length) return;
    if (time >= nextPaint) {
      const dt = Math.min(lastPaint === null ? interval : time - lastPaint, 100) / 1000;
      lastPaint = time;
      nextPaint = nextPaint ? Math.max(time + .1, nextPaint + interval) : time + interval;
      elapsed += dt * (reduced.matches ? .38 : 1);
      scrollImpulse *= Math.exp(-dt * 3.2);
      draw(time, dt);
    }
    schedule();
  }
  function schedule() {
    if (!frame && !document.hidden && points.length) frame = requestAnimationFrame(tick);
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
  window.addEventListener('cv-progress', () => { geometryDirty = true; });
  window.addEventListener('scroll', () => {
    scrollImpulse = clamp(scrollImpulse + window.scrollY - scrollPosition, -65, 65);
    scrollPosition = window.scrollY;
    geometryDirty = true;
  }, { passive: true });
  window.addEventListener('resize', layout, { passive: true });
  document.fonts?.ready.then(() => { geometryDirty = true; });
  document.addEventListener('visibilitychange', () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastPaint = null;
    nextPaint = 0;
    pointer.active = false;
    schedule();
  });
  document.documentElement.classList.add('particles-ready');
  layout();
})();

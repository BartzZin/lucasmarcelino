(() => {
  'use strict';

  const canvas = document.getElementById('puzzle');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = n => clamp(n) ** 2 * (3 - 2 * clamp(n));
  const thickness = 0.21;
  const tiles = [
    // Edges run clockwise from the top. Adjacent tabs have opposing signs.
    { x: -.5, z: -.5, edge: [0, 1, -1, 0], spread: [-.40, -.25, .62], twist: -.19, tilt: .13, start: .02, end: .53, color: [194, 155, 238] },
    { x:  .5, z: -.5, edge: [0, 0, 1, -1], spread: [.48, -.32, .26], twist: .19, tilt: -.19, start: .20, end: .70, color: [98, 75, 223] },
    { x: -.5, z:  .5, edge: [1, 1, 0, 0], spread: [-.45, .42, .19], twist: -.23, tilt: -.12, start: .39, end: .85, color: [125, 144, 246] },
    { x:  .5, z:  .5, edge: [-1, 0, 0, -1], spread: [.40, .45, .42], twist: .14, tilt: .20, start: .57, end: .98, color: [85, 66, 169] }
  ];

  // The normalized seam is symmetric about t=.5, so it fits when reversed.
  const seam = [[0, 0], [.31, 0]];
  function curve(points, start, a, b, end, steps) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const s = 1 - t;
      points.push([0, 1].map(k => s*s*s*start[k] + 3*s*s*t*a[k] + 3*s*t*t*b[k] + t*t*t*end[k]));
    }
  }
  curve(seam, [.31, 0], [.41, 0], [.48, -.035], [.43, .058], 7);
  curve(seam, [.43, .058], [.34, .195], [.404, .258], [.5, .258], 10);
  curve(seam, [.5, .258], [.596, .258], [.66, .195], [.57, .058], 10);
  curve(seam, [.57, .058], [.52, -.035], [.59, 0], [.69, 0], 7);
  seam.push([1, 0]);

  const corners = [[-.5,-.5], [.5,-.5], [.5,.5], [-.5,.5]];
  for (const tile of tiles) {
    const ring = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i+1)%4], c = corners[(i+2)%4];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      // Only the four external corners of the assembled square are rounded.
      const cut = tile.edge[i] === 0 && tile.edge[(i+1)%4] === 0 ? .075 : 0;
      if (tile.edge[i]) {
        for (const [t, bump] of seam.slice(1,-1)) {
          ring.push([a[0] + t*dx + bump*dz*tile.edge[i], a[1] + t*dz - bump*dx*tile.edge[i]]);
        }
      }
      const from = [b[0]-cut*dx, b[1]-cut*dz];
      ring.push(from);
      if (cut) {
        const to = [b[0]+cut*(c[0]-b[0]), b[1]+cut*(c[1]-b[1])];
        curve(ring, from, b, b, to, 7);
      }
    }
    tile.ring = ring;
  }

  function geometry(tile, progress, phase, camera, index) {
    const open = 1 - smooth((progress - tile.start) / (tile.end - tile.start));
    const beat = phase * .83 + index * 1.86;
    const wave = motion.matches ? 0 : Math.sin(beat);
    const glide = motion.matches ? 0 : Math.cos(beat * .82 + index);
    // Separated pieces each have their own axis and phase. Docked pieces
    // share the camera movement so the complementary edges stay joined.
    const arc = Math.sin(Math.PI * open);
    const twist = (tile.twist + .24 * wave) * open + arc * tile.twist * 2;
    const tilt = (tile.tilt + .20 * glide) * open + arc * .21;
    const cosTilt = Math.cos(tilt), sinTilt = Math.sin(tilt);
    const cosTwist = Math.cos(twist), sinTwist = Math.sin(twist);
    const dx = tile.x + (tile.spread[0] + .10 * glide) * open;
    const dz = tile.z + (tile.spread[1] + .10 * wave) * open;
    const lift = (tile.spread[2] + .15 * wave) * open + .20 * arc;
    function project(x, z, h) {
      const zTilt = z*cosTilt - h*sinTilt;
      const altitude = h*cosTilt + z*sinTilt + lift;
      const xx = dx + x*cosTwist - zTilt*sinTwist;
      const zz = dz + zTilt*cosTwist + x*sinTwist;
      const depth = camera.sin*xx + camera.cos*zz;
      return [camera.cos*xx - camera.sin*zz, depth*camera.pitch - altitude*camera.lift, depth];
    }
    const top = tile.ring.map(([x,z]) => project(x,z,thickness));
    const bottom = tile.ring.map(([x,z]) => project(x,z,0));
    return { tile, index, top, bottom, project, depth: project(0,0,0)[2] };
  }

  function color(rgb, factor, white = 0) {
    return 'rgb(' + rgb.map(c => Math.min(255, Math.round(c*factor + white))).join(',') + ')';
  }
  function polygon(path) {
    ctx.beginPath();
    ctx.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
    ctx.closePath();
  }

  function drawTile(mesh, scale, phase) {
    const { tile, top, bottom, project, index } = mesh;
    const wallSegments = [];
    for (let i = 0; i < top.length; i++) {
      const j = (i+1) % top.length;
      const dx = top[j][0] - top[i][0], dy = top[j][1] - top[i][1];
      const downX = bottom[i][0]-top[i][0], downY = bottom[i][1]-top[i][1];
      if (dx*downY - dy*downX >= 0) continue;
      const intensity = .49 + .22*dy/(Math.hypot(dx,dy) || 1);
      wallSegments.push({ depth: (top[i][2]+top[j][2])/2, face: [top[i],top[j],bottom[j],bottom[i]], intensity });
    }
    wallSegments.sort((a,b) => a.depth-b.depth);
    for (const segment of wallSegments) {
      polygon(segment.face);
      ctx.fillStyle = color(tile.color,segment.intensity);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = .75/scale;
      ctx.fill();
      ctx.stroke();
    }

    const back = project(-.5,-.5,thickness), front = project(.5,.5,thickness);
    const finish = ctx.createLinearGradient(back[0],back[1],front[0],front[1]);
    finish.addColorStop(0,color(tile.color,.94,35));
    finish.addColorStop(.38,color(tile.color,1.02,12));
    finish.addColorStop(1,color(tile.color,.87,0));
    polygon(top);
    ctx.fillStyle = finish;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const pulse = pulses[index];
    const age = phase - pulse;
    const docking = age >= 0 && age < .85 ? (1-age/.85) ** 2 : 0;
    if (!motion.matches) {
      const shine = (phase - index*.23 + 8) % 8;
      if (shine < 1.45 || docking > 0) {
        const sweep = docking > 0 ? age/.85 : shine/1.45;
        const center = project(0,0,thickness);
        const x = center[0]-1.2 + sweep*2.4;
        const band = ctx.createLinearGradient(x-.26,center[1]-.1,x+.26,center[1]+.1);
        band.addColorStop(0,'rgba(255,255,255,0)');
        band.addColorStop(.55,'rgba(232,226,255,'+ (.15 + .20*docking) +')');
        band.addColorStop(1,'rgba(255,255,255,0)');
        ctx.fillStyle = band;
        ctx.fillRect(center[0]-1.5,center[1]-1.5,3,3);
      }
    }
    // Fine paired edges read as a bevel even on a narrow phone viewport.
    ctx.strokeStyle = color(tile.color,.90,65+80*docking);
    ctx.lineWidth = .021 + docking*.035;
    ctx.stroke();
    ctx.restore();
    polygon(top);
    ctx.lineWidth = .006;
    ctx.strokeStyle = color(tile.color,.69);
    ctx.stroke();
  }

  const pulses = tiles.map(() => -10);
  const cursor = { x: 0, y: 0, toX: 0, toY: 0 };
  let width = 0, height = 0, ratio = 1;
  let target = 0, shown = 0, frame = 0, previous = 0, phase = 0;
  let onScreen = true, replay = null;

  function drawDust(time, progress) {
    const centerX = width*.5, centerY = height*.49;
    const radius = Math.min(width, height*1.4);
    for (let i = 0; i < 17; i++) {
      const t = i*2.40 + time*(.12 + i%3*.037) + progress*.44;
      const orbit = radius*(.31 + (i%5)*.037);
      const x = centerX+Math.cos(t)*orbit;
      const y = centerY+Math.sin(t)*orbit*.64 - Math.cos(t)*orbit*.24;
      const alpha = .26+.18*Math.sin(t*1.35+i);
      if (i%4===0) {
        ctx.beginPath();
        ctx.moveTo(x,y);
        for (let j=1;j<=8;j++) {
          const a = t-j*.017;
          ctx.lineTo(centerX+Math.cos(a)*orbit,centerY+Math.sin(a)*orbit*.64-Math.cos(a)*orbit*.24);
        }
        ctx.strokeStyle = 'rgba(152,152,244,'+alpha*.6+')';
        ctx.lineWidth = .9;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x,y,i%4===0 ? 1.6 : .95,0,Math.PI*2);
      ctx.fillStyle = 'rgba(206,205,255,'+alpha+')';
      ctx.fill();
    }
  }
  function draw(progress) {
    if (width < 2 || height < 2) return;
    const animated = !motion.matches;
    const yaw = .78 + progress*.26 + (animated ? Math.sin(phase*.44)*.085 + cursor.x*.14 : 0);
    const pitch = .57 + progress*.075 + (animated ? Math.sin(phase*.53)*.035 + cursor.y*.06 : 0);
    const camera = {sin:Math.sin(yaw), cos:Math.cos(yaw), pitch, lift:Math.sqrt(1-pitch*pitch)};
    const scene = tiles.map((tile,index) => geometry(tile,progress,phase,camera,index)).sort((a,b) => a.depth-b.depth);
    const points = scene.flatMap(tile => tile.top.concat(tile.bottom));
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const left = Math.min(...xs), right = Math.max(...xs);
    const rear = Math.min(...ys), near = Math.max(...ys);
    const scale = Math.min(width*.91/(right-left), height*.79/(near-rear), width*.30);
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,width,height);
    if (animated) drawDust(phase,progress);
    const bob = animated ? Math.sin(phase*.95)*scale*.029 : 0;
    ctx.translate(width*.5-(left+right)*scale/2,height*.48+bob-(rear+near)*scale/2);
    ctx.scale(scale,scale);
    ctx.save();
    ctx.translate((left+right)/2, near+.14);
    ctx.scale(1,.20);
    const glow = ctx.createRadialGradient(0,0,0,0,0,1.65);
    glow.addColorStop(0,'rgba(83,70,181,.26)');
    glow.addColorStop(.55,'rgba(62,49,141,.15)');
    glow.addColorStop(1,'rgba(42,39,100,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-1.65,-1.65,3.3,3.3);
    ctx.restore();
    for (const mesh of scene) drawTile(mesh,scale,phase);
  }

  function replayProgress(dt) {
    replay.elapsed += dt;
    const t = replay.elapsed;
    if (t < .9) return replay.from*(1-smooth(t/.9));
    if (t < 1.15) return 0;
    if (t < 4.5) return smooth((t-1.15)/3.35);
    if (t < 5.15) return 1;
    if (t < 6.45) return 1 + (target-1)*smooth((t-5.15)/1.3);
    replay = null;
    return target;
  }
  function tick(time) {
    frame = 0;
    if (!onScreen || document.hidden) return;
    const active = replay || Math.abs(target-shown)>.001 || Math.abs(cursor.toX-cursor.x)>.01 || Math.abs(cursor.toY-cursor.y)>.01;
    const elapsed = time - (previous || time-40);
    if (elapsed < (active ? 14 : 40) && !motion.matches) { refresh(); return; }
    const dt = Math.min(80,elapsed);
    previous = time;
    const before = shown;
    if (!motion.matches) {
      phase += dt/1000;
      shown = replay ? replayProgress(dt/1000) : shown+(target-shown)*(1-Math.exp(-dt/64));
      if (!replay && Math.abs(target-shown)<.0006) shown = target;
      tiles.forEach((tile,i) => { if (before < tile.end && shown >= tile.end) pulses[i] = phase; });
      const ease = 1-Math.exp(-dt/150);
      cursor.x += (cursor.toX-cursor.x)*ease;
      cursor.y += (cursor.toY-cursor.y)*ease;
    }
    draw(motion.matches ? 1 : shown);
    if (!motion.matches) refresh();
  }
  function refresh() {
    if (!frame && onScreen && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function resize() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (box.width === width && box.height === height && dpr === ratio) return;
    width = box.width; height = box.height; ratio = dpr;
    canvas.width = Math.round(width*ratio);
    canvas.height = Math.round(height*ratio);
    refresh();
  }
  window.addEventListener('cv-progress', event => {
    if (!Number.isFinite(event.detail)) return;
    target = clamp(event.detail);
    if (!motion.matches) refresh();
  });
  window.addEventListener('cv-replay', () => {
    if (motion.matches) return;
    replay = { from: shown, elapsed: 0 };
    refresh();
  });
  // Stage layout can make the canvas pointer-transparent. Sample the pointer
  // from the page and normalize it only in the vicinity of the stage.
  window.addEventListener('pointermove', event => {
    if (!onScreen || motion.matches || event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX-rect.left)/rect.width * 2 - 1;
    const y = (event.clientY-rect.top)/rect.height * 2 - 1;
    const within = Math.abs(x)<1.35 && Math.abs(y)<1.35;
    cursor.toX = within ? Math.max(-1,Math.min(1,x)) : 0;
    cursor.toY = within ? Math.max(-1,Math.min(1,y)) : 0;
  }, { passive:true });
  document.addEventListener('pointerleave', () => { cursor.toX = cursor.toY = 0; });
  function visibilityChanged() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; previous = 0;
    refresh();
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  motion.addEventListener('change', () => {
    replay = null;
    pulses.fill(-10);
    visibilityChanged();
  });
  window.addEventListener('resize', resize, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  if (window.IntersectionObserver) {
    new IntersectionObserver(entries => {
      onScreen = entries[0].isIntersecting;
      visibilityChanged();
    }).observe(canvas);
  }
  resize();
})();

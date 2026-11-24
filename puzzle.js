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

  function geometry(tile, progress) {
    const open = 1 - smooth((progress - tile.start) / (tile.end - tile.start));
    const twist = tile.twist * open, tilt = tile.tilt * open;
    const dx = tile.x + tile.spread[0]*open, dz = tile.z + tile.spread[1]*open;
    function project(x, z, h) {
      const zTilt = z*Math.cos(tilt) - h*Math.sin(tilt);
      const altitude = h*Math.cos(tilt) + z*Math.sin(tilt) + tile.spread[2]*open;
      const xx = dx + x*Math.cos(twist) - zTilt*Math.sin(twist);
      const zz = dz + zTilt*Math.cos(twist) + x*Math.sin(twist);
      const depth = Math.SQRT1_2 * (xx + zz);
      return [Math.SQRT1_2 * (xx - zz), depth*.56 - altitude*.83, depth];
    }
    const top = tile.ring.map(([x,z]) => project(x,z,thickness));
    const bottom = tile.ring.map(([x,z]) => project(x,z,0));
    return { tile, top, bottom, project, depth: project(0,0,0)[2] };
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

  function drawTile(mesh, scale) {
    const { tile, top, bottom, project } = mesh;
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
    // Fine paired edges read as a bevel even on a narrow phone viewport.
    ctx.strokeStyle = color(tile.color,.90,65);
    ctx.lineWidth = .021;
    ctx.stroke();
    ctx.restore();
    polygon(top);
    ctx.lineWidth = .006;
    ctx.strokeStyle = color(tile.color,.69);
    ctx.stroke();
  }

  let width = 0, height = 0, ratio = 1;
  let target = 0, shown = 0, frame = 0, previous = 0;
  function draw(progress) {
    if (width < 2 || height < 2) return;
    const scene = tiles.map(tile => geometry(tile, progress)).sort((a,b) => a.depth-b.depth);
    const points = scene.flatMap(tile => tile.top.concat(tile.bottom));
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const left = Math.min(...xs), right = Math.max(...xs);
    const rear = Math.min(...ys), near = Math.max(...ys);
    const scale = Math.min(width*.91/(right-left), height*.79/(near-rear), width*.30);
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,width,height);
    ctx.translate(width*.5-(left+right)*scale/2,height*.48-(rear+near)*scale/2);
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
    for (const mesh of scene) drawTile(mesh,scale);
  }

  function tick(time) {
    const dt = Math.min(64, time - (previous || time - 16));
    previous = time;
    shown += (target-shown) * (1-Math.exp(-dt/64));
    if (Math.abs(target-shown) < .0006) shown = target;
    draw(motion.matches ? 1 : shown);
    if (!motion.matches && shown !== target) frame = requestAnimationFrame(tick);
    else { frame = 0; previous = 0; }
  }
  function refresh() {
    if (!frame) frame = requestAnimationFrame(tick);
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
  motion.addEventListener('change', refresh);
  window.addEventListener('resize', resize, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  resize();
})();

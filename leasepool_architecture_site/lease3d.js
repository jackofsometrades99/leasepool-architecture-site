(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hexToRgb = (hex) => {
    const clean = hex.replace('#', '');
    const n = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const rgba = (hex, a) => {
    const c = hexToRgb(hex);
    return `rgba(${c.r},${c.g},${c.b},${a})`;
  };

  class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vec3(this.x, this.y, this.z); }
    add(v) { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
    sub(v) { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
    scale(s) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  }

  class ArchitectureScene {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.options = options;
      this.mode = 'direct';
      this.rotationX = -0.22;
      this.rotationY = -0.23;
      this.targetRotationX = this.rotationX;
      this.targetRotationY = this.rotationY;
      this.zoom = 1;
      this.targetZoom = 1;
      this.dragging = false;
      this.pointer = { x: 0, y: 0 };
      this.lastPointer = { x: 0, y: 0 };
      this.hovered = null;
      this.selected = 'manager';
      this.reducedMotion = false;
      this.time = 0;
      this.lastTime = performance.now();
      this.particles = [];
      this.projectedNodes = [];
      this.dpr = 1;
      this.nodes = this.createNodes();
      this.nodeMap = Object.fromEntries(this.nodes.map(n => [n.id, n]));
      this.modes = this.createModes();
      this.bind();
      this.resize();
      this.seedParticles();
      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    }

    createNodes() {
      const C = {
        cyan: '#6ee7ff', violet: '#a987ff', green: '#68f1b2', amber: '#ffc76b',
        red: '#ff748b', blue: '#77a7ff', steel: '#7b91b5'
      };
      return [
        { id: 'caller', label: 'Async callers', sub: 'routes · jobs · services', pos: new Vec3(-5.7, 1.55, .35), size: .58, color: C.blue, shape: 'users', info: 'Async application code supplies synchronous callables and user data, then awaits a Future-backed result.', tags: ['input payload', 'await result', 'many producers'] },
        { id: 'thread', label: 'Other OS thread', sub: 'thread-safe ingress', pos: new Vec3(-5.45, -2.2, -1.05), size: .48, color: C.violet, shape: 'thread', info: 'Non-owner threads enter WorkGrinder through asyncio.run_coroutine_threadsafe via submit_from_thread().', tags: ['sync API', 'run_coroutine_threadsafe', 'not owner loop'] },
        { id: 'loop', label: 'asyncio event loop', sub: 'coordination plane', pos: new Vec3(-3.4, .55, .15), size: .78, color: C.cyan, shape: 'loop', info: 'The owner event loop coordinates acquisition, waiting, batching, cancellation, and result delivery. Synchronous work runs elsewhere.', tags: ['owner loop', 'non-blocking wait', 'future delivery'] },
        { id: 'grinder', label: 'WorkGrinder', sub: 'condition + pending deque', pos: new Vec3(-1.65, -1.65, .15), size: .8, color: C.violet, shape: 'queue', info: 'Collects work until count, age, or shutdown triggers a batch; drains the entire pending deque and leases one executor.', tags: ['serial batches', 'whole-queue drain', 'per-item outcomes'] },
        { id: 'manager', label: 'LeasedExecutorManager', sub: 'capacity arbitration', pos: new Vec3(0, .45, .1), size: 1.02, color: C.cyan, shape: 'manager', info: 'Owns bounded executor pools, arbitrates leases, tracks futures, and enforces lifecycle rules.', tags: ['async boundary', 'RLock state', 'backpressure'] },
        { id: 'lock', label: 'Synchronous state', sub: 'threading.RLock', pos: new Vec3(-.05, -1.7, -1.15), size: .58, color: C.violet, shape: 'lock', info: 'Guards _available, _leased, submission validation, pending future registration, release, and completion callbacks.', tags: ['atomic transition', 'backend threads', 'submit race safety'] },
        { id: 'lease', label: 'ExecutorLease', sub: 'safe submission proxy', pos: new Vec3(1.8, .55, .55), size: .68, color: C.green, shape: 'lease', info: 'Temporary exclusive right to submit to one executor. The proxy blocks direct shutdown and rejects work after release or revocation.', tags: ['exclusive executor', 'safe proxy', 'context manager'] },
        { id: 'checker', label: 'Checker task', sub: 'expiry + adaptive sizing', pos: new Vec3(.45, 2.35, -1.15), size: .55, color: C.amber, shape: 'clock', info: 'Revokes hard-expired leases, ensures minimum capacity, shrinks idle excess, then sleeps until a change or the next expiry.', tags: ['hard expiry', 'size signal', 'event wakeup'] },
        { id: 'pool1', label: 'Executor pool 1', sub: 'available / leased', pos: new Vec3(3.65, 1.75, .5), size: .72, color: C.green, shape: 'pool', info: 'A concrete ThreadPoolExecutor, ProcessPoolExecutor, or InterpreterPoolExecutor owned by the manager.', tags: ['workers_per_pool', 'exclusive lease', 'managed lifetime'] },
        { id: 'pool2', label: 'Executor pool 2', sub: 'burst capacity', pos: new Vec3(4.05, .05, -.3), size: .72, color: C.cyan, shape: 'pool', info: 'Additional capacity may be created on acquisition up to max_pools, even above the adaptive desired target.', tags: ['burst above target', 'max_pools ceiling', 'reusable when idle'] },
        { id: 'pool3', label: 'Executor pool 3', sub: 'idle / replacement', pos: new Vec3(3.55, -1.65, .55), size: .72, color: C.blue, shape: 'pool', info: 'Idle capacity can be shrunk when total exceeds the desired target; replacement capacity is created after retirement.', tags: ['adaptive shrink', 'minimum capacity', 'replacement'] },
        { id: 'retired', label: 'Retired executor', sub: 'expired or broken', pos: new Vec3(5.65, -2.25, -1.35), size: .56, color: C.red, shape: 'retired', info: 'Hard-expired and broken executors are terminal: removed from management and shut down rather than recycled.', tags: ['never reusable', 'shutdown', 'capacity restored'] },
        { id: 'logqueue', label: 'Log queue', sub: 'multiprocessing Queue', pos: new Vec3(4.2, -2.05, -.25), size: .58, color: C.violet, shape: 'queueSmall', info: 'Process workers forward LogRecords through a multiprocessing queue when process logging is enabled.', tags: ['QueueHandler', 'opt-in', 'child process'] },
        { id: 'listener', label: 'QueueListener', sub: 'parent process', pos: new Vec3(2.25, -2.55, .45), size: .55, color: C.cyan, shape: 'listener', info: 'The parent listener forwards child LogRecords back into the application logger hierarchy.', tags: ['target_logger', 'respect levels', 'parent handlers'] },
        { id: 'result', label: 'Resolved result', sub: 'value · error · cancel', pos: new Vec3(-5.55, -1.05, .7), size: .55, color: C.green, shape: 'result', info: 'The original Future resolves with the callable value, its exception, or cancellation semantics.', tags: ['output value', 'exception fidelity', 'original caller'] }
      ];
    }

    createModes() {
      return {
        direct: {
          caption: 'request → acquire → lease → executor → result',
          active: ['caller','loop','manager','lock','lease','pool1','checker','result'],
          routes: [
            ['caller','loop'], ['loop','manager'], ['manager','lease'], ['lease','pool1'],
            ['pool1','loop'], ['loop','result'], ['manager','lock'], ['checker','manager']
          ],
          particleRoutes: [['caller','loop','manager','lease','pool1'], ['pool1','loop','result']]
        },
        grinder: {
          caption: 'callers → pending deque → whole batch → one lease → results',
          active: ['caller','thread','loop','grinder','manager','lock','lease','pool2','result'],
          routes: [
            ['caller','loop'], ['thread','grinder'], ['loop','grinder'], ['grinder','manager'],
            ['manager','lease'], ['lease','pool2'], ['pool2','grinder'], ['grinder','loop'], ['loop','result'], ['manager','lock']
          ],
          particleRoutes: [['caller','loop','grinder','manager','lease','pool2'], ['pool2','grinder','loop','result']]
        },
        expiry: {
          caption: 'soft window → grace → hard revocation → replacement',
          active: ['caller','loop','manager','lease','checker','pool1','retired','pool3'],
          routes: [['caller','loop'],['loop','manager'],['manager','lease'],['lease','pool1'],['checker','lease'],['pool1','retired'],['manager','pool3']],
          particleRoutes: [['caller','loop','manager','lease','pool1','retired'], ['manager','pool3']]
        },
        broken: {
          caption: 'BrokenExecutor → retire record → restore minimum → deferred shutdown',
          active: ['loop','manager','lock','lease','pool2','retired','pool3','checker'],
          routes: [['loop','manager'],['manager','lease'],['lease','pool2'],['pool2','manager'],['manager','retired'],['manager','pool3'],['manager','lock']],
          particleRoutes: [['loop','manager','lease','pool2','manager','retired'], ['manager','pool3']]
        },
        logging: {
          caption: 'worker logger → process queue → parent listener → application logger',
          active: ['caller','manager','pool1','pool2','logqueue','listener','loop'],
          routes: [['manager','pool1'],['manager','pool2'],['pool1','logqueue'],['pool2','logqueue'],['logqueue','listener'],['listener','loop'],['loop','caller']],
          particleRoutes: [['pool1','logqueue','listener','loop','caller'], ['pool2','logqueue','listener','loop','caller']]
        }
      };
    }

    bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', e => {
        this.dragging = true;
        this.pointer.x = this.lastPointer.x = e.clientX;
        this.pointer.y = this.lastPointer.y = e.clientY;
        c.setPointerCapture?.(e.pointerId);
      });
      c.addEventListener('pointermove', e => {
        const rect = c.getBoundingClientRect();
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;
        if (this.dragging) {
          const dx = e.clientX - this.lastPointer.x;
          const dy = e.clientY - this.lastPointer.y;
          this.targetRotationY += dx * .006;
          this.targetRotationX = clamp(this.targetRotationX + dy * .004, -.8, .5);
          this.lastPointer.x = e.clientX;
          this.lastPointer.y = e.clientY;
        } else {
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          this.hovered = this.hitTest(x, y);
          c.style.cursor = this.hovered ? 'pointer' : 'grab';
        }
      });
      c.addEventListener('pointerup', e => {
        const moved = Math.hypot(e.clientX - this.lastPointer.x, e.clientY - this.lastPointer.y);
        this.dragging = false;
        const rect = c.getBoundingClientRect();
        const hit = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (hit && moved < 8) this.select(hit);
      });
      c.addEventListener('pointercancel', () => { this.dragging = false; });
      c.addEventListener('wheel', e => {
        e.preventDefault();
        this.targetZoom = clamp(this.targetZoom - e.deltaY * .0007, .68, 1.48);
      }, { passive: false });
      c.addEventListener('dblclick', () => {
        this.targetRotationX = -.22;
        this.targetRotationY = -.23;
        this.targetZoom = 1;
      });
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
      this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.width = rect.width;
      this.height = rect.height;
    }

    setReducedMotion(value) { this.reducedMotion = !!value; }

    setMode(mode) {
      if (!this.modes[mode]) return;
      this.mode = mode;
      this.seedParticles();
      if (this.options.onMode) this.options.onMode(mode, this.modes[mode]);
      const first = this.modes[mode].active.includes(this.selected) ? this.selected : this.modes[mode].active[0];
      this.select(first);
    }

    select(id) {
      if (!this.nodeMap[id]) return;
      this.selected = id;
      if (this.options.onSelect) this.options.onSelect(this.nodeMap[id]);
    }

    seedParticles() {
      this.particles = [];
      const routes = this.modes[this.mode].particleRoutes;
      routes.forEach((route, routeIndex) => {
        const count = routeIndex === 0 ? 7 : 5;
        for (let i = 0; i < count; i++) {
          this.particles.push({
            route,
            t: (i / count + routeIndex * .15) % 1,
            speed: .055 + routeIndex * .012 + (i % 3) * .003,
            color: routeIndex === 0 ? '#6ee7ff' : '#68f1b2',
            size: 2.2 + (i % 2)
          });
        }
      });
    }

    rotate(v) {
      const cy = Math.cos(this.rotationY), sy = Math.sin(this.rotationY);
      const cx = Math.cos(this.rotationX), sx = Math.sin(this.rotationX);
      const x1 = v.x * cy - v.z * sy;
      const z1 = v.x * sy + v.z * cy;
      const y2 = v.y * cx - z1 * sx;
      const z2 = v.y * sx + z1 * cx;
      return new Vec3(x1, y2, z2);
    }

    project(v) {
      const p = this.rotate(v);
      const camera = 11.5;
      const z = clamp(camera - p.z, 3.2, 30);
      const fov = Math.min(this.width, this.height) * 1.43 * this.zoom;
      const s = fov / z;
      return { x: this.width * .54 + p.x * s, y: this.height * .49 - p.y * s, z: p.z, scale: s / 80 };
    }

    curvePoint(a, b, t, arc = 1) {
      const mid = a.add(b).scale(.5);
      const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      const ctrl = new Vec3(mid.x, mid.y + .2 + dist * .07 * arc, mid.z + .65 * arc);
      const u = 1 - t;
      return a.scale(u * u).add(ctrl.scale(2 * u * t)).add(b.scale(t * t));
    }

    routePoint(ids, t) {
      const segments = ids.length - 1;
      const p = clamp(t, 0, .999999) * segments;
      const i = Math.floor(p);
      const local = p - i;
      const a = this.nodeMap[ids[i]].pos;
      const b = this.nodeMap[ids[i + 1]].pos;
      const arc = (i % 2 ? -.55 : .7);
      return this.curvePoint(a, b, local, arc);
    }

    hitTest(x, y) {
      let best = null;
      let bestD = Infinity;
      for (const p of this.projectedNodes) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < p.r * 1.2 && d < bestD) { bestD = d; best = p.id; }
      }
      return best;
    }

    drawGrid() {
      const ctx = this.ctx;
      ctx.save();
      ctx.lineWidth = 1;
      for (let i = -8; i <= 8; i++) {
        const a = this.project(new Vec3(i, -2.9, -5));
        const b = this.project(new Vec3(i, -2.9, 5));
        const alpha = .025 + (1 - Math.min(1, Math.abs(i) / 8)) * .025;
        ctx.strokeStyle = `rgba(107,148,207,${alpha})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let z = -5; z <= 5; z++) {
        const a = this.project(new Vec3(-8, -2.9, z));
        const b = this.project(new Vec3(8, -2.9, z));
        ctx.strokeStyle = 'rgba(107,148,207,.035)';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }

    drawRoute(aId, bId, active = true, index = 0) {
      const ctx = this.ctx;
      const a = this.nodeMap[aId].pos;
      const b = this.nodeMap[bId].pos;
      const steps = 34;
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const world = this.curvePoint(a, b, i / steps, index % 2 ? -.55 : .7);
        const p = this.project(world);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = active ? 'rgba(110,231,255,.20)' : 'rgba(114,139,178,.055)';
      ctx.lineWidth = active ? 1.15 : .7;
      ctx.setLineDash(active ? [3, 7] : [1, 9]);
      ctx.lineDashOffset = -this.time * 18;
      ctx.stroke();
      ctx.restore();
    }

    drawNode(node, projected, active) {
      const ctx = this.ctx;
      const selected = this.selected === node.id;
      const hovered = this.hovered === node.id;
      const scale = clamp(projected.scale * node.size * 46, 18, 74);
      const alpha = active ? 1 : .17;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(projected.x, projected.y);

      if (selected || hovered) {
        ctx.strokeStyle = rgba(node.color, selected ? .55 : .3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, scale * (selected ? 1.35 : 1.2), 0, TAU);
        ctx.stroke();
        if (selected) {
          ctx.setLineDash([3, 5]);
          ctx.beginPath(); ctx.arc(0, 0, scale * 1.58, this.time, this.time + Math.PI * 1.6); ctx.stroke();
        }
      }

      if (node.shape === 'manager' || node.shape === 'loop' || node.shape === 'clock' || node.shape === 'listener') {
        const grad = ctx.createRadialGradient(-scale*.18, -scale*.2, 2, 0, 0, scale);
        grad.addColorStop(0, rgba(node.color, .38));
        grad.addColorStop(.55, rgba(node.color, .10));
        grad.addColorStop(1, rgba(node.color, .015));
        ctx.fillStyle = grad;
        ctx.strokeStyle = rgba(node.color, .55);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0,0,scale,0,TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = rgba(node.color, .22);
        ctx.beginPath(); ctx.ellipse(0,0,scale*1.25,scale*.43,this.time*.13,0,TAU); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0,0,scale*.43,scale*1.25,-this.time*.09,0,TAU); ctx.stroke();
        if (node.shape === 'clock') {
          ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(this.time)*scale*.5, Math.sin(this.time)*scale*.5); ctx.stroke();
        } else if (node.shape === 'listener') {
          for (let i=0;i<3;i++) { ctx.beginPath(); ctx.arc(0,0,scale*(.25+i*.18),-.7,.7); ctx.stroke(); }
        } else {
          ctx.fillStyle = node.color;
          ctx.beginPath(); ctx.arc(0,0,Math.max(2,scale*.09),0,TAU); ctx.fill();
        }
      } else if (node.shape === 'pool') {
        ctx.fillStyle = rgba(node.color, .06);
        ctx.strokeStyle = rgba(node.color, .45);
        this.roundRect(ctx,-scale*1.1,-scale*.72,scale*2.2,scale*1.44,scale*.2); ctx.fill(); ctx.stroke();
        const workers = 4;
        for (let i=0;i<workers;i++) {
          const ww = scale*.35;
          const gap = scale*.1;
          const x = -((workers*ww+(workers-1)*gap)/2)+i*(ww+gap);
          const h = scale*(.52 + .17*Math.sin(this.time*2.4+i));
          ctx.fillStyle = rgba(node.color, .12 + i*.018);
          ctx.strokeStyle = rgba(node.color, .22);
          this.roundRect(ctx,x,-h/2,ww,h,3); ctx.fill(); ctx.stroke();
        }
      } else if (node.shape === 'queue' || node.shape === 'queueSmall') {
        ctx.fillStyle = rgba(node.color,.075); ctx.strokeStyle = rgba(node.color,.43);
        this.roundRect(ctx,-scale*1.2,-scale*.7,scale*2.4,scale*1.4,scale*.22); ctx.fill(); ctx.stroke();
        const count = node.shape === 'queueSmall' ? 5 : 8;
        for (let i=0;i<count;i++) {
          const cols = node.shape === 'queueSmall' ? 5 : 4;
          const row = Math.floor(i/cols), col = i%cols;
          const x = -scale*.72 + col*scale*.48;
          const y = -scale*.25 + row*scale*.48;
          ctx.fillStyle = rgba(node.color,.65);
          this.roundRect(ctx,x,y,scale*.26,scale*.26,2); ctx.fill();
        }
      } else if (node.shape === 'lease') {
        ctx.fillStyle = rgba(node.color,.075); ctx.strokeStyle = rgba(node.color,.55);
        this.hex(ctx,0,0,scale,6,Math.PI/6); ctx.fill(); ctx.stroke();
        ctx.setLineDash([3,5]); ctx.beginPath(); ctx.arc(0,0,scale*.58,this.time, this.time+Math.PI*1.7); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `${Math.max(8,scale*.3)}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace'}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = node.color; ctx.fillText('LEASE',0,1);
      } else if (node.shape === 'lock') {
        ctx.fillStyle = rgba(node.color,.08); ctx.strokeStyle = rgba(node.color,.5);
        this.roundRect(ctx,-scale*.75,-scale*.25,scale*1.5,scale*1.05,scale*.18); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(0,-scale*.25,scale*.42,Math.PI,TAU); ctx.stroke();
        ctx.fillStyle = node.color; ctx.beginPath(); ctx.arc(0,scale*.18,scale*.09,0,TAU); ctx.fill();
      } else if (node.shape === 'users') {
        [-.5,0,.5].forEach((off,i) => {
          ctx.fillStyle = rgba(node.color,.08); ctx.strokeStyle = rgba(node.color,.48);
          ctx.beginPath(); ctx.arc(off*scale, -scale*.15 + Math.abs(off)*scale*.12, scale*.3, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(off*scale, scale*.43, scale*.43, Math.PI, TAU); ctx.stroke();
        });
      } else if (node.shape === 'thread') {
        ctx.strokeStyle = rgba(node.color,.5);
        for (let i=0;i<3;i++) { ctx.beginPath(); ctx.arc(0,0,scale*(.35+i*.25),-2.4,2.4); ctx.stroke(); }
      } else if (node.shape === 'retired') {
        ctx.fillStyle = rgba(node.color,.08); ctx.strokeStyle = rgba(node.color,.5);
        this.hex(ctx,0,0,scale,6,0); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-scale*.35,-scale*.35); ctx.lineTo(scale*.35,scale*.35); ctx.moveTo(scale*.35,-scale*.35); ctx.lineTo(-scale*.35,scale*.35); ctx.stroke();
      } else if (node.shape === 'result') {
        ctx.fillStyle = rgba(node.color,.09); ctx.strokeStyle = rgba(node.color,.55);
        ctx.beginPath(); ctx.arc(0,0,scale,0,TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-scale*.42,0); ctx.lineTo(-scale*.08,scale*.34); ctx.lineTo(scale*.5,-scale*.35); ctx.stroke();
      }

      ctx.restore();

      // Label is drawn in screen space for legibility.
      ctx.save();
      ctx.globalAlpha = active ? (hovered || selected ? 1 : .88) : .13;
      ctx.textAlign = 'center';
      ctx.fillStyle = selected ? '#ffffff' : '#c7d4e8';
      ctx.font = `${selected ? 700 : 600} ${clamp(scale*.22,8,12)}px system-ui, sans-serif`;
      ctx.fillText(node.label, projected.x, projected.y + scale + 17);
      ctx.fillStyle = '#667793';
      ctx.font = `${clamp(scale*.14,6,8)}px ui-monospace, monospace`;
      ctx.fillText(node.sub, projected.x, projected.y + scale + 30);
      ctx.restore();
      return scale;
    }

    drawParticle(p) {
      const world = this.routePoint(p.route, p.t);
      const q = this.project(world);
      const ctx = this.ctx;
      const r = p.size * clamp(q.scale, .75, 1.5);
      ctx.save();
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(q.x,q.y,r,0,TAU); ctx.fill();
      ctx.globalAlpha = .28;
      ctx.beginPath(); ctx.arc(q.x,q.y,r*2.3,0,TAU); ctx.fill();
      ctx.restore();
    }

    drawVignette() {
      const ctx = this.ctx;
      const g = ctx.createRadialGradient(this.width*.5,this.height*.45,this.height*.15,this.width*.5,this.height*.45,this.width*.68);
      g.addColorStop(.25,'rgba(7,11,23,0)');
      g.addColorStop(1,'rgba(3,6,14,.58)');
      ctx.fillStyle = g; ctx.fillRect(0,0,this.width,this.height);
    }

    roundRect(ctx,x,y,w,h,r) {
      r = Math.min(r,w/2,h/2);
      ctx.beginPath();
      ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
    }

    hex(ctx,x,y,r,sides=6,rot=0) {
      ctx.beginPath();
      for (let i=0;i<sides;i++) {
        const a=rot+i*TAU/sides, px=x+Math.cos(a)*r, py=y+Math.sin(a)*r;
        if(i===0)ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath();
    }

    update(dt) {
      this.rotationX = lerp(this.rotationX, this.targetRotationX, 1 - Math.pow(.001, dt));
      this.rotationY = lerp(this.rotationY, this.targetRotationY, 1 - Math.pow(.001, dt));
      this.zoom = lerp(this.zoom, this.targetZoom, 1 - Math.pow(.001, dt));
      if (!this.dragging && !this.reducedMotion) this.targetRotationY += dt * .025;
      if (!this.reducedMotion) {
        this.time += dt;
        this.particles.forEach(p => { p.t = (p.t + dt * p.speed) % 1; });
      }
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0,0,this.width,this.height);
      this.drawGrid();
      const mode = this.modes[this.mode];
      const activeSet = new Set(mode.active);

      // faint structural mesh
      const allStructure = [['caller','loop'],['loop','manager'],['loop','grinder'],['grinder','manager'],['manager','lease'],['lease','pool1'],['lease','pool2'],['lease','pool3'],['manager','checker'],['manager','lock'],['pool3','retired'],['pool1','logqueue'],['logqueue','listener']];
      allStructure.forEach((r,i) => this.drawRoute(r[0],r[1],false,i));
      mode.routes.forEach((r,i) => this.drawRoute(r[0],r[1],true,i));

      const projections = this.nodes.map(n => ({ node:n, p:this.project(n.pos) })).sort((a,b)=>a.p.z-b.p.z);
      this.projectedNodes = [];
      projections.forEach(({node,p}) => {
        const r = this.drawNode(node,p,activeSet.has(node.id));
        this.projectedNodes.push({ id:node.id, x:p.x, y:p.y, r });
      });
      this.particles.forEach(p => this.drawParticle(p));
      this.drawVignette();
    }

    frame(now) {
      const dt = clamp((now - this.lastTime) / 1000, 0, .05);
      this.lastTime = now;
      this.update(dt);
      this.draw();
      requestAnimationFrame(this.frame);
    }
  }

  window.Lease3D = { ArchitectureScene, Vec3 };
})();

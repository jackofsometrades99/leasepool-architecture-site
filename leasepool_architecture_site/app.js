(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const escapeHtml = (s) => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  let motionWasSetByUser = false;
  let syncMotionDependentUI = () => {};

  // Global ambient UI.
  const topbar = $('#topbar');
  const cursorGlow = $('.cursor-glow');
  const updateTopbar = () => topbar?.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', updateTopbar, { passive: true });
  updateTopbar();
  window.addEventListener('pointermove', e => {
    if (!cursorGlow || reducedMotion) return;
    cursorGlow.style.left = `${e.clientX}px`;
    cursorGlow.style.top = `${e.clientY}px`;
  }, { passive: true });

  const revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) entry.target.classList.add('visible');
  }, { threshold: .08, rootMargin: '0px 0px -5% 0px' });
  $$('.reveal').forEach(el => revealObserver.observe(el));

  const navLinks = $$('.nav a');
  const navSections = navLinks.map(a => $(a.getAttribute('href'))).filter(Boolean);
  const navObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${visible.target.id}`));
  }, { threshold: [.18,.35,.55], rootMargin: '-20% 0px -55% 0px' });
  navSections.forEach(s => navObserver.observe(s));

  // Interactive 3D system view.
  const nodeInspector = $('#nodeInspector');
  const inspectorClose = $('#inspectorClose');
  const inspectorTitle = $('#inspectorTitle');
  const inspectorBody = $('#inspectorBody');
  const inspectorTags = $('#inspectorTags');

  inspectorClose?.addEventListener('click', () => {
    nodeInspector?.classList.add('is-closed');
  });
  // const modeCaption = $('#modeCaption');
  const modeMetrics = {
    direct: { pending: 0, available: 1, leased: 1, draining: 0, results: 24 },
    grinder: { pending: 8, available: 1, leased: 1, draining: 0, results: 64 },
    expiry: { pending: 0, available: 1, leased: 0, draining: 0, results: 18 },
    broken: { pending: 0, available: 1, leased: 0, draining: 0, results: 17 },
    logging: { pending: 0, available: 0, leased: 2, draining: 0, results: 41 }
  };
  const metricIds = { pending: '#metricPending', available: '#metricAvailable', leased: '#metricLeased', draining: '#metricDraining', results: '#metricResults' };

  const architectureCanvas = $('#architectureCanvas');
  const scene = architectureCanvas && window.Lease3D?.ArchitectureScene
    ? new Lease3D.ArchitectureScene(architectureCanvas, {
    onSelect(node) {
      nodeInspector?.classList.remove('is-closed');

      if (inspectorTitle) inspectorTitle.textContent = node.label;
      if (inspectorBody) inspectorBody.textContent = node.info;
      if (inspectorTags) {
        inspectorTags.innerHTML = node.tags
          .map(tag => `<span>${escapeHtml(tag)}</span>`)
          .join('');
      }
    },
    onMode(mode, def) {
      // if (modeCaption) modeCaption.textContent = def.caption;
      const values = modeMetrics[mode];
      if (!values) return;
      Object.entries(metricIds).forEach(([key, selector]) => animateNumber($(selector), Number(values[key])));
    }
  }) : null;
  scene?.setReducedMotion(reducedMotion);
  scene?.select('manager');

  function animateNumber(el, target) {
    if (!el) return;
    const start = Number(el.textContent) || 0;
    const started = performance.now();
    const duration = reducedMotion ? 0 : 420;
    const tick = now => {
      const t = duration ? clamp((now - started) / duration, 0, 1) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(start + (target - start) * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  $$('[data-mode]').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.mode;
    $$('[data-mode]').forEach(b => {
      b.classList.toggle('active', b === button);
      b.setAttribute('aria-selected', String(b === button));
    });
    scene?.setMode(mode);
  }));
  $$('[data-set-mode]').forEach(button => button.addEventListener('click', () => {
    const target = $(`[data-mode="${button.dataset.setMode}"]`);
    target?.click();
    $('#architecture')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  }));

  const reduceMotionButton = $('#reduceMotion');
  function applyReducedMotion(value, fromUser = false) {
    reducedMotion = Boolean(value);
    if (fromUser) motionWasSetByUser = true;
    document.body.classList.toggle('reduced-motion', reducedMotion);
    document.documentElement.style.scrollBehavior = reducedMotion ? 'auto' : '';
    reduceMotionButton?.setAttribute('aria-pressed', String(reducedMotion));
    reduceMotionButton?.setAttribute('title', reducedMotion ? 'Enable motion' : 'Reduce motion');
    scene?.setReducedMotion(reducedMotion);
    syncMotionDependentUI();
  }
  reduceMotionButton?.addEventListener('click', () => applyReducedMotion(!reducedMotion, true));
  const onMotionPreferenceChange = event => {
    if (!motionWasSetByUser) applyReducedMotion(event.matches);
  };
  if (motionPreference.addEventListener) motionPreference.addEventListener('change', onMotionPreferenceChange);
  else motionPreference.addListener?.(onMotionPreferenceChange);
  applyReducedMotion(reducedMotion);

  // Request / result protocol explorer. All copy stays visible; only the focused stage changes.
  const sequenceData = {
    lease: {
      title: 'Direct lease',
      summary: 'One caller reserves bounded capacity, runs synchronous work away from the event loop, and releases the executor safely.',
      outcome: 'The exact value, exception, or cancellation from its own submission.',
      actors: ['Caller', 'Event loop', 'Manager', 'Executor'],
      steps: [
        { from:'Caller', to:'Event loop', title:'Request capacity', detail:'The coroutine waits asynchronously, so other event-loop work can continue.', code:'await manager.acquire(owner=...)', actor:1 },
        { from:'Event loop', to:'Manager', title:'Choose a healthy executor', detail:'The manager reuses available capacity or creates a pool without exceeding max_pools.', code:'available → create → wait', actor:2 },
        { from:'Manager', to:'Caller', title:'Grant exclusive access', detail:'The caller receives a lease with a safe submission proxy; no other owner can use that record.', code:'ExecutorLease', actor:2 },
        { from:'Event loop', to:'Executor', title:'Run the callable off-loop', detail:'The synchronous function is submitted to the backend while its Future is registered on the lease.', code:'await lease.run(fn, data)', actor:3 },
        { from:'Executor', to:'Event loop', title:'Return the real outcome', detail:'The original value, exception, or cancellation comes back without being flattened or replaced.', code:'value | exception | cancelled', actor:1 },
        { from:'Event loop', to:'Manager', title:'Release or drain safely', detail:'New submissions stop at release. The executor is reused only after pending work reaches zero.', code:'await lease.release()', actor:2 }
      ]
    },
    grinder: {
      title: 'Batched work',
      summary: 'WorkGrinder groups small requests, borrows one bounded lease for the batch, and resolves every caller independently.',
      outcome: 'One result Future per submitted item—even though the work travelled as a batch.',
      actors: ['Callers', 'WorkGrinder', 'Manager', 'Executor'],
      steps: [
        { from:'Caller', to:'WorkGrinder', title:'Queue each request', detail:'Every submission immediately receives its own result Future and keeps its own identity.', code:'await grinder.submit(fn, data)', actor:1 },
        { from:'WorkGrinder', to:'WorkGrinder', title:'Wait for a useful batch', detail:'The queue opens when it reaches the threshold, the oldest item ages out, or shutdown begins.', code:'threshold | max_wait | stop', actor:1 },
        { from:'WorkGrinder', to:'Manager', title:'Borrow one bounded lease', detail:'The complete live batch is drained together, while one grinder holds at most one lease.', code:'acquire(wait=True)', actor:2 },
        { from:'Manager', to:'Executor', title:'Submit the live items', detail:'Cancelled queue entries are skipped; valid items are submitted without losing earlier outcomes.', code:'proxy.submit(...)', actor:3 },
        { from:'Executor', to:'WorkGrinder', title:'Collect mixed outcomes', detail:'Values, ordinary exceptions, and cancellations are gathered without one item hiding another.', code:'gather(return_exceptions=True)', actor:1 },
        { from:'WorkGrinder', to:'Callers', title:'Resolve every caller', detail:'Each original Future receives only the outcome that belongs to its own request.', code:'future.set_result(...)', actor:0 }
      ]
    },
    thread: {
      title: 'Cross-thread entry',
      summary: 'A non-owner thread hands work to the owner event loop, then receives the result through a thread-safe bridge.',
      outcome: 'A concurrent Future that can be waited on safely from the source thread.',
      actors: ['Source thread', 'Owner loop', 'Manager', 'Executor'],
      steps: [
        { from:'Source thread', to:'Owner loop', title:'Submit from outside the loop', detail:'The synchronous caller uses the dedicated thread-safe entry point instead of touching loop state.', code:'submit_from_thread(fn, data)', actor:0 },
        { from:'Source thread', to:'Owner loop', title:'Bridge into asyncio', detail:'run_coroutine_threadsafe schedules the normal async submission path on the owner loop.', code:'asyncio.run_coroutine_threadsafe', actor:1 },
        { from:'Owner loop', to:'Owner loop', title:'Use the normal queue path', detail:'All WorkGrinder queue mutation and cancellation handling still happen on one event loop.', code:'grinder.submit(...)', actor:1 },
        { from:'Owner loop', to:'Manager', title:'Acquire bounded capacity', detail:'The batch follows the same waiting, ownership, expiry, and backpressure rules.', code:'manager.acquire(...)', actor:2 },
        { from:'Manager', to:'Executor', title:'Execute away from the loop', detail:'The selected thread, process, or interpreter backend runs the synchronous callable.', code:'Executor.submit(...)', actor:3 },
        { from:'Owner loop', to:'Source thread', title:'Deliver the result back', detail:'The source thread reads the exact result through its concurrent Future.', code:'future.result()', actor:0 }
      ]
    }
  };
  let sequenceKind = 'lease';
  let sequenceStep = 0;

  function renderSequence() {
    const path = sequenceData[sequenceKind];
    const steps = path.steps;
    const title = $('#sequenceTitle');
    const summary = $('#sequenceSummary');
    const outcome = $('#sequenceOutcome');
    const route = $('#protocolRoute');
    const list = $('#sequenceSteps');
    const progress = $('#sequenceProgress');
    const label = $('#sequenceStepLabel');
    if (!path || !list) return;

    if (title) title.textContent = path.title;
    if (summary) summary.textContent = path.summary;
    if (outcome) outcome.textContent = path.outcome;
    if (route) route.setAttribute('aria-label', `${path.title} route`);
    path.actors.forEach((actor, index) => {
      const el = $(`#routeActor${index}`);
      if (el) el.textContent = actor;
    });

    const current = steps[sequenceStep];
    $$('.route-actor').forEach((actor, index) => {
      actor.classList.toggle('active', index === current.actor);
    });

    list.innerHTML = steps.map((step, index) => `
      <li class="protocol-step ${index === sequenceStep ? 'active' : ''} ${index < sequenceStep ? 'complete' : ''}">
        <button type="button" data-sequence-step="${index}" aria-current="${index === sequenceStep ? 'step' : 'false'}">
          <span class="step-number">${String(index + 1).padStart(2, '0')}</span>
          <span class="step-copy">
            <small>${escapeHtml(step.from)} <i>→</i> ${escapeHtml(step.to)}</small>
            <b>${escapeHtml(step.title)}</b>
            <p>${escapeHtml(step.detail)}</p>
            <code>${escapeHtml(step.code)}</code>
          </span>
          <span class="step-state" aria-hidden="true">${index < sequenceStep ? '✓' : index === sequenceStep ? '●' : '○'}</span>
        </button>
      </li>`).join('');

    $$('[data-sequence-step]', list).forEach(button => button.addEventListener('click', () => {
      sequenceStep = Number(button.dataset.sequenceStep) || 0;
      renderSequence();
    }));

    if (progress) progress.style.width = `${((sequenceStep + 1) / steps.length) * 100}%`;
    if (label) label.textContent = `Stage ${sequenceStep + 1} of ${steps.length} · ${current.title}`;
  }

  $$('.sequence-tabs button').forEach(button => {
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(button.classList.contains('active')));
    button.addEventListener('click', () => {
      $$('.sequence-tabs button').forEach(tab => {
        const selected = tab === button;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
      });
      sequenceKind = button.dataset.sequence in sequenceData ? button.dataset.sequence : 'lease';
      sequenceStep = 0;
      renderSequence();
    });
  });

  $('#sequenceReplay')?.addEventListener('click', () => {
    const total = sequenceData[sequenceKind].steps.length;
    sequenceStep = (sequenceStep + 1) % total;
    renderSequence();
  });

  syncMotionDependentUI = () => {
    if (reducedMotion) $$('.request-token').forEach(token => token.remove());
  };
  renderSequence();

  // Lifecycle state machine.
  const lifecycleScenarios = {
    normal: {
      states: ['available','leased','decision','available'], paths:['acquire','release','finalize'], branch:'recycle', clock:28, status:'healthy', statusColor:'var(--green)',
      explanation:'Release with no pending futures finalizes immediately. The executor returns only if healthy, unexpired, and within the desired target.',
      logs:[['00:00.000','executor-1 available','total=1 available=1'],['00:00.014','lease granted','available=0 leased=1'],['00:00.228','lease released','pending=0 draining=False'],['00:00.230','executor returned','kept=True available=1']]
    },
    drain: {
      states:['available','leased','draining','decision','available'], paths:['acquire','release','finalize'], branch:'recycle', clock:49, status:'draining', statusColor:'var(--amber)',
      explanation:'Release closes submissions immediately. The record remains leased while pending futures finish, then a done callback finalizes it.',
      logs:[['00:00.000','lease granted','owner=batch-17'],['00:00.031','4 futures submitted','pending=4'],['00:00.114','release requested','draining=True'],['00:00.512','last future completed','pending=0 → finalize'],['00:00.515','executor returned','kept=True']]
    },
    expire: {
      states:['available','leased','decision'], paths:['acquire',null], branch:'retire', clock:100, status:'revoked', statusColor:'var(--red)',
      explanation:'Soft expiry is informational. Submission remains allowed through grace; at hard expiry the record is removed and the executor is shut down.',
      logs:[['00:00.000','lease granted','lease=5s grace=2s'],['00:05.000','soft expiry reached','submissions still allowed'],['00:07.000','hard expiry reached','lease revoked'],['00:07.002','executor shutdown','replacement minimum ensured']]
    },
    broken: {
      states:['available','leased','decision'], paths:['acquire','finalize'], branch:'retire', clock:43, status:'broken', statusColor:'var(--red)',
      explanation:'A BrokenExecutor exception retires the entire executor. Ordinary callable errors do not trigger this topology change.',
      logs:[['00:00.000','future submitted','pending=1'],['00:00.093','BrokenExecutor detected','future callback'],['00:00.095','record retired','broken=True pending cleared'],['00:00.097','minimum restored','new executor created'],['00:00.099','shutdown deferred','outside callback thread']]
    },
    shrink: {
      states:['available','leased','decision'], paths:['acquire','release'], branch:'retire', clock:31, status:'above target', statusColor:'var(--amber)',
      explanation:'A target decrease never revokes a healthy active lease. When that lease later releases, an excess executor can be shut down instead of returned.',
      logs:[['00:00.000','desired target changed','desired 3 → 1'],['00:00.013','active lease preserved','no forced revoke'],['00:00.428','lease released','pending=0'],['00:00.431','projected total > target','kept=False'],['00:00.433','executor shutdown','idle excess removed']]
    }
  };
  let lifecycleTimers = [];

  function playLifecycle(name) {
    lifecycleTimers.forEach(clearTimeout); lifecycleTimers = [];
    const scenario = lifecycleScenarios[name];
    if (!scenario) return;
    $$('.state-card').forEach(el => el.classList.remove('active','retired'));
    $$('.state-path').forEach(el => el.classList.remove('active'));
    $$('.state-branch').forEach(el => el.style.opacity = '.2');
    const terminal = $('#lifecycleTerminal');
    terminal.innerHTML = scenario.logs.map(row => `<div><span>${row[0]}</span><b>${row[1]}</b><em>${row[2]}</em></div>`).join('');
    $('#clockStatus').textContent = scenario.status;
    $('#clockStatus').style.color = scenario.statusColor;
    $('#clockExplanation').textContent = scenario.explanation;
    $('#clockFill').style.width = `${scenario.clock}%`;
    $('#clockNeedle').style.left = `${scenario.clock}%`;
    $('#clockFill').style.background = scenario.clock >= 100 ? 'linear-gradient(90deg,var(--cyan),var(--amber),var(--red))' : scenario.status === 'broken' ? 'linear-gradient(90deg,var(--cyan),var(--red))' : 'linear-gradient(90deg,var(--cyan),var(--violet))';

    const interval = reducedMotion ? 0 : 560;
    scenario.states.forEach((state, index) => {
      const timer = setTimeout(() => {
        $$('.state-card').forEach(el => el.classList.remove('active'));
        const card = $(`[data-state="${state}"]`);
        if (card) {
          card.classList.add('active');
          if (index === scenario.states.length - 1 && scenario.branch === 'retire') card.classList.add('retired');
        }
        if (index > 0) {
          const pathName = scenario.paths[index - 1];
          if (pathName) $(`[data-path="${pathName}"]`)?.classList.add('active');
        }
        if (index === scenario.states.length - 1) {
          const branch = $(`[data-branch="${scenario.branch}"]`);
          if (branch) branch.style.opacity = '1';
        }
      }, interval * index);
      lifecycleTimers.push(timer);
    });
  }
  $$('.lifecycle-controls button').forEach(button => button.addEventListener('click', () => {
    $$('.lifecycle-controls button').forEach(b => {
      const selected = b === button;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-pressed', String(selected));
    });
    playLifecycle(button.dataset.lifecycle);
  }));
  $$('.lifecycle-controls button').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
  playLifecycle('normal');

  // Concurrency lab.
  class ConcurrencyLab {
    constructor() {
      this.mode = 'grinder';
      this.queue = [];
      this.pools = [];
      this.completed = 0;
      this.completionTimes = [];
      this.arrivalAccumulator = 0;
      this.elapsed = 0;
      this.last = performance.now();
      this.lastRender = 0;
      this.taskId = 0;
      this.params = {};
      this.chartRaw = Array(90).fill(0);
      this.chartPooled = Array(90).fill(0);
      this.readParams();
      this.buildPools();
      this.bind();
      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    }

    readParams() {
      this.params.arrival = +$('#arrivalRate').value;
      this.params.cost = +$('#taskCost').value;
      this.params.maxPools = +$('#maxPools').value;
      this.params.workers = +$('#workersPool').value;
      this.params.threshold = +$('#batchThreshold').value;
      this.params.maxWait = +$('#maxWait').value;
    }

    bind() {
      const controls = [
        ['arrivalRate','arrivalRateOut',v=>`${v} / sec`], ['taskCost','taskCostOut',v=>`${v} ms`],
        ['maxPools','maxPoolsOut',v=>v], ['workersPool','workersPoolOut',v=>v],
        ['batchThreshold','batchThresholdOut',v=>v], ['maxWait','maxWaitOut',v=>`${v} ms`]
      ];
      controls.forEach(([id,out,fmt]) => {
        $(`#${id}`).addEventListener('input', () => {
          $(`#${out}`).textContent = fmt($(`#${id}`).value);
          const oldPools = this.params.maxPools;
          this.readParams();
          if (this.params.maxPools !== oldPools) this.buildPools(true);
          this.render(true);
        });
      });
      $$('[data-lab-mode]').forEach(button => button.addEventListener('click', () => {
        this.setMode(button.dataset.labMode);
        this.reset();
      }));
      $('#burstButton').addEventListener('click', () => { for (let i=0;i<20;i++) this.addTask(true); this.render(true); });
      $('#resetLab').addEventListener('click', () => this.reset());
      this.setMode(this.mode);
    }

    setMode(mode) {
      this.mode = mode === 'direct' ? 'direct' : 'grinder';
      $$('[data-lab-mode]').forEach(button => {
        const selected = button.dataset.labMode === this.mode;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      $$('.grinder-control').forEach(control => {
        const disabled = this.mode !== 'grinder';
        control.classList.toggle('disabled', disabled);
        control.setAttribute('aria-disabled', String(disabled));
        $$('input, button, select, textarea', control).forEach(input => { input.disabled = disabled; });
      });
      $('#queueZoneTitle').textContent = this.mode === 'grinder' ? 'WorkGrinder' : 'Capacity waiters';
      $('#queueZoneSub').textContent = this.mode === 'grinder' ? 'condition + deque' : 'acquire wait=True';
      $('#rackLinkLabel').textContent = this.mode === 'grinder' ? 'enqueue' : 'acquire';
    }

    buildPools(preserve = false) {
      const old = preserve ? this.pools : [];
      this.pools = Array.from({ length: this.params.maxPools }, (_, i) => old[i] || { id:i+1, state:'available', running:[], waiting:[], batchId:0 });
      if (old.length > this.pools.length) {
        old.slice(this.pools.length).forEach(p => this.queue.unshift(...p.running, ...p.waiting));
      }
    }

    addTask(burst = false) {
      const jitter = .78 + Math.random() * .44;
      this.queue.push({ id:++this.taskId, remaining:this.params.cost*jitter, total:this.params.cost*jitter, age:0, burst });
      if (Math.random() < .34) this.spawnToken();
    }

    spawnToken() {
      const stream = $('#requestStream');
      if (!stream || reducedMotion || stream.childElementCount > 14) return;
      const el = document.createElement('i');
      el.className = 'request-token';
      el.textContent = String(this.taskId % 99).padStart(2,'0');
      el.style.left = `${5 + Math.random()*35}%`;
      el.style.top = `${20 + Math.random()*70}%`;
      el.style.setProperty('--ty', `${-30 - Math.random()*100}px`);
      stream.appendChild(el);
      setTimeout(() => el.remove(), 1500);
    }

    dispatch() {
      if (!this.queue.length) return;
      if (this.mode === 'grinder') {
        if (this.pools.some(p => p.state !== 'available')) return; // one WorkGrinder, one lease
        const oldest = this.queue[0]?.age || 0;
        if (this.queue.length < this.params.threshold && oldest < this.params.maxWait) return;
        const pool = this.pools.find(p => p.state === 'available');
        if (!pool) return;
        const batch = this.queue.splice(0); // exact implementation drains all pending
        pool.batchId++;
        pool.state = 'leased';
        pool.running = batch.splice(0, this.params.workers);
        pool.waiting = batch;
      } else {
        for (const pool of this.pools) {
          if (!this.queue.length) break;
          if (pool.state !== 'available') continue;
          pool.state = 'leased';
          // conceptual direct lease wave: caller can submit work to its exclusive pool
          pool.running = this.queue.splice(0, this.params.workers);
          pool.waiting = [];
        }
      }
    }

    tick(dt) {
      this.elapsed += dt;
      this.arrivalAccumulator += this.params.arrival * dt / 1000;
      while (this.arrivalAccumulator >= 1) { this.addTask(); this.arrivalAccumulator -= 1; }
      this.queue.forEach(t => t.age += dt);
      this.dispatch();

      for (const pool of this.pools) {
        if (pool.state === 'available') continue;
        for (const task of pool.running) task.remaining -= dt;
        const done = pool.running.filter(t => t.remaining <= 0);
        if (done.length) {
          this.completed += done.length;
          const now = performance.now();
          done.forEach(() => this.completionTimes.push(now));
          pool.running = pool.running.filter(t => t.remaining > 0);
          while (pool.running.length < this.params.workers && pool.waiting.length) pool.running.push(pool.waiting.shift());
        }
        if (!pool.running.length && !pool.waiting.length) pool.state = 'available';
      }
      this.dispatch();
      const cutoff = performance.now() - 5000;
      this.completionTimes = this.completionTimes.filter(t => t >= cutoff);
    }

    reset() {
      this.queue = [];
      this.completed = 0;
      this.completionTimes = [];
      this.arrivalAccumulator = 0;
      this.elapsed = 0;
      this.buildPools();
      this.chartRaw.fill(0); this.chartPooled.fill(0);
      this.render(true);
    }

    render(force = false) {
      const now = performance.now();
      if (!force && now - this.lastRender < 180) return;
      this.lastRender = now;
      const q = this.queue.length;
      const oldest = this.queue[0]?.age || 0;
      $('#queueCount').textContent = q;
      $('#queueFill').style.height = `${Math.min(100, q/30*100)}%`;
      $('#batchTimerFill').style.width = `${this.mode === 'grinder' ? Math.min(100, oldest/this.params.maxWait*100) : Math.min(100,q/this.params.maxPools/3*100)}%`;
      $('#batchTimerText').textContent = this.mode === 'grinder' ? `oldest ${Math.round(oldest)} ms` : `${q} waiting for capacity`;
      $('#queueDots').innerHTML = Array.from({length:Math.min(q,50)},()=>'<i></i>').join('');

      $('#poolGrid').innerHTML = this.pools.map(pool => {
        const busy = pool.running.length;
        const state = pool.state;
        const workers = Array.from({length:this.params.workers},(_,i)=>`<i class="${i<busy?'busy':''}"></i>`).join('');
        return `<div class="pool-card ${state}"><h5>pool-${pool.id} · ${state}${pool.waiting.length ? ` · +${pool.waiting.length} queued` : ''}</h5><div class="pool-workers">${workers}</div></div>`;
      }).join('');
      const activeWorkers = this.pools.reduce((n,p)=>n+p.running.length,0);
      const totalWorkers = this.params.maxPools*this.params.workers;
      const throughput = this.completionTimes.length/5;
      $('#completedCount').textContent = this.completed;
      $('#labQueueMetric').textContent = q;
      $('#labQueueTrend').textContent = q > 24 ? 'capacity exceeded' : q > 8 ? 'building' : q ? 'flowing' : 'stable';
      $('#labWorkersMetric').textContent = `${activeWorkers} / ${totalWorkers}`;
      $('#labThroughputMetric').textContent = `${throughput.toFixed(1)}/s`;
      const pressureRatio = (this.params.arrival*this.params.cost)/(Math.max(1,totalWorkers)*1000);
      const pressure = q > 30 ? 'high' : q > 12 || pressureRatio > .9 ? 'moderate' : 'low';
      $('#labPressureMetric').textContent = pressure;
      $('#simTime').textContent = `T+${String(Math.floor(this.elapsed/60000)).padStart(2,'0')}:${String(Math.floor(this.elapsed/1000)%60).padStart(2,'0')}`;
      this.updateChart(pressureRatio,q);
    }

    updateChart(ratio,q) {
      const rawBase = clamp(this.params.arrival*this.params.cost/30, 5, 1500);
      const pooledBase = clamp(4 + ratio*13 + q*.8, 3, 180);
      this.chartRaw.push(rawBase*(.78+Math.random()*.42)); this.chartRaw.shift();
      this.chartPooled.push(pooledBase*(.74+Math.random()*.34)); this.chartPooled.shift();
      this.drawChart();
    }

    drawChart() {
      const canvas = $('#pressureChart');
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1,2);
      const width = Math.max(1,rect.width), height = 170;
      if (canvas.width !== Math.floor(width*dpr) || canvas.height !== Math.floor(height*dpr)) { canvas.width=Math.floor(width*dpr); canvas.height=Math.floor(height*dpr); }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
      ctx.strokeStyle='rgba(130,160,205,.08)'; ctx.lineWidth=1;
      for(let i=0;i<5;i++){ const y=15+i*34; ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke(); }
      const max = Math.max(60,...this.chartRaw,...this.chartPooled);
      const draw=(data,color,fill)=>{
        ctx.beginPath();
        data.forEach((v,i)=>{ const x=i/(data.length-1)*width; const y=height-10-(v/max)*(height-25); if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y); });
        ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.stroke();
        if(fill){ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();const g=ctx.createLinearGradient(0,0,0,height);g.addColorStop(0,fill);g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fill();}
      };
      draw(this.chartRaw,'rgba(255,116,139,.7)','rgba(255,116,139,.07)');
      draw(this.chartPooled,'rgba(110,231,255,.95)','rgba(110,231,255,.09)');
      ctx.font='8px ui-monospace, monospace';ctx.fillStyle='rgba(120,139,172,.65)';ctx.fillText(`${Math.round(max)} ms`,4,10);ctx.fillText('0 ms',4,height-3);
    }

    frame(now) {
      const dt = Math.min(100, now - this.last);
      this.last = now;
      if (!document.hidden) this.tick(dt);
      this.render();
      requestAnimationFrame(this.frame);
    }
  }
  const lab = new ConcurrencyLab();

  // Adaptive sizing calculator.
  const formulaInputs = ['unitsInput','unitsPerPoolInput','minPoolsInput','maxPoolsFormulaInput'];
  function updateFormula() {
    let units = +$('#unitsInput').value;
    const upp = +$('#unitsPerPoolInput').value;
    let min = +$('#minPoolsInput').value;
    let max = +$('#maxPoolsFormulaInput').value;
    if (min > max) { max = min; $('#maxPoolsFormulaInput').value = max; }
    const desired = Math.min(max, Math.max(min, Math.ceil(units / upp)));
    $('#unitsOutput').textContent = units;
    $('#unitsPerPoolOutput').textContent = upp;
    $('#minPoolsOutput').textContent = min;
    $('#maxPoolsFormulaOutput').textContent = max;
    $('#desiredOutput').textContent = `${desired} pool${desired===1?'':'s'}`;
    $('#workerCapacityOutput').textContent = `${desired*4} configured workers at 4 per pool`;
    $('#capacityPools').innerHTML = Array.from({length:max},(_,i)=>`<div class="${i<desired?'active':''}"><i></i><span>${i<desired?'target':'ceiling'} ${i+1}</span></div>`).join('');
  }
  formulaInputs.forEach(id => $(`#${id}`).addEventListener('input', updateFormula));
  updateFormula();

  // Internal mechanism explorer.
  const mechanisms = {
    lock: {
      kicker:'Synchronous critical section', title:'Why a threading.RLock exists inside an async library',
      body:'Executor.submit() is synchronous, while done callbacks can execute on worker or manager threads. The lock makes lease validation, submission, pending-future registration, release, and callback accounting one coherent state transition.',
      points:['Protects <code>_available</code> and <code>_leased</code>','Prevents submit-after-release races','Keeps callbacks backend-thread safe'],
      html:`<div class="lock-viz"><div class="sync-call submit-call"><small>event-loop thread</small><b>submit()</b><i></i></div><div class="sync-call callback-call"><small>backend thread</small><b>done callback</b><i></i></div><div class="lock-core"><span>RLock</span><b>atomic lease state</b><div><i>available</i><i>leased</i><i>pending</i></div></div></div>`
    },
    checker: {
      kicker:'Owner-loop background task', title:'The checker sleeps until something actually matters',
      body:'Each iteration clears its wake event, revokes hard-expired leases, restores the desired minimum, removes idle excess, and computes the next hard-expiry deadline. It then waits for either a signal or the earlier of check_interval and that deadline.',
      points:['New short leases wake the checker immediately','Expiry timing is not limited by a long check interval','Sizing changes use the same wake event'],
      html:`<div class="checker-viz"><div class="checker-ring"><span>revoke expired</span><span>ensure minimum</span><span>shrink idle</span><span>wait until event</span></div></div>`
    },
    callbacks: {
      kicker:'Backend-thread completion path', title:'A done callback closes the accounting loop',
      body:'Every submitted concurrent Future is added to the lease record before returning. Its callback removes it, detects BrokenExecutor, and finalizes a released record when the pending set becomes empty.',
      points:['Ordinary task exceptions remain per-task','Broken pools are retired, never recycled','Shutdown is deferred beyond callback threads'],
      html:`<div class="callback-viz"><div class="future-box"><h4>completed Future</h4><code>cancelled?</code><code>exception()</code><code>BrokenExecutor?</code></div><div class="callback-arrow"></div><div class="record-box"><h4>_LeaseRecord</h4><code>pending.discard(future)</code><code>retire broken</code><code>finalize draining</code></div></div>`
    },
    ownership: {
      kicker:'Cross-loop and cross-thread contract', title:'One event loop owns the asynchronous state',
      body:'Manager start, stop, and acquire—and every WorkGrinder async method—must execute on the loop that started the object. Other OS threads use the explicit thread-safe bridge instead of touching loop-bound state.',
      points:['Wrong-loop calls fail before mutating state','Sync thread APIs reject owner-loop use','Thread bridge returns ConcurrentFuture'],
      html:`<div class="ownership-viz"><div class="thread-stack"><div>thread A · submit_from_thread</div><div>thread B · stats_from_thread</div><div>thread C · result()</div></div><div class="thread-bridge"></div><div class="loop-orb"><b>owner event loop</b><span>all async mutation</span></div></div>`
    },
    logging: {
      kicker:'Opt-in process bridge', title:'Process worker logs return without replacing application logging',
      body:'The manager composes its initializer with the user initializer, installs QueueHandler in each child, and runs a QueueListener in the parent. The forwarding handler re-enters the selected parent logger hierarchy.',
      points:['Prefers forkserver, then spawn, when context is implicit','User-provided multiprocessing context is respected','Application formatters, filters, and handlers remain authoritative'],
      html:`<div class="logging-viz"><i></i><div><b>QueueHandler</b><span>child root logger</span></div><div><b>mp Queue</b><span>LogRecord IPC</span></div><div><b>QueueListener</b><span>parent thread</span></div><div><b>target logger</b><span>app hierarchy</span></div></div>`
    }
  };
  function setMechanism(name) {
    const m = mechanisms[name];
    $('#mechanismKicker').textContent = m.kicker;
    $('#mechanismTitle').textContent = m.title;
    $('#mechanismBody').textContent = m.body;
    $('#mechanismPoints').innerHTML = m.points.map(p=>`<span><i></i>${p}</span>`).join('');
    $('#mechanismDiagram').dataset.view = name;
    $('#mechanismDiagram').innerHTML = m.html;
  }
  $$('.mechanism-nav button').forEach(button => button.addEventListener('click', () => {
    $$('.mechanism-nav button').forEach(b => {
      const selected = b === button;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-pressed', String(selected));
    });
    setMechanism(button.dataset.mechanism);
  }));
  $$('.mechanism-nav button').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));

  // Copy canonical snippet as clean source text.
  function legacyCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand?.('copy') || false;
    textarea.remove();
    return copied;
  }

  $('#copyCode')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const code = $('#quickstartCode')?.textContent || '';
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) copied = legacyCopy(code);
    button.textContent = copied ? 'Copied' : 'Select text';
    setTimeout(() => { button.textContent = 'Copy'; }, 1300);
  });

  // Keep canvas/chart correctly sized after font/layout changes.
  window.addEventListener('resize', () => lab.drawChart());
  if (window.ResizeObserver) {
    const pressureChart = $('#pressureChart');
    if (pressureChart) new ResizeObserver(() => lab.drawChart()).observe(pressureChart);
  }
})();

/* AUTOPLAY page: plays the film, then hands the controller to the visitor.
   Everything below is a paper simulation on a random market. No wallet, no network, no real funds. */
(function () {
  'use strict';
  const FILM = 22.8, ROUND = 60, TPS = 10, N = ROUND * TPS, START = 10, FEE = 0.003, RATE = 0.00012, TAU = Math.PI * 2;
  const PAGE = 'https://kaivornxbt.github.io/autoplay-controller/';
  const SANS = '"Space Grotesk"', MONO = '"JetBrains Mono"', MINT = '#14f195', VIO = '#9945ff';
  const STOCK = { risk: 5, speed: 3, stake: 0.3, auto: true };

  /* ---------- market and strategy ---------- */
  function rng(a) { return function () { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function market(seed) {
    const r = rng(seed), p = new Float64Array(N + 1), f = new Float64Array(N + 1), s = new Float64Array(N + 1);
    let v = 0, left = 0, drift = 0, vol = 0.003;
    p[0] = f[0] = s[0] = 100;
    for (let i = 1; i <= N; i++) {
      if (left-- <= 0) { left = 18 + r() * 50; drift = (r() - 0.5) * 0.0011; vol = 0.002 + r() * 0.0045; }
      v += drift + vol * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
      if (r() < 0.0035) v += (r() < 0.62 ? -1 : 1) * (0.018 + r() * 0.03);   /* sudden wicks, mostly down */
      p[i] = 100 * Math.exp(v);
      f[i] = f[i - 1] + 0.2 * (p[i] - f[i - 1]);
      s[i] = s[i - 1] + 0.05 * (p[i] - s[i - 1]);
    }
    return { p, f, s };
  }
  const book = () => ({ cash: START, margin: 0, entry: 0, lev: 1, staked: 0, rew: 0 });
  const posVal = (b, p) => b.margin ? Math.max(0, b.margin * (1 + b.lev * (p / b.entry - 1))) : 0;
  const equity = (b, p) => b.cash + posVal(b, p) + b.staked;
  const money = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);

  function buy(b, p, frac, lev) {
    const amt = b.cash * frac;
    if (amt < 0.05) return null;
    const v = posVal(b, p);
    b.cash -= amt; b.margin = v + amt * (1 - FEE); b.entry = p; b.lev = lev;
    return { b: 'BUY', log: 'entry ' + lev.toFixed(1) + 'x' };
  }
  function sell(b, p) {
    if (b.margin) {
      const v = posVal(b, p) * (1 - FEE), pnl = v - b.margin;
      b.cash += v; b.margin = 0;
      return { b: 'SELL', log: money(pnl) + ' SOL' };
    }
    if (b.staked > 0.01) { b.cash += b.staked * 0.99; b.staked = 0; return { b: 'SELL', log: 'unstaked' }; }
    return null;
  }
  function stake(b, amt) {
    amt = Math.min(amt, b.cash);
    if (amt < 0.05) return null;
    b.cash -= amt; b.staked += amt;
    return { b: 'STAKE', log: amt.toFixed(2) + ' idle' };
  }
  function claim(b) {
    if (b.rew < 0.005) return null;
    const d = b.rew; b.cash += d; b.rew = 0;
    return { b: 'CLAIM', log: '+' + d.toFixed(2) + ' SOL', d };
  }
  function accrue(b, p) {
    b.rew += b.staked * RATE;
    if (b.margin && posVal(b, p) <= b.margin * 0.02) { b.margin = 0; return { b: 'L', log: 'LIQUIDATED', tag: 'ALERT' }; }
    return null;
  }
  const interval = (speed) => [16, 10, 6, 4, 3][speed - 1];
  function agentStep(b, c, m, i) {
    const p = m.p[i], sig = (m.f[i] - m.s[i]) / m.s[i], th = 0.0012 + (6 - c.speed) * 0.00025;
    if (b.margin) {
      const mv = p / b.entry - 1;
      if (sig < -th || mv < -(0.008 + 0.003 * c.risk) || mv > 0.02 + 0.008 * c.risk) return sell(b, p);
    } else if (sig > th && b.cash > 0.1) {
      const r = buy(b, p, 0.1 + 0.08 * c.risk, 1 + (c.risk - 1) * 0.25);
      if (r) return r;
    }
    if (c.auto && b.rew > 0.03) return claim(b);
    if (c.stake > 0) {
      const want = equity(b, p) * c.stake - b.staked;
      if (want > 0.2 && b.cash > 0.1) return stake(b, Math.min(b.cash * 0.6, want));
    }
    return null;
  }
  /* headless run, used by the round itself and handy from the console */
  window.__AUTOPLAY_SIM = {
    run(c, seed) {
      const m = market(seed), b = book(), iv = interval(c.speed);
      for (let i = 1; i <= N; i++) { accrue(b, m.p[i]); if (i % iv === 0) agentStep(b, c, m, i); }
      return equity(b, m.p[N]) - START;
    },
  };

  /* ---------- state ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window */ } },
  };
  let cfg = Object.assign({ name: 'AFK', risk: 5, speed: 3, stake: 30, auto: true }, store.get('autoplay.cfg', {}));
  let tab = 'agent', view = 'film', soundOn = false, round = null, t0 = null;
  const last = {};
  const SIM = {
    pose: 16, clock: 0, claims: [],
    press(n, t, dec) { const l = last[n]; return l === undefined || t < l ? 0 : Math.exp(-(t - l) / dec); },
    age(n, t) { const l = last[n]; return l === undefined || t < l ? 9 : t - l; },
    draw(g, w, h) { drawScreen(g, w, h); },
  };
  const cleanName = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9_ -]/g, '').trim().slice(0, 12) || 'AFK';

  /* ---------- sound: a tiny live chip loop, separate from the film track ---------- */
  const film = new Audio('media/autoplay-audio.m4a'); film.loop = true; film.preload = 'auto';
  let ac = null, nextNote = 0, step = 0;
  function tone(type, f, t, dur, g) {
    const o = ac.createOscillator(), v = ac.createGain();
    o.type = type; o.frequency.value = f;
    v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(v).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const CH = [[61.74, [493.88, 587.33, 739.99]], [49, [392, 493.88, 587.33]], [73.42, [440, 587.33, 739.99]], [55, [440, 554.37, 659.25]]];
  function schedule() {
    if (!soundOn || !round || round.over || !ac) return;
    while (nextNote < ac.currentTime + 0.25) {
      const s = step % 16, c = CH[Math.floor(step / 16) % 4];
      if (s % 2 === 0 && s !== 6 && s !== 14) tone('triangle', c[0] * (s % 8 === 4 ? 2 : 1), nextNote, 0.26, 0.2);
      tone('square', c[1][[0, 1, 2, 1][s % 4]] * 2, nextNote, 0.1, 0.022);
      nextNote += 0.15; step++;
    }
  }
  setInterval(schedule, 80);
  function blip(n) {
    if (!soundOn || !ac) return;
    const t = ac.currentTime;
    if (n === 'BUY') { tone('square', 987.77, t, 0.07, 0.06); tone('square', 1479.98, t + 0.05, 0.08, 0.06); }
    else if (n === 'SELL') { const o = 1479.98; tone('square', o, t, 0.06, 0.06); tone('square', o * 0.75, t + 0.06, 0.09, 0.06); }
    else if (n === 'STAKE') { tone('sine', 587.33, t, 0.25, 0.12); tone('sine', 880, t + 0.03, 0.2, 0.07); }
    else if (n === 'CLAIM') { [1174.66, 1480, 1760].forEach((f, k) => tone('square', f, t + k * 0.05, 0.1, 0.06)); }
    else if (n === 'L') { tone('sawtooth', 160, t, 0.5, 0.14); }
  }

  /* ---------- round ---------- */
  function startRound() {
    const name = tab === 'agent' ? cleanName(cfg.name) : 'YOU';
    const c = { risk: +cfg.risk, speed: +cfg.speed, stake: +cfg.stake / 100, auto: !!cfg.auto };
    round = {
      kind: tab, name, c, m: market((Math.random() * 2147483647) | 0), you: book(), afk: book(), i: 0, start: SIM.clock,
      log: [], eqY: [START], eqA: [START], human: 0, over: false, iv: interval(c.speed), ivA: interval(STOCK.speed),
    };
    SIM.claims = [];
    if (ac) { nextNote = ac.currentTime + 0.05; step = 0; }
    view = 'run'; render();
  }
  function apply(r) {
    if (!r) return;
    last[r.b] = SIM.clock;
    if (r.b === 'BUY') last.R2 = SIM.clock + 0.12;
    if (r.d) SIM.claims.push({ t: SIM.clock, d: r.d });
    round.log.push({ tag: r.tag || r.b, log: r.log, bad: r.b === 'L' });
    blip(r.b);
  }
  function tick() {
    const R = round; R.i++;
    const p = R.m.p[R.i];
    apply(accrue(R.you, p));
    accrue(R.afk, p);
    if (R.kind === 'agent' && R.i % R.iv === 0) {
      apply(agentStep(R.you, R.c, R.m, R.i));
      if (R.i % (R.iv * 3) === 0) last.L = SIM.clock;
    }
    if (R.i % R.ivA === 0) agentStep(R.afk, STOCK, R.m, R.i);
    R.eqY.push(equity(R.you, p)); R.eqA.push(equity(R.afk, p));
  }
  function finish() {
    const R = round; R.over = true;
    const p = R.m.p[N];
    R.result = { you: equity(R.you, p) - START, afk: equity(R.afk, p) - START, lost: R.you.rew };
    if (R.kind === 'agent') store.set('autoplay.cfg', cfg);
    const key = 'autoplay.best.' + R.kind, best = store.get(key, null);
    R.result.best = best === null ? R.result.you : Math.max(best, R.result.you);
    R.result.record = best === null || R.result.you > best;
    store.set(key, R.result.best);
    view = 'done'; render();
  }
  function human(a) {
    if (view !== 'run') return;
    const R = round;
    if (R.kind === 'agent') { last[a] = SIM.clock; const t = document.getElementById('toast'); if (t) t.textContent = 'Hands off. ' + R.name + ' has this.'; return; }
    const p = R.m.p[R.i];
    let r = null;
    if (a === 'BUY') r = buy(R.you, p, 0.5, 2);
    else if (a === 'SELL') r = sell(R.you, p);
    else if (a === 'STAKE') r = stake(R.you, R.you.cash * 0.25);
    else if (a === 'CLAIM') r = claim(R.you);
    R.human++;
    if (r) apply(r); else { last[a] = SIM.clock; blip('none'); }
  }

  /* ---------- terminal screen ---------- */
  function drawScreen(g, w, h) {
    const wa = 602, wb = 1806, cx = (wa + wb) / 2, R = round;
    g.fillStyle = '#090713'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(153,69,255,.10)'; g.lineWidth = 2;
    for (let x = 0; x < w; x += 80) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 80) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(wa - 1, 0, 3, h); g.fillRect(wb - 1, 0, 3, h);
    const label = (s, x, y, al) => { g.textAlign = al || 'left'; g.fillStyle = '#b8add0'; g.font = '700 42px ' + SANS; g.fillText(s, x, y); g.textAlign = 'left'; };

    if (!R) {
      g.textAlign = 'center'; g.fillStyle = '#f3effc'; g.font = '700 120px ' + SANS; g.fillText('YOUR TURN', cx, 360);
      g.font = '500 50px ' + MONO; g.fillStyle = MINT; g.fillText('paper SOL. no wallet.', cx, 450);
      g.font = '500 42px ' + MONO; g.fillStyle = '#c7bfd8'; g.fillText('set it up on the left', cx, 530);
      label('LOG', 44, 76); label('HANDS', wb + 44, 76);
      g.fillStyle = '#fff'; g.font = '700 118px ' + SANS; g.fillText('0', wb + 44, 200);
      return;
    }
    const li = Math.min(R.i, N), bal = R.eqY[li], pct = bal - START;
    label(R.name.slice(0, 9) + ' LOG', 44, 76);
    R.log.slice(-9).forEach((e, i, a) => {
      const y = 150 + i * 76, nw = i === a.length - 1;
      if (nw) { g.fillStyle = e.bad ? 'rgba(255,95,168,.22)' : 'rgba(20,241,149,.16)'; g.fillRect(24, y - 54, wa - 48, 72); }
      g.font = '700 46px ' + MONO; g.fillStyle = e.bad ? '#ff6f9f' : nw ? MINT : '#8a7fa3'; g.fillText(e.tag, 44, y, 165);
      g.font = '500 44px ' + MONO; g.fillStyle = nw ? '#fff' : '#c7bfd8'; g.fillText(e.log, 218, y, 360);
    });
    label('PAPER BALANCE', cx, 76, 'center');
    g.textAlign = 'center'; g.font = '700 170px ' + SANS; g.fillStyle = '#fff'; g.fillText(bal.toFixed(3), cx, 240);
    g.font = '500 52px ' + MONO; g.fillStyle = pct >= 0 ? MINT : '#ff6f9f';
    const left = Math.max(0, ROUND - li / TPS);
    g.fillText(money(pct) + ' paper SOL   ' + (R.over ? 'done' : left.toFixed(0) + 's'), cx, 326);
    const x0 = wa + 70, x1 = wb - 70, y0 = 800, y1 = 380;
    let lo = START - 0.3, hi = START + 0.3;
    for (let i = 0; i <= li; i++) { lo = Math.min(lo, R.eqY[i], R.eqA[i]); hi = Math.max(hi, R.eqY[i], R.eqA[i]); }
    const X = (i) => x0 + (x1 - x0) * i / N, Y = (v) => y0 + (y1 - y0) * (v - lo) / (hi - lo);
    g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 2; g.setLineDash([10, 12]); g.beginPath(); g.moveTo(x0, Y(START)); g.lineTo(x1, Y(START)); g.stroke(); g.setLineDash([]);
    const path = (arr) => { g.beginPath(); for (let i = 0; i <= li; i += 2) { const x = X(i), y = Y(arr[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.lineTo(X(li), Y(arr[li])); };
    path(R.eqA); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 5; g.stroke();
    path(R.eqY); const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, VIO); gr.addColorStop(1, MINT); g.strokeStyle = gr; g.lineWidth = 9; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(li), Y(R.eqY[li]), 14, 0, TAU); g.fill();

    label('HANDS', wb + 44, 76);
    g.font = '700 118px ' + SANS; g.fillStyle = '#fff'; g.fillText(String(R.human), wb + 44, 200);
    const nw = g.measureText(String(R.human)).width;
    g.font = '500 44px ' + MONO; g.fillStyle = '#c7bfd8'; g.fillText('human input', wb + 44 + nw + 24, 196);
    [['BUY', 'BUY'], ['SELL', 'SELL'], ['STAKE', 'STAKE'], ['CLAIM', 'CLAIM'], ['L', 'STICK'], ['R2', 'R2']].forEach(([b, lab], i) => {
      const cw = 170, xx = wb + 44 + (i % 3) * (cw + 12), yy = 260 + Math.floor(i / 3) * 100, on = SIM.press(b, SIM.clock, 0.14);
      g.fillStyle = 'rgba(20,241,149,' + (0.08 + on * 0.85) + ')'; g.beginPath(); g.roundRect(xx, yy, cw, 86, 12); g.fill();
      g.fillStyle = on > 0.35 ? '#07130e' : '#e8e2f5'; g.font = '700 40px ' + SANS; g.textAlign = 'center'; g.fillText(lab, xx + cw / 2, yy + 58); g.textAlign = 'left';
    });
    label('STOCK AFK', wb + 44, 520);
    const af = R.eqA[li] - START;
    g.font = '700 100px ' + SANS; g.fillStyle = af >= 0 ? '#fff' : '#ff9dbd'; g.fillText(money(af), wb + 44, 628);
    g.fillStyle = R.over ? '#b8add0' : MINT; g.beginPath(); g.arc(wb + 56, 800, 13, 0, TAU); g.fill();
    g.font = '500 44px ' + MONO; g.fillText(R.over ? 'FINISHED' : 'RUNNING', wb + 84, 816);
  }

  /* ---------- page ---------- */
  const stage = document.getElementById('stage');
  const bar = document.createElement('div'); bar.id = 'bar';
  bar.innerHTML = '<button id="snd" aria-pressed="false">Sound off</button><button id="rst" class="film">Restart</button>' +
    '<span class="film">Concept render. No trading logic.</span><button id="take" class="go film">Take the controller</button>' +
    '<a href="https://github.com/kaivornxbt/autoplay-controller">GitHub</a>';
  document.body.appendChild(bar);
  const panel = document.createElement('aside'); panel.id = 'panel'; panel.setAttribute('aria-label', 'Simulator');
  document.body.appendChild(panel);
  const $ = (id) => document.getElementById(id);

  function fit() {
    const narrow = innerWidth <= 760 || innerWidth <= innerHeight;
    const insim = view !== 'film';
    const left = insim && !narrow ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'), 10) : 0;
    const k = Math.min((innerWidth - left) / 1920, narrow && insim ? 1 : innerHeight / 1080);
    const y = narrow && insim ? 0 : (innerHeight - 1080 * k) / 2;
    stage.style.transform = 'translate(' + (left + (innerWidth - left - 1920 * k) / 2) + 'px,' + y + 'px) scale(' + k + ')';
    if (narrow && insim) panel.style.paddingTop = (1080 * k + 12) + 'px'; else panel.style.paddingTop = '';
  }
  addEventListener('resize', fit);

  function slider(id, lab, val, min, max, step, unit, hint) {
    return '<label class="field"><span class="row">' + lab + '<b id="' + id + 'V">' + val + unit + '</b></span><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><small>' + hint + '</small></label>';
  }
  const FINE = '<p class="fine">Random paper market. No wallet, no real funds, not financial advice. Doing well here means nothing about real markets.</p>';
  function render() {
    fit();
    document.body.classList.toggle('sim', view !== 'film');
    document.documentElement.classList.toggle('simdoc', view !== 'film');
    if (view === 'film') { panel.innerHTML = ''; return; }
    let h = '<h1>AUTOPLAY SIM</h1><div class="badge">Paper SOL only. No wallet.</div>';
    if (view === 'lobby') {
      h += '<div class="tabs" role="tablist"><button class="btn" role="tab" data-tab="agent" aria-selected="' + (tab === 'agent') + '">Deploy agent</button><button class="btn" role="tab" data-tab="hand" aria-selected="' + (tab === 'hand') + '">Play by hand</button></div>';
      if (tab === 'agent') {
        h += '<label class="field"><span class="row">Agent name</span><input type="text" id="nm" maxlength="12" autocomplete="off" spellcheck="false" value=""></label>' +
          slider('risk', 'Risk', cfg.risk, 1, 10, 1, '', 'Bigger size and leverage. Can get liquidated.') +
          slider('speed', 'Speed', cfg.speed, 1, 5, 1, '', 'Reacts faster, pays more fees.') +
          slider('stake', 'Stake idle SOL', cfg.stake, 0, 80, 5, '%', 'Safe yield, less to trade with.') +
          '<label class="check"><input type="checkbox" id="auto"' + (cfg.auto ? ' checked' : '') + '>Auto claim rewards</label>' +
          '<button class="btn go wide big" id="go">Deploy for 60 seconds</button>';
      } else {
        h += '<p>You get 10 paper SOL and 60 seconds against Stock AFK on the same market.</p><p>BUY puts half your cash in at 2x. SELL closes it, or unstakes if you hold nothing. STAKE locks a quarter of your cash for yield. Rewards only count once you CLAIM them.</p><button class="btn go wide big" id="go">Start 60 seconds</button>';
      }
      h += FINE + '<button class="btn wide" id="back">Back to the film</button>';
    } else if (view === 'run') {
      h += '<h2 id="clk">60s</h2>';
      if (round.kind === 'hand') {
        h += '<div class="pads">' + [['BUY', 'A'], ['SELL', 'S'], ['STAKE', 'D'], ['CLAIM', 'F']].map(([a, k]) => '<button class="btn" data-a="' + a + '">' + a + '<kbd>' + k + '</kbd></button>').join('') + '</div>';
      } else {
        h += '<p>Hands off. ' + round.name.replace(/</g, '') + ' is playing.</p>';
      }
      h += '<div class="toast" id="toast" role="status"></div><div class="stats"><span>' + (round.kind === 'hand' ? 'You' : 'Your agent') + '</span><span id="sY"></span><span>Stock AFK</span><span id="sA"></span><span>Claimable</span><span id="sR"></span></div><button class="btn wide" id="stop">Stop round</button>';
    } else if (view === 'done') {
      const r = round.result, win = r.you > r.afk, tie = Math.abs(r.you - r.afk) < 0.005, who = round.kind === 'hand' ? 'You' : round.name;
      h += '<h2 class="' + (r.you >= 0 ? 'good' : 'bad') + '">' + money(r.you) + ' paper SOL</h2><p id="who"></p>' +
        '<div class="stats"><span id="whoL"></span><span>' + money(r.you) + '</span><span>Stock AFK</span><span>' + money(r.afk) + '</span><span>Your best</span><span>' + money(r.best) + (r.record ? ' new' : '') + '</span>' + (r.lost > 0.005 ? '<span>Never claimed</span><span class="bad">' + r.lost.toFixed(2) + '</span>' : '') + '</div>' +
        '<p class="' + (tie ? '' : win ? 'good' : 'bad') + '">' + (tie ? 'Dead even with Stock AFK. Change a setting.' : win ? 'Beat Stock AFK.' : 'Stock AFK won this one.') + '</p>' +
        '<button class="btn go wide" id="x">Share on X</button><button class="btn wide" id="cp">Copy result</button><button class="btn wide" id="again">Run it again</button><button class="btn wide" id="setup">Change setup</button>' + FINE;
      panel.innerHTML = h;
      $('who').textContent = who + ' finished the round.';
      $('whoL').textContent = who;
      bind(); return;
    }
    panel.innerHTML = h;
    bind();
  }
  function shareText() {
    const R = round, r = R.result, a = money(r.you) + ' paper SOL', b = money(r.afk);
    return (R.kind === 'hand' ? 'I played the controller by hand and made ' + a + ' in 60 seconds. Stock AFK made ' + b + '.' : 'My agent ' + R.name + ' made ' + a + ' in 60 seconds with zero human input. Stock AFK made ' + b + '.') + ' Simulation, no real funds. Beat it:';
  }
  function bind() {
    panel.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
    panel.querySelectorAll('[data-a]').forEach((b) => { b.onpointerdown = (e) => { e.preventDefault(); human(b.dataset.a); }; b.onclick = (e) => { if (e.detail === 0) human(b.dataset.a); }; });
    const nm = $('nm'); if (nm) { nm.value = cfg.name; nm.oninput = () => { cfg.name = nm.value; }; }
    [['risk', ''], ['speed', ''], ['stake', '%']].forEach(([k, u]) => { const e = $(k); if (e) e.oninput = () => { cfg[k] = +e.value; $(k + 'V').textContent = e.value + u; }; });
    const au = $('auto'); if (au) au.onchange = () => { cfg.auto = au.checked; };
    const on = (id, f) => { const e = $(id); if (e) e.onclick = f; };
    on('go', () => { cfg.name = cleanName(cfg.name); startRound(); });
    on('back', () => { view = 'film'; round = null; window.__SIM = null; t0 = performance.now(); if (soundOn) { film.currentTime = 0; film.play(); } render(); });
    on('stop', () => { round = null; SIM.claims = []; view = 'lobby'; render(); });
    on('again', startRound);
    on('setup', () => { round = null; SIM.claims = []; view = 'lobby'; render(); });
    on('x', () => window.open('https://x.com/intent/post?text=' + encodeURIComponent(shareText()) + '&url=' + encodeURIComponent(PAGE), '_blank', 'noopener'));
    on('cp', () => { const b = $('cp'), done = () => { b.textContent = 'Copied'; }; if (navigator.clipboard) navigator.clipboard.writeText(shareText() + ' ' + PAGE).then(done, () => { b.textContent = 'Copy failed'; }); });
  }

  $('take').onclick = () => { view = 'lobby'; window.__SIM = SIM; film.pause(); render(); };
  $('rst').onclick = () => { t0 = performance.now(); if (soundOn) film.currentTime = 0; };
  $('snd').onclick = () => {
    const b = $('snd'); soundOn = !soundOn;
    b.textContent = soundOn ? 'Sound on' : 'Sound off'; b.setAttribute('aria-pressed', soundOn);
    if (soundOn) {
      if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (C) ac = new C(); }
      if (ac) { ac.resume(); nextNote = ac.currentTime + 0.05; }
      if (view === 'film') { if (t0 !== null) film.currentTime = ((performance.now() - t0) / 1000) % FILM; film.play(); }
    } else film.pause();
  };
  stage.addEventListener('pointerdown', (e) => {
    if (view !== 'run' || !window.__R.hit) return;
    const r = stage.getBoundingClientRect(), n = window.__R.hit((e.clientX - r.left) * 1920 / r.width, (e.clientY - r.top) * 1080 / r.height);
    if (n) human(n);
  });
  addEventListener('keydown', (e) => {
    if (view !== 'run' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = { a: 'BUY', s: 'SELL', d: 'STAKE', f: 'CLAIM' }[e.key.toLowerCase()];
    if (a) human(a);
  });

  function loop() {
    if (document.documentElement.dataset.ready === '1') {
      SIM.clock = performance.now() / 1000;
      if (view === 'film') {
        if (t0 === null) t0 = performance.now();
        const t = ((performance.now() - t0) / 1000) % FILM;
        window.__R.seek(t);
        if (soundOn && film.readyState >= 2 && Math.abs(film.currentTime - t) > 0.18) film.currentTime = t;
        $('take').classList.toggle('pulse', t > 20.4);
      } else {
        if (view === 'run' && round) {
          const target = Math.min(N, Math.floor((SIM.clock - round.start) * TPS));
          while (round.i < target) tick();
          const c = $('clk'); if (c) c.textContent = Math.max(0, Math.ceil(ROUND - round.i / TPS)) + 's left';
          const p = round.m.p[round.i], sY = $('sY');
          if (sY) { sY.textContent = money(equity(round.you, p) - START); $('sA').textContent = money(equity(round.afk, p) - START); $('sR').textContent = round.you.rew.toFixed(3); }
          if (round.i >= N) finish();
        }
        window.__R.seek(0);
      }
    }
    requestAnimationFrame(loop);
  }
  render();
  requestAnimationFrame(loop);
})();

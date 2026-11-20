/* Sparse Musings - journal front end (plain JS) */
(() => {
  'use strict';

  // ---------- constants ----------
  const PAGE_W = 794, PAGE_H = 1123;      // A4 at 96dpi
  const LINE = 36;                         // ruled line height
  const FIRST_BODY_H = 19 * LINE;          // body height on an entry's first page
  const NEXT_BODY_H = 24 * LINE;           // body height on continuation pages
  const FRONT = 2;                         // pages before the first entry: prologue + mood tracker
  const MAX_CONTENT = 5000;
  const MAX_INTRO = 450;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // happiest first (value 5) to angriest (value 1)
  const MOODS = [
    { v: 5, name: 'Joyful', color: '#34B35A' },
    { v: 4, name: 'Good',   color: '#9ACD32' },
    { v: 3, name: 'Okay',   color: '#FFC21A' },
    { v: 2, name: 'Low',    color: '#F7882F' },
    { v: 1, name: 'Angry',  color: '#E53935' },
  ];
  const moodOf = (v) => MOODS.find((m) => m.v === Number(v));

  const THEMES = { sunset: 'cover', meadow: 'cover-meadow' };   // theme -> cover image base name

  // ---------- tiny helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const pad2 = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const longDate = (iso) => { const d = parseISO(iso); return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, parent) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function flower(cls) {
    const svg = s('svg', { class: cls, 'aria-hidden': 'true' });
    s('use', { href: '#flower' }, svg);
    return svg;
  }
  function face(v, cls) {
    const svg = s('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
    if (cls) svg.setAttribute('class', cls);
    s('use', { href: '#face-' + v }, svg);
    return svg;
  }
  function wave(extra) {
    const svg = s('svg', { class: 'wave' + (extra ? ' ' + extra : ''), viewBox: '0 0 624 24', 'aria-hidden': 'true' });
    const seg = ' t26 0'.repeat(23);
    [['var(--yellow)', 15], ['var(--red)', 9]].forEach(([color, y]) => {
      const p = s('path', { d: `M0 ${y} q13 -10 26 0${seg}`, fill: 'none', 'stroke-width': '3', 'stroke-linecap': 'round' }, svg);
      p.style.stroke = color;
    });
    return svg;
  }

  // ---------- state ----------
  const state = {
    entries: [], pages: [], index: 0, busy: false,
    prologue: { intro: '', quote: '', loves: '', goals: '' },
    theme: 'sunset',
  };
  const els = {
    book: $('#book'), prev: $('#prevBtn'), next: $('#nextBtn'), add: $('#addBtn'),
    toast: $('#toast'), measure: $('#measure'),
    themeBtn: $('#themeBtn'), themeMenu: $('#themeMenu'),
    modal: $('#modal'), form: $('#entryForm'), sheetTitle: $('#sheetTitle'),
    dateBtn: $('#dateBtn'), dateLabel: $('#dateLabel'), cal: $('#cal'), moods: $('#moods'),
    title: $('#titleInput'), body: $('#bodyInput'), counter: $('#counter'),
    note: $('#note'), error: $('#formError'), del: $('#deleteBtn'), save: $('#saveBtn'),
    proModal: $('#prologueModal'), proForm: $('#prologueForm'),
    proIntro: $('#proIntro'), proIntroCount: $('#proIntroCount'), proQuote: $('#proQuote'),
    proLoves: $('#proLoves'), proGoals: $('#proGoals'), proError: $('#proError'), proSave: $('#proSave'),
  };

  // ---------- scale the A4 sheet to the window ----------
  function fit() {
    const pad = window.innerWidth < 700 ? 6 : 26;
    const sc = Math.min((window.innerWidth - pad * 2) / PAGE_W, (window.innerHeight - pad * 2) / PAGE_H);
    document.documentElement.style.setProperty('--s', sc.toFixed(4));
    document.documentElement.style.setProperty('--pw', (PAGE_W * sc).toFixed(1) + 'px');
  }

  // ---------- long entries flow onto extra pages (no scrolling, ever) ----------
  function fits(text, cap) {
    els.measure.textContent = text;
    return els.measure.scrollHeight <= cap;
  }
  function paginate(text, firstCap, nextCap) {
    const chunks = [];
    let rest = text;
    let cap = firstCap;
    while (rest) {
      if (fits(rest, cap)) { chunks.push(rest); break; }
      let tokens = rest.split(/(\s+)/);                    // words + the whitespace between them
      if (!fits(tokens[0], cap)) tokens = rest.split('');   // one giant word: split by character
      let lo = 1, hi = tokens.length;                       // largest prefix that still fits
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(tokens.slice(0, mid).join('').trimEnd(), cap)) lo = mid; else hi = mid - 1;
      }
      const chunk = tokens.slice(0, lo).join('').trimEnd();
      chunks.push(chunk || tokens[0]);
      rest = tokens.slice(lo).join('').replace(/^\s+/, '');
      cap = nextCap;
    }
    return chunks.length ? chunks : [''];
  }

  // cover, prologue, mood tracker, one or more pages per day, then a blank page
  function buildPages() {
    const pages = [{ type: 'cover' }, { type: 'prologue' }, { type: 'mood' }];
    const sorted = [...state.entries].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    for (const entry of sorted) {
      const chunks = paginate(entry.content, FIRST_BODY_H, NEXT_BODY_H);
      chunks.forEach((text, i) => pages.push({ type: 'entry', entry, part: i, parts: chunks.length, text }));
    }
    pages.push({ type: 'blank' });
    state.pages = pages;
  }

  // ---------- drawing a page ----------
  function foot(label) {
    const f = h('div', 'foot');
    f.append(h('span', 'tag', 'Sparse Musings'), h('span', '', `— ${label} —`));
    return f;
  }
  function editButton(label, onClick) {
    const b = h('button', 'edit-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#202A2B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.5-1 10-10a2.1 2.1 0 00-3-3l-10 10L4 20z"/></svg>';
    b.addEventListener('click', onClick);
    return b;
  }
  const lines = (text) => String(text || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6);

  function buildPage(p, idx) {
    if (p.type === 'cover') {
      const base = THEMES[state.theme] || 'cover';
      const page = h('section', 'page cover-page');
      const img = new Image();
      img.alt = 'Sparse Musings - Guru Leo';
      img.draggable = false;
      img.onerror = () => { img.onerror = null; img.src = base + '.jpg'; }; // jpeg fallback
      img.src = base + '.png';
      page.append(img);
      return page;
    }
    if (p.type === 'prologue') return buildPrologue();
    if (p.type === 'mood') return buildMoodPage();

    const page = h('section', 'page paper');
    page.append(h('div', 'margin-line'), flower('flower flower-tr'), flower('flower flower-br'));

    if (p.type === 'blank') {
      const note = h('div', 'blank-note');
      note.append(flower('flower-mid flower'));
      note.append(
        h('h2', '', state.entries.length === 0 ? 'Your first page awaits' : 'A fresh page awaits'),
        h('p', '', 'Press the + button to write about your day.')
      );
      page.append(note, foot(idx - FRONT));
      return page;
    }

    // a day
    const d = parseISO(p.entry.date);
    if (p.part === 0) {
      const head = h('header', 'head');
      const meta = h('div', 'date-meta');
      meta.append(h('div', 'weekday', DAYS[d.getDay()]), h('div', 'month-year', `${MONTHS[d.getMonth()]} ${d.getFullYear()}`));
      head.append(h('div', 'day-badge', String(d.getDate())), meta);
      page.append(head, h('h2', 'entry-title', p.entry.title), wave());
      const mood = moodOf(p.entry.mood);
      if (mood) {
        const badge = h('div', 'mood-badge');
        badge.append(face(mood.v), h('span', '', mood.name));
        badge.title = 'Feeling ' + mood.name.toLowerCase();
        page.append(badge);
      }
    } else {
      const head = h('header', 'head-cont');
      head.append(h('span', '', `${DAYS[d.getDay()].slice(0, 3)}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`), h('em', '', 'continued'));
      page.append(head, wave('cont'));
    }
    const body = h('div', 'body ' + (p.part === 0 ? 'first' : 'cont'));
    body.append(h('div', 'body-text', p.text));
    page.append(body, foot(idx - FRONT), editButton('Edit this page', () => openModal(p.entry.date)));
    return page;
  }

  // ----- prologue -----
  function buildPrologue() {
    const P = state.prologue;
    const page = h('section', 'page paper');
    page.append(h('div', 'margin-line'), flower('flower flower-tr'), flower('flower flower-br'));
    page.append(h('h2', 'front-title', 'Prologue'), h('div', 'front-sub', 'a few words before the pages begin'), wave('front'));

    const intro = h('div', 'pro-intro');
    const introText = h('div', 'body-text' + (P.intro ? '' : ' ghost'), P.intro || 'Tap the pencil to write about yourself: who you are, and why you keep this journal.');
    intro.append(introText);

    const quote = h('div', 'pro-quote' + (P.quote ? '' : ' ghost'), P.quote ? `“${P.quote}”` : 'Add a quote you live by.');

    const loves = lines(P.loves), goals = lines(P.goals);
    const col = (cls, title, items, ghost, kind) => {
      const c = h('div', 'pro-col ' + cls);
      c.append(h('h3', '', title));
      const ul = h('ul', 'pro-list');
      const list = items.length ? items : [ghost];
      list.forEach((t) => {
        const li = h('li', items.length ? '' : 'ghost');
        li.append(kind === 'flower' ? flower('bullet flower') : h('i', 'check'), h('span', '', t));
        ul.append(li);
      });
      c.append(ul);
      return c;
    };
    page.append(
      intro, quote,
      col('left', 'Things I love', loves, 'Add what makes you happy', 'flower'),
      col('right', 'Dreams & goals', goals, 'Add what you are working towards', 'check'),
      foot('i'),
      editButton('Edit the prologue', openPrologue)
    );
    return page;
  }

  // ----- mood tracker -----
  function buildMoodPage() {
    const page = h('section', 'page paper');
    page.append(h('div', 'margin-line'), flower('flower flower-tr'), flower('flower flower-br'));
    page.append(h('h2', 'front-title', 'Mood Tracker'), h('div', 'front-sub', 'how the days have felt'), wave('front'));

    const withMood = [...state.entries].filter((e) => moodOf(e.mood)).sort((a, b) => a.date.localeCompare(b.date));
    page.append(buildMoodChart(withMood.slice(-14)), buildMoodMonth(), buildMoodLegend(withMood), foot('ii'));
    return page;
  }

  function buildMoodChart(data) {
    const box = h('div', 'mood-chart');
    const W = 618, H = 312;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Mood over your most recent pages' }, box);
    const yFor = (v) => 44 + (5 - v) * 54;
    const defs = s('defs', {}, svg);
    const grad = s('linearGradient', { id: 'moodGrad', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yFor(5), x2: 0, y2: yFor(1) }, defs);
    MOODS.forEach((m, i) => s('stop', { offset: i / 4, 'stop-color': m.color }, grad));

    // guides + the five faces down the left
    MOODS.forEach((m) => {
      const y = yFor(m.v);
      s('line', { x1: 62, x2: W - 14, y1: y, y2: y, stroke: m.color, 'stroke-opacity': '.45', 'stroke-width': '2', 'stroke-dasharray': '2 7', 'stroke-linecap': 'round' }, svg);
      const f = s('use', { href: '#face-' + m.v, x: 14, y: y - 18, width: 36, height: 36 }, svg);
      f.appendChild(s('title', {}));
      f.firstChild.textContent = m.name;
    });

    if (!data.length) {
      box.append(h('div', 'mood-empty', 'Pick a mood on your pages and your line will start to grow here.'));
      return box;
    }

    const x0 = 96, x1 = W - 34;
    const xs = data.map((_, i) => (data.length === 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (data.length - 1)));
    const ys = data.map((e) => yFor(Number(e.mood)));

    if (data.length > 1) {
      let d = `M${xs[0]} ${ys[0]}`;
      for (let i = 1; i < data.length; i++) {
        const mx = (xs[i - 1] + xs[i]) / 2;
        d += ` C${mx} ${ys[i - 1]} ${mx} ${ys[i]} ${xs[i]} ${ys[i]}`;
      }
      s('path', { d, fill: 'none', stroke: 'url(#moodGrad)', 'stroke-width': '6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    }

    data.forEach((e, i) => {
      const dt = parseISO(e.date);
      const size = data.length > 10 ? 32 : 38;
      const u = s('use', { href: '#face-' + e.mood, x: xs[i] - size / 2, y: ys[i] - size / 2, width: size, height: size }, svg);
      const t = s('title', {}, u);
      t.textContent = `${longDate(e.date)}: ${moodOf(e.mood).name}`;
      const day = s('text', { x: xs[i], y: H - 24, 'text-anchor': 'middle', class: 'axis-label' }, svg);
      day.textContent = String(dt.getDate());
      const mon = s('text', { x: xs[i], y: H - 10, 'text-anchor': 'middle', class: 'axis-sub' }, svg);
      mon.textContent = MONTHS[dt.getMonth()].slice(0, 3);
    });
    return box;
  }

  function buildMoodMonth() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const first = new Date(y, m, 1).getDay();
    const total = new Date(y, m + 1, 0).getDate();
    const today = todayISO();
    const byDay = new Map(state.entries.map((e) => [e.date, e]));

    const wrap = h('div', 'mood-month');
    wrap.append(h('h3', 'mm-title', `${MONTHS[m]} ${y}`));
    const grid = h('div', 'mm-grid');
    DAYS.forEach((d) => grid.append(h('div', 'mm-dow', d.slice(0, 3))));
    for (let i = 0; i < first; i++) grid.append(h('div', 'mm-cell pad'));
    for (let day = 1; day <= total; day++) {
      const iso = `${y}-${pad2(m + 1)}-${pad2(day)}`;
      const cell = h('div', 'mm-cell' + (iso === today ? ' today' : ''));
      cell.append(h('span', 'mm-num', String(day)));
      const e = byDay.get(iso);
      if (e && moodOf(e.mood)) { cell.append(face(e.mood)); cell.title = moodOf(e.mood).name; }
      else if (e) cell.append(h('i', 'dot'));
      grid.append(cell);
    }
    wrap.append(grid);
    return wrap;
  }

  function buildMoodLegend(withMood) {
    const legend = h('div', 'mood-legend');
    MOODS.forEach((m) => {
      const item = h('div');
      item.append(face(m.v), h('span', '', m.name), h('small', '', '×' + withMood.filter((e) => Number(e.mood) === m.v).length));
      legend.append(item);
    });
    return legend;
  }

  // ---------- navigation ----------
  function updateNav() {
    els.prev.disabled = state.index <= 0;
    els.next.disabled = state.index >= state.pages.length - 1;
  }

  function showPage(target, dir) {
    const old = els.book.querySelector('.page');
    const neu = buildPage(state.pages[target], target);
    state.index = target;
    updateNav();
    if (!old || !dir || reduceMotion) { els.book.replaceChildren(neu); return; }

    state.busy = true;
    const turning = dir === 'next' ? old : neu;
    const under = dir === 'next' ? neu : old;
    turning.classList.add(dir === 'next' ? 'turning-out' : 'turning-in');
    under.classList.add('under');
    els.book.append(neu);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      old.remove();
      neu.classList.remove('under', 'turning-in', 'turning-out');
      state.busy = false;
    };
    turning.addEventListener('animationend', (e) => {
      if (e.animationName === 'turnOut' || e.animationName === 'turnIn') finish();
    });
    setTimeout(finish, 1000); // safety net
  }

  function go(delta) {
    if (state.busy) return;
    const t = state.index + delta;
    if (t < 0 || t >= state.pages.length) return;
    showPage(t, delta > 0 ? 'next' : 'prev');
  }

  function goToDate(iso) {
    const idx = state.pages.findIndex((p) => p.type === 'entry' && p.entry.date === iso && p.part === 0);
    if (idx < 0) return;
    showPage(idx, idx > state.index ? 'next' : idx < state.index ? 'prev' : null);
  }

  // ---------- themes ----------
  function applyTheme(name, persist) {
    if (!THEMES[name]) name = 'sunset';
    state.theme = name;
    document.documentElement.dataset.theme = name;
    if (persist) { try { localStorage.setItem('sm-theme', name); } catch (e) { /* private mode */ } }
    document.querySelectorAll('[data-theme-opt]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeOpt === name)));
    if (state.pages.length && state.pages[state.index] && state.pages[state.index].type === 'cover') showPage(state.index, null); // swap the cover art
  }
  function closeThemeMenu() { els.themeMenu.hidden = true; els.themeBtn.setAttribute('aria-expanded', 'false'); }
  els.themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = els.themeMenu.hidden;
    els.themeMenu.hidden = !open;
    els.themeBtn.setAttribute('aria-expanded', String(open));
  });
  els.themeMenu.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-theme-opt]');
    if (!opt) return;
    applyTheme(opt.dataset.themeOpt, true);
    closeThemeMenu();
  });
  document.addEventListener('click', (e) => { if (!els.themeMenu.hidden && !e.target.closest('.theme-wrap')) closeThemeMenu(); });

  // ---------- talking to the server ----------
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4200);
  }

  async function loadEntries() {
    try {
      const res = await fetch('/api/entries', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('bad status ' + res.status);
      const data = await res.json();
      state.entries = Array.isArray(data.entries) ? data.entries : [];
      return true;
    } catch (err) {
      toast("Couldn't reach the journal database. Is the server running?");
      return false;
    }
  }
  async function loadPrologue() {
    try {
      const res = await fetch('/api/prologue', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('bad status ' + res.status);
      const d = await res.json();
      state.prologue = { intro: d.intro || '', quote: d.quote || '', loves: d.loves || '', goals: d.goals || '' };
    } catch (err) { /* keep the empty prologue; loadEntries already warned */ }
  }

  const byDate = (iso) => state.entries.find((e) => e.date === iso);
  const netError = (err) => (err instanceof TypeError ? "Couldn't reach the server. Is it running?" : err.message);

  // ---------- popup: add / edit a day ----------
  const form = { date: null, loaded: null, mood: null, deleteArmed: false };

  MOODS.forEach((m) => {
    const b = h('button', 'mood-btn');
    b.type = 'button';
    b.dataset.mood = m.v;
    b.setAttribute('aria-pressed', 'false');
    b.append(face(m.v), h('span', '', m.name));
    els.moods.append(b);
  });
  function setMood(v) {
    form.mood = v || null;
    els.moods.querySelectorAll('.mood-btn').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.mood) === form.mood)));
  }
  els.moods.addEventListener('click', (e) => {
    const b = e.target.closest('.mood-btn');
    if (!b) return;
    const v = Number(b.dataset.mood);
    setMood(form.mood === v ? null : v); // click again to clear
  });

  function updateCounter() { els.counter.textContent = `${els.body.value.length} / ${MAX_CONTENT}`; }
  function showNote(msg) { els.note.textContent = msg; els.note.hidden = false; }
  function showError(msg) { els.error.textContent = msg; els.error.hidden = false; }

  function formIsPristine() {
    const t = els.title.value, b = els.body.value;
    if (!t && !b) return true;
    return !!form.loaded && t === form.loaded.title && b === form.loaded.content;
  }

  function setDate(iso) {
    form.date = iso;
    els.dateLabel.textContent = longDate(iso);
    const existing = byDate(iso);
    const pristine = formIsPristine();

    if (existing) {
      if (pristine) {
        els.title.value = existing.title;
        els.body.value = existing.content;
        form.loaded = existing;
        setMood(existing.mood);
        showNote('This day already has a page, so you are editing it.');
      } else {
        showNote('This day already has a page. Saving will replace it.');
      }
    } else {
      if (form.loaded && pristine) { els.title.value = ''; els.body.value = ''; setMood(null); }
      form.loaded = null;
      els.note.hidden = true;
    }
    els.sheetTitle.textContent = existing ? 'Edit Page' : 'New Page';
    els.del.hidden = !existing;
    resetDeleteButton();
    updateCounter();
  }

  function resetDeleteButton() { form.deleteArmed = false; els.del.textContent = 'Delete page'; }

  function openModal(iso) {
    els.error.hidden = true;
    els.note.hidden = true;
    els.title.value = '';
    els.body.value = '';
    form.loaded = null;
    setMood(null);
    closeCal();
    els.modal.hidden = false;
    setDate(iso || todayISO());
    renderCal(parseISO(form.date));
    setTimeout(() => els.title.focus(), 60);
  }
  function closeModal() { els.modal.hidden = true; closeCal(); }

  els.modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  els.body.addEventListener('input', updateCounter);
  els.add.addEventListener('click', () => openModal(todayISO()));

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.error.hidden = true;
    const title = els.title.value.trim();
    const content = els.body.value.trim();
    if (!title) return showError('Please give the page a title.');
    if (!content) return showError('The page is empty. Write something!');

    els.save.disabled = true;
    try {
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: form.date, title, content, mood: form.mood }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the page.');
      const savedDate = form.date;
      closeModal();
      await loadEntries();
      buildPages();
      goToDate(savedDate);
      toast('Page saved to your journal.');
    } catch (err) {
      showError(netError(err));
    } finally {
      els.save.disabled = false;
    }
  });

  els.del.addEventListener('click', async () => {
    const existing = byDate(form.date);
    if (!existing) return;
    if (!form.deleteArmed) {
      form.deleteArmed = true;
      els.del.textContent = 'Really delete? Click again';
      return;
    }
    try {
      const res = await fetch('/api/entries/' + existing.id, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete the page.');
      const before = state.pages.findIndex((p) => p.entry && p.entry.id === existing.id);
      closeModal();
      await loadEntries();
      buildPages();
      showPage(Math.min(Math.max(before, 0), state.pages.length - 1), null);
      toast('Page removed.');
    } catch (err) {
      showError(netError(err));
    }
  });

  // ---------- popup: prologue ----------
  function openPrologue() {
    const P = state.prologue;
    els.proError.hidden = true;
    els.proIntro.value = P.intro;
    els.proQuote.value = P.quote;
    els.proLoves.value = P.loves;
    els.proGoals.value = P.goals;
    els.proIntroCount.textContent = `${P.intro.length} / ${MAX_INTRO}`;
    els.proModal.hidden = false;
    setTimeout(() => els.proIntro.focus(), 60);
  }
  function closePrologue() { els.proModal.hidden = true; }
  els.proModal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closePrologue(); });
  els.proIntro.addEventListener('input', () => { els.proIntroCount.textContent = `${els.proIntro.value.length} / ${MAX_INTRO}`; });

  els.proForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.proError.hidden = true;
    els.proSave.disabled = true;
    try {
      const res = await fetch('/api/prologue', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intro: els.proIntro.value, quote: els.proQuote.value,
          loves: lines(els.proLoves.value).join('\n'), goals: lines(els.proGoals.value).join('\n'),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the prologue.');
      state.prologue = { intro: data.intro || '', quote: data.quote || '', loves: data.loves || '', goals: data.goals || '' };
      closePrologue();
      showPage(state.index, null);
      toast('Prologue saved.');
    } catch (err) {
      els.proError.textContent = netError(err);
      els.proError.hidden = false;
    } finally {
      els.proSave.disabled = false;
    }
  });

  // ---------- themed date picker ----------
  let calView = new Date();

  function closeCal() { els.cal.hidden = true; els.dateBtn.setAttribute('aria-expanded', 'false'); }
  els.dateBtn.addEventListener('click', () => {
    if (els.cal.hidden) {
      renderCal(parseISO(form.date));
      els.cal.hidden = false;
      els.dateBtn.setAttribute('aria-expanded', 'true');
    } else {
      closeCal();
    }
  });

  function renderCal(viewDate) {
    calView = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const y = calView.getFullYear(), m = calView.getMonth();
    const first = new Date(y, m, 1).getDay();
    const total = new Date(y, m + 1, 0).getDate();
    const today = todayISO();
    const have = new Set(state.entries.map((e) => e.date));

    const root = els.cal;
    root.replaceChildren();

    const head = h('div', 'cal-head');
    const nav = (act, label, text) => {
      const b = h('button', 'cal-nav', text);
      b.type = 'button'; b.dataset.act = act; b.setAttribute('aria-label', label);
      return b;
    };
    head.append(nav('py', 'Previous year', '«'), nav('pm', 'Previous month', '‹'),
      h('div', 'cal-title', `${MONTHS[m]} ${y}`),
      nav('nm', 'Next month', '›'), nav('ny', 'Next year', '»'));

    const grid = h('div', 'cal-grid');
    DAYS.forEach((d) => grid.append(h('div', 'cal-dow', d.slice(0, 2))));
    for (let i = 0; i < first; i++) grid.append(h('span'));
    for (let day = 1; day <= total; day++) {
      const iso = `${y}-${pad2(m + 1)}-${pad2(day)}`;
      const b = h('button', 'cal-day', String(day));
      b.type = 'button';
      b.dataset.date = iso;
      if (iso === today) b.classList.add('today');
      if (have.has(iso)) b.classList.add('has');
      if (iso === form.date) b.classList.add('sel');
      grid.append(b);
    }

    const foot = h('div', 'cal-foot');
    const todayBtn = h('button', 'link-btn', 'Today');
    todayBtn.type = 'button'; todayBtn.dataset.act = 'today';
    const legend = h('span');
    legend.append(h('i', 'legend-dot'), document.createTextNode('has a page'));
    foot.append(todayBtn, legend);

    root.append(head, grid, foot);
  }

  els.cal.addEventListener('click', (e) => {
    const dayBtn = e.target.closest('.cal-day');
    if (dayBtn) {
      setDate(dayBtn.dataset.date);
      closeCal();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const y = calView.getFullYear(), m = calView.getMonth();
    switch (act.dataset.act) {
      case 'py': renderCal(new Date(y - 1, m, 1)); break;
      case 'pm': renderCal(new Date(y, m - 1, 1)); break;
      case 'nm': renderCal(new Date(y, m + 1, 1)); break;
      case 'ny': renderCal(new Date(y + 1, m, 1)); break;
      case 'today': setDate(todayISO()); closeCal(); break;
    }
  });

  // ---------- wiring ----------
  els.prev.addEventListener('click', () => go(-1));
  els.next.addEventListener('click', () => go(1));

  document.addEventListener('keydown', (e) => {
    if (!els.proModal.hidden) { if (e.key === 'Escape') closePrologue(); return; }
    if (!els.modal.hidden) {
      if (e.key === 'Escape') { if (!els.cal.hidden) closeCal(); else closeModal(); }
      return;
    }
    if (e.key === 'Escape') closeThemeMenu();
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  });

  window.addEventListener('resize', fit);

  // ---------- start ----------
  async function waitForFonts() {
    if (!document.fonts || !document.fonts.load) return;
    const wanted = Promise.all([
      document.fonts.load('400 21px Kalam'),
      document.fonts.load('700 21px Kalam'),
      document.fonts.load('400 38px Shrikhand'),
    ]).catch(() => {});
    await Promise.race([wanted, new Promise((r) => setTimeout(r, 2500))]);
  }

  async function init() {
    fit();
    let saved = null;
    try { saved = localStorage.getItem('sm-theme'); } catch (e) { /* ignore */ }
    applyTheme(saved, false);
    // the cover shows straight away; pages are measured once the fonts are ready
    state.pages = [{ type: 'cover' }, { type: 'blank' }];
    showPage(0, null);
    await Promise.all([waitForFonts(), loadEntries(), loadPrologue()]);
    buildPages();
    updateNav();
  }

  init();
})();

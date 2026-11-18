/* Sparse Musings - journal front end (plain JS) */
(() => {
  'use strict';

  // ---------- constants ----------
  const PAGE_W = 794, PAGE_H = 1123;      // A4 at 96dpi
  const LINE = 36;                         // ruled line height
  const FIRST_BODY_H = 19 * LINE;          // body height on an entry's first page
  const NEXT_BODY_H = 24 * LINE;           // body height on continuation pages
  const MAX_CONTENT = 5000;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  function flower(cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#flower');
    svg.appendChild(use);
    return svg;
  }
  function wave(extra) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'wave' + (extra ? ' ' + extra : ''));
    svg.setAttribute('viewBox', '0 0 624 24');
    svg.setAttribute('aria-hidden', 'true');
    const seg = ' t26 0'.repeat(23);
    [['#FFAE00', 15], ['#E5532D', 9]].forEach(([color, y]) => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', `M0 ${y} q13 -10 26 0${seg}`);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', color);
      p.setAttribute('stroke-width', '3');
      p.setAttribute('stroke-linecap', 'round');
      svg.appendChild(p);
    });
    return svg;
  }

  // ---------- state ----------
  const state = { entries: [], pages: [], index: 0, busy: false };
  const els = {
    book: $('#book'), prev: $('#prevBtn'), next: $('#nextBtn'), add: $('#addBtn'),
    toast: $('#toast'), measure: $('#measure'),
    modal: $('#modal'), form: $('#entryForm'), sheetTitle: $('#sheetTitle'),
    dateBtn: $('#dateBtn'), dateLabel: $('#dateLabel'), cal: $('#cal'),
    title: $('#titleInput'), body: $('#bodyInput'), counter: $('#counter'),
    note: $('#note'), error: $('#formError'), del: $('#deleteBtn'), save: $('#saveBtn'),
  };

  // ---------- scale the A4 sheet to the window ----------
  function fit() {
    const pad = window.innerWidth < 700 ? 6 : 26;
    const s = Math.min((window.innerWidth - pad * 2) / PAGE_W, (window.innerHeight - pad * 2) / PAGE_H);
    document.documentElement.style.setProperty('--s', s.toFixed(4));
    document.documentElement.style.setProperty('--pw', (PAGE_W * s).toFixed(1) + 'px');
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

  function buildPages() {
    const pages = [{ type: 'cover' }];
    const sorted = [...state.entries].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    for (const entry of sorted) {
      const chunks = paginate(entry.content, FIRST_BODY_H, NEXT_BODY_H);
      chunks.forEach((text, i) => pages.push({ type: 'entry', entry, part: i, parts: chunks.length, text }));
    }
    pages.push({ type: 'blank' });
    state.pages = pages;
  }

  // ---------- drawing a page ----------
  function buildPage(p, num) {
    if (p.type === 'cover') {
      const page = h('section', 'page cover-page');
      const img = new Image();
      img.alt = 'Sparse Musings - Guru Leo';
      img.draggable = false;
      img.onerror = () => { img.onerror = null; img.src = 'cover.jpg'; }; // jpeg fallback
      img.src = 'cover.png';
      page.append(img);
      return page;
    }

    const page = h('section', 'page paper');
    page.append(h('div', 'margin-line'));

    if (p.type === 'blank') {
      page.append(flower('flower flower-tr'), flower('flower flower-br'));
      const note = h('div', 'blank-note');
      note.append(flower('flower-mid flower'));
      const empty = state.entries.length === 0;
      note.append(
        h('h2', '', empty ? 'Your first page awaits' : 'A fresh page awaits'),
        h('p', '', 'Press the + button to write about your day.')
      );
      page.append(note, foot(num));
      return page;
    }

    // entry page
    const d = parseISO(p.entry.date);
    page.append(flower('flower flower-tr'), flower('flower flower-br'));
    if (p.part === 0) {
      const head = h('header', 'head');
      const meta = h('div', 'date-meta');
      meta.append(h('div', 'weekday', DAYS[d.getDay()]), h('div', 'month-year', `${MONTHS[d.getMonth()]} ${d.getFullYear()}`));
      head.append(h('div', 'day-badge', String(d.getDate())), meta);
      page.append(head, h('h2', 'entry-title', p.entry.title), wave());
    } else {
      const head = h('header', 'head-cont');
      head.append(h('span', '', `${DAYS[d.getDay()].slice(0, 3)}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`), h('em', '', 'continued'));
      page.append(head, wave('cont'));
    }
    const body = h('div', 'body ' + (p.part === 0 ? 'first' : 'cont'));
    body.append(h('div', 'body-text', p.text));
    page.append(body, foot(num));

    const edit = h('button', 'edit-btn');
    edit.type = 'button';
    edit.title = 'Edit this page';
    edit.setAttribute('aria-label', 'Edit this page');
    edit.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#202A2B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.5-1 10-10a2.1 2.1 0 00-3-3l-10 10L4 20z"/></svg>';
    edit.addEventListener('click', () => openModal(p.entry.date));
    page.append(edit);
    return page;
  }
  function foot(num) {
    const f = h('div', 'foot');
    f.append(h('span', 'tag', 'Sparse Musings'), h('span', '', `— ${num} —`));
    return f;
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

  const byDate = (iso) => state.entries.find((e) => e.date === iso);

  // ---------- popup: add / edit ----------
  const form = { date: null, loaded: null, deleteArmed: false };

  function updateCounter() {
    els.counter.textContent = `${els.body.value.length} / ${MAX_CONTENT}`;
  }
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
        showNote('This day already has a page, so you are editing it.');
      } else {
        showNote('This day already has a page. Saving will replace it.');
      }
    } else {
      if (form.loaded && pristine) { els.title.value = ''; els.body.value = ''; }
      form.loaded = null;
      els.note.hidden = true;
    }
    els.sheetTitle.textContent = existing ? 'Edit Page' : 'New Page';
    els.del.hidden = !existing;
    resetDeleteButton();
    updateCounter();
  }

  function resetDeleteButton() {
    form.deleteArmed = false;
    els.del.textContent = 'Delete page';
  }

  function openModal(iso) {
    els.error.hidden = true;
    els.note.hidden = true;
    els.title.value = '';
    els.body.value = '';
    form.loaded = null;
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
        body: JSON.stringify({ date: form.date, title, content }),
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
      showError(err instanceof TypeError ? "Couldn't reach the server. Is it running?" : err.message);
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
      showError(err instanceof TypeError ? "Couldn't reach the server. Is it running?" : err.message);
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
    if (!els.modal.hidden) {
      if (e.key === 'Escape') { if (!els.cal.hidden) closeCal(); else closeModal(); }
      return;
    }
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
    // cover shows straight away; pages are measured once the fonts are ready
    state.pages = [{ type: 'cover' }, { type: 'blank' }];
    showPage(0, null);
    await Promise.all([waitForFonts(), loadEntries()]);
    buildPages();
    updateNav();
  }

  init();
})();

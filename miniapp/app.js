'use strict';
/* Молодёжка ЛДПР — мини-приложение Telegram: дашборд по дорожной карте + отчёты направлений */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const SVGNS = 'http://www.w3.org/2000/svg';
const nf = new Intl.NumberFormat('ru-RU');
const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MON_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const ROLE_NAMES = { admin: 'Администратор', deputy: 'Заместитель', media: 'Руководитель: Медиа', people: 'Руководитель: Работа с людьми', events: 'Руководитель: Мероприятия', viewer: 'Только просмотр' };
const DEPT_ORDER = ['media', 'people', 'events'];
const PHASES = [['', 'Все'], ['launch', 'Запуск'], ['recruit', 'Набор'], ['hold', 'Закрепление'], ['campaign', 'Кампания']];

const S = { me: null, depts: {}, plan: [], reports: [], progress: [], now: null, view: 'overview', phase: '', repDept: 'media', repMonth: '' };

// ---------- утилиты ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
function s(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}
const fmt = (v) => (v === null || v === undefined ? '—' : nf.format(v));
const range = (a, b) => (a === null || a === undefined ? '—' : a === b || b === null ? String(a) : `${a}–${b}`);
const monthOf = (d) => d.slice(0, 7);
const monthLabel = (m) => `${MON_FULL[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const dateLabel = (d) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const initials = (n) => (n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const anyDept = () => S.me && (S.me.role === 'admin' || S.me.role === 'deputy');
const canWrite = (dept) => S.me && (anyDept() || S.me.role === dept);
const myDepts = () => (anyDept() ? DEPT_ORDER : DEPT_ORDER.filter((d) => d === S.me.role));

const TG = window.Telegram && window.Telegram.WebApp;
async function api(action, payload) {
  let res;
  try {
    // text/plain — чтобы Google Apps Script принял запрос без предварительной проверки CORS
    res = await fetch(window.CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, initData: TG ? TG.initData : '' }, payload || {})) });
  } catch (e) { throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'); }
  let data;
  try { data = await res.json(); } catch { throw new Error('Сервер ответил с ошибкой. Попробуйте позже.'); }
  if (data.error) throw new Error(data.error);
  return data;
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- экран-заглушка ----------
function gate(title, text, retry) {
  $('#shell').hidden = true; $('#gate').hidden = false;
  $('#gate-title').textContent = title; $('#gate-text').textContent = text;
  $('#gate-retry').hidden = !retry;
}
$('#gate-retry').addEventListener('click', () => { gate('Загрузка…', 'Подключаемся к данным молодёжки.'); boot(); });

// ---------- расчёт плана и факта ----------
function computeProgress() {
  const byMonth = {};
  const sorted = [...S.reports].sort((a, b) => (a.date + a.created).localeCompare(b.date + b.created));
  for (const r of sorted) {
    const m = monthOf(r.date);
    const a = byMonth[m] || (byMonth[m] = { members: null, new_members: 0, vk: null, tiktok: null, posts: 0, reels: 0, events: 0, participants: 0, has: {} });
    const v = r.values || {};
    a.has[r.dept] = true;
    if (r.dept === 'people') {
      if (v.active_total !== undefined) a.members = v.active_total;
      a.new_members += v.new_members || 0;
    } else if (r.dept === 'media') {
      if (v.vk_subs !== undefined) a.vk = v.vk_subs;
      if (v.tt_subs !== undefined) a.tiktok = v.tt_subs;
      a.posts += v.posts_vk || 0; a.reels += v.reels || 0;
    } else if (r.dept === 'events') {
      a.events += 1; a.participants += v.participants || 0;
    }
  }
  // данные ВК собираются автоматически и важнее ручных
  const vkMonth = {};
  let vkFrom = null;
  if (S.vk) {
    for (const d of S.vk.days) { const m = d.d.slice(0, 7); (vkMonth[m] = vkMonth[m] || { posts: 0, views: 0 }).subs = d.n; }
    for (const x of S.vk.posts) { const m = x.date.slice(0, 7); const o = (vkMonth[m] = vkMonth[m] || { posts: 0, views: 0 }); o.posts++; o.views += x.views; }
    vkFrom = Object.keys(vkMonth).sort()[0] || null;
  }
  const thisMonth = new Date().toISOString().slice(0, 7);
  const pct = (f, p) => (f === null || !p ? null : Math.round((f / p) * 100));
  S.progress = S.plan.map((p) => {
    const a = byMonth[p.month] || { has: {} };
    const members_fact = a.members ?? null;
    const auto = vkFrom && p.month >= vkFrom && p.month <= thisMonth ? (vkMonth[p.month] || { posts: 0, views: 0 }) : null;
    const vk_fact = auto && auto.subs !== undefined ? auto.subs : (a.vk ?? null);
    return { ...p,
      members_fact, members_pct: pct(members_fact, p.members_min),
      vk_fact, vk_pct: pct(vk_fact, p.vk_plan),
      tiktok_fact: a.tiktok ?? null,
      posts_fact: auto ? auto.posts : a.has.media ? a.posts : null, vk_views: auto ? auto.views : null, vk_auto: !!auto, reels_fact: a.has.media ? a.reels : null,
      events_fact: a.has.events ? a.events : null, participants: a.participants || 0,
      new_members: a.has.people ? a.new_members : null };
  });
  const d = new Date();
  const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  let i = S.progress.findIndex((r) => r.month === key);
  if (i < 0) i = S.progress.length && key < S.progress[0].month ? 0 : S.progress.length - 1;
  S.now = { ...S.progress[i], pos: i + 1, count: S.progress.length };
}

// ---------- старт ----------
function applyReports(reports) { S.reports = reports; computeProgress(); renderHeader(); renderView(); }
async function boot() {
  if (TG) { TG.ready(); TG.expand(); try { TG.setHeaderColor('#0f1733'); TG.setBackgroundColor('#0f1733'); } catch { /* старые версии Telegram */ } }
  if (!TG || !TG.initData) return gate('Откройте через Telegram', 'Это мини-приложение молодёжки ЛДПР. Откройте его кнопкой «Дашборд» в боте.');
  if (!window.CONFIG || !/^https:\/\//.test(window.CONFIG.API_URL)) return gate('Не настроено', 'В файле config.js не указан адрес Google Apps Script.');
  try {
    const [plan, st] = await Promise.all([fetch('plan.json').then((r) => r.json()), api('state')]);
    S.plan = plan; S.me = st.user; S.depts = st.depts; S.reports = st.reports; S.vk = st.vk || null; S.people = st.people || [];
  } catch (e) { return gate('Нет доступа', e.message, true); }
  if (DEPT_ORDER.includes(S.me.role)) S.repDept = S.me.role;
  { const d = new Date(); S.repMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  computeProgress();
  $('#gate').hidden = true; $('#shell').hidden = false;
  $('#me-name').textContent = S.me.name; $('#me-role').textContent = ROLE_NAMES[S.me.role] || S.me.role;
  $('#me-avatar').textContent = initials(S.me.name);
  $('#nav-users').hidden = S.me.role !== 'admin';
  $('#quick-add').hidden = myDepts().length === 0;
  renderHeader();
  const wantAdd = location.hash === '#add';
  if (wantAdd) history.replaceState(null, '', '#reports');
  route();
  if (wantAdd && myDepts().length) $('#quick-add').click();
}

// ---------- навигация ----------
const VIEWS = ['overview', 'members', 'social', 'events', 'roadmap', 'reports', 'users'];
function route() {
  let v = location.hash.slice(1);
  if (!VIEWS.includes(v) || (v === 'users' && S.me.role !== 'admin')) v = 'overview';
  S.view = v;
  $$('.view').forEach((el) => { el.hidden = el.dataset.view !== v; });
  $$('.nav').forEach((a) => { a.classList.toggle('on', a.dataset.view === v); if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  renderView();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => { if (S.me && location.hash !== '#add') route(); });
function renderView() {
  ({ overview: renderOverview, members: renderMembers, social: renderSocial, events: renderEvents,
    roadmap: renderRoadmap, reports: renderReports, users: renderUsers })[S.view]();
}
let rsz;
window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => S.me && ['members', 'social', 'events'].includes(S.view) && renderView(), 150); });

function renderHeader() {
  const n = S.now;
  $('#now-month').textContent = n.month_label; $('#now-stage').textContent = n.stage;
  $('#now-track').replaceChildren(...Array.from({ length: n.count }, (_, i) => h('i', { class: i + 1 < n.pos ? 'done' : i + 1 === n.pos ? 'cur' : '' })));
}

// ---------- блоки ----------
const ICONS = {
  members: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>',
  vk: '<path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/>',
  events: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  posts: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>'
};
function icon(name, tone) {
  const svg = s('svg', { viewBox: '0 0 24 24' });
  // разметка иконок — наши константы, не данные пользователей
  svg.innerHTML = ICONS[name];
  return h('span', { class: 'ico ' + tone }, svg);
}
function factSpan(v, txt) { return h('span', { class: 'fact' + (v === null ? ' empty' : '') }, v === null ? 'не внесён' : (txt ?? fmt(v))); }
function pctPill(p) { return p === null ? null : h('span', { class: 'pill ' + (p >= 100 ? 'good' : 'bad') }, p + '%'); }
function stat(label, value, cls) { return h('div', { class: 'stat glass' }, h('span', null, label), h('b', { class: cls || '' }, value)); }
function statFact(label, v) { return stat(label, v === null ? 'не внесён' : fmt(v), v === null ? 'empty' : 'fact'); }

function renderOverview() {
  const n = S.now;
  const lead = $('#ov-lead'); lead.replaceChildren();
  if (n.members_fact === null) lead.append('Этап «', h('b', null, n.stage), '»: нужно ', h('b', null, range(n.members_min, n.members_max)), ' активных членов и ', h('b', null, fmt(n.vk_plan)), ' подписчиков ВК. Факт за месяц ещё не внесён.');
  else lead.append('Этап «', h('b', null, n.stage), '»: в активе ', h('b', null, fmt(n.members_fact)), ' человек при плане ', h('b', null, range(n.members_min, n.members_max)), ' (', h('b', null, n.members_pct + '%'), ' от минимума).');
  const tile = (href, ic, tone, label, big, fact) => h('a', { class: 'tile glass lift', href }, icon(ic, tone), h('span', { class: 'label' }, label), h('span', { class: 'big' }, big), h('span', { class: 'factline' }, 'Факт: ', ...fact), h('span', { class: 'more' }, 'Подробнее →'));
  $('#ov-tiles').replaceChildren(
    tile('#members', 'members', 'gold', 'Активные члены', range(n.members_min, n.members_max), [factSpan(n.members_fact), pctPill(n.members_pct)]),
    tile('#social', 'vk', 'sky', 'Подписчики ВК', fmt(n.vk_plan), [factSpan(n.vk_fact), pctPill(n.vk_pct)]),
    tile('#events', 'events', 'lilac', 'Мероприятия', n.events_plan === null ? 'агитация' : String(n.events_plan), [factSpan(n.events_fact)]),
    tile('#social', 'posts', 'ok', 'Постов в месяц', range(n.posts_min, n.posts_max), [factSpan(n.posts_fact)])
  );
  const recent = [...S.reports].sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created)).slice(0, 6);
  $('#ov-feed').replaceChildren(...(recent.length ? recent.map((r) => h('li', { class: 'd-' + r.dept },
    h('span', { class: 'av' }, initials(S.depts[r.dept].name)),
    h('span', { class: 't' }, h('b', null, r.values.title || '—'), h('small', null, `${S.depts[r.dept].name} · ${r.author_name}`)),
    h('span', { class: 'd' }, dateLabel(r.date)))) : [h('li', null, h('span', { class: 'none' }, 'Отчётов пока нет. Руководители направлений добавляют их в разделе «Отчёты».'))]));
}

function renderMembers() {
  const n = S.now, last = S.plan[S.plan.length - 1];
  $('#mem-mini').replaceChildren(stat('Сейчас по плану', range(n.members_min, n.members_max)), statFact('Факт', n.members_fact),
    statFact('Новых за месяц', n.new_members), stat('Цель к августу', range(last.members_min, last.members_max)));
  chartMembers($('#ch-members'));
}
function renderSocial() {
  const n = S.now, last = S.plan[S.plan.length - 1];
  $('#soc-mini').replaceChildren(stat('ВК сейчас по плану', fmt(n.vk_plan)), statFact('ВК, факт', n.vk_fact), stat('ВК к августу', fmt(last.vk_plan)), stat('Reels в этом месяце', n.reels_min === null ? 'без нормы' : range(n.reels_min, n.reels_max)));
  chartVk($('#ch-vk')); chartContent($('#ch-content'));
  renderVkLive();
  $('#soc-tt').replaceChildren(...S.progress.filter((r) => r.tiktok_target !== null || r.tiktok_fact !== null).map((r) =>
    h('li', null, h('span', { class: 'm' }, r.month_label), h('span', { class: 'v' }, fmt(r.tiktok_target)),
      h('span', { class: 'f' + (r.tiktok_fact !== null ? ' has' : '') }, r.tiktok_fact === null ? 'факт не внесён' : 'факт: ' + fmt(r.tiktok_fact)))));
}
function renderEvents() {
  const n = S.now;
  const total = S.plan.reduce((t, r) => t + (r.events_plan || 0), 0);
  $('#ev-mini').replaceChildren(stat('В этом месяце', n.events_plan === null ? 'агитация' : String(n.events_plan)), statFact('Факт', n.events_fact),
    stat('Участников за месяц', n.events_fact === null ? '—' : fmt(n.participants)), stat('Всего за сезон', String(total)));
  chartEvents($('#ch-events'));
}

// ---------- графики (SVG без библиотек) ----------
function frame(el, ymax, label) {
  el.replaceChildren();
  const rows = S.progress;
  const W = Math.max(280, el.clientWidth || 600), H = 250;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  el.append(svg);
  const step0 = ymax <= 10 ? 1 : Math.pow(10, Math.floor(Math.log10(ymax / 4)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * step0).find((st) => ymax / st <= 5) || step0 * 10;
  const top = Math.ceil(ymax / step) * step;
  const ticks = []; for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const probe = s('text', { class: 'tick' }); probe.textContent = nf.format(top); svg.append(probe);
  const tw = probe.getComputedTextLength() || 30; probe.remove();
  const m = { l: tw + 14, r: 18, t: 22, b: 26 };
  const x0 = m.l + 14, x1 = W - m.r - 14;
  const x = (i) => (rows.length < 2 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (rows.length - 1));
  const y = (v) => H - m.b - (v / top) * (H - m.t - m.b);
  for (const v of ticks) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,.07)' }));
    const t = s('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }); t.textContent = nf.format(v); svg.append(t);
  }
  const every = W < 440 ? 2 : 1;
  rows.forEach((r, i) => {
    if (i % every) return;
    const t = s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'tick' }); t.textContent = MON[+r.month.slice(5, 7) - 1]; svg.append(t);
  });
  const ni = S.now.pos - 1;
  svg.append(s('line', { x1: x(ni), x2: x(ni), y1: m.t - 8, y2: H - m.b, stroke: '#f8d561', 'stroke-opacity': .45, 'stroke-width': 2, 'stroke-dasharray': '4 4' }));
  return { svg, rows, x, y, W, H, m };
}
function path(pts) { return pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(''); }
function factLine(f, key) {
  const pts = f.rows.map((r, i) => [i, r[key]]).filter((p) => p[1] !== null);
  if (!pts.length) return;
  f.svg.append(s('path', { d: path(pts.map(([i, v]) => [f.x(i), f.y(v)])), fill: 'none', stroke: '#f8d561', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
  for (const [i, v] of pts) f.svg.append(s('circle', { cx: f.x(i), cy: f.y(v), r: 4.5, fill: '#f8d561', stroke: '#0f1733', 'stroke-width': 2 }));
}
function label(f, xv, yv, text, cls, anchor) {
  const t = s('text', { x: xv, y: yv, 'text-anchor': anchor || 'middle', class: 'lbl ' + (cls || '') }); t.textContent = text; f.svg.append(t);
}
function hover(f, el, lines) {
  const tip = h('div', { class: 'tip', hidden: true }); el.append(tip);
  const bw = f.rows.length > 1 ? f.x(1) - f.x(0) : 40;
  const hl = s('rect', { y: f.m.t - 8, height: f.H - f.m.t - f.m.b + 8, width: bw, fill: 'rgba(132,180,245,.08)', opacity: 0 });
  f.svg.insertBefore(hl, f.svg.firstChild);
  f.rows.forEach((r, i) => {
    const zone = s('rect', { x: f.x(i) - bw / 2, y: 0, width: bw, height: f.H, fill: 'transparent' });
    const show = () => {
      hl.setAttribute('x', f.x(i) - bw / 2); hl.setAttribute('opacity', 1);
      tip.replaceChildren(h('b', null, r.month_label), ...lines(r).map(([k, v]) => h('div', null, h('span', null, k + ': '), v)));
      tip.hidden = false;
      const box = el.getBoundingClientRect(), px = (f.x(i) / f.W) * box.width, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(box.width - tw, px + 14 + tw > box.width ? px - tw - 14 : px + 14)) + 'px';
    };
    zone.addEventListener('pointerenter', show); zone.addEventListener('pointermove', show);
    zone.addEventListener('pointerleave', () => { tip.hidden = true; hl.setAttribute('opacity', 0); });
    f.svg.append(zone);
  });
}
const nz = (v, t) => (v === null ? t : fmt(v));

function chartMembers(el) {
  const rows = S.progress;
  const f = frame(el, Math.max(...rows.map((r) => Math.max(r.members_max, r.members_fact || 0))) * 1.1, 'Активные члены: коридор плана и факт по месяцам');
  const up = rows.map((r, i) => [f.x(i), f.y(r.members_max)]), lo = rows.map((r, i) => [f.x(i), f.y(r.members_min)]).reverse();
  f.svg.append(s('path', { d: path(up.concat(lo)) + 'Z', fill: 'rgba(132,180,245,.26)', stroke: '#84b4f5', 'stroke-width': 1 }));
  rows.forEach((r, i) => { if (f.W >= 520 || i % 2 === 0 || i === rows.length - 1) label(f, f.x(i), f.y(r.members_max) - 7, `${r.members_min}–${r.members_max}`); });
  factLine(f, 'members_fact');
  hover(f, el, (r) => [['План', `${r.members_min}–${r.members_max}`], ['Факт', nz(r.members_fact, 'не внесён')], ['Новых', nz(r.new_members, '—')], ['Этап', r.stage]]);
}
function chartVk(el) {
  const rows = S.progress;
  const f = frame(el, Math.max(...rows.map((r) => Math.max(r.vk_plan, r.vk_fact || 0))) * 1.1, 'Подписчики ВК: план и факт по месяцам');
  const pts = rows.map((r, i) => [f.x(i), f.y(r.vk_plan)]);
  f.svg.append(s('path', { d: path(pts) + `L${pts[pts.length - 1][0]},${f.y(0)}L${pts[0][0]},${f.y(0)}Z`, fill: 'rgba(132,180,245,.12)' }));
  f.svg.append(s('path', { d: path(pts), fill: 'none', stroke: '#84b4f5', 'stroke-width': 2.5 }));
  pts.forEach((p) => f.svg.append(s('circle', { cx: p[0], cy: p[1], r: 3, fill: '#84b4f5' })));
  label(f, pts[0][0], pts[0][1] - 9, fmt(rows[0].vk_plan), 'hi', 'start');
  label(f, pts[pts.length - 1][0], pts[pts.length - 1][1] - 9, fmt(rows[rows.length - 1].vk_plan), 'hi', 'end');
  factLine(f, 'vk_fact');
  hover(f, el, (r) => [['План', fmt(r.vk_plan)], ['Факт' + (r.vk_auto ? ' (из ВК)' : ''), nz(r.vk_fact, 'не внесён')], ['Выполнение', r.vk_pct === null ? '—' : r.vk_pct + '%']]);
}
function chartEvents(el) {
  const rows = S.progress;
  const f = frame(el, Math.max(6, ...rows.map((r) => Math.max(r.events_plan || 0, r.events_fact || 0) + 1)), 'Мероприятия: план и факт по месяцам');
  const bw = Math.min(30, (rows.length > 1 ? f.x(1) - f.x(0) : 60) * 0.62);
  rows.forEach((r, i) => {
    const cx = f.x(i);
    if (r.events_plan === null) {
      const t = s('text', { transform: `translate(${cx + 4},${f.y(0) - 6}) rotate(-90)`, class: 'lbl' }); t.textContent = 'агитация'; t.setAttribute('fill', '#ff8b7b'); f.svg.append(t);
    } else {
      f.svg.append(s('rect', { x: cx - bw / 2, width: bw, y: f.y(r.events_plan), height: f.y(0) - f.y(r.events_plan), rx: 3, fill: 'rgba(132,180,245,.3)', stroke: '#84b4f5' }));
      label(f, cx, f.y(Math.max(r.events_plan, r.events_fact || 0)) - 6, String(r.events_plan), 'hi');
    }
    if (r.events_fact !== null && r.events_fact > 0) f.svg.append(s('rect', { x: cx - bw / 4, width: bw / 2, y: f.y(r.events_fact), height: f.y(0) - f.y(r.events_fact), rx: 2, fill: '#f8d561' }));
  });
  hover(f, el, (r) => [['План', r.events_plan === null ? 'агитация' : String(r.events_plan)], ['Факт', nz(r.events_fact, 'не внесён')], ['Что', r.events_text]]);
}
function chartContent(el) {
  const rows = S.progress;
  const f = frame(el, Math.max(...rows.map((r) => Math.max(r.posts_max || 0, r.posts_fact || 0))) * 1.12, 'Посты и Reels: план и факт по месяцам');
  const bw = Math.min(14, (rows.length > 1 ? f.x(1) - f.x(0) : 60) * 0.3);
  rows.forEach((r, i) => {
    const cx = f.x(i);
    if (r.posts_max !== null) {
      f.svg.append(s('rect', { x: cx - bw - 1, width: bw, y: f.y(r.posts_max), height: f.y(0) - f.y(r.posts_max), rx: 2, fill: 'rgba(132,180,245,.22)', stroke: '#84b4f5' }));
      if (r.posts_min !== r.posts_max) f.svg.append(s('line', { x1: cx - bw - 1, x2: cx - 1, y1: f.y(r.posts_min), y2: f.y(r.posts_min), stroke: '#84b4f5', 'stroke-width': 2 }));
    }
    if (r.reels_max !== null) f.svg.append(s('rect', { x: cx + 1, width: bw, y: f.y(r.reels_max), height: f.y(0) - f.y(r.reels_max), rx: 2, fill: '#aebfe3', 'fill-opacity': .75 }));
    if (r.posts_fact !== null) f.svg.append(s('line', { x1: cx - bw - 4, x2: cx + bw + 4, y1: f.y(r.posts_fact), y2: f.y(r.posts_fact), stroke: '#f8d561', 'stroke-width': 3 }));
  });
  hover(f, el, (r) => [['Посты', range(r.posts_min, r.posts_max)], ['Reels', r.reels_min === null ? 'без нормы' : range(r.reels_min, r.reels_max)], ['Факт: посты', nz(r.posts_fact, 'не внесён')], ['Факт: Reels', nz(r.reels_fact, '—')]]);
}

// ---------- ВК в реальном времени ----------
function renderVkLive() {
  const box = $('#vk-live');
  if (!S.vk) {
    box.replaceChildren(h('h3', { class: 'h3' }, 'ВК в реальном времени'), h('p', { class: 'hint flush' }, anyDept()
      ? 'Автосбор ВК не подключён. Добавьте в Apps Script свойства VK_TOKEN и VK_GROUP и снова нажмите в таблице «Молодёжка → Настроить бота».'
      : 'Автосбор статистики ВК пока не подключён.'));
    return;
  }
  const v = S.vk, days = v.days;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const base = [...days].reverse().find((d) => d.d <= weekAgo) || days[0];
  const delta = v.members - base.n;
  const m = new Date().toISOString().slice(0, 7);
  const monthPosts = v.posts.filter((p) => p.date.slice(0, 7) === m);
  const views = monthPosts.reduce((t, p) => t + p.views, 0);
  const upd = v.updated.slice(11, 16) + ', ' + dateLabel(v.updated.slice(0, 10));
  const top = [...monthPosts].sort((a, b) => b.views - a.views).slice(0, 5);
  box.replaceChildren(
    h('div', { class: 'card-h' }, h('h3', { class: 'h3' }, 'ВК в реальном времени'), h('span', { class: 'live' }, h('i', { class: 'live-dot' }), 'обновлено ' + upd)),
    h('div', { class: 'mini' },
      stat('Подписчиков сейчас', fmt(v.members), 'fact'),
      stat('За 7 дней', (delta > 0 ? '+' : '') + fmt(delta), delta > 0 ? 'up' : delta < 0 ? 'down' : ''),
      stat('Постов в этом месяце', String(monthPosts.length)),
      stat('Просмотров за месяц', fmt(views))),
    h('div', { class: 'chart small', id: 'ch-days' }),
    h('h4', { class: 'h4' }, 'Лучшие посты месяца'),
    top.length ? h('ul', { class: 'posts' }, ...top.map((p) => h('li', null,
      h('a', { href: p.link, target: '_blank', rel: 'noopener noreferrer', class: 'pt' }, p.text || 'Пост без текста'),
      h('span', { class: 'pm' }, dateLabel(p.date.slice(0, 10)) + ' · 👁 ' + fmt(p.views) + ' · ❤ ' + fmt(p.likes) + ' · ↗ ' + fmt(p.reposts) + ' · 💬 ' + fmt(p.comments)))))
      : h('p', { class: 'hint flush' }, 'В этом месяце постов пока нет.'));
  chartDays($('#ch-days'), days.slice(-60));
}
function chartDays(el, days) {
  el.replaceChildren();
  if (days.length < 2) { el.append(h('p', { class: 'hint flush' }, 'График роста появится, когда наберутся данные хотя бы за два дня.')); return; }
  const W = Math.max(280, el.clientWidth || 600), H = 180, m = { l: 44, r: 14, t: 14, b: 24 };
  const lo = Math.min(...days.map((d) => d.n)), hi = Math.max(...days.map((d) => d.n));
  const pad = Math.max(2, Math.round((hi - lo) * 0.15));
  const y0 = Math.max(0, lo - pad), y1 = hi + pad;
  const x = (i) => m.l + (i * (W - m.l - m.r)) / (days.length - 1);
  const y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Подписчики ВК по дням', preserveAspectRatio: 'none' });
  svg.style.height = H + 'px';
  el.append(svg);
  [y0, Math.round((y0 + y1) / 2), y1].forEach((v) => {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,.07)' }));
    const t = s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }); t.textContent = nf.format(v); svg.append(t);
  });
  const stepL = Math.ceil(days.length / (W < 440 ? 4 : 7));
  days.forEach((d, i) => {
    if (i % stepL !== 0 && i !== days.length - 1) return;
    if (i !== days.length - 1 && days.length - 1 - i < stepL / 2) return;
    const t = s('text', { x: x(i), y: H - 6, 'text-anchor': i === days.length - 1 ? 'end' : i === 0 ? 'start' : 'middle', class: 'tick' });
    t.textContent = dateLabel(d.d); svg.append(t);
  });
  const pts = days.map((d, i) => [x(i), y(d.n)]);
  svg.append(s('path', { d: path(pts) + `L${pts[pts.length - 1][0]},${H - m.b}L${pts[0][0]},${H - m.b}Z`, fill: 'rgba(248,213,97,.12)' }));
  svg.append(s('path', { d: path(pts), fill: 'none', stroke: '#f8d561', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  const lp = pts[pts.length - 1];
  svg.append(s('circle', { cx: lp[0], cy: lp[1], r: 4.5, fill: '#f8d561', stroke: '#0f1733', 'stroke-width': 2 }));
  const tip = h('div', { class: 'tip', hidden: true }); el.append(tip);
  const bw = (W - m.l - m.r) / (days.length - 1);
  days.forEach((d, i) => {
    const z = s('rect', { x: x(i) - bw / 2, y: 0, width: bw, height: H, fill: 'transparent' });
    z.addEventListener('pointerenter', () => {
      tip.replaceChildren(h('b', null, dateLabel(d.d)), h('div', null, h('span', null, 'Подписчиков: '), fmt(d.n)));
      tip.hidden = false;
      const box = el.getBoundingClientRect(), px = (x(i) / W) * box.width, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(box.width - tw, px + 14 + tw > box.width ? px - tw - 14 : px + 14)) + 'px';
    });
    z.addEventListener('pointerleave', () => { tip.hidden = true; });
    svg.append(z);
  });
}

// ---------- план по месяцам ----------
function renderRoadmap() {
  $('#rm-chips').replaceChildren(...PHASES.map(([k, t]) => h('button', { type: 'button', class: 'chip ph-' + (k || 'all') + (S.phase === k ? ' on' : ''), onclick: () => { S.phase = k; renderRoadmap(); } }, k ? h('i', { class: 'dot' }) : null, t)));
  const cur = S.now.month;
  const body = $('#rm-body'); body.replaceChildren();
  S.progress.forEach((r) => {
    if (S.phase && r.phase !== S.phase) return;
    let st = ['', 'Впереди'];
    if (r.members_fact !== null) st = r.members_pct >= 100 ? ['ok', 'Выполнен'] : ['bad', 'Ниже плана'];
    else if (r.month === cur) st = ['now', 'Сейчас'];
    else if (r.month < cur) st = ['wait', 'Ждёт факта'];
    const det = h('tr', { class: 'det', hidden: true }, h('td', { colspan: 8 }, h('div', { class: 'dgrid' },
      ...[['Набор актива', r.recruit], ['ВК и TikTok', r.social], ['Массовые мероприятия', r.events_text]].map(([t, v]) => h('p', null, h('b', null, t), v || '—')))));
    const toggle = () => { det.hidden = !det.hidden; tr.setAttribute('aria-expanded', String(!det.hidden)); };
    const tr = h('tr', { class: 'click ph-' + r.phase + (r.month === cur ? ' cur' : ''), tabindex: 0, 'aria-expanded': 'false', onclick: toggle, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
      h('td', null, h('div', { class: 'mcell' }, h('span', { class: 'av' }, String(+r.month.slice(5, 7))), h('div', null, r.month_label, h('small', null, r.month === cur ? 'текущий месяц' : r.month < cur ? 'прошёл' : 'впереди')))),
      h('td', null, r.stage), h('td', null, `${r.members_min}–${r.members_max}`),
      h('td', { class: 'num' }, fmt(r.members_fact)), h('td', { class: 'num' }, fmt(r.vk_plan)), h('td', { class: 'num' }, fmt(r.vk_fact)),
      h('td', { class: 'num' }, r.events_plan === null ? 'агитация' : String(r.events_plan) + (r.events_fact !== null ? ` / ${r.events_fact}` : '')),
      h('td', null, h('span', { class: 'st ' + st[0] }, st[1])));
    body.append(tr, det);
  });
}

// ---------- отчёты ----------
const SUMS = {
  media: [['posts_vk', 'Постов в ВК', 'sum'], ['reels', 'Reels', 'sum'], ['tiktok', 'Видео TikTok', 'sum'], ['vk_subs', 'Подписчиков ВК', 'last'], ['reach', 'Охват', 'sum']],
  people: [['new_members', 'Новых активистов', 'sum'], ['active_total', 'Всего в активе', 'last'], ['meetings', 'Встреч / выходов', 'sum'], ['contacts', 'Контактов', 'sum']],
  events: [['__count', 'Мероприятий', 'count'], ['participants', 'Участников', 'sum'], ['new_people', 'Новых людей', 'sum']]
};
const COLS = {
  media: ['posts_vk', 'reels', 'tiktok', 'vk_subs', 'reach'],
  people: ['new_members', 'active_total', 'meetings', 'contacts'],
  events: ['kind', 'participants', 'new_people']
};
function renderReports() {
  $('#rep-tabs').replaceChildren(...DEPT_ORDER.map((d) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(S.repDept === d), class: 'chip d-' + d + (S.repDept === d ? ' on' : ''), onclick: () => { S.repDept = d; renderReports(); } }, h('i', { class: 'dot' }), S.depts[d].name)));
  const months = Array.from(new Set(S.plan.map((p) => p.month).concat(S.reports.map((r) => monthOf(r.date))))).sort().reverse();
  const sel = $('#rep-month');
  sel.replaceChildren(h('option', { value: '' }, 'Все месяцы'), ...months.map((m) => h('option', { value: m }, monthLabel(m))));
  sel.value = S.repMonth;
  sel.onchange = () => { S.repMonth = sel.value; renderReports(); };
  const dept = S.repDept, def = S.depts[dept];
  $('#rep-add').hidden = !canWrite(dept);
  $('#rep-add').textContent = `+ Отчёт: ${def.name}`;
  const list = S.reports.filter((r) => r.dept === dept && (!S.repMonth || monthOf(r.date) === S.repMonth))
    .sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created));
  // итоги
  const asc = [...list].reverse();
  // для Медиа посты, просмотры и подписчики ВК берутся автоматически из ВК
  const vkAuto = dept === 'media' && S.vk;
  const autoStats = [];
  if (vkAuto) {
    const inPeriod = S.vk.posts.filter((p) => !S.repMonth || p.date.slice(0, 7) === S.repMonth);
    const sum = (k) => inPeriod.reduce((t, p) => t + p[k], 0);
    const dayList = S.vk.days.filter((d) => !S.repMonth || d.d.slice(0, 7) === S.repMonth);
    const subs = dayList.length ? dayList[dayList.length - 1].n : null;
    autoStats.push(
      stat('Постов в ВК · авто', String(inPeriod.length), 'fact'),
      stat('Просмотров ВК · авто', fmt(sum('views')), 'fact'),
      stat('Лайков ВК · авто', fmt(sum('likes')), 'fact'),
      stat('Подписчиков ВК · авто', subs === null ? '—' : fmt(subs), subs === null ? 'empty' : 'fact'));
  }
  const skip = vkAuto ? ['posts_vk', 'vk_subs', 'reach'] : [];
  $('#rep-sum').replaceChildren(...autoStats, ...SUMS[dept].filter(([k]) => !skip.includes(k)).map(([k, t, how]) => {
    let v = null;
    if (how === 'count') v = list.length;
    else if (how === 'sum') { const xs = list.map((r) => r.values[k]).filter((x) => x !== undefined); v = xs.length ? xs.reduce((a, b) => a + b, 0) : null; }
    else { const xs = asc.map((r) => r.values[k]).filter((x) => x !== undefined); v = xs.length ? xs[xs.length - 1] : null; }
    return stat(t, v === null ? '—' : fmt(v), v === null ? 'empty' : '');
  }));
  const fields = Object.fromEntries(def.fields.map((f) => [f.k, f]));
  const cols = COLS[dept];
  $('#rep-head').replaceChildren(h('tr', null, h('th', null, 'Дата'), h('th', null, 'Что сделано'), ...cols.map((k) => h('th', { class: fields[k].type === 'int' ? 'num' : '' }, fields[k].label.replace(' на эту дату', ''))), h('th', null, 'Автор'), h('th', null, '')));
  $('#rep-body').replaceChildren(...list.map((r) => h('tr', null,
    h('td', null, dateLabel(r.date)),
    h('td', { class: 'rt' }, h('b', null, r.values.title || '—'), r.values.note || r.values.place ? h('small', null, r.values.place ? r.values.place + (r.values.note ? ' · ' + r.values.note : '') : r.values.note) : null,
      r.values.link ? h('small', null, h('a', { href: r.values.link, target: '_blank', rel: 'noopener noreferrer' }, 'ссылка')) : null),
    ...cols.map((k) => h('td', { class: fields[k].type === 'int' ? 'num' : '' }, r.values[k] === undefined ? '—' : fields[k].type === 'int' ? fmt(r.values[k]) : r.values[k])),
    h('td', null, r.author_name, r.entered_by ? h('small', { class: 'by' }, 'внёс(ла): ' + r.entered_by) : null),
    h('td', null, canWrite(dept) ? h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'btn small', onclick: () => reportForm(dept, r) }, 'Изменить'),
      h('button', { type: 'button', class: 'btn small danger', onclick: () => deleteReport(r) }, 'Удалить')) : null))));
  $('#rep-empty').hidden = list.length > 0;
}
$('#rep-add').addEventListener('click', () => reportForm(S.repDept));
$('#quick-add').addEventListener('click', () => {
  const ds = myDepts();
  if (ds.length === 1) return reportForm(ds[0]);
  dialog({ title: 'Какое направление?', ok: 'Дальше',
    body: [h('label', { class: 'fld wide' }, h('span', null, 'Направление'), h('select', { id: 'f-dept' }, ...ds.map((d) => h('option', { value: d }, S.depts[d].name))))],
    submit: async () => { const d = $('#f-dept').value; setTimeout(() => reportForm(d), 0); } });
});

function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function reportForm(dept, rep) {
  const def = S.depts[dept], v = rep ? rep.values : {};
  const els = [h('label', { class: 'fld' }, h('span', null, 'Дата ', h('b', null, '*')), h('input', { type: 'date', id: 'f-date', required: true, value: rep ? rep.date : today() }))];
  if (anyDept()) {
    // зам и админ вносят отчёт за любого человека
    const sel = h('select', { id: 'f-author' }, h('option', { value: S.me.id }, 'Я — ' + S.me.name),
      ...S.people.filter((u) => u.id !== S.me.id).map((u) => h('option', { value: u.id }, u.name + ' · ' + (ROLE_NAMES[u.role] || u.role))),
      h('option', { value: '__other' }, 'Другой человек…'));
    const other = h('input', { id: 'f-author-name', maxlength: 80, placeholder: 'Имя и фамилия' });
    const otherWrap = h('label', { class: 'fld', hidden: true }, h('span', null, 'Кто сделал'), other);
    if (rep) {
      if (rep.author && S.people.some((u) => u.id === rep.author)) sel.value = rep.author;
      else { sel.value = '__other'; other.value = rep.author_name; otherWrap.hidden = false; }
    }
    sel.onchange = () => { otherWrap.hidden = sel.value !== '__other'; if (!otherWrap.hidden) other.focus(); };
    els.push(h('label', { class: 'fld' }, h('span', null, 'Автор отчёта'), sel), otherWrap);
  }
  for (const f of def.fields) {
    const idf = 'f-' + f.k, val = v[f.k] ?? '';
    let input;
    if (f.type === 'textarea') { input = h('textarea', { id: idf, maxlength: f.max || 2000 }); input.value = val; }
    else if (f.type === 'select') { input = h('select', { id: idf }, h('option', { value: '' }, '— выберите —'), ...f.options.map((o) => h('option', { value: o }, o))); input.value = val; }
    else if (f.type === 'int') input = h('input', { id: idf, type: 'number', min: 0, step: 1, inputmode: 'numeric', value: val });
    else if (f.type === 'url') input = h('input', { id: idf, type: 'url', placeholder: 'https://', value: val });
    else input = h('input', { id: idf, maxlength: f.max || 200, value: val, required: f.req || null });
    const wide = f.type === 'textarea' || f.k === 'title' || f.type === 'url' || f.k === 'place';
    els.push(h('label', { class: 'fld' + (wide ? ' wide' : '') }, h('span', null, f.label, f.req ? h('b', null, ' *') : null), input));
  }
  if (dept === 'people') els.push(h('p', null, '«Всего в активе» — сколько человек в активе на эту дату. Из него считается факт на дашборде.'));
  if (dept === 'media') els.push(h('p', null, S.vk
    ? 'Подписчиков и посты ВК бот считает сам — эти поля можно не заполнять. TikTok указывайте на дату отчёта.'
    : 'Число подписчиков указывайте на дату отчёта — дашборд берёт последнее значение за месяц.'));
  dialog({ title: (rep ? 'Изменить отчёт · ' : 'Новый отчёт · ') + def.name, body: els, ok: rep ? 'Сохранить' : 'Добавить',
    submit: async () => {
      const values = {};
      for (const f of def.fields) { const x = $('#f-' + f.k).value.trim(); if (x !== '') values[f.k] = f.type === 'int' ? Number(x) : x; }
      const body = { dept, date: $('#f-date').value, values };
      if (anyDept()) {
        const who = $('#f-author').value;
        if (who === '__other') { body.author_name = $('#f-author-name').value.trim(); if (!body.author_name) throw new Error('Укажите, кто сделал'); }
        else body.author_id = who;
      }
      const r = rep ? await api('update', Object.assign({ id: rep.id }, body)) : await api('add', body);
      S.repDept = dept; S.repMonth = S.repMonth && S.repMonth !== monthOf(body.date) ? '' : S.repMonth;
      applyReports(r.reports);
      if (TG && TG.HapticFeedback) TG.HapticFeedback.notificationOccurred('success');
      toast(rep ? 'Отчёт сохранён' : 'Отчёт добавлен');
    } });
}
function deleteReport(r) {
  dialog({ title: 'Удалить отчёт?', ok: 'Удалить', danger: true,
    body: [h('p', null, `«${r.values.title || 'без названия'}» от ${dateLabel(r.date)} будет удалён без возможности восстановления.`)],
    submit: async () => { const x = await api('delete', { id: r.id }); applyReports(x.reports); toast('Отчёт удалён'); } });
}

// ---------- доступ (администратор) ----------
const ROLE_ALL = Object.assign({}, ROLE_NAMES, { pending: 'Ждёт подтверждения', blocked: 'Доступ закрыт' });
function drawUsers(users) {
  const order = { pending: 0, admin: 1, media: 2, people: 3, events: 4, viewer: 5, blocked: 6 };
  users.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.name.localeCompare(b.name));
  $('#users-body').replaceChildren(...users.map((u) => {
    const role = h('select', { class: 'btn small role-sel', 'aria-label': 'Роль ' + u.name, disabled: u.id === S.me.id || null },
      ...Object.entries(ROLE_ALL).map(([k, t]) => h('option', { value: k }, t)));
    role.value = u.role;
    role.onchange = async () => {
      role.disabled = true;
      try { drawUsers((await api('setRole', { id: u.id, role: role.value })).users); toast('Роль изменена'); }
      catch (e) { toast(e.message); role.value = u.role; role.disabled = false; }
    };
    return h('tr', { class: u.role === 'pending' ? 'pending-row' : '' },
      h('td', null, u.name + (u.id === S.me.id ? ' (вы)' : '')),
      h('td', { class: 'tg-user' }, u.username ? '@' + u.username : '—', h('small', null, 'ID ' + u.id)),
      h('td', null, role));
  }));
}
async function renderUsers() {
  try { drawUsers((await api('users')).users); }
  catch (e) { $('#users-body').replaceChildren(h('tr', null, h('td', { colspan: 3, class: 'err' }, e.message))); }
}

// ---------- диалог ----------
let dlgSubmit = null;
function dialog({ title, body, ok, danger, submit }) {
  const d = $('#dlg');
  $('#dlg-title').textContent = title;
  $('#dlg-body').replaceChildren(...body);
  $('#dlg-ok').textContent = ok || 'Сохранить';
  $('#dlg-ok').className = 'btn ' + (danger ? 'danger' : 'primary');
  $('#dlg-err').hidden = true;
  dlgSubmit = submit;
  d.showModal();
  const first = $('#dlg-body input, #dlg-body select, #dlg-body textarea');
  if (first) first.focus();
}
$('#dlg-cancel').addEventListener('click', () => $('#dlg').close());
$('#dlg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#dlg-ok'); btn.disabled = true; $('#dlg-err').hidden = true;
  try { await dlgSubmit(); $('#dlg').close(); }
  catch (err) { $('#dlg-err').textContent = err.message; $('#dlg-err').hidden = false; }
  finally { btn.disabled = false; }
});

boot();

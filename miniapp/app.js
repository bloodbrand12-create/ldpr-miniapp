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

const S = { me: null, depts: {}, plan: [], reports: [], progress: [], now: null, view: 'overview', phase: '', repDept: 'media', repMonth: '',
  tasks: [], cal: [], team: null, taskFilter: '', ratePeriod: 'month' };

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
const canSocial = () => S.me && ['media', 'admin', 'deputy'].includes(S.me.role);
const myDepts = () => (anyDept() ? DEPT_ORDER : DEPT_ORDER.filter((d) => d === S.me.role));
const canPlan = () => S.me && (anyDept() || S.me.role === 'events');

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
  const ttMonth = {};
  for (const r of S.social || []) if (r.tt_subs !== undefined) ttMonth[r.t.slice(0, 7)] = r.tt_subs;
  const pct = (f, p) => (f === null || !p ? null : Math.round((f / p) * 100));
  S.progress = S.plan.map((p) => {
    const a = byMonth[p.month] || { has: {} };
    const members_fact = a.members ?? null;
    const auto = vkFrom && p.month >= vkFrom && p.month <= thisMonth ? (vkMonth[p.month] || { posts: 0, views: 0 }) : null;
    const vk_fact = auto && auto.subs !== undefined ? auto.subs : (a.vk ?? null);
    return { ...p,
      members_fact, members_pct: pct(members_fact, p.members_min),
      vk_fact, vk_pct: pct(vk_fact, p.vk_plan),
      tiktok_fact: ttMonth[p.month] ?? a.tiktok ?? null,
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
    S.plan = plan; S.me = st.user; S.depts = st.depts; S.reports = st.reports; S.vk = st.vk || null; S.people = st.people || []; S.social = st.social || [];
    S.tasks = st.tasks || []; S.cal = st.plan || []; S.team = st.team || null; S.week = st.week || null; S.goals = st.goals || [];
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
  if (deepLink()) return;
  route();
  if (wantAdd && myDepts().length) $('#quick-add').click();
}
// ссылки из бота: #ev-<id> — карточка мероприятия, #evrep-<id> — сразу отчёт по нему
function deepLink() {
  const m = /^#(ev|evrep)-(\w+)$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', '#events');
  route();
  const e = S.cal.find((x) => x.id === m[2]);
  if (!e) { toast('Мероприятие не найдено — возможно, его удалили'); return true; }
  if (m[1] === 'evrep' && !e.report && canWrite('events')) reportFromPlan(e);
  else eventDialog(e);
  return true;
}

// ---------- навигация ----------
const VIEWS = ['overview', 'members', 'social', 'events', 'roadmap', 'team', 'reports', 'users'];
function route() {
  let v = location.hash.slice(1);
  if (!VIEWS.includes(v) || (v === 'users' && S.me.role !== 'admin')) v = 'overview';
  S.view = v;
  $$('.view').forEach((el) => { el.hidden = el.dataset.view !== v; });
  $$('.nav').forEach((a) => { a.classList.toggle('on', a.dataset.view === v); if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  renderView();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => { if (S.me && location.hash !== '#add' && !deepLink()) route(); });
function renderView() {
  ({ overview: renderOverview, members: renderMembers, social: renderSocial, events: renderEvents,
    roadmap: renderRoadmap, team: renderTeam, reports: renderReports, users: renderUsers })[S.view]();
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
  renderLights();
  renderNext();
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
  renderSocMan();
  $('#soc-tt').replaceChildren(...S.progress.filter((r) => r.tiktok_target !== null || r.tiktok_fact !== null).map((r) =>
    h('li', null, h('span', { class: 'm' }, r.month_label), h('span', { class: 'v' }, fmt(r.tiktok_target)),
      h('span', { class: 'f' + (r.tiktok_fact !== null ? ' has' : '') }, r.tiktok_fact === null ? 'факт не внесён' : 'факт: ' + fmt(r.tiktok_fact)))));
}
function renderEvents() {
  const n = S.now;
  const total = S.plan.reduce((t, r) => t + (r.events_plan || 0), 0);
  $('#ev-mini').replaceChildren(stat('В этом месяце', n.events_plan === null ? 'агитация' : String(n.events_plan)), statFact('Факт', n.events_fact),
    stat('Участников за месяц', n.events_fact === null ? '—' : fmt(n.participants)), stat('Всего за сезон', String(total)));
  renderCal();
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

// ---------- TikTok и Instagram (цифры из опроса в боте) ----------
const SOC_FIELDS = [['tt_subs', 'TikTok подписчиков'], ['tt_videos', 'TikTok видео за неделю'], ['ig_subs', 'Instagram подписчиков'], ['ig_posts', 'Instagram постов за неделю']];
function lastOf(rows, k) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][k] !== undefined) return { v: rows[i][k], i }; return null; }
function renderSocMan() {
  const box = $('#soc-manual');
  const rows = S.social || [];
  const head = h('div', { class: 'card-h' }, h('h3', { class: 'h3' }, 'TikTok и Instagram'),
    canSocial() ? h('button', { type: 'button', class: 'btn small', onclick: socForm }, '+ Внести цифры') : null);
  if (!rows.length) {
    box.replaceChildren(head, h('p', { class: 'hint flush' }, 'Цифр пока нет. Каждый понедельник бот спрашивает их у руководителя Медиа. Внести сразу можно командой /social в боте или кнопкой выше.'));
    return;
  }
  const m = new Date().toISOString().slice(0, 7);
  const month = rows.filter((r) => r.t.slice(0, 7) === m);
  const sum = (k) => month.reduce((t, r) => t + (r[k] || 0), 0);
  const subsStat = (k, label) => {
    const l = lastOf(rows, k);
    if (!l) return stat(label, '—', 'empty');
    const p = lastOf(rows.slice(0, l.i), k);
    const d = p ? l.v - p.v : null;
    const el = stat(label, fmt(l.v), 'fact');
    if (d !== null) el.append(h('span', { class: 'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') }, (d > 0 ? '+' : '') + fmt(d) + ' с прошлого раза'));
    return el;
  };
  const last = rows[rows.length - 1];
  box.replaceChildren(head,
    h('div', { class: 'mini' },
      subsStat('tt_subs', 'TikTok подписчиков'), subsStat('ig_subs', 'Instagram подписчиков'),
      stat('Видео TikTok за месяц', fmt(sum('tt_videos'))), stat('Постов Instagram за месяц', fmt(sum('ig_posts')))),
    h('p', { class: 'hint flush' }, 'Последнее обновление: ' + dateLabel(last.t.slice(0, 10)) + ', ' + (last.author || '—') + '. Цифры вносятся вручную раз в неделю.'),
    h('ul', { class: 'posts' }, ...rows.slice(-5).reverse().map((r) => h('li', null,
      h('span', { class: 'pm' }, dateLabel(r.t.slice(0, 10)) + ' · ' + (r.author || '—')),
      h('span', null, SOC_FIELDS.filter(([k]) => r[k] !== undefined).map(([k, t]) => t + ': ' + fmt(r[k])).join(' · '))))));
}
function socForm() {
  const last = (k) => { const l = lastOf(S.social || [], k); return l ? l.v : ''; };
  dialog({ title: 'Цифры TikTok и Instagram', ok: 'Записать', body: [
    ...SOC_FIELDS.map(([k, t]) => h('label', { class: 'fld' }, h('span', null, t),
      h('input', { id: 's-' + k, type: 'number', min: 0, step: 1, inputmode: 'numeric', placeholder: /subs/.test(k) && last(k) !== '' ? 'было ' + fmt(last(k)) : '' }))),
    h('p', null, 'Заполните то, что знаете, остальное можно оставить пустым.')],
  submit: async () => {
    const values = {};
    for (const [k] of SOC_FIELDS) { const x = $('#s-' + k).value.trim(); if (x !== '') values[k] = Number(x); }
    if (!Object.keys(values).length) throw new Error('Заполните хотя бы одно поле');
    const r = await api('social', { values });
    S.social = r.social; computeProgress(); renderHeader(); renderView();
    toast('Цифры записаны');
  } });
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
  if (dept === 'media') {
    const soc = (S.social || []).filter((r) => !S.repMonth || r.t.slice(0, 7) === S.repMonth);
    if (soc.length) {
      const lastIn = (k) => { const l = lastOf(soc, k); return l ? fmt(l.v) : '—'; };
      const sumIn = (k) => fmt(soc.reduce((t, r) => t + (r[k] || 0), 0));
      autoStats.push(stat('TikTok подписчиков · бот', lastIn('tt_subs'), 'fact'), stat('Видео TikTok · бот', sumIn('tt_videos'), 'fact'),
        stat('Instagram подписчиков · бот', lastIn('ig_subs'), 'fact'), stat('Постов Instagram · бот', sumIn('ig_posts'), 'fact'));
      skip.push('tiktok');
    }
  }
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
      r.values.link ? h('small', null, h('a', { href: r.values.link, target: '_blank', rel: 'noopener noreferrer' }, 'ссылка')) : null,
      thumbs(r.photos)),
    ...cols.map((k) => h('td', { class: fields[k].type === 'int' ? 'num' : '' }, r.values[k] === undefined ? '—' : fields[k].type === 'int' ? fmt(r.values[k]) : r.values[k])),
    h('td', null, r.author_name, r.entered_by ? h('small', { class: 'by' }, 'внёс(ла): ' + r.entered_by) : null,
      r.reviewed ? h('small', { class: 'ok-by' }, '✓ принято: ' + r.reviewed.split(' · ')[0]) : null),
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
function reportForm(dept, rep, pre) {
  const def = S.depts[dept], v = rep ? rep.values : (pre && pre.values) || {};
  const els = [h('label', { class: 'fld' }, h('span', null, 'Дата ', h('b', null, '*')), h('input', { type: 'date', id: 'f-date', required: true, value: rep ? rep.date : (pre && pre.date) || today() }))];
  if (pre && pre.plan_title) els.push(h('p', null, 'Отчёт по мероприятию из календаря «' + pre.plan_title + '». После сохранения оно отметится как проведённое.'));
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
  const had = rep ? (rep.photos || []).length : 0;
  const photoInput = h('input', { id: 'f-photos', type: 'file', accept: 'image/*', multiple: true });
  els.push(h('label', { class: 'fld wide' }, h('span', null, 'Фото' + (had ? ` (уже ${had}, можно ещё ${10 - had})` : ' (до 10 штук)')), photoInput));
  dialog({ title: (rep ? 'Изменить отчёт · ' : 'Новый отчёт · ') + def.name, body: els, ok: rep ? 'Сохранить' : 'Добавить',
    submit: async () => {
      const values = {};
      for (const f of def.fields) { const x = $('#f-' + f.k).value.trim(); if (x !== '') values[f.k] = f.type === 'int' ? Number(x) : x; }
      const files = Array.from(photoInput.files || []);
      if (had + files.length > 10) throw new Error(`Можно прикрепить не больше 10 фото, сейчас выбрано ${files.length}`);
      const body = { dept, date: $('#f-date').value, values };
      if (pre && pre.plan_id) body.plan_id = pre.plan_id;
      if (anyDept()) {
        const who = $('#f-author').value;
        if (who === '__other') { body.author_name = $('#f-author-name').value.trim(); if (!body.author_name) throw new Error('Укажите, кто сделал'); }
        else body.author_id = who;
      }
      const r = rep ? await api('update', Object.assign({ id: rep.id }, body)) : await api('add', body);
      if (r.plan) S.cal = r.plan;
      S.repDept = dept; S.repMonth = S.repMonth && S.repMonth !== monthOf(body.date) ? '' : S.repMonth;
      applyReports(r.reports);
      if (TG && TG.HapticFeedback) TG.HapticFeedback.notificationOccurred('success');
      toast(rep ? 'Отчёт сохранён' : 'Отчёт добавлен');
      // фото грузим после сохранения: отчёт уже записан, даже если фото не дойдут
      if (files.length) uploadPhotos(rep ? rep.id : r.id, files);
    } });
}
// фото: уменьшаем на телефоне до 1600 px, чтобы грузилось быстро
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Не удалось открыть фото «' + file.name + '»')); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}
async function uploadPhotos(id, files) {
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    toast(`Загружаю фото ${i + 1} из ${files.length}…`);
    try { applyReports((await api('photo', { id, data: await shrink(files[i]) })).reports); ok++; }
    catch (e) { toast('Фото не загрузилось: ' + e.message); return; }
  }
  toast(ok === 1 ? 'Фото прикреплено' : `Прикреплено фото: ${ok}`);
}
const driveId = (link) => (/\/d\/([\w-]+)/.exec(link) || [])[1];
function thumbs(photos) {
  if (!photos || !photos.length) return null;
  return h('span', { class: 'thumbs' }, ...photos.map((l) => h('a', { href: l, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Открыть фото' },
    h('img', { src: 'https://drive.google.com/thumbnail?id=' + driveId(l) + '&sz=w200', alt: '', loading: 'lazy' }))));
}
function deleteReport(r) {
  dialog({ title: 'Удалить отчёт?', ok: 'Удалить', danger: true,
    body: [h('p', null, `«${r.values.title || 'без названия'}» от ${dateLabel(r.date)} будет удалён без возможности восстановления.`)],
    submit: async () => { const x = await api('delete', { id: r.id }); applyReports(x.reports); toast('Отчёт удалён'); } });
}

// ---------- светофор и прогноз ----------
const MON_DAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
const monthKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
// наклон прямой по точкам [x, y] (метод наименьших квадратов)
function slope(pts) {
  const n = pts.length, mx = pts.reduce((t, p) => t + p[0], 0) / n, my = pts.reduce((t, p) => t + p[1], 0) / n;
  const den = pts.reduce((t, p) => t + (p[0] - mx) ** 2, 0);
  return den ? pts.reduce((t, p) => t + (p[0] - mx) * (p[1] - my), 0) / den : 0;
}
function lightRows() {
  const i = S.progress.findIndex((r) => r.month === monthKey());
  if (i < 0) return null;
  const P = S.progress, cur = P[i], prev = P[i - 1], end = P[P.length - 1];
  const d = new Date(), dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), frac = d.getDate() / dim;
  const ramp = (a, b) => (b === null || b === undefined ? a : b + (a - b) * frac);   // план «к сегодняшнему дню»
  const latest = (k) => { for (let j = i; j >= 0; j--) if (P[j][k] !== null) return P[j][k]; return null; };
  const trend = (k) => {
    const pts = P.slice(0, i + 1).map((r, j) => [j, r[k]]).filter((p) => p[1] !== null).slice(-4);
    if (pts.length < 2) return null;
    const lp = pts[pts.length - 1];
    return Math.max(0, Math.round(lp[1] + slope(pts) * (P.length - 1 - lp[0])));
  };
  const endLabel = MON_DAT[+end.month.slice(5, 7) - 1] + ' ' + end.month.slice(0, 4);
  const monthEnd = d.getDate() >= 5;
  const rows = [];
  // актив
  rows.push({ name: 'Актив', fact: latest('members_fact'), need: Math.round(ramp(cur.members_min, prev && prev.members_min)),
    fc: trend('members_fact'), goal: end.members_min, goalText: range(end.members_min, end.members_max), fcWhen: 'к ' + endLabel, href: '#members' });
  // подписчики ВК: прогноз по скорости роста за последние 30 дней
  let vkFc = trend('vk_fact');
  if (S.vk && S.vk.days.length >= 7) {
    const days = S.vk.days, lastD = days[days.length - 1];
    const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const base = days.find((x) => x.d >= from) || days[0];
    const span = (Date.parse(lastD.d) - Date.parse(base.d)) / 864e5;
    if (span >= 6) {
      const left = (Date.parse(end.month + '-28') - Date.now()) / 864e5;
      vkFc = Math.max(0, Math.round(S.vk.members + ((lastD.n - base.n) / span) * Math.max(0, left)));
    }
  }
  rows.push({ name: 'Подписчики ВК', fact: S.vk ? S.vk.members : latest('vk_fact'), need: Math.round(ramp(cur.vk_plan, prev && prev.vk_plan)),
    fc: vkFc, goal: end.vk_plan, goalText: fmt(end.vk_plan), fcWhen: 'к ' + endLabel, href: '#social' });
  // посты и Reels за месяц
  if (cur.posts_min !== null) rows.push({ name: 'Посты в этом месяце', fact: cur.posts_fact, need: Math.round(cur.posts_min * frac),
    fc: monthEnd && cur.posts_fact !== null ? Math.round(cur.posts_fact / frac) : null, goal: cur.posts_min, goalText: range(cur.posts_min, cur.posts_max), fcWhen: 'к концу месяца', href: '#social' });
  if (cur.reels_min !== null) rows.push({ name: 'Reels в этом месяце', fact: cur.reels_fact, need: Math.round(cur.reels_min * frac),
    fc: monthEnd && cur.reels_fact !== null ? Math.round(cur.reels_fact / frac) : null, goal: cur.reels_min, goalText: range(cur.reels_min, cur.reels_max), fcWhen: 'к концу месяца', href: '#social' });
  // мероприятия: проведённые + запланированные в календаре до конца месяца
  if (cur.events_plan !== null) {
    const t = today(), done = cur.events_fact || 0;
    const ahead = S.cal.filter((e) => e.status === 'planned' && e.date >= t && e.date.slice(0, 7) === cur.month).length;
    rows.push({ name: 'Мероприятия в этом месяце', fact: done, need: Math.floor(cur.events_plan * frac), fc: done + ahead, goal: cur.events_plan,
      goalText: String(cur.events_plan), fcWhen: 'с учётом календаря', href: '#events', note: ahead ? `ещё ${ahead} в календаре` : '' });
  }
  return rows.map((r) => {
    let st = ['none', 'Нет данных'];
    if (r.fact !== null) st = r.fact >= r.need ? ['ok', 'В графике'] : r.fact >= r.need * 0.8 ? ['warn', 'Чуть отстаём'] : ['bad', 'Отстаём'];
    return Object.assign(r, { st });
  });
}
function renderLights() {
  const box = $('#ov-lights'), rows = lightRows();
  box.hidden = !rows;
  if (!rows) return;
  box.replaceChildren(
    h('div', { class: 'card-h' }, h('h3', { class: 'h3' }, 'Светофор: идём ли по плану'), h('span', { class: 'hint flush' }, 'план «к сегодня» считается по дням месяца')),
    h('ul', { class: 'lights' }, ...rows.map((r) => h('li', null,
      h('a', { href: r.href, class: 'lt-' + r.st[0] },
        h('i', { class: 'lamp', 'aria-hidden': 'true' }),
        h('span', { class: 'lt-name' }, r.name, h('small', null, r.st[1])),
        h('span', { class: 'lt-fact' }, h('b', null, fmt(r.fact)), h('small', null, 'нужно к сегодня ≈ ' + fmt(r.need))),
        h('span', { class: 'lt-fc' }, r.fc === null ? h('small', null, r.fcWhen === 'к концу месяца' ? 'прогноз — после 5-го числа' : 'для прогноза нужно больше данных')
          : [h('span', { class: 'pill ' + (r.fc >= r.goal ? 'good' : 'bad') }, '≈ ' + fmt(r.fc)), h('small', null, r.fcWhen + ' · цель ' + r.goalText + (r.note ? ' · ' + r.note : ''))]))))));
}
function renderNext() {
  const box = $('#ov-next'), t = today();
  const evs = S.cal.filter((e) => e.status === 'planned' && e.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 3);
  const mine = S.tasks.filter((x) => x.to === S.me.id && x.status === 'open');
  const late = mine.filter((x) => x.due < t).length;
  box.hidden = !evs.length && !mine.length;
  box.replaceChildren(...[h('div', { class: 'card-h' }, h('h3', { class: 'h3' }, 'Ближайшее'), h('a', { class: 'link', href: '#events' }, 'Календарь →')),
    mine.length ? h('a', { class: 'next-tasks' + (late ? ' late' : ''), href: '#team' }, '📌 Ваши поручения: ' + mine.length + (late ? ` · просрочено ${late}` : ''), h('span', null, '→')) : null,
    evs.length ? h('div', { class: 'evlist' }, ...evs.map(evItem)) : null].filter(Boolean));
}

// ---------- календарь мероприятий ----------
const DEFAULT_CHECKLIST = ['Согласовать площадку', 'Анонс в ВК и чатах', 'Список участников', 'Фото и видео на месте', 'Пост-отчёт после мероприятия'];
function evItem(e) {
  const done = e.checklist.filter((x) => x.d).length, all = e.checklist.length;
  const d = new Date(e.date + 'T00:00:00');
  return h('button', { type: 'button', class: 'ev-item st-' + e.status, onclick: () => eventDialog(e) },
    h('span', { class: 'ev-date' }, h('b', null, String(d.getDate())), MON[d.getMonth()]),
    h('span', { class: 'ev-body' }, h('b', null, e.title),
      h('small', null, [e.time, e.place, e.owner_name ? 'отв. ' + e.owner_name : ''].filter(Boolean).join(' · ') || 'без подробностей')),
    e.status === 'cancelled' ? h('span', { class: 'st bad' }, 'отменено')
      : e.status === 'done' ? h('span', { class: 'st ok' }, 'проведено')
        : e.date < today() ? h('span', { class: 'st now' }, 'нужен отчёт')
          : all ? h('span', { class: 'ev-prog', title: 'Подготовка' }, h('span', { class: 'bar' }, h('i', { style: `width:${Math.round((done / all) * 100)}%` })), `${done}/${all}`) : null);
}
function renderCal() {
  const box = $('#ev-cal'), t = today();
  const by = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
  const up = S.cal.filter((e) => e.status === 'planned' && e.date >= t).sort(by);
  const need = S.cal.filter((e) => e.status === 'planned' && e.date < t).sort(by);
  const past = S.cal.filter((e) => e.status !== 'planned').sort(by).reverse().slice(0, 5);
  const sec = (title, list) => (list.length ? [h('h4', { class: 'h4' }, title), h('div', { class: 'evlist' }, ...list.map(evItem))] : []);
  box.replaceChildren(h('div', { class: 'card-h' }, h('h3', { class: 'h3' }, 'Календарь мероприятий'),
    canPlan() ? h('button', { type: 'button', class: 'btn small primary', onclick: () => planForm() }, '+ Запланировать') : null),
  ...(S.cal.length ? [...sec('Впереди', up), ...sec('Прошли — ждут отчёта', need), ...sec('Недавние', past)]
    : [h('p', { class: 'hint flush' }, canPlan() ? 'Запланируйте мероприятие заранее: бот напомнит ответственному за 3 дня и накануне, а после даты попросит заполнить отчёт.' : 'Запланированных мероприятий пока нет.')]));
}
function eventDialog(e) {
  const editable = canPlan() || e.owner === S.me.id;
  const t = today();
  const list = e.checklist.map((c, i) => {
    const box = h('input', { type: 'checkbox', disabled: !editable || e.status !== 'planned' || null });
    box.checked = c.d;
    box.onchange = async () => {
      box.disabled = true;
      try { S.cal = (await api('planCheck', { id: e.id, i, d: box.checked })).plan; e = S.cal.find((x) => x.id === e.id) || e; renderView(); }
      catch (err) { box.checked = !box.checked; toast(err.message); }
      finally { box.disabled = false; }
    };
    return h('label', { class: 'chk' }, box, h('span', null, c.t));
  });
  const close = (fn) => () => { $('#dlg').close(); setTimeout(fn, 0); };
  const acts = [];
  if (e.status === 'planned' && e.date <= t && !e.report && canWrite('events')) acts.push(h('button', { type: 'button', class: 'btn primary', onclick: close(() => reportFromPlan(e)) }, '📝 Заполнить отчёт'));
  if (canPlan()) {
    if (e.status === 'planned') acts.push(h('button', { type: 'button', class: 'btn', onclick: close(() => planForm(e)) }, 'Изменить'));
    acts.push(h('button', { type: 'button', class: 'btn', onclick: close(() => planStatus(e, e.status === 'cancelled' ? 'planned' : 'cancelled')) }, e.status === 'cancelled' ? 'Вернуть в план' : 'Отменить'));
    acts.push(h('button', { type: 'button', class: 'btn danger', onclick: close(() => planDelete(e)) }, 'Удалить'));
  }
  dialog({ title: e.title, ok: 'Закрыть', info: true, submit: async () => {}, body: [
    h('p', null, h('b', null, new Date(e.date + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) + (e.time ? ', ' + e.time : '')),
      [e.kind, e.place].filter(Boolean).length ? ' · ' + [e.kind, e.place].filter(Boolean).join(' · ') : ''),
    h('p', null, 'Ответственный: ' + (e.owner_name || 'не назначен') + (e.status === 'done' ? ' · ✓ отчёт внесён' : e.status === 'cancelled' ? ' · отменено' : '')),
    list.length ? h('div', { class: 'wide chks' }, h('span', { class: 'h4' }, 'Подготовка'), ...list) : null,
    acts.length ? h('div', { class: 'wide dlg-acts' }, ...acts) : null].filter(Boolean) });
}
function reportFromPlan(e) {
  reportForm('events', null, { plan_id: e.id, plan_title: e.title, date: e.date <= today() ? e.date : today(),
    values: { title: e.title, kind: e.kind || '', place: e.place || '' } });
}
function planForm(e) {
  const owner = h('select', { id: 'p-owner' }, h('option', { value: '' }, '— не назначен —'),
    ...S.people.map((u) => h('option', { value: u.id }, u.name + (u.id === S.me.id ? ' (я)' : ''))));
  owner.value = e ? e.owner : '';
  const kind = h('select', { id: 'p-kind' }, h('option', { value: '' }, '— выберите —'), ...S.depts.events.fields.find((f) => f.k === 'kind').options.map((o) => h('option', { value: o }, o)));
  kind.value = e ? e.kind : '';
  const chk = h('textarea', { id: 'p-check', rows: 5, placeholder: 'Каждый пункт с новой строки' });
  chk.value = e ? e.checklist.map((c) => c.t).join('\n') : DEFAULT_CHECKLIST.join('\n');
  dialog({ title: e ? 'Изменить мероприятие' : 'Запланировать мероприятие', ok: e ? 'Сохранить' : 'Запланировать', body: [
    h('label', { class: 'fld wide' }, h('span', null, 'Название ', h('b', null, '*')), h('input', { id: 'p-title', maxlength: 200, value: e ? e.title : '' })),
    h('label', { class: 'fld' }, h('span', null, 'Дата ', h('b', null, '*')), h('input', { id: 'p-date', type: 'date', value: e ? e.date : '' })),
    h('label', { class: 'fld' }, h('span', null, 'Время'), h('input', { id: 'p-time', type: 'time', value: e ? e.time : '' })),
    h('label', { class: 'fld' }, h('span', null, 'Формат'), kind),
    h('label', { class: 'fld' }, h('span', null, 'Ответственный'), owner),
    h('label', { class: 'fld wide' }, h('span', null, 'Место'), h('input', { id: 'p-place', maxlength: 200, value: e ? e.place : '' })),
    h('label', { class: 'fld wide' }, h('span', null, 'Чек-лист подготовки'), chk),
    h('p', null, 'Ответственному придёт сообщение, а за 3 дня и накануне — напоминание с чек-листом.')],
  submit: async () => {
    const old = e ? e.checklist : [];
    const checklist = $('#p-check').value.split('\n').map((x) => x.trim()).filter(Boolean)
      .map((t) => ({ t, d: !!(old.find((c) => c.t === t) || {}).d }));
    const r = await api('planSave', { id: e ? e.id : '', title: $('#p-title').value, date: $('#p-date').value, time: $('#p-time').value,
      kind: kind.value, place: $('#p-place').value, owner: owner.value, checklist });
    S.cal = r.plan; renderView(); toast(e ? 'Сохранено' : 'Мероприятие в календаре');
  } });
}
async function planStatus(e, status) {
  try { S.cal = (await api('planStatus', { id: e.id, status })).plan; renderView(); toast(status === 'cancelled' ? 'Мероприятие отменено' : 'Снова в плане'); }
  catch (err) { toast(err.message); }
}
function planDelete(e) {
  dialog({ title: 'Удалить мероприятие?', ok: 'Удалить', danger: true, body: [h('p', null, `«${e.title}» пропадёт из календаря. Отчёты при этом не удаляются.`)],
    submit: async () => { S.cal = (await api('planDelete', { id: e.id })).plan; renderView(); toast('Удалено'); } });
}

// ---------- команда: поручения, рейтинг, сводка ----------
function renderTeam() {
  $('#task-add').hidden = !anyDept();
  $('#export-btn').hidden = !anyDept();
  $('#roadmap-btn').hidden = !anyDept();
  renderMe();
  const chat = $('#team-chat');
  chat.hidden = !S.team;
  if (S.team) chat.replaceChildren(h('p', { class: 'hint flush' }, S.team.chat
    ? h('span', null, '💬 Общий чат подключён' + (S.team.title ? ': «' + S.team.title + '»' : '') + '. Туда приходят новые отчёты, план мероприятий, напоминания накануне, итоги недели по ВК и сводка за месяц.')
    : h('span', null, '💬 Общий чат не подключён. Добавьте бота в групповой чат команды и отправьте там команду /bind — бот начнёт присылать туда новые отчёты, анонсы и сводки.')));
  renderWeek();
  renderTasks();
  renderRating();
}
// недельная отчётность: срок — пятница 17:00 по Омску
function renderWeek() {
  const box = $('#week-card'), w = S.week;
  box.hidden = !w || !w.leaders.length;
  if (box.hidden) return;
  const dl = new Date(w.deadline.slice(0, 10) + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
  const done = w.leaders.filter((l) => l.count).length;
  box.replaceChildren(
    h('div', { class: 'card-h' }, h('h3', { class: 'h3' }, 'Отчётность за неделю'), h('span', { class: 'pill ' + (done === w.leaders.length ? 'good' : '') }, `сдали ${done} из ${w.leaders.length}`)),
    h('p', { class: 'hint flush' }, `Срок — ${dl}, 17:00 по Омску. Бот напоминает в четверг в 17:00 и в пятницу утром тем, кто ещё не сдал.`),
    h('ul', { class: 'week' }, ...w.leaders.map((l) => h('li', { class: l.count ? 'ok' : 'miss' },
      h('span', { class: 'wk-mark', 'aria-hidden': 'true' }, l.count ? '✓' : '•'),
      h('span', null, h('b', null, l.dept_name), h('small', null, l.name)),
      h('span', { class: 'wk-st' }, l.count ? `отчётов: ${l.count}` : 'ещё нет')))));
}
function renderTasks() {
  const t = today();
  const mineN = S.tasks.filter((x) => x.to === S.me.id && x.status === 'open').length;
  if (!S.taskFilter) S.taskFilter = mineN ? 'mine' : 'open';
  const F = [['mine', 'Мои'], ['open', 'В работе'], ['done', 'Выполнены'], ['all', 'Все']];
  $('#task-chips').replaceChildren(...F.map(([k, l]) => h('button', { type: 'button', class: 'chip' + (S.taskFilter === k ? ' on' : ''), onclick: () => { S.taskFilter = k; renderTasks(); } }, l)));
  const list = S.tasks.filter((x) => S.taskFilter === 'all' || (S.taskFilter === 'mine' ? x.to === S.me.id && x.status === 'open' : x.status === S.taskFilter))
    .sort((a, b) => (a.status === b.status ? (a.status === 'open' ? a.due.localeCompare(b.due) : b.done_at.localeCompare(a.done_at)) : a.status === 'open' ? -1 : 1));
  const act = (label, cls, fn) => h('button', { type: 'button', class: 'btn small ' + cls, onclick: fn }, label);
  const run = (action, x, msg) => async () => {
    try { S.tasks = (await api(action, { id: x.id })).tasks; renderTasks(); renderRating(); toast(msg); } catch (e) { toast(e.message); }
  };
  $('#task-list').replaceChildren(...(list.length ? list.map((x) => {
    const late = x.status === 'open' && x.due < t;
    const btns = [];
    if (x.status === 'open' && (x.to === S.me.id || anyDept())) btns.push(act('✓ Готово', 'primary', run('taskDone', x, 'Отмечено как выполненное')));
    if (x.status === 'done' && anyDept()) btns.push(act('Вернуть', '', run('taskReopen', x, 'Снова в работе')));
    if (anyDept()) btns.push(act('Удалить', 'danger', () => dialog({ title: 'Удалить поручение?', ok: 'Удалить', danger: true, body: [h('p', null, `«${x.text}» будет удалено.`)],
      submit: async () => { S.tasks = (await api('taskDelete', { id: x.id })).tasks; renderTasks(); toast('Удалено'); } })));
    return h('li', { class: 'task ' + (x.status === 'done' ? 'done' : late ? 'late' : '') },
      h('span', { class: 'tk-mark', 'aria-hidden': 'true' }, x.status === 'done' ? '✓' : ''),
      h('span', { class: 'tk-body' }, h('b', null, x.text),
        h('small', null, x.to_name + ' · ' + (x.status === 'done' ? 'выполнено ' + dateLabel(x.done_at.slice(0, 10)) : (late ? 'просрочено, срок был ' : 'до ') + dateLabel(x.due)) + (x.by_name ? ' · от ' + x.by_name : '')),
        x.comment ? h('small', { class: 'tk-c' }, '💬 ' + x.comment) : null),
      btns.length ? h('span', { class: 'acts' }, ...btns) : null);
  }) : [h('li', { class: 'none' }, S.taskFilter === 'mine' ? 'У вас нет открытых поручений 👌' : 'Здесь пока пусто.')]));
}
function taskForm() {
  const to = h('select', { id: 't-to' }, h('option', { value: '' }, '— выберите —'), ...S.people.map((u) => h('option', { value: u.id }, u.name + ' · ' + (ROLE_NAMES[u.role] || u.role))));
  const due = new Date(Date.now() + 3 * 864e5);
  dialog({ title: 'Новое поручение', ok: 'Поставить', body: [
    h('label', { class: 'fld wide' }, h('span', null, 'Что сделать ', h('b', null, '*')), h('textarea', { id: 't-text', maxlength: 300, rows: 3 })),
    h('label', { class: 'fld' }, h('span', null, 'Исполнитель ', h('b', null, '*')), to),
    h('label', { class: 'fld' }, h('span', null, 'Срок ', h('b', null, '*')), h('input', { id: 't-due', type: 'date', value: due.toISOString().slice(0, 10) })),
    h('p', null, 'Исполнителю сразу придёт сообщение с кнопкой «Готово», накануне и в день срока — напоминание.')],
  submit: async () => {
    if (!to.value) throw new Error('Выберите исполнителя');
    S.tasks = (await api('taskAdd', { to: to.value, text: $('#t-text').value, due: $('#t-due').value })).tasks;
    S.taskFilter = 'open'; renderTasks(); toast('Поручение отправлено');
  } });
}
$('#task-add').addEventListener('click', taskForm);

function ratePeriod() {
  const d = new Date(), cur = monthKey(d), prev = monthKey(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  return S.ratePeriod === 'month' ? (x) => x.slice(0, 7) === cur : S.ratePeriod === 'prev' ? (x) => x.slice(0, 7) === prev : () => true;
}
function renderRating() {
  const P = [['month', 'Этот месяц'], ['prev', 'Прошлый'], ['all', 'Весь сезон']];
  $('#rate-chips').replaceChildren(...P.map(([k, l]) => h('button', { type: 'button', class: 'chip' + (S.ratePeriod === k ? ' on' : ''), onclick: () => { S.ratePeriod = k; renderRating(); } }, l)));
  const inP = ratePeriod(), M = {};
  const get = (id, name) => { const k = id || 'n:' + name; return M[k] || (M[k] = { name, reports: 0, people: 0, done: 0, onTime: 0 }); };
  for (const r of S.reports) {
    if (!inP(r.date) || !r.author_name) continue;
    const p = get(r.author, r.author_name);
    p.reports++; p.people += (r.values.new_members || 0) + (r.values.new_people || 0);
  }
  for (const x of S.tasks) {
    if (x.status !== 'done' || !x.done_at || !inP(x.done_at)) continue;
    const p = get(x.to, x.to_name);
    p.done++; if (x.done_at.slice(0, 10) <= x.due) p.onTime++;
  }
  const rows = Object.values(M).map((p) => Object.assign(p, { pts: p.reports * 2 + p.people + p.onTime * 3 + (p.done - p.onTime) })).sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  const medal = ['🥇', '🥈', '🥉'];
  $('#rate-body').replaceChildren(...(rows.length ? rows.map((p, i) => h('tr', { class: p.name === S.me.name ? 'cur' : '' },
    h('td', null, medal[i] || String(i + 1)), h('td', null, p.name), h('td', { class: 'num' }, fmt(p.reports)), h('td', { class: 'num' }, fmt(p.people)),
    h('td', { class: 'num' }, p.done ? `${p.onTime} / ${p.done}` : '—'), h('td', { class: 'num' }, h('b', null, fmt(p.pts)))))
    : [h('tr', null, h('td', { colspan: 6, class: 'empty-val' }, 'За этот период активности пока нет.'))]));
}

function summaryDialog() {
  const months = S.plan.map((p) => p.month).filter((m) => m <= monthKey()).reverse();
  const sel = h('select', { id: 'sum-month' }, ...(months.length ? months : [monthKey()]).map((m) => h('option', { value: m }, monthLabel(m))));
  const pre = h('pre', { class: 'sum-text wide' }, 'Загрузка…');
  const load = async () => { pre.textContent = 'Загрузка…'; try { pre.textContent = (await api('summary', { month: sel.value })).text; } catch (e) { pre.textContent = e.message; } };
  sel.onchange = load;
  dialog({ title: 'Сводка за месяц', ok: 'Скопировать текст', body: [h('label', { class: 'fld wide' }, h('span', null, 'Месяц'), sel), pre,
    h('p', null, 'Готовый текст для руководства. 1-го числа бот сам присылает сводку за прошлый месяц администратору и заму.')],
  submit: async () => {
    try { await navigator.clipboard.writeText(pre.textContent); toast('Текст скопирован'); }
    catch { throw new Error('Не получилось скопировать — выделите текст и скопируйте вручную'); }
  } });
  load();
}
$('#sum-btn').addEventListener('click', summaryDialog);
$('#export-btn').addEventListener('click', exportDialog);
$('#roadmap-btn').addEventListener('click', roadmapDialog);

// ---------- личные показатели и цели ----------
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
function metricVals(dept, from, to) {
  const reps = S.reports.filter((r) => r.dept === dept && r.date >= from && r.date <= to)
    .sort((a, b) => (a.date + a.created).localeCompare(b.date + b.created));
  const out = {};
  for (const [k, , how] of S.depts[dept].metrics) {
    if (how === 'count') out[k] = reps.length;
    else if (how === 'sum') out[k] = reps.reduce((t, r) => t + (r.values[k] || 0), 0);
    else { let v = null; for (const r of reps) if (r.values[k] !== undefined) v = r.values[k]; out[k] = v; }
  }
  return out;
}
function leaders() { return S.people.length ? S.people.filter((u) => DEPT_ORDER.includes(u.role)) : (DEPT_ORDER.includes(S.me.role) ? [S.me] : []); }
function renderMe() {
  const box = $('#me-card');
  const list = DEPT_ORDER.includes(S.me.role) ? [S.me] : anyDept() ? leaders() : [];
  box.hidden = !list.length;
  if (!list.length) return;
  if (!S.meUser || !list.some((u) => u.id === S.meUser)) S.meUser = list[0].id;
  const u = list.find((x) => x.id === S.meUser), dept = u.role;
  const t = today(), month = t.slice(0, 7), day = +t.slice(8, 10);
  const pmEnd = shift(month + '-01', -1), pm = pmEnd.slice(0, 7), pmDay = Math.min(day, +pmEnd.slice(8, 10));
  const w1 = metricVals(dept, shift(t, -6), t), w0 = metricVals(dept, shift(t, -13), shift(t, -7));
  const m1 = metricVals(dept, month + '-01', t), m0 = metricVals(dept, pm + '-01', pm + '-' + String(pmDay).padStart(2, '0'));
  const goals = (S.goals || []).filter((g) => g.user === u.id && g.month === month);
  const delta = (c, p, how) => {
    if (c === null || p === null || how === 'last') return null;
    const d = c - p;
    return h('span', { class: 'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') }, (d > 0 ? '+' : d < 0 ? '−' : '±') + fmt(Math.abs(d)));
  };
  const rows = S.depts[dept].metrics.map(([k, label, how]) => {
    const g = goals.find((x) => x.k === k);
    const pct = g ? Math.round(((m1[k] || 0) / g.v) * 100) : null;
    return h('tr', null, h('td', null, label),
      h('td', { class: 'num' }, fmt(w1[k]), ' ', delta(w1[k], w0[k], how)),
      h('td', { class: 'num' }, fmt(m1[k]), ' ', delta(m1[k], m0[k], how)),
      h('td', null, g ? h('span', { class: 'goal' }, h('span', { class: 'gbar' }, h('i', { style: `width:${Math.min(100, pct)}%`, class: pct >= 100 ? 'done' : '' })), `${fmt(m1[k] || 0)} из ${fmt(g.v)}`) : h('span', { class: 'empty-val' }, '—')));
  });
  const my = S.tasks.filter((x) => x.to === u.id);
  const open = my.filter((x) => x.status === 'open'), late = open.filter((x) => x.due < t);
  const doneM = my.filter((x) => x.status === 'done' && x.done_at.slice(0, 7) === month);
  const onTime = doneM.filter((x) => x.done_at.slice(0, 10) <= x.due).length;
  const wk = S.week && S.week.leaders.find((l) => l.id === u.id);
  box.replaceChildren(
    h('div', { class: 'card-h' }, h('h3', { class: 'h3' }, list.length > 1 ? 'Показатели руководителей' : 'Мои показатели'),
      anyDept() ? h('button', { type: 'button', class: 'btn small', onclick: () => goalForm(u) }, '🎯 Цели на месяц') : null),
    list.length > 1 ? h('div', { class: 'chips' }, ...list.map((x) => h('button', { type: 'button', class: 'chip d-' + x.role + (x.id === u.id ? ' on' : ''), onclick: () => { S.meUser = x.id; renderMe(); } },
      h('i', { class: 'dot' }), x.name))) : null,
    h('p', { class: 'hint flush' }, `${u.name} · ${S.depts[dept].name}. Рядом с числом — разница с прошлыми 7 днями и с 1–${pmDay} ${MON[+pm.slice(5, 7) - 1]}.`),
    h('div', { class: 'tablewrap' }, h('table', { class: 'table metrics' },
      h('thead', null, h('tr', null, h('th', null, 'Показатель'), h('th', { class: 'num' }, '7 дней'), h('th', { class: 'num' }, 'С начала месяца'), h('th', null, 'Цель на месяц'))),
      h('tbody', null, ...rows))),
    h('div', { class: 'mini' },
      stat('Поручений в работе', String(open.length) + (late.length ? ` · ${late.length} просроч.` : ''), late.length ? 'down' : ''),
      stat('Выполнено в этом месяце', doneM.length ? `${doneM.length} (в срок ${onTime})` : '0'),
      stat('Отчётность за неделю', wk ? (wk.count ? '✓ сдана' : 'ещё нет') : '—', wk && wk.count ? 'up' : wk ? 'down' : '')));
}
function goalForm(u) {
  const month = today().slice(0, 7);
  const cur = Object.fromEntries((S.goals || []).filter((g) => g.user === u.id && g.month === month).map((g) => [g.k, g.v]));
  dialog({ title: 'Цели на ' + monthLabel(month).toLowerCase(), ok: 'Сохранить', body: [
    h('p', null, `${u.name} · ${S.depts[u.role].name}. Пустое поле — без цели. Руководителю придёт сообщение с целями.`),
    ...S.depts[u.role].metrics.map(([k, label]) => h('label', { class: 'fld' }, h('span', null, label),
      h('input', { id: 'g-' + k, type: 'number', min: 0, step: 1, inputmode: 'numeric', value: cur[k] ?? '' })))],
  submit: async () => {
    const values = {};
    for (const [k] of S.depts[u.role].metrics) { const x = $('#g-' + k).value.trim(); if (x !== '') values[k] = Number(x); }
    S.goals = (await api('goalSet', { user: u.id, month, values })).goals;
    renderMe(); toast('Цели сохранены');
  } });
}

// ---------- выгрузка и дорожная карта ----------
function exportDialog() {
  const m = monthKey(), pm = monthKey(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
  const sel = h('select', { id: 'x-period' }, h('option', { value: m }, monthLabel(m)), h('option', { value: pm }, monthLabel(pm)), h('option', { value: 'season' }, 'Весь сезон'));
  dialog({ title: 'Выгрузка в Excel и PDF', ok: 'Выгрузить', body: [
    h('label', { class: 'fld wide' }, h('span', null, 'Период'), sel),
    h('p', null, 'Бот пришлёт два файла в ваш чат с ним: Excel (план и факт по месяцам, все отчёты, поручения, мероприятия) и PDF для печати. Таблица также сохранится на Google Диске в папке «Молодёжка — выгрузки». Подготовка занимает до минуты.')],
  submit: async () => {
    $('#dlg-ok').textContent = 'Готовлю…';
    await api('export', { period: sel.value });
    toast('Готово — файлы в чате с ботом');
  } });
}
function roadmapDialog() {
  const m = monthKey(), nm = monthKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
  const months = S.plan.map((p) => p.month).filter((x) => x === m || x === nm);
  if (!months.length) return toast('В дорожной карте нет плана на этот месяц');
  const sel = h('select', { id: 'r-month' }, ...months.map((x) => h('option', { value: x }, monthLabel(x))));
  dialog({ title: 'Дорожная карта → поручения', ok: 'Создать поручения', body: [
    h('label', { class: 'fld wide' }, h('span', null, 'Месяц'), sel),
    h('p', null, 'Пункты плана месяца станут поручениями руководителям: «Набор актива» — Работе с людьми, «ВК и TikTok» — Медиа, «Мероприятия» — Мероприятиям. Срок — последний день месяца. Повторный запуск не создаёт дублей. 1-го числа бот делает это сам.')],
  submit: async () => {
    const r = await api('roadmapTasks', { month: sel.value });
    S.tasks = r.tasks; S.taskFilter = 'open'; renderTeam(); toast(r.text.split('\n')[0]);
  } });
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
function dialog({ title, body, ok, danger, submit, info }) {
  const d = $('#dlg');
  $('#dlg-cancel').hidden = !!info;
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

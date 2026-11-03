import { LANGS, UI } from './i18n.js';

/* ------------------------------------------------------------------ setup */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = { lang: pickLang(), data: null, instFilter: 'all', acadTab: 'article', map: null, markers: {}, showAllRoles: false };

function pickLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(q)) return q;
  const saved = store.get('lang');
  if (LANGS.includes(saved)) return saved;
  const nav = (navigator.language || 'en').slice(0, 2);
  return LANGS.includes(nav) ? nav : 'en';
}
const t = (key, vars = {}) => (UI[state.lang][key] ?? UI.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
// Pick the visitor's language from a {en, es, fr} object, falling back to English.
const ROLES = ['installed', 'managed', 'assisted'];
const roleOf = x => (ROLES.includes(x.role_type) ? x.role_type : 'installed');
const tx = (o) => (o == null ? '' : typeof o === 'string' ? o : (o[state.lang] || o.en || ''));

// Resolve a media path from the CMS ("media/x.jpg" or "/media/x.jpg") relative to the site.
function asset(p) {
  if (!p) return '';
  if (/^(https?:)?\/\//.test(p) || p.startsWith('data:')) return p;
  return new URL(p.replace(/^\/+/, ''), document.baseURI).href;
}

/* ------------------------------------------------------------ data load */
const FILES = ['site', 'experience', 'installations', 'gallery', 'news', 'academic', 'projects'];
async function load() {
  const res = await Promise.all(FILES.map(f => fetch(`content/${f}.json`, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null)).catch(() => null)));
  const d = Object.fromEntries(FILES.map((f, i) => [f, res[i] ?? (f === 'site' ? {} : [])]));
  return d;
}

/* --------------------------------------------------------------- dates */
function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = String(ym).split('-').map(Number);
  if (!m) return String(y);
  return new Intl.DateTimeFormat(state.lang, { month: 'short', year: 'numeric' }).format(new Date(y, m - 1, 1));
}
function fmtRange(a, b) {
  if (a && b && a === b) return fmtMonth(a);
  return `${fmtMonth(a)} – ${b ? fmtMonth(b) : t('exp.present')}`;
}

/* --------------------------------------------------------------- media */
function normMedia(list = []) {
  return (list || []).map(m => {
    const file = Array.isArray(m.file) ? m.file[0] : m.file;
    const url = (m.url || '').trim();
    const caption = tx(m.caption);
    if (url) {
      const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
      if (yt) return { kind: 'youtube', id: yt[1], src: url, caption, thumb: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` };
      const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      if (vm) return { kind: 'vimeo', id: vm[1], src: url, caption };
      return { kind: kindOf(url), src: url, caption };
    }
    if (!file) return null;
    return { kind: kindOf(file), src: asset(file), caption };
  }).filter(Boolean);
}
function kindOf(p) {
  const ext = (p.split('?')[0].split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'link';
}
function thumbsHTML(media, group) {
  if (!media.length) return '';
  return `<div class="thumbs">${media.map((m, i) => {
    let inner = '';
    if (m.kind === 'image') inner = `<img src="${esc(m.src)}" alt="${esc(m.caption)}" loading="lazy" decoding="async">`;
    else if (m.kind === 'youtube') inner = `${art(m.id, 'other')}<img src="${esc(m.thumb)}" alt="" loading="lazy" style="position:absolute;inset:0" onerror="this.remove()"><span class="play"></span>`;
    else if (m.kind === 'video') inner = `<video src="${esc(m.src)}#t=0.5" muted playsinline preload="metadata"></video><span class="play"></span>`;
    else if (m.kind === 'vimeo') inner = `${art(m.id, 'other')}<span class="play"></span>`;
    else if (m.kind === 'pdf') inner = `<span class="doc">PDF</span>`;
    else inner = `<span class="doc link">${esc(m.caption || t('media.link'))} ↗</span>`;
    return `<button class="thumb" data-group="${esc(group)}" data-i="${i}" aria-label="${esc(m.caption || m.kind)}">${inner}</button>`;
  }).join('')}</div>`;
}
const mediaGroups = new Map();
function registerMedia(group, media) { mediaGroups.set(group, media); return thumbsHTML(media, group); }

/* -------------------------------------------- generative placeholder art */
const PALETTES = [
  ['#3e5a3a', '#6b8f4e', '#e9dfc8'], ['#6b4a2f', '#a7754a', '#f1e3c7'], ['#2f4b55', '#6e95a8', '#e6eef0'],
  ['#4a5a2c', '#8fa65a', '#eef0d8'], ['#7a3e24', '#b5643c', '#f6e2cf']
];
const ICONS = {
  'eddy-covariance': 'M32 8v48M24 56h16M32 18h14M32 18l-8-6M46 18l3-4M46 18l3 4M32 30h-12',
  meteorology: 'M32 10v44M24 54h16M32 16h16M44 12l4 4-4 4M32 26c-6 0-10 3-10 7',
  'soil-respiration': 'M14 44h36M18 44v-10h28v10M24 34v-6h16v6M14 50h36',
  power: 'M14 24h36v18H14zM50 30h4v6h-4M28 24l-4 10h8l-4 8',
  radiation: 'M32 18a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM32 8v4M32 44v4M14 28h4M46 28h4',
  aerosol: 'M16 40c6 0 6-6 12-6s6 6 12 6 6-6 12-6M20 26a2 2 0 1 0 0 .1M32 20a2 2 0 1 0 0 .1M42 28a2 2 0 1 0 0 .1',
  'surface-renewal': 'M12 46c8-10 14-10 20 0s12 10 20 0M32 10v26M26 16h12',
  other: 'M20 44l12-24 12 24z',
  code: 'M24 20l-12 12 12 12M40 20l12 12-12 12M36 14l-8 36'
};
function hash(s = '') { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function rng(seed) { let x = seed || 1; return () => ((x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909)) >>> 0) / 4294967296; }
function art(seed, type = 'other') {
  const r = rng(hash(seed)); const [a, b, c] = PALETTES[hash(seed) % PALETTES.length];
  const cx = 60 + r() * 200, cy = 40 + r() * 120; const ph = [r() * 6, r() * 6, r() * 6];
  let paths = '';
  for (let k = 1; k <= 11; k++) {
    const base = k * 26; let d = '';
    for (let i = 0; i <= 64; i++) {
      const th = (i / 64) * Math.PI * 2;
      const rr = base * (1 + .14 * Math.sin(3 * th + ph[0]) + .08 * Math.sin(5 * th + ph[1] + k * .2) + .04 * Math.sin(7 * th + ph[2]));
      d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(th)).toFixed(1)} ${(cy + rr * Math.sin(th) * .8).toFixed(1)}`;
    }
    paths += `<path d="${d}Z"/>`;
  }
  const icon = ICONS[type] || ICONS.other;
  return `<svg class="art" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="g${hash(seed)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#g${hash(seed)})"/>
    <g fill="none" stroke="${c}" stroke-opacity=".28" stroke-width="1">${paths}</g>
    <g transform="translate(128 68)" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".92"><path d="${icon}"/></g>
  </svg>`;
}

/* ----------------------------------------------------------------- hero */
function renderHero(site) {
  $('#heroName').textContent = site.name || '';
  $('#heroHeadline').textContent = tx(site.headline);
  $('#heroTagline').textContent = tx(site.tagline);
  $('#heroLocation').textContent = site.location || '';
  const cv = $('#cvBtn'); if (site.cv_file) cv.href = asset(site.cv_file); else cv.hidden = true;
  const bg = $('#heroBg');
  const heroSrc = (matchMedia('(max-width: 760px)').matches && site.hero_image_mobile) ? site.hero_image_mobile : site.hero_image;
  if (heroSrc && bg.dataset.src !== heroSrc) {
    bg.dataset.src = heroSrc;
    const img = new Image(); img.decoding = 'async';
    img.onload = () => { bg.style.backgroundImage = `url("${asset(heroSrc)}")`; bg.classList.add('loaded'); };
    img.src = asset(heroSrc);
  }
}

/* ---------------------------------------------------------------- about */
function renderAbout(site) {
  $('#aboutText').innerHTML = tx(site.about).split(/\n\s*\n/).filter(Boolean).map(p => `<p>${esc(p.trim())}</p>`).join('');
  const portrait = $('#portrait');
  if (site.photo) portrait.innerHTML = `<img src="${esc(asset(site.photo))}" alt="${esc(site.name)}" loading="lazy">`;
  else {
    const ini = (site.name || 'DT').split(/\s+/).filter(Boolean); const initials = (ini[0]?.[0] || '') + (ini[2]?.[0] || ini[1]?.[0] || '');
    portrait.innerHTML = `${art('portrait-' + site.name, 'other').replace(/<g transform[\s\S]*?<\/g>/, '')}<span class="initials" style="position:relative">${esc(initials)}</span>`;
  }
  const inst = state.data?.installations || [];
  const counted = { all: inst.length }; ROLES.forEach(r => (counted[r] = inst.filter(x => roleOf(x) === r).length));
  $('#stats').innerHTML = (site.stats || []).map(s => `<div class="stat"><b>${esc(s.count && inst.length ? String(counted[s.count] ?? s.value) : s.value)}</b><span>${esc(tx(s.label))}</span></div>`).join('');
  renderRecord(inst);
  $('#skills').innerHTML = (site.skills || []).map(g => `<div class="skill-group"><h3>${esc(tx(g.group))}</h3>
    <ul class="chips">${(Array.isArray(g.items) ? g.items : tx(g.items).split('\n')).map(i => String(i).trim()).filter(Boolean).map(i => `<li class="chip">${esc(i)}</li>`).join('')}</ul></div>`).join('');
  const langs = site.languages || [];
  $('#langs').innerHTML = langs.length ? `<span>${esc(t('about.languages'))}:</span>` + langs.map(l => `<span><b>${esc(tx(l.name))}</b> · ${esc(tx(l.level))}</span>`).join('') : '';
}

/* ----------------------------------------------------------- experience */
const VISIBLE_ROLES = 8;
// Station record under the portrait: what I installed (by country) and what I manage.
function renderRecord(inst) {
  const box = $('#record'); if (!box) return;
  if (!inst.length) { box.hidden = true; return; }
  box.hidden = false;
  const sorted = [...inst].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const chip = x => `<button class="rec-chip" data-open="${esc(x.slug)}" title="${esc(tx(x.title))}">${esc(x.short || x.site || tx(x.title))}</button>`;
  const country = x => (x.region || '').split(',').pop().trim();
  const installed = sorted.filter(x => roleOf(x) === 'installed');
  const managed = sorted.filter(x => roleOf(x) === 'managed');
  const assisted = sorted.filter(x => roleOf(x) === 'assisted');
  const countries = [...new Set(installed.map(country))];
  const cname = c => { const k = 'country.' + c.toLowerCase(); const v = t(k); return v === k ? c : v; };
  box.innerHTML = `<h3>${esc(t('rec.title'))}</h3>
    <div class="rec-group"><p class="rec-h"><span class="pin installed"></span>${esc(t('rec.installed'))} <span class="n">${installed.length}</span></p>
      ${countries.map(c => `<p class="rec-country">${esc(cname(c))}</p><div class="rec-chips">${installed.filter(x => country(x) === c).map(chip).join('')}</div>`).join('')}
    </div>
    ${managed.length ? `<div class="rec-group"><p class="rec-h"><span class="pin managed"></span>${esc(t('rec.managed'))} <span class="n">${managed.length}</span></p>
      <div class="rec-chips">${managed.map(chip).join('')}</div></div>` : ''}
    ${assisted.length ? `<div class="rec-group"><p class="rec-h"><span class="pin assisted"></span>${esc(t('rec.assisted'))} <span class="n">${assisted.length}</span></p>
      <div class="rec-chips">${assisted.map(chip).join('')}</div></div>` : ''}
    <p class="rec-note">${esc(t('rec.note'))}</p>`;
}

function renderExperience(jobs) {
  const sorted = [...jobs].sort((a, b) => (b.end ? 0 : 1) - (a.end ? 0 : 1) || String(b.start).localeCompare(String(a.start)));
  const tl = $('#timeline');
  tl.classList.toggle('show-all', state.showAllRoles);
  tl.innerHTML = sorted.map((j, i) => {
    const id = `job-${i}`;
    const points = tx(j.highlights).split('\n').map(s => s.trim()).filter(Boolean);
    const media = normMedia(j.media);
    const hasMore = points.length || media.length || (j.tags || []).length || j.url;
    return `<li class="job ${j.end ? '' : 'current'} ${i >= VISIBLE_ROLES ? 'hidden-role' : ''} reveal">
      <article class="job-card" data-open="false">
        <button class="job-head" ${hasMore ? `aria-expanded="false" aria-controls="${id}"` : 'disabled style="cursor:default"'}>
          <span class="job-dates">${esc(fmtRange(j.start, j.end))}</span>
          <span class="job-role">${esc(tx(j.role))}</span>
          <span class="job-org">${esc(j.org)}${j.location ? ` <small>· ${esc(j.location)}</small>` : ''}</span>
          ${hasMore ? `<span class="job-toggle"><span class="lbl">${esc(t('exp.details'))}</span><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>` : ''}
          <span class="job-summary">${esc(tx(j.summary))}</span>
        </button>
        ${hasMore ? `<div class="job-more" id="${id}" role="region"><div><div class="job-more-inner">
          ${points.length ? `<ul class="points">${points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
          ${registerMedia(id, media)}
          ${(j.tags || []).length ? `<ul class="chips">${j.tags.map(x => `<li class="chip">${esc(x)}</li>`).join('')}</ul>` : ''}
          ${j.url ? `<p style="margin:12px 0 0"><a class="job-link" href="${esc(j.url)}" target="_blank" rel="noopener">${esc(t('exp.website'))} ↗</a></p>` : ''}
        </div></div></div>` : ''}
      </article></li>`;
  }).join('');
  const btn = $('#moreRoles'); const extra = Math.max(0, sorted.length - VISIBLE_ROLES);
  btn.hidden = !extra; btn.textContent = state.showAllRoles ? t('exp.fewer') : t('exp.more', { n: extra });
}

/* -------------------------------------------------------- installations */
function instSorted() { return [...state.data.installations].sort((a, b) => String(b.date).localeCompare(String(a.date))); }
function instVisible() { return instSorted().filter(x => state.instFilter === 'all' || (x.types || []).includes(state.instFilter)); }
function renderInstFilters() {
  const all = state.data.installations; const counts = {};
  all.forEach(x => (x.types || []).forEach(ty => (counts[ty] = (counts[ty] || 0) + 1)));
  const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const colors = ['var(--moss)', 'var(--clay)', 'var(--sky)', 'var(--peat)', 'var(--sphagnum)', '#9a7fb0', '#c9a227', '#7c8a90'];
  $('#instFilters').innerHTML = [`<button class="filter" data-f="all" aria-pressed="${state.instFilter === 'all'}">${esc(t('inst.all'))} <span class="count">${all.length}</span></button>`]
    .concat(types.map((ty, i) => `<button class="filter" data-f="${esc(ty)}" aria-pressed="${state.instFilter === ty}"><span class="dot" style="background:${colors[i % colors.length]}"></span>${esc(t('type.' + ty))} <span class="count">${counts[ty]}</span></button>`)).join('');
}
function renderInstallations() {
  const list = instVisible();
  $('#instCards').innerHTML = list.length ? list.map(x => {
    const media = normMedia(x.media);
    const cover = x.cover ? `<img src="${esc(asset(x.cover))}" alt="${esc(tx(x.title))}" loading="lazy" decoding="async">` : art(x.slug, (x.types || [])[0]);
    return `<button class="card reveal" data-slug="${esc(x.slug)}">
      <div class="card-media">${cover}<div class="ribbon">${(x.types || []).slice(0, 2).map(ty => `<span class="tag">${esc(t('type.' + ty))}</span>`).join('')}</div></div>
      <div class="card-body">
        <div class="card-meta"><span class="when">${esc(fmtMonth(x.date))}</span><span class="where">${esc(x.region || '')}</span></div>
        <h3>${esc(tx(x.title))}</h3>
        <p>${esc(tx(x.summary))}</p>
        <div class="card-foot"><span class="role-badge ${roleOf(x)}">${esc(t('role.' + roleOf(x)))}</span>${x.network_id ? `<span class="chip">${esc(x.network_id)}</span>` : ''}${media.length ? `<span class="count-media">▣ ${esc(t('inst.media', { n: media.length }))}</span>` : ''}</div>
      </div></button>`;
  }).join('') : `<p class="empty">${esc(t('inst.none'))}</p>`;
  updateMarkers();
  observeReveals();
}
function openInstallation(slug, push = true) {
  const x = state.data.installations.find(i => i.slug === slug); if (!x) return;
  const media = normMedia(x.media); const group = 'inst-' + slug; mediaGroups.set(group, media);
  const cover = x.cover ? `<img src="${esc(asset(x.cover))}" alt="">` : art(x.slug, (x.types || [])[0]);
  const coords = x.lat != null && x.lon != null ? `${Number(x.lat).toFixed(4)}, ${Number(x.lon).toFixed(4)}${x.approximate ? ' (≈)' : ''}` : '';
  $('#modalBody').innerHTML = `
    <div class="modal-hero">${cover}<div class="ttl"><p class="eyebrow" style="margin:0 0 8px">${esc(fmtMonth(x.date))} · ${esc(x.site || '')}</p><h3 id="modalTitle">${esc(tx(x.title))}</h3></div></div>
    <div class="modal-content">
      <div>
        <p style="font-size:17px">${esc(tx(x.summary))}</p>
        ${tx(x.description) ? `<p>${esc(tx(x.description))}</p>` : ''}
        ${media.length ? `<h4 style="margin:22px 0 4px;font-size:17px">${esc(t('inst.gallery'))}</h4>${thumbsHTML(media, group)}` : ''}
      </div>
      <aside class="facts">
        ${tx(x.involvement) ? `<div class="fact"><span>${esc(t('inst.role'))}</span><span class="role-badge ${roleOf(x)}">${esc(t('role.' + roleOf(x)))}</span><br>${esc(tx(x.involvement))}</div>` : ''}
        <div class="fact"><span>${esc(t('inst.location'))}</span>${esc(x.region || '')}${coords ? `<br><small style="color:var(--muted)">${esc(coords)}</small>` : ''}</div>
        ${x.network_id ? `<div class="fact"><span>${esc(t('inst.network'))}</span>${esc(x.network_id)}</div>` : ''}
        ${(x.equipment || []).length ? `<div class="fact"><span>${esc(t('inst.equipment'))}</span><ul class="equip">${x.equipment.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        ${(x.links || []).length ? `<div class="fact"><span>${esc(t('inst.links'))}</span>${x.links.map(l => `<a class="job-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('<br>')}</div>` : ''}
        ${coords ? `<button class="btn ghost small" data-map="${esc(slug)}">${esc(t('inst.map'))}</button>` : ''}
      </aside>
    </div>`;
  const dlg = $('#modal'); if (!dlg.open) dlg.showModal(); dlg.scrollTop = 0;
  if (push) history.replaceState(null, '', `#installation/${slug}`);
}

/* ------------------------------------------------------------------ map */
let leafletPromise;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ||= new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet';
    css.href = 'assets/vendor/leaflet/leaflet.css'; document.head.append(css);
    const mc = document.createElement('link'); mc.rel = 'stylesheet';
    mc.href = 'assets/vendor/markercluster/MarkerCluster.css'; document.head.append(mc);
    const s = document.createElement('script'); s.src = 'assets/vendor/leaflet/leaflet.js';
    s.onload = () => {
      const c = document.createElement('script'); c.src = 'assets/vendor/markercluster/leaflet.markercluster.js';
      c.onload = () => res(window.L); c.onerror = () => res(window.L); document.head.append(c);
    };
    s.onerror = rej; document.head.append(s);
  });
  return leafletPromise;
}
async function initMap() {
  try {
    const L = await loadLeaflet();
    const map = L.map('map', { scrollWheelZoom: false, worldCopyJump: true, zoomControl: true, attributionControl: true }).setView([0, -70], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    map.on('focus', () => map.scrollWheelZoom.enable()); map.on('blur', () => map.scrollWheelZoom.disable());
    // On touch screens one finger scrolls the page; a tap on the map unlocks panning.
    if (matchMedia('(pointer: coarse)').matches) {
      map.dragging.disable(); state.mapLocked = true;
      map.once('click', () => { map.dragging.enable(); state.mapLocked = false; updateHint(); });
    }
    state.map = map; updateMarkers(true);
  } catch {
    $('#map').innerHTML = `<div class="map-fallback">${esc(t('inst.nomap'))}</div>`; $('#map').classList.add('failed');
  }
}
function updateHint() { $('#mapHint').textContent = state.mapLocked ? t('inst.tapmap') : ''; }
function updateLegend() {
  const L = window.L; const map = state.map; if (!L || !map) return;
  if (state.legend) state.legend.remove();
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const d = L.DomUtil.create('div', 'map-legend');
    d.innerHTML = `<div><span class="pin installed"></span>${esc(t('legend.installed'))}</div>
      <div><span class="pin managed"></span>${esc(t('legend.managed'))}</div>
      ${state.data.installations.some(x => roleOf(x) === 'assisted') ? `<div><span class="pin assisted"></span>${esc(t('legend.assisted'))}</div>` : ''}
      <div><span class="pin installed approx"></span>${esc(t('legend.approx'))}</div>
      <div><span class="cluster-dot">3</span>${esc(t('legend.cluster'))}</div>`;
    L.DomEvent.disableClickPropagation(d); return d;
  };
  legend.addTo(map); state.legend = legend;
}
function updateMarkers(fit = true) {
  const L = window.L; const map = state.map; if (!L || !map) return;
  if (state.cluster) { state.cluster.remove(); state.cluster = null; }
  Object.values(state.markers).forEach(m => m.remove()); state.markers = {};
  const layer = L.markerClusterGroup ? L.markerClusterGroup({
    maxClusterRadius: 44, showCoverageOnHover: false, spiderfyOnMaxZoom: true, zoomToBoundsOnClick: true,
    iconCreateFunction: c => L.divIcon({ className: 'cluster-wrap', html: `<span class="cluster">${c.getChildCount()}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] })
  }) : L.layerGroup();
  const pts = [];
  instVisible().filter(x => x.lat != null && x.lon != null).forEach(x => {
    const role = roleOf(x);
    const icon = L.divIcon({ className: 'pin-wrap', html: `<div class="pin ${role} ${x.approximate ? 'approx' : ''}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    const m = L.marker([x.lat, x.lon], { icon, title: tx(x.title), keyboard: true });
    m.bindPopup(`<b>${esc(tx(x.title))}</b><span style="color:var(--muted)">${esc(fmtMonth(x.date))} · ${esc(x.region || '')}</span><br><span class="role-badge ${role}">${esc(t('role.' + role))}</span><br><button data-open="${esc(x.slug)}">${esc(t('inst.details'))}</button>`);
    layer.addLayer(m); state.markers[x.slug] = m; pts.push([x.lat, x.lon]);
  });
  layer.addTo(map); state.cluster = layer;
  updateLegend(); updateHint();
  if (fit && pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 9, animate: !reduceMotion });
}
function showOnMap(slug) {
  $('#modal').close();
  const go = () => {
    const m = state.markers[slug]; if (!m) return;
    if (state.cluster && state.cluster.zoomToShowLayer) state.cluster.zoomToShowLayer(m, () => { state.map.setView(m.getLatLng(), Math.max(state.map.getZoom(), 12)); m.openPopup(); });
    else { state.map.flyTo(m.getLatLng(), 12, { duration: reduceMotion ? 0 : 1.2 }); setTimeout(() => m.openPopup(), reduceMotion ? 0 : 1200); }
  };
  $('#map').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  if (!state.markers[slug]) { state.instFilter = 'all'; renderInstFilters(); renderInstallations(); }
  if (state.map) go(); else initMap().then(go);
}

/* ------------------------------------------------------------- gallery */
const GCATS = ['installation', 'maintenance', 'calibration', 'cleaning', 'repairs', 'troubleshooting', 'power', 'fieldwork'];
function renderGallery(items) {
  const sec = $('#field'); if (!items || !items.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const list = [...items].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const counts = {}; list.forEach(x => (counts[x.category] = (counts[x.category] || 0) + 1));
  const cats = GCATS.filter(c => counts[c]).concat(Object.keys(counts).filter(c => !GCATS.includes(c)));
  const f = state.galleryFilter || 'all';
  $('#fieldFilters').innerHTML = [`<button class="filter" data-g="all" aria-pressed="${f === 'all'}">${esc(t('inst.all'))} <span class="count">${list.length}</span></button>`]
    .concat(cats.map(c => `<button class="filter" data-g="${esc(c)}" aria-pressed="${f === c}">${esc(t('gcat.' + c))} <span class="count">${counts[c]}</span></button>`)).join('');
  const shown = list.filter(x => f === 'all' || x.category === f);
  const media = shown.map(x => ({ kind: kindOf(x.file || x.url || ''), src: asset(x.file || x.url), caption: [tx(x.caption), x.place, fmtMonth(x.date)].filter(Boolean).join(' · ') }));
  mediaGroups.set('field', media);
  $('#fieldGrid').innerHTML = shown.map((x, i) => `<button class="shot" data-group="field" data-i="${i}" aria-label="${esc(tx(x.caption))}">
      <img src="${esc(asset(x.file))}" alt="${esc(tx(x.caption))}" loading="lazy" decoding="async">
      <span class="shot-cap"><b>${esc(tx(x.caption))}</b><small>${esc([x.place, fmtMonth(x.date)].filter(Boolean).join(' · '))}</small></span>
    </button>`).join('');
}

/* -------------------------------------------------------------- updates */
function renderNews(items) {
  const list = [...items].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $('#news').innerHTML = list.map((n, i) => {
    const media = normMedia(n.media); const group = 'news-' + i;
    const rel = n.related && state.data.installations.some(x => x.slug === n.related);
    return `<li class="news-item reveal">
      <span class="news-date">${esc(fmtMonth(n.date))}</span>
      <div class="news-body">
        <h3>${esc(tx(n.title))}</h3>
        <p>${esc(tx(n.summary))}</p>
        ${registerMedia(group, media)}
        <div class="card-foot">
          ${n.url ? `<a class="link-btn" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(/linkedin\.com/.test(n.url) ? t('news.read') : t('news.source'))} ↗</a>` : ''}
          ${rel ? `<button class="link-btn" data-open="${esc(n.related)}">${esc(t('news.inst'))}</button>` : ''}
        </div>
      </div></li>`;
  }).join('');
  $('#updates').hidden = !list.length;
}

/* ------------------------------------------------------------- projects */
const LANG_COLORS = { Python: '#3572A5', JavaScript: '#e3c13b', Java: '#b07219', R: '#198CE7', HTML: '#e34c26', TypeScript: '#3178c6', MATLAB: '#e16737' };
const GH_ICON = '<svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
function renderProjects(projects) {
  $('#projCards').innerHTML = [...projects].sort((a, b) => (b.year || 0) - (a.year || 0)).map((p, i) => {
    const media = normMedia(p.media); const group = 'proj-' + i;
    const cover = p.cover ? `<img src="${esc(asset(p.cover))}" alt="" loading="lazy">` : art(p.title, 'code');
    return `<article class="card reveal">
      <div class="card-media">${cover}<div class="ribbon">${(p.tags || []).slice(0, 3).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div></div>
      <div class="card-body">
        <div class="card-meta">${p.year ? esc(p.year) : ''}</div>
        <h3>${esc(p.title)}</h3><p>${esc(tx(p.description))}</p>
        ${registerMedia(group, media)}
        <div class="card-foot">
          ${p.repo ? `<a class="link-btn" href="${esc(p.repo)}" target="_blank" rel="noopener">${GH_ICON}${esc(t('proj.repo'))}</a>` : ''}
          ${p.live ? `<a class="link-btn" href="${esc(p.live)}" target="_blank" rel="noopener">↗ ${esc(t('proj.live'))}</a>` : ''}
        </div>
      </div></article>`;
  }).join('');
}
let ghRepos = null;
async function loadRepos(site) {
  if (!site.show_github_repos || !site.github_user) return;
  const key = 'gh-' + site.github_user;
  try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.at < 3600e3) ghRepos = c.repos; } catch { /* ignore */ }
  if (!ghRepos) {
    try {
      const r = await fetch(`https://api.github.com/users/${encodeURIComponent(site.github_user)}/repos?per_page=100&sort=pushed`);
      if (!r.ok) return; ghRepos = await r.json();
      try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), repos: ghRepos })); } catch { /* ignore */ }
    } catch { return; }
  }
  renderRepos(site);
}
function renderRepos(site) {
  if (!ghRepos) return;
  const featured = new Set(state.data.projects.map(p => (p.repo || '').toLowerCase().replace(/\/$/, '')));
  const exclude = new Set((site.github_exclude || []).map(s => s.toLowerCase()));
  const list = ghRepos.filter(r => !r.fork && !featured.has(r.html_url.toLowerCase()) && !exclude.has(r.name.toLowerCase())).slice(0, 12);
  if (!list.length) return;
  const df = new Intl.DateTimeFormat(state.lang, { month: 'short', year: 'numeric' });
  $('#repoList').innerHTML = list.map(r => `<li><a class="repo" href="${esc(r.html_url)}" target="_blank" rel="noopener">
    <b>${esc(r.name.replace(/[-_]/g, ' '))}</b><p>${esc(r.description || '')}</p>
    <span class="meta">${r.language ? `<span><span class="lang-dot" style="background:${LANG_COLORS[r.language] || 'var(--muted)'}"></span>${esc(r.language)}</span>` : ''}
    ${r.stargazers_count ? `<span>★ ${r.stargazers_count}</span>` : ''}<span>${esc(t('proj.updated'))} ${esc(df.format(new Date(r.pushed_at)))}</span></span></a></li>`).join('');
  $('#ghBlock').hidden = false;
}

/* ------------------------------------------------------------- academic */
const KINDS = ['article', 'dataset', 'conference', 'thesis', 'other'];
const ME = /(Trejo[- ]Cancino,? D(?:\.|avid)?|Trejo,? D(?:\.|avid)?)(?=[\s,.;)]|$)/g;
function renderAcademic(items) {
  const counts = {}; items.forEach(x => (counts[x.kind] = (counts[x.kind] || 0) + 1));
  const kinds = KINDS.filter(k => counts[k]);
  if (!kinds.includes(state.acadTab)) state.acadTab = kinds[0] || 'article';
  $('#acadTabs').innerHTML = kinds.map(k => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === state.acadTab}">${esc(t('acad.' + k))}<span class="n">${counts[k]}</span></button>`).join('');
  const list = items.filter(x => x.kind === state.acadTab).sort((a, b) => (b.year || 0) - (a.year || 0) || (b.month || 0) - (a.month || 0));
  $('#pubs').innerHTML = list.map((p, i) => {
    const media = normMedia(p.media); const group = `pub-${state.acadTab}-${i}`;
    const authors = esc(p.authors || '').replace(ME, '<b>$1</b>');
    const link = p.doi ? `https://doi.org/${p.doi}` : p.url;
    const linkTxt = p.doi ? `doi.org/${p.doi}` : (p.url || '').replace(/^https?:\/\//, '').slice(0, 48);
    return `<li class="pub" style="animation-delay:${Math.min(i * 40, 400)}ms">
      <div class="pub-year">${esc(p.year || '')}<small>${esc(t('acad1.' + (p.kind || 'other')))}</small></div>
      <div>
        <h3>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener" style="text-decoration:none">${esc(p.title)}</a>` : esc(p.title)}</h3>
        <p class="authors">${authors}</p>
        <p class="venue"><i>${esc(p.venue || '')}</i>${p.details ? `, ${esc(p.details)}` : ''}</p>
        ${tx(p.note) ? `<p class="venue" style="margin-top:6px">${esc(tx(p.note))}</p>` : ''}
        ${registerMedia(group, media)}
        <div class="pub-badges">
          ${p.format ? `<span class="badge-pill ${esc(p.format)}">${esc(t('acad.' + p.format))}</span>` : ''}
          ${p.presenter ? `<span class="badge-pill presenter">${esc(t('acad.presenter'))}</span>` : ''}
          ${link ? `<a class="doi" href="${esc(link)}" target="_blank" rel="noopener">${esc(linkTxt)} ↗</a>` : ''}
        </div>
      </div></li>`;
  }).join('');
}

/* -------------------------------------------------------------- contact */
function renderContact(site) {
  const e = $('#email'); e.textContent = site.email || ''; e.href = site.email ? `mailto:${site.email}` : '#';
  $('#contactLinks').innerHTML = (site.links || []).map(l => `<a class="btn ghost small" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')
    + (site.cv_file ? `<a class="btn primary small" href="${esc(asset(site.cv_file))}" target="_blank" rel="noopener">${esc(t('hero.cv'))}</a>` : '');
  $('#copy').textContent = `© ${new Date().getFullYear()} ${site.name || ''} · ${t('footer.rights')}`;
}

/* ------------------------------------------------------------- lightbox */
const lb = { list: [], i: 0 };
function openLightbox(list, i) {
  lb.list = list; lb.i = i; showLb();
  const d = $('#lightbox'); if (!d.open) d.showModal();
}
function showLb() {
  const m = lb.list[lb.i]; const box = $('#lbMedia'); if (!m) return;
  if (m.kind === 'image') box.innerHTML = `<img src="${esc(m.src)}" alt="${esc(m.caption)}">`;
  else if (m.kind === 'video') box.innerHTML = `<video src="${esc(m.src)}" controls autoplay playsinline></video>`;
  else if (m.kind === 'youtube') box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(m.id)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(m.caption || 'YouTube')}"></iframe>`;
  else if (m.kind === 'vimeo') box.innerHTML = `<iframe src="https://player.vimeo.com/video/${esc(m.id)}?autoplay=1" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="${esc(m.caption || 'Vimeo')}"></iframe>`;
  else if (m.kind === 'pdf') box.innerHTML = `<iframe class="pdf" src="${esc(m.src)}" title="${esc(m.caption || 'PDF')}"></iframe>`;
  else { window.open(m.src, '_blank', 'noopener'); $('#lightbox').close(); return; }
  $('#lbCaption').textContent = m.caption || '';
  $('#lbPrev').hidden = lb.list.length < 2; $('#lbNext').hidden = lb.list.length < 2;
}
function stepLb(d) { lb.i = (lb.i + d + lb.list.length) % lb.list.length; showLb(); }

/* --------------------------------------------------------- interactions */
let revealObs;
function observeReveals() {
  if (reduceMotion || !('IntersectionObserver' in window)) { $$('.reveal').forEach(el => el.classList.add('in')); return; }
  revealObs ||= new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: .06 });
  $$('.reveal:not(.in)').forEach(el => revealObs.observe(el));
}

function bind() {
  // language
  $$('.lang button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
  // theme
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next);
  });
  // mobile menu
  const links = $('#navLinks'), menu = $('#menuBtn');
  menu.addEventListener('click', () => { const o = links.classList.toggle('open'); menu.setAttribute('aria-expanded', o); });
  links.addEventListener('click', e => { if (e.target.closest('a')) { links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); } });
  // nav background + parallax
  const nav = $('#nav'), bg = $('#heroBg'); let ticking = false;
  const onScroll = () => {
    nav.classList.toggle('solid', scrollY > 40);
    if (!reduceMotion && scrollY < innerHeight * 1.2) bg.style.transform = `translateY(${scrollY * .25}px) scale(1.06)`;
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true }); onScroll();
  // active section in nav
  const secObs = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) $$('.nav-links a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach(s => secObs.observe(s));
  // lazy map
  const mapObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { mapObs.disconnect(); initMap(); } }, { rootMargin: '400px' });
  mapObs.observe($('#map'));

  // delegated clicks
  document.addEventListener('click', e => {
    const head = e.target.closest('.job-head[aria-expanded]');
    if (head) {
      const card = head.closest('.job-card'); const open = card.dataset.open !== 'true';
      card.dataset.open = open; head.setAttribute('aria-expanded', open);
      head.querySelector('.lbl').textContent = open ? t('exp.less') : t('exp.details'); return;
    }
    const th = e.target.closest('.thumb, .shot');
    if (th) { e.stopPropagation(); openLightbox(mediaGroups.get(th.dataset.group) || [], +th.dataset.i); return; }
    const card = e.target.closest('.card[data-slug]'); if (card) { openInstallation(card.dataset.slug); return; }
    const pop = e.target.closest('[data-open]'); if (pop) { openInstallation(pop.dataset.open); return; }
    const mapBtn = e.target.closest('[data-map]'); if (mapBtn) { showOnMap(mapBtn.dataset.map); return; }
    const gf = e.target.closest('.filter[data-g]'); if (gf) { state.galleryFilter = gf.dataset.g; renderGallery(state.data.gallery); return; }
    const f = e.target.closest('.filter[data-f]'); if (f) { state.instFilter = f.dataset.f; renderInstFilters(); renderInstallations(); return; }
    const tab = e.target.closest('.tab'); if (tab) { state.acadTab = tab.dataset.tab; renderAcademic(state.data.academic); return; }
    if (e.target.closest('[data-close]')) { e.target.closest('dialog').close(); return; }
  });
  $('#moreRoles').addEventListener('click', () => {
    state.showAllRoles = !state.showAllRoles; renderExperience(state.data.experience); observeReveals();
    if (!state.showAllRoles) $('#experience').scrollIntoView({ behavior: 'smooth' });
  });
  // dialogs: click on backdrop closes; closing the modal clears the hash
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  $('#modal').addEventListener('close', () => { if (location.hash.startsWith('#installation/')) history.replaceState(null, '', location.pathname + location.search + '#installations'); });
  $('#lightbox').addEventListener('close', () => { $('#lbMedia').innerHTML = ''; });
  $('#lbPrev').addEventListener('click', () => stepLb(-1)); $('#lbNext').addEventListener('click', () => stepLb(1));
  addEventListener('keydown', e => { if (!$('#lightbox').open) return; if (e.key === 'ArrowLeft') stepLb(-1); if (e.key === 'ArrowRight') stepLb(1); });
  let x0 = null;
  $('#lightbox').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  $('#lightbox').addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) stepLb(dx < 0 ? 1 : -1); x0 = null; });
  addEventListener('hashchange', route);
}
function route() {
  const m = location.hash.match(/^#installation\/([\w-]+)/);
  if (m && state.data) openInstallation(m[1], false);
}

function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  state.lang = lang; store.set('lang', lang); document.documentElement.lang = lang;
  $$('.lang button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === lang));
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  if (state.data) renderAll();
}
function renderAll() {
  const d = state.data; mediaGroups.clear();
  renderHero(d.site); renderAbout(d.site); renderExperience(d.experience);
  renderInstFilters(); renderInstallations(); renderGallery(d.gallery); renderNews(d.news); renderProjects(d.projects); renderRepos(d.site);
  renderAcademic(d.academic); renderContact(d.site); observeReveals();
  if ($('#modal').open) { const m = location.hash.match(/^#installation\/([\w-]+)/); if (m) openInstallation(m[1], false); }
}

/* ----------------------------------------------------------------- boot */
(async function boot() {
  bind(); setLang(state.lang);
  state.data = await load();
  renderAll(); route(); loadRepos(state.data.site);
})();

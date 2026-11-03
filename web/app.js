import {
  search, searchAll, findBySiteNr, facets, fields, hitSource, jaarTekst, taxonTekst, PAGE_SIZE, TIJDVAKKEN, PERIODES,
  toParams, fromParams, toCsv, toGeoJson, ZoekFout, WKT_FIELD,
} from './search.js';
import { centroidLatLon } from './geo.js';
import { fetchPlanten, fetchSporen, fetchLiteratuur, fetchPlantnamen, bewaringTotalen } from './detail.js';
import { fetchErfgoed, fetchBoneInfo } from './related.js';
import { t, getLang, setLang, LANGS, bewaringLabel, bewaringSoort, deelLabel, facetLabel } from './i18n.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const getal = (x) => Number(x).toLocaleString(getLang() === 'nl' ? 'nl-NL' : 'en-GB');
const debounce = (fn, ms) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };

const state = { search: '', filters: {}, page: 0, sort: 'relevantie', resolution: 'locaties', site: null };
const FACET_ZICHTBAAR = 8;
const facetOpen = new Set();

let map = null;
let markerLayer = null;
let lastData = null;
let runController = null;
let namenToken = 0;
let detail = null; // { hit, controller, opener }

// ---- statische teksten ------------------------------------------------------------------
function applyStaticI18n() {
  document.documentElement.lang = getLang();
  document.title = t('pageTitle');
  for (const node of qsa('[data-i18n]')) {
    const key = node.dataset.i18n;
    if (key.startsWith('facet_')) node.textContent = t('facets')[key.slice(6)] ?? key;
    else node.textContent = t(key);
  }
  for (const node of qsa('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  const raster = t('mapResolutions');
  for (const option of qsa('#map-resolution option')) option.textContent = raster[option.value] ?? option.value;
  for (const code of LANGS) qs(`#lang-${code}`).setAttribute('aria-pressed', String(getLang() === code));
}

// ---- kaart ------------------------------------------------------------------------------
function initMap() {
  if (!window.L) { qs('#map').textContent = ''; return; }
  map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([52.2, 5.3], 7);
  L.tileLayer('https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png', {
    attribution: 'Kaart: PDOK / Kadaster &middot; Data: RADAR / BIAX Consult',
    maxZoom: 19,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on('focus', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());
}

function bucketStyle(count) {
  if (count >= 51) return { r: 22, cls: 'c6' };
  if (count >= 26) return { r: 18, cls: 'c5' };
  if (count >= 11) return { r: 14, cls: 'c4' };
  if (count >= 6) return { r: 11, cls: 'c3' };
  if (count >= 2) return { r: 8, cls: 'c2' };
  return { r: 6, cls: 'c1' };
}

function renderMap(data) {
  if (!map) return;
  markerLayer.clearLayers();
  const buckets = data.aggregations?.kaart?.locaties?.buckets ?? [];
  let plotted = 0;
  for (const b of buckets) {
    const latlon = centroidLatLon(b);
    if (!latlon) continue;
    plotted++;
    const { r, cls } = bucketStyle(b.doc_count);
    const marker = L.circleMarker(latlon, { radius: r, className: `cluster-bubble ${cls}`, weight: 1 });
    if (b.doc_count > 1) marker.bindTooltip(String(b.doc_count), { permanent: true, direction: 'center', className: 'bubble-label' });
    marker.on('click', () => map.flyTo(latlon, Math.max(Math.min(map.getZoom() + 3, 18), 12), { duration: 0.4 }));
    marker.addTo(markerLayer);
  }
  const totaal = data.hits.total.value;
  const opKaart = buckets.reduce((s, b) => s + b.doc_count, 0);
  qs('#map-status').textContent = t('mapStatus', plotted, totaal, Math.max(0, totaal - opKaart), state.resolution !== 'locaties');
}

// ---- tijdband ---------------------------------------------------------------------------
const jaarLabel = (y) => jaarTekst(y, t('bc'), t('ad'));
let tlSelectie = null; // [a, b] kolomindexen tijdens het slepen

function kolomGeselecteerd(vak) {
  const { vanaf, tot } = state.filters;
  if (vanaf == null && tot == null) return false;
  return (tot == null || vak.van <= tot) && (vanaf == null || vak.tot >= vanaf);
}

function renderTimeline(data) {
  const chart = qs('#timeline-chart');
  const buckets = data.aggregations?.tijd?.vakken?.buckets ?? {};
  chart.replaceChildren();
  chart.removeAttribute('aria-busy');
  const aantallen = TIJDVAKKEN.map((v) => buckets[v.id]?.doc_count ?? 0);
  const max = Math.max(1, ...aantallen);

  const kolommen = el('div', 'tl-cols');
  kolommen.setAttribute('role', 'group');
  kolommen.setAttribute('aria-label', t('timeTitle'));
  TIJDVAKKEN.forEach((vak, i) => {
    const knop = el('button', 'tl-col');
    knop.type = 'button';
    knop.dataset.i = String(i);
    if (aantallen[i] === 0) knop.dataset.leeg = 'true';
    if (kolomGeselecteerd(vak)) knop.classList.add('sel');
    const tekst = t('timeColumn', jaarLabel(vak.van), jaarLabel(vak.tot), aantallen[i]);
    knop.setAttribute('aria-label', tekst);
    knop.dataset.tekst = tekst;
    const balk = el('span', 'tl-bar');
    balk.style.setProperty('--h', `${(aantallen[i] / max) * 100}%`);
    knop.append(balk);
    kolommen.append(knop);
  });

  const banden = el('div', 'tl-bands');
  for (const p of PERIODES) {
    const band = el('div', 'tl-band');
    band.style.flex = String(p.kolommen);
    const naam = el('span', 'tl-band-name');
    naam.append(el('span', 'vol', t('periodes')[p.id]), el('span', 'kort', t('periodesKort')[p.id]));
    band.append(naam, el('span', 'tl-band-year', jaarLabel(p.van)));
    banden.append(band);
  }
  const info = el('p', 'tl-info');
  info.setAttribute('aria-hidden', 'true');
  chart.append(el('span', 'tl-max', getal(max)), kolommen, banden, info);

  const { vanaf, tot } = state.filters;
  const gekozen = qs('#timeline-selected');
  gekozen.textContent = vanaf != null || tot != null ? t('timeSelected', vanaf != null ? jaarLabel(vanaf) : '…', tot != null ? jaarLabel(tot) : '…') : '';
  qs('#timeline-clear').hidden = vanaf == null && tot == null;
}

function initTimeline() {
  const chart = qs('#timeline-chart');
  const index = (e) => {
    const kolommen = qs('.tl-cols', chart);
    if (!kolommen) return -1;
    const r = kolommen.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right) return -1;
    return Math.min(TIJDVAKKEN.length - 1, Math.floor(((e.clientX - r.left) / r.width) * TIJDVAKKEN.length));
  };
  const markeer = () => {
    const [a, b] = tlSelectie ? [Math.min(...tlSelectie), Math.max(...tlSelectie)] : [-1, -2];
    qsa('.tl-col', chart).forEach((k, i) => k.classList.toggle('sel', i >= a && i <= b));
  };
  const toon = (i) => { const info = qs('.tl-info', chart); if (info) info.textContent = i >= 0 ? qs(`.tl-col[data-i="${i}"]`, chart)?.dataset.tekst ?? '' : ''; };
  const pas = (a, b) => {
    const van = TIJDVAKKEN[Math.min(a, b)].van;
    const tot = TIJDVAKKEN[Math.max(a, b)].tot;
    const alGekozen = state.filters.vanaf === van && state.filters.tot === tot && (state.filters.modus ?? 'overlapt') === 'overlapt';
    if (alGekozen) { delete state.filters.vanaf; delete state.filters.tot; }
    else { state.filters.vanaf = van; state.filters.tot = tot; delete state.filters.modus; }
    state.page = 0;
    run();
  };
  chart.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const i = index(e);
    if (i < 0) return;
    tlSelectie = [i, i];
    chart.setPointerCapture(e.pointerId);
    markeer();
  });
  chart.addEventListener('pointermove', (e) => {
    const i = index(e);
    toon(i);
    if (tlSelectie && i >= 0) { tlSelectie[1] = i; markeer(); }
  });
  chart.addEventListener('pointerup', () => {
    if (!tlSelectie) return;
    const [a, b] = tlSelectie;
    tlSelectie = null;
    pas(a, b);
  });
  chart.addEventListener('pointercancel', () => { tlSelectie = null; if (lastData) renderTimeline(lastData); });
  chart.addEventListener('pointerleave', () => toon(-1));
  // met het toetsenbord: Enter of spatie kiest één kolom (muisklikken worden al via de pointer-events afgehandeld)
  chart.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const knop = e.target.closest('.tl-col');
    if (knop) pas(Number(knop.dataset.i), Number(knop.dataset.i));
  });
  chart.addEventListener('focusin', (e) => { const knop = e.target.closest?.('.tl-col'); if (knop) toon(Number(knop.dataset.i)); });
  qs('#timeline-clear').addEventListener('click', () => { delete state.filters.vanaf; delete state.filters.tot; delete state.filters.modus; state.page = 0; run(); });
}

// ---- selectie en filters ----------------------------------------------------------------
function renderSelection(data) {
  const s = data.aggregations?.statistiek;
  qs('#selection').textContent = s ? t('selection', s.doc_count, Math.round(s.waarnemingen.value ?? 0), Math.round(s.taxa.value ?? 0)) : '';
}

function actieveFilters() {
  const lijst = [];
  const f = state.filters;
  if (state.search) lijst.push({ label: `“${state.search}”`, wis: () => { state.search = ''; qs('#q').value = ''; } });
  for (const key of facets) for (const v of f[key] ?? []) lijst.push({ label: facetLabel(key, v), wis: () => toggleFacet(key, v, false, true) });
  for (const v of f.taxon ?? []) lijst.push({ label: taxonTekst(v), latijn: true, wis: () => toggleTaxon(v, true) });
  const tekstVelden = { plant: 'fieldPlant', plaats: 'fieldPlaats', spoor: 'fieldSpoor', literatuur: 'fieldLiteratuur', nummer: 'fieldNummer' };
  for (const [key, label] of Object.entries(tekstVelden)) if (f[key]) lijst.push({ label: `${t(label)}: ${f[key]}`, wis: () => { delete f[key]; qs(`#${key}`).value = ''; } });
  if (f.vanaf != null || f.tot != null) lijst.push({ label: `${f.vanaf != null ? jaarLabel(f.vanaf) : '…'} – ${f.tot != null ? jaarLabel(f.tot) : '…'}`, wis: () => { delete f.vanaf; delete f.tot; delete f.modus; } });
  return lijst;
}

function renderActiveFilters() {
  const box = qs('#active-filters');
  const lijst = actieveFilters();
  box.replaceChildren();
  box.hidden = !lijst.length;
  box.setAttribute('aria-label', t('activeFilters'));
  for (const item of lijst) {
    const chip = el('button', 'chip');
    chip.type = 'button';
    chip.append(el('span', item.latijn ? 'latijn' : null, item.label), el('span', 'chip-x', '×'));
    chip.setAttribute('aria-label', t('removeFilter', item.label));
    chip.addEventListener('click', () => { item.wis(); state.page = 0; run(); });
    box.append(chip);
  }
}

function renderFacets(data) {
  for (const key of facets) {
    const box = qs(`[data-facet="${key}"] .facet-values`);
    if (!box) continue;
    box.replaceChildren();
    const buckets = data.aggregations?.[key]?.values?.buckets ?? [];
    const actief = new Set(state.filters[key] || []);
    if (!buckets.length) { box.append(el('p', 'facet-empty', t('facetEmpty'))); continue; }
    const open = facetOpen.has(key);
    const getoond = open ? buckets : buckets.filter((b, i) => i < FACET_ZICHTBAAR || actief.has(b.key));
    for (const b of getoond) {
      const label = el('label', 'facet-option');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = actief.has(b.key);
      input.addEventListener('change', () => toggleFacet(key, b.key, input.checked));
      label.append(input, el('span', 'facet-name', facetLabel(key, b.key)), el('span', 'facet-count', getal(b.doc_count)));
      box.append(label);
    }
    if (buckets.length > FACET_ZICHTBAAR) {
      const knop = el('button', 'link-btn facet-more', open ? t('facetLess') : t('facetMore', buckets.length));
      knop.type = 'button';
      knop.addEventListener('click', () => { if (open) facetOpen.delete(key); else facetOpen.add(key); renderFacets(data); });
      box.append(knop);
    }
  }
}

function toggleFacet(key, value, aan, geenRun = false) {
  const huidig = new Set(state.filters[key] || []);
  if (aan) huidig.add(value); else huidig.delete(value);
  state.filters[key] = [...huidig];
  if (!state.filters[key].length) delete state.filters[key];
  state.page = 0;
  if (!geenRun) run();
}

function toggleTaxon(naam, geenRun = false) {
  const huidig = new Set(state.filters.taxon || []);
  if (huidig.has(naam)) huidig.delete(naam); else huidig.add(naam);
  state.filters.taxon = [...huidig];
  if (!state.filters.taxon.length) delete state.filters.taxon;
  state.page = 0;
  if (!geenRun) run();
}

// ---- meest gevonden planten -------------------------------------------------------------
async function renderTop(data) {
  const lijst = qs('#top-taxa');
  const buckets = data.aggregations?.topTaxa?.values?.buckets ?? [];
  lijst.replaceChildren();
  if (!buckets.length) { lijst.append(el('li', 'facet-empty', t('topEmpty'))); return; }
  const max = Math.max(...buckets.map((b) => b.doc_count));
  const actief = new Set(state.filters.taxon || []);
  const items = buckets.map((b) => {
    const li = el('li');
    const knop = el('button', 'top-btn');
    knop.type = 'button';
    knop.style.setProperty('--w', `${(b.doc_count / max) * 100}%`);
    knop.setAttribute('aria-pressed', String(actief.has(b.key)));
    // tot de Nederlandse naam er is, staat de Latijnse naam in het hoofdvak
    const naam = el('span', 'top-naam');
    const nl = el('span', 'nl latijn', taxonTekst(b.key));
    const latijn = el('span', 'latijn', taxonTekst(b.key));
    latijn.hidden = true;
    naam.append(nl, latijn);
    knop.append(naam, el('span', 'top-aantal', t('topSites', b.doc_count)));
    knop.addEventListener('click', () => toggleTaxon(b.key));
    li.append(knop);
    lijst.append(li);
    return { b, nl, latijn };
  });
  // Nederlandse namen komen uit de brondataset.
  const token = ++namenToken;
  try {
    const namen = await fetchPlantnamen(buckets.map((b) => b.key));
    if (token !== namenToken) return;
    for (const { b, nl, latijn } of items) {
      const n = namen.get(b.key);
      const naam = getLang() === 'nl' ? n?.naam : n?.naamEn || n?.naam;
      if (naam) { nl.textContent = naam; nl.className = 'nl'; latijn.hidden = false; }
    }
  } catch { /* de Latijnse namen blijven staan */ }
}

// ---- resultaten -------------------------------------------------------------------------
function renderHighlight(node, fragment) {
  // alleen <mark> uit het fragment; al het andere is tekst, nooit HTML uit de bron
  let inMark = false;
  for (const stuk of String(fragment).split(/(<mark>|<\/mark>)/)) {
    if (stuk === '<mark>') inMark = true;
    else if (stuk === '</mark>') inMark = false;
    else if (stuk) node.append(inMark ? el('mark', null, stuk) : document.createTextNode(stuk));
  }
}

function siteTitel(src) {
  return src.one(fields.locatienaam) || src.one(fields.plaats) || t('unknownLocation');
}

function rangschikNamen(namen) {
  const woorden = `${state.search} ${state.filters.plant ?? ''}`.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!woorden.length) return namen;
  const treft = (n) => woorden.some((w) => n.toLowerCase().includes(w));
  return [...namen.filter(treft), ...namen.filter((n) => !treft(n))];
}

function renderResults(data) {
  const lijst = qs('#results');
  lijst.replaceChildren();
  const hits = data.hits.hits;
  const totaal = data.hits.total.value;
  qs('#result-count').textContent = t('resultCount', totaal);
  qs('#status').textContent = '';
  qs('#status').classList.remove('error');
  if (!hits.length) { lijst.append(el('p', 'empty', t('resultsEmpty'))); renderPager(totaal); return; }
  for (const hit of hits) {
    const src = hitSource(hit);
    const rij = el('article', 'rij');

    // de titel is een echte knop (toetsenbord en schermlezer); de hele rij is ook met de muis te klikken
    const kop = el('h3');
    const open = el('button', 'rij-knop', siteTitel(src));
    open.type = 'button';
    open.setAttribute('aria-label', t('openSite', siteTitel(src)));
    kop.append(open);
    const type = src.one(fields.complextype);
    if (type) kop.append(el('span', 'rij-type', type));
    rij.append(kop);

    const meta = el('div', 'rij-meta');
    const plek = [src.one(fields.plaats) !== src.one(fields.locatienaam) ? src.one(fields.plaats) : null, src.one(fields.provincie)].filter(Boolean).join(', ');
    if (plek) meta.append(el('span', null, plek));
    const bp = src.one(fields.beginperiode), ep = src.one(fields.eindperiode);
    const periode = bp && ep && bp !== ep ? `${bp} – ${ep}` : bp || ep;
    if (periode) meta.append(el('span', 'periode-chip', periode));
    const bj = src.one(fields.beginjaar), ej = src.one(fields.eindjaar);
    if (bj != null || ej != null) meta.append(el('span', null, [jaarLabel(bj), jaarLabel(ej)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' – ')));
    rij.append(meta);

    const namen = rangschikNamen(src.many(fields.plantnaam));
    const latijn = src.many(fields.wetenschappelijkeNaam);
    const planten = el('p', 'rij-planten');
    if (namen.length || latijn.length) {
      planten.append(el('span', 'rij-label', t('plants')));
      if (namen.length) planten.append(document.createTextNode(`${namen.slice(0, 6).map(taxonTekst).join(', ')}${namen.length > 6 ? ', …' : ''}`));
      else {
        const i = el('span', 'latijn', latijn.slice(0, 6).map(taxonTekst).join(', ') + (latijn.length > 6 ? ', …' : ''));
        planten.append(i);
      }
      rij.append(planten);
    }
    const omschrijving = src.one(fields.omschrijving);
    if (omschrijving) {
      const snippet = el('p', 'rij-snippet');
      const hl = hit.highlight?.[fields.omschrijving]?.[0];
      if (hl) renderHighlight(snippet, hl);
      else snippet.textContent = omschrijving.length > 200 ? `${omschrijving.slice(0, 200)}…` : omschrijving;
      rij.append(snippet);
    }

    const zijde = el('div', 'rij-zijde');
    const waarnemingen = Number(src.one(fields.aantalWaarnemingen)) || 0;
    if (waarnemingen) {
      const g = el('div', 'rij-getal', getal(waarnemingen));
      g.append(el('span', 'rij-getal-label', t('obsWord', waarnemingen)), el('span', 'rij-getal-label', t('taxaCount', latijn.length)));
      zijde.append(g);
      const stippen = el('div', 'bew-stippen');
      for (const soort of new Set(src.many(fields.bewaringswijze).map(bewaringSoort))) {
        const s = el('span', `stip ${soort}`);
        s.title = src.many(fields.bewaringswijze).filter((b) => bewaringSoort(b) === soort).map(bewaringLabel).join(', ');
        stippen.append(s);
      }
      zijde.append(stippen);
    } else zijde.append(el('span', 'rij-leeg', t('noPlantData')));
    rij.append(zijde);

    rij.addEventListener('click', () => openDetail(hit, open));
    lijst.append(rij);
  }
  renderPager(totaal);
}

function renderPager(totaal) {
  const pager = qs('#pager');
  pager.replaceChildren();
  const paginas = Math.min(Math.ceil(totaal / PAGE_SIZE), 400);
  if (paginas <= 1) return;
  const knop = (tekst, uit, naar) => {
    const b = el('button', 'page-btn', tekst);
    b.type = 'button';
    b.disabled = uit;
    b.addEventListener('click', () => { state.page = naar; run(true); });
    return b;
  };
  pager.append(knop(t('pagerPrev'), state.page === 0, Math.max(0, state.page - 1)), el('span', 'page-status', t('pagerStatus', state.page + 1, paginas)), knop(t('pagerNext'), state.page >= paginas - 1, Math.min(paginas - 1, state.page + 1)));
}

// ---- zoeken -----------------------------------------------------------------------------
function syncUrl() {
  const q = toParams({ ...state }).toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}`);
}

function renderAll(data) {
  renderSelection(data);
  renderActiveFilters();
  renderFacets(data);
  renderResults(data);
  renderMap(data);
  renderTimeline(data);
  renderTop(data);
}

function toonFout(fout) {
  const status = qs('#status');
  status.classList.add('error');
  status.textContent = fout instanceof ZoekFout ? (fout.soort === 'netwerk' ? t('errNetwork') : fout.soort === 'onbeschikbaar' ? t('errUnavailable') : t('errGeneric', fout.status)) : t('errNetwork');
  const opnieuw = el('button', 'link-btn', t('retry'));
  opnieuw.type = 'button';
  opnieuw.addEventListener('click', () => run());
  status.append(opnieuw);
}

async function run(scroll = false) {
  runController?.abort();
  runController = new AbortController();
  const controller = runController;
  qs('#status').classList.remove('error');
  qs('#status').textContent = t('statusLoading');
  syncUrl();
  try {
    const data = await search(state, controller.signal);
    if (controller !== runController) return;
    lastData = data;
    renderAll(data);
    if (scroll) qs('#results').scrollIntoView({ block: 'start' });
  } catch (e) {
    if (e.name === 'AbortError') return;
    toonFout(e);
  }
}

// ---- detail -----------------------------------------------------------------------------
const KOLOMMEN_PLANT = 25;

function feitenRijen(src) {
  const L = t('detailLabels');
  const bp = src.one(fields.beginperiode), ep = src.one(fields.eindperiode);
  const periode = bp && ep && bp !== ep ? `${bp} – ${ep}` : bp || ep;
  const jaren = [jaarLabel(src.one(fields.beginjaar)), jaarLabel(src.one(fields.eindjaar))].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' – ');
  return [
    [L.siteNr, src.one(fields.siteNr)], [L.plaats, src.one(fields.plaats)], [L.provincie, src.one(fields.provincie)],
    [L.complextype, src.one(fields.complextype)], [L.archeoregio, src.one(fields.archeoregio)], [L.periode, periode], [L.jaren, jaren],
    [L.dateringBron, src.one(fields.dateringBron)], [L.waarnemingsnummer, src.one(fields.waarnemingsnummer)], [L.zaaknummer, src.one(fields.zaaknummer)],
    [L.biaxId, src.one(fields.biaxId)], [L.nauwkeurigheid, src.one(fields.coordinaatNauwkeurigheid)],
    [L.sporen, src.one(fields.aantalSporen) != null ? getal(src.one(fields.aantalSporen)) : null],
    [L.monsters, src.one(fields.aantalMonsters) != null ? getal(src.one(fields.aantalMonsters)) : null],
    [L.waarnemingen, src.one(fields.aantalWaarnemingen) != null ? getal(src.one(fields.aantalWaarnemingen)) : null],
    [L.taxa, src.many(fields.wetenschappelijkeNaam).length ? getal(src.many(fields.wetenschappelijkeNaam).length) : null],
  ].filter(([, v]) => v != null && v !== '');
}

function plantNaam(p) {
  return getLang() === 'nl' ? p.naam : p.naamEn || p.naam;
}

function renderPlanten(box, planten, src) {
  box.className = '';
  box.replaceChildren();
  if (!planten.length) {
    box.append(el('p', 'empty', t('plantsEmpty')), el('p', 'hint', t('plantsEmptyNote')));
    return;
  }
  const waarnemingen = planten.reduce((s, p) => s + p.n, 0);
  box.append(el('p', null, `${t('plantsCount', planten.length)}, ${t('observations', waarnemingen)}`));

  // bewaringswijzen over alle planten: een balk met dezelfde kleuren als de stippen in de lijst
  const totalen = bewaringTotalen(planten);
  if (totalen.length) {
    const sum = totalen.reduce((s, x) => s + x.n, 0);
    const balk = el('div', 'bew-balk');
    balk.setAttribute('role', 'img');
    balk.setAttribute('aria-label', totalen.map((x) => `${bewaringLabel(x.key)} ${getal(x.n)}`).join(', '));
    const legenda = el('ul', 'bew-legenda');
    for (const x of totalen) {
      const s = el('span', null);
      s.style.width = `${(x.n / sum) * 100}%`;
      s.style.background = `var(--${bewaringSoort(x.key)})`;
      balk.append(s);
      const li = el('li');
      li.append(el('i', `bew-sw ${bewaringSoort(x.key)}`), document.createTextNode(`${bewaringLabel(x.key)} ${getal(x.n)}`));
      legenda.append(li);
    }
    box.append(balk, legenda);
  }
  box.append(el('p', 'hint', t('plantObsHint')));

  const gereedschap = el('div', 'plant-gereedschap');
  const filter = el('input');
  filter.type = 'search';
  filter.placeholder = t('plantsFilter');
  filter.setAttribute('aria-label', t('plantsFilter'));
  gereedschap.append(filter);
  box.append(gereedschap);

  const tabel = el('table', 'plant-tabel');
  const P = t('plantTable');
  const kop = el('thead');
  const kr = el('tr');
  [['plant', ''], ['finds', ''], ['samples', 'kolom-monsters'], ['preserved', ''], ['parts', 'kolom-delen']].forEach(([k, c]) => { const th = el('th', c, P[k]); th.scope = 'col'; kr.append(th); });
  kop.append(kr);
  const lichaam = el('tbody');
  tabel.append(kop, lichaam);
  const meer = el('button', 'link-btn lijst-meer');
  meer.type = 'button';
  let alles = false;
  const max = Math.max(...planten.map((p) => p.n));

  const teken = () => {
    const zoek = filter.value.trim().toLowerCase();
    const zichtbaar = planten.filter((p) => !zoek || [p.latijn, p.naam, p.naamEn, p.familie].some((x) => x && x.toLowerCase().includes(zoek)));
    const getoond = alles || zoek ? zichtbaar : zichtbaar.slice(0, KOLOMMEN_PLANT);
    lichaam.replaceChildren();
    for (const p of getoond) {
      const tr = el('tr');
      const naam = el('td', 'plant-naam');
      const nm = plantNaam(p);
      naam.append(el('span', nm ? 'nl' : 'latijn', nm || taxonTekst(p.latijn)));
      if (nm) naam.append(el('span', 'latijn', taxonTekst(p.latijn)));
      if (p.familie) naam.append(el('span', 'fam', p.familie));
      if (!p.latijn.includes('|')) {
        const toon = el('button', 'link-btn tonen', t('showSitesWithPlant'));
        toon.type = 'button';
        toon.addEventListener('click', () => { sluitDetail(); state.filters.taxon = [p.latijn]; state.page = 0; run(true); });
        naam.append(toon);
      }
      const aantal = el('td', 'num', getal(p.n));
      const b = el('span', 'waarneming-balk');
      b.style.width = `${Math.max(3, (p.n / max) * 100)}%`;
      aantal.append(b);
      const mon = el('td', 'num kolom-monsters', getal(p.monsters));
      const bew = el('td');
      const bw = el('div', 'plant-bew');
      for (const [k, n] of [...p.bewaring].sort((x, y) => y[1] - x[1])) {
        const s = el('span');
        s.append(el('i', `bew-sw ${bewaringSoort(k)}`), document.createTextNode(`${bewaringLabel(k)} ${getal(n)}`));
        bw.append(s);
      }
      bew.append(bw);
      const delen = el('td', 'plant-delen kolom-delen', [...p.delen].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => deelLabel(k)).join(', '));
      tr.append(naam, aantal, mon, bew, delen);
      lichaam.append(tr);
    }
    meer.hidden = !!zoek || zichtbaar.length <= KOLOMMEN_PLANT;
    meer.textContent = alles ? t('plantsLess') : t('plantsMore', zichtbaar.length);
  };
  meer.addEventListener('click', () => { alles = !alles; teken(); });
  filter.addEventListener('input', teken);
  box.append(tabel, meer);
  teken();
}

function renderSporen(box, sporen) {
  box.className = '';
  box.replaceChildren();
  if (!sporen.length) { box.append(el('p', 'empty', t('featuresEmpty'))); return; }
  const lijst = el('ul', 'spoor-lijst');
  for (const s of sporen.slice(0, 40)) {
    const li = el('li');
    const links = el('span');
    links.append(el('span', 'spoor-naam', s.soort ?? '–'), document.createTextNode(` ${t('featureCount', s.sporen)}`));
    const jaren = s.van != null || s.tot != null ? [jaarLabel(s.van), jaarLabel(s.tot)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' – ') : '';
    const rechts = el('span', 'spoor-sub', [s.monsters ? t('featureSamples', s.monsters) : '', jaren].filter(Boolean).join(', '));
    li.append(links, rechts);
    lijst.append(li);
  }
  box.append(lijst);
}

function renderLiteratuur(box, lit) {
  box.className = '';
  box.replaceChildren();
  if (!lit.length) { box.append(el('p', 'empty', t('litEmpty'))); return; }
  const lijst = el('ul', 'lit-lijst');
  for (const l of lit) {
    const li = el('li');
    li.append(el('div', 'lit-titel', l.titel ?? '—'));
    const meta = [l.auteurs.join('; '), l.jaar, l.tijdschrift ? `${l.tijdschrift}${l.deel ? ` ${l.deel}` : ''}` : '', l.paginas, l.uitgever].filter(Boolean).join(', ');
    if (meta) li.append(el('div', 'lit-meta', meta));
    if (l.url) {
      const a = el('a', null, t('litOpen'));
      a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(a);
    }
    lijst.append(li);
  }
  box.append(lijst);
}

function renderVerwant(box, erfgoed, bone) {
  box.className = '';
  box.replaceChildren();
  if (!erfgoed.length && !bone.length) { box.append(el('p', 'empty', t('relatedNone'))); return; }
  const lijst = el('ul', 'related-list');
  for (const item of erfgoed) {
    const li = el('li');
    const a = el('a', null, `${item.klasseLabel}${[item.naam, item.gemeente, item.provincie].filter(Boolean).length ? `: ${[item.naam, item.gemeente, item.provincie].filter(Boolean).join(', ')}` : ''}`);
    a.href = item.zoekdemoUrl || item.uri; a.target = '_blank'; a.rel = 'noopener noreferrer';
    li.append(el('span', 'ref-sub', `${t('relatedHeritage')}: `), a);
    if (item.aantalObjecten) li.append(el('span', 'ref-sub', t('relatedContains', item.aantalObjecten)));
    lijst.append(li);
  }
  for (const b of bone) {
    const li = el('li');
    const a = el('a', null, `BoneInfo ${b.zoonr}`);
    a.href = b.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    li.append(el('span', 'ref-sub', `${t('relatedBone')}: `), a);
    if (b.soorten.length) li.append(el('span', 'ref-sub', t('relatedBoneText', b.soorten.length)));
    lijst.append(li);
  }
  box.append(el('p', 'hint', t('relatedNote')), lijst);
}

function laadFout(box, sleutel, e) {
  box.className = 'error';
  box.textContent = t(sleutel) + (e?.message ?? '');
}

async function openDetail(hit, opener = null) {
  detail?.controller.abort();
  const controller = new AbortController();
  const { signal } = controller;
  detail = { hit, controller, opener: opener ?? detail?.opener ?? null };
  const src = hitSource(hit);
  const paneel = qs('#detail-panel');
  paneel.hidden = false;
  document.body.style.overflow = 'hidden';
  qs('#detail-title').textContent = siteTitel(src);
  const nr = src.one(fields.siteNr);
  if (nr != null) { state.site = nr; syncUrl(); }

  const body = qs('#detail-body');
  body.replaceChildren();
  const dl = el('dl', 'detail-grid');
  for (const [label, waarde] of feitenRijen(src)) dl.append(el('dt', null, label), el('dd', null, String(waarde)));
  body.append(dl);
  if (src.one(fields.waarnemingsnummerOnzeker) === 'true') body.append(el('p', 'detail-note', t('uncertainNumber')));
  if (src.one(fields.coordinaatNauwkeurigheid)) body.append(el('p', 'detail-note', t('coordPrecision')));
  if (src.one(fields.omschrijving)) body.append(el('h3', null, t('headingDescription')), el('p', null, src.one(fields.omschrijving)));

  const plantenBox = el('div', 'loading', t('statusLoading'));
  const sporenBox = el('div', 'loading', t('statusLoading'));
  const litBox = el('div', 'loading', t('statusLoading'));
  body.append(el('h3', null, t('headingPlants')), plantenBox, el('h3', null, t('headingFeatures')), sporenBox, el('h3', null, t('headingLiterature')), litBox);
  const wnr = src.one(fields.waarnemingsnummer);
  const onzeker = src.one(fields.waarnemingsnummerOnzeker) === 'true';
  let verwantBox = null;
  if (wnr && !onzeker) {
    verwantBox = el('div', 'loading', t('statusLooking'));
    body.append(el('h3', null, t('headingRelated')), verwantBox);
  }
  qs('.detail-panel', paneel).scrollTop = 0;
  qs('.detail-panel', paneel).focus();

  const uri = hit._id;
  fetchPlanten(uri, signal).then((p) => renderPlanten(plantenBox, p, src), (e) => { if (e.name !== 'AbortError') laadFout(plantenBox, 'plantsLoadError', e); });
  fetchSporen(uri, signal).then((s) => renderSporen(sporenBox, s), (e) => { if (e.name !== 'AbortError') laadFout(sporenBox, 'featuresLoadError', e); });
  fetchLiteratuur(uri, signal).then((l) => renderLiteratuur(litBox, l), (e) => { if (e.name !== 'AbortError') laadFout(litBox, 'litLoadError', e); });
  if (verwantBox) {
    Promise.allSettled([fetchErfgoed(wnr, signal), fetchBoneInfo(wnr, signal)]).then(([a, b]) => {
      if (signal.aborted) return;
      if (a.status === 'rejected' && b.status === 'rejected') laadFout(verwantBox, 'relatedError', a.reason);
      else renderVerwant(verwantBox, a.value ?? [], b.value ?? []);
    });
  }
}

function sluitDetail() {
  if (!detail) return;
  detail.controller.abort();
  qs('#detail-panel').hidden = true;
  document.body.style.overflow = '';
  detail.opener?.focus?.();
  detail = null;
  state.site = null;
  syncUrl();
}

function initDetail() {
  qs('#detail-close').addEventListener('click', sluitDetail);
  qs('#detail-scrim').addEventListener('click', sluitDetail);
  document.addEventListener('keydown', (e) => {
    if (!detail) return;
    if (e.key === 'Escape') { sluitDetail(); return; }
    if (e.key === 'Tab') { // focus blijft in het paneel
      const focusbaar = qsa('button, a[href], input, select, summary, [tabindex="0"]', qs('.detail-panel')).filter((n) => !n.disabled && n.offsetParent !== null);
      if (!focusbaar.length) return;
      const eerste = focusbaar[0], laatste = focusbaar[focusbaar.length - 1];
      if (e.shiftKey && (document.activeElement === eerste || document.activeElement === qs('.detail-panel'))) { e.preventDefault(); laatste.focus(); }
      else if (!e.shiftKey && document.activeElement === laatste) { e.preventDefault(); eerste.focus(); }
    }
  });
  qs('#detail-copy-link').addEventListener('click', async () => {
    const knop = qs('#detail-copy-link');
    const oud = knop.textContent;
    try { await navigator.clipboard.writeText(location.href); knop.textContent = t('detailCopied'); }
    catch { window.prompt('URL', location.href); }
    setTimeout(() => { knop.textContent = oud; }, 2200);
  });
}

// ---- export -----------------------------------------------------------------------------
function download(naam, type, inhoud) {
  const url = URL.createObjectURL(new Blob([inhoud], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = naam;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exporteer(soort) {
  const knop = qs(soort === 'csv' ? '#download-csv' : '#download-geojson');
  knop.disabled = true;
  try {
    const hits = await searchAll(state);
    if (soort === 'csv') download('radar-vindplaatsen.csv', 'text/csv;charset=utf-8', toCsv(hits));
    else download('radar-vindplaatsen.geojson', 'application/geo+json', JSON.stringify(toGeoJson(hits)));
  } catch (e) { toonFout(e); } finally { knop.disabled = false; }
}

// ---- invoer -----------------------------------------------------------------------------
function zetInvoer() {
  qs('#q').value = state.search;
  for (const key of ['plant', 'plaats', 'spoor', 'literatuur', 'nummer']) qs(`#${key}`).value = state.filters[key] ?? '';
  qs('#vanaf').value = state.filters.vanaf ?? '';
  qs('#tot').value = state.filters.tot ?? '';
  qs('#jaar-modus').value = state.filters.modus ?? 'overlapt';
  qs('#sort').value = state.sort;
  qs('#map-resolution').value = state.resolution;
}

function initInvoer() {
  qs('#search-form').addEventListener('submit', (e) => { e.preventDefault(); state.search = qs('#q').value.trim(); state.page = 0; run(); });
  for (const key of ['plant', 'plaats', 'spoor', 'literatuur', 'nummer']) {
    qs(`#${key}`).addEventListener('input', debounce(() => { const v = qs(`#${key}`).value.trim(); if (v) state.filters[key] = v; else delete state.filters[key]; state.page = 0; run(); }, 350));
  }
  const jaar = () => {
    const lees = (id) => { const v = qs(id).value.trim(); return v !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null; };
    const van = lees('#vanaf'), tot = lees('#tot');
    if (van != null) state.filters.vanaf = van; else delete state.filters.vanaf;
    if (tot != null) state.filters.tot = tot; else delete state.filters.tot;
    state.page = 0; run();
  };
  qs('#vanaf').addEventListener('change', jaar);
  qs('#tot').addEventListener('change', jaar);
  qs('#jaar-modus').addEventListener('change', () => { if (qs('#jaar-modus').value === 'binnen') state.filters.modus = 'binnen'; else delete state.filters.modus; state.page = 0; run(); });
  qs('#sort').addEventListener('change', () => { state.sort = qs('#sort').value; state.page = 0; run(); });
  qs('#map-resolution').addEventListener('change', () => { state.resolution = qs('#map-resolution').value; run(); });
  qs('#clear').addEventListener('click', () => { state.search = ''; state.filters = {}; state.page = 0; zetInvoer(); run(); });
  qs('#download-csv').addEventListener('click', () => exporteer('csv'));
  qs('#download-geojson').addEventListener('click', () => exporteer('geojson'));
  for (const code of LANGS) qs(`#lang-${code}`).addEventListener('click', () => {
    setLang(code);
    applyStaticI18n();
    if (lastData) renderAll(lastData);
    if (detail) openDetail(detail.hit);
  });
}

async function init() {
  Object.assign(state, fromParams(location.search));
  applyStaticI18n();
  zetInvoer();
  initMap();
  initTimeline();
  initDetail();
  initInvoer();
  await run();
  if (state.site != null) {
    try {
      const hit = await findBySiteNr(state.site);
      if (hit) openDetail(hit);
    } catch { /* de lijst werkt ook zonder */ }
  }
}

init();

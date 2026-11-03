// Querybuilder en Elasticsearch-client voor RADAR. Geen DOM-afhankelijkheden,
// zodat dit los te testen is (zie tests/web.test.mjs).
//
// De index heeft één document per vindplaats (site), gemaakt met construct/radar.rq.
// Veldnamen zijn de property-IRI's uit de zoekprojectie, met een spatie in plaats van
// elke punt (zo noemt TriplyDB ze).

export const ES_ENDPOINT =
  'https://api.linkeddata.cultureelerfgoed.nl/datasets/archeobotanie/radar-elastic/services/Radar/_search';

const RE = 'https://linkeddata cultureelerfgoed nl/def/radar-elastic#';
export const WKT_FIELD = 'http://www opengis net/ont/geosparql#asWKT';

const NAMEN = [
  'siteNr', 'biaxId', 'waarnemingsnummer', 'waarnemingsnummerOnzeker', 'zaaknummer', 'locatienaam', 'plaats',
  'provincie', 'complextype', 'archeoregio', 'omschrijving', 'coordinaatNauwkeurigheid', 'dateringBron',
  'beginperiode', 'eindperiode', 'periodecode', 'beginjaar', 'eindjaar', 'soortSpoor', 'aantalSporen',
  'aantalMonsters', 'aantalWaarnemingen', 'wetenschappelijkeNaam', 'plantnaam', 'familie',
  'gebruiksplantCategorie', 'taxonUri', 'bewaringswijze', 'plantdeel', 'monstertype', 'auteur', 'titel',
  'publicatiejaar', 'tijdschrift', 'onderzoeksinstantie', 'rapportUrl',
];
export const fields = Object.fromEntries(NAMEN.map((naam) => [naam, RE + naam]));
export const kw = (key) => `${fields[key]}.keyword`;

// Facetten in de zijbalk: elke facet is een `terms`-aggregatie die alle *andere* actieve
// filters respecteert, zodat de tellingen onderling kloppen.
export const facets = ['provincie', 'archeoregio', 'complextype', 'beginperiode', 'bewaringswijze', 'plantdeel', 'gebruiksplantCategorie', 'familie'];

export const PAGE_SIZE = 25;
const MAX_EXPORT = 3000; // ruim boven het aantal vindplaatsen (1.630)

const SEARCH_FIELDS = [
  'locatienaam', 'plaats', 'complextype', 'provincie', 'archeoregio', 'omschrijving', 'plantnaam',
  'wetenschappelijkeNaam', 'familie', 'soortSpoor', 'beginperiode', 'eindperiode', 'periodecode',
  'titel', 'auteur', 'tijdschrift', 'onderzoeksinstantie',
].map((k) => fields[k]);

// "bool_prefix": het laatste (nog onvolledig getypte) woord mag een voorvoegsel zijn, de overige woorden
// moeten volledig matchen. Zonder dit vond "Hord" niets voor "Hordeum".
const prefixQuery = (query, fieldList) => ({ multi_match: { query, type: 'bool_prefix', operator: 'and', fields: fieldList } });

export function textQuery(q) {
  if (!q || !q.trim()) return { match_all: {} };
  // Aanhalingstekens = bewust een exacte zin: dan geen prefix-matching.
  if (q.includes('"')) return { simple_query_string: { query: q, fields: SEARCH_FIELDS, default_operator: 'and' } };
  return prefixQuery(q, SEARCH_FIELDS);
}

// ---- tijd -------------------------------------------------------------------------------
// De tijdband bovenaan: elke kolom is een tijdvak. De tijdschaal is niet lineair: de jongere
// perioden hebben meer en kortere kolommen, omdat daar de meeste vindplaatsen zitten. Een vindplaats
// telt mee in elke kolom waar zijn datering (beginjaar tot eindjaar) mee overlapt.
export const PERIODES = [
  { id: 'meso', van: -8800, tot: -5300, kolommen: 4 },
  { id: 'neo', van: -5300, tot: -2000, kolommen: 5 },
  { id: 'brons', van: -2000, tot: -800, kolommen: 4 },
  { id: 'ijzer', van: -800, tot: -12, kolommen: 4 },
  { id: 'romeins', van: -12, tot: 450, kolommen: 5 },
  { id: 'vme', van: 450, tot: 1050, kolommen: 6 },
  { id: 'lme', van: 1050, tot: 1500, kolommen: 6 },
  { id: 'nt', van: 1500, tot: 2000, kolommen: 5 },
];
export const TIJDVAKKEN = PERIODES.flatMap((p) =>
  Array.from({ length: p.kolommen }, (_, k) => {
    const lengte = p.tot - p.van;
    const van = p.van + Math.floor((k * lengte) / p.kolommen);
    const tot = k === p.kolommen - 1 ? p.tot : p.van + Math.floor(((k + 1) * lengte) / p.kolommen) - 1;
    return { id: `${p.id}${k}`, periode: p.id, van, tot };
  })
);

export const jaarOverlapt = (van, tot) => ({
  bool: { filter: [{ range: { [fields.beginjaar]: { lte: tot } } }, { range: { [fields.eindjaar]: { gte: van } } }] },
});

// Jaarfilter: "overlapt" (standaard; een breed gedateerde site telt al snel mee) of "binnen" (strenger).
export function jaarClause({ vanaf = null, tot = null, modus = 'overlapt' } = {}) {
  const b = fields.beginjaar;
  const e = fields.eindjaar;
  const filter =
    modus === 'binnen'
      ? [vanaf != null && { range: { [b]: { gte: vanaf } } }, tot != null && { range: { [e]: { lte: tot } } }]
      : [tot != null && { range: { [b]: { lte: tot } } }, vanaf != null && { range: { [e]: { gte: vanaf } } }];
  return { bool: { filter: filter.filter(Boolean) } };
}

// ---- filters ----------------------------------------------------------------------------
// `exclude` laat een facet of veld zijn eigen filter overslaan (nodig zodat de aggregatie voor facet X
// niet door een al actief filter op X zelf wordt ingeperkt).
export function filterClauses(filters = {}, exclude = null) {
  const clauses = [];
  for (const key of facets) {
    const values = filters[key];
    if (key !== exclude && values?.length) clauses.push({ terms: { [kw(key)]: values } });
  }
  if (exclude !== 'taxon' && filters.taxon?.length) clauses.push({ terms: { [kw('wetenschappelijkeNaam')]: filters.taxon } });
  if (exclude !== 'plant' && filters.plant) clauses.push(prefixQuery(filters.plant, [fields.plantnaam, fields.wetenschappelijkeNaam]));
  if (exclude !== 'plaats' && filters.plaats) clauses.push(prefixQuery(filters.plaats, [fields.plaats, fields.locatienaam]));
  if (exclude !== 'spoor' && filters.spoor) clauses.push(prefixQuery(filters.spoor, [fields.soortSpoor]));
  if (exclude !== 'literatuur' && filters.literatuur) clauses.push(prefixQuery(filters.literatuur, [fields.titel, fields.auteur, fields.tijdschrift, fields.onderzoeksinstantie]));
  if (exclude !== 'nummer' && filters.nummer) {
    const nr = String(filters.nummer).trim();
    clauses.push({ bool: { should: ['siteNr', 'waarnemingsnummer', 'zaaknummer'].map((k) => ({ term: { [kw(k)]: nr } })), minimum_should_match: 1 } });
  }
  if (exclude !== 'jaar' && (filters.vanaf != null || filters.tot != null)) clauses.push(jaarClause(filters));
  return clauses;
}

const gefilterd = (filters, exclude) => ({ bool: { filter: filterClauses(filters, exclude) } });

function facetAggs(filters) {
  return Object.fromEntries(
    facets.map((key) => [key, { filter: gefilterd(filters, key), aggs: { values: { terms: { field: kw(key), size: 100 } } } }])
  );
}

// Rasterresolutie voor de kaart. 'locaties' groepeert punten op (bijna) dezelfde brongeometrie
// (geohash_grid precision 10, ~1 m); de overige niveaus gebruiken geotile_grid. Dit is een weergavekeuze,
// geen locatienauwkeurigheid.
export const MAP_RESOLUTIONS = { locaties: null, '1km': 14, '5km': 12, '10km': 11, '25km': 10 };

export function geoAgg(filters, resolution = 'locaties') {
  const zoom = MAP_RESOLUTIONS[resolution] ?? null;
  const grid = zoom === null
    ? { geohash_grid: { field: WKT_FIELD, precision: 10, size: 10000 } }
    : { geotile_grid: { field: WKT_FIELD, precision: zoom, size: 10000 } };
  return { filter: gefilterd(filters, null), aggs: { locaties: { ...grid, aggs: { middelpunt: { geo_centroid: { field: WKT_FIELD } } } } } };
}

// Wat de selectie bevat: aantallen die meebewegen met de filters.
export const statistiekAgg = (filters) => ({
  filter: gefilterd(filters, null),
  aggs: {
    waarnemingen: { sum: { field: fields.aantalWaarnemingen } },
    sporen: { sum: { field: fields.aantalSporen } },
    monsters: { sum: { field: fields.aantalMonsters } },
    taxa: { cardinality: { field: kw('wetenschappelijkeNaam'), precision_threshold: 3000 } },
  },
});

// De meest gevonden planten in de selectie; het taxonfilter zelf telt niet mee, zodat je kunt wisselen.
export const topTaxaAgg = (filters, size = 15) => ({
  filter: gefilterd(filters, 'taxon'),
  aggs: { values: { terms: { field: kw('wetenschappelijkeNaam'), size } } },
});

// De tijdband: per kolom het aantal vindplaatsen dat overlapt. Het jaarfilter zelf telt niet mee,
// zodat de band de hele selectie blijft laten zien terwijl je er een periode in kiest.
export const tijdAgg = (filters) => ({
  filter: gefilterd(filters, 'jaar'),
  aggs: {
    vakken: {
      filters: { filters: Object.fromEntries(TIJDVAKKEN.map((v) => [v.id, jaarOverlapt(v.van, v.tot)])) },
    },
  },
});

export const SORTEREN = ['relevantie', 'jaar', 'plaats', 'planten'];

export function sortClause(sort) {
  if (sort === 'jaar') return [{ [fields.beginjaar]: { order: 'asc', missing: '_last' } }];
  if (sort === 'plaats') return [{ [kw('plaats')]: { order: 'asc', missing: '_last' } }];
  if (sort === 'planten') return [{ [fields.aantalWaarnemingen]: { order: 'desc', missing: '_last' } }];
  return undefined;
}

export function buildQuery({ search = '', filters = {}, page = 0, sort = 'relevantie', resolution = 'locaties' } = {}) {
  const sorteer = sortClause(sort);
  return {
    from: page * PAGE_SIZE,
    size: PAGE_SIZE,
    track_total_hits: true,
    timeout: '15s',
    query: textQuery(search),
    post_filter: gefilterd(filters, null),
    ...(sorteer ? { sort: sorteer } : {}),
    highlight: { fields: { [fields.omschrijving]: {}, [fields.plantnaam]: {} }, pre_tags: ['<mark>'], post_tags: ['</mark>'], fragment_size: 180 },
    aggs: {
      ...facetAggs(filters),
      kaart: geoAgg(filters, resolution),
      statistiek: statistiekAgg(filters),
      topTaxa: topTaxaAgg(filters),
      tijd: tijdAgg(filters),
    },
  };
}

export function buildExportQuery({ search = '', filters = {}, sort = 'relevantie' } = {}) {
  const q = buildQuery({ search, filters, page: 0, sort });
  return { ...q, size: MAX_EXPORT, aggs: undefined, highlight: undefined };
}

// ---- client -----------------------------------------------------------------------------
export class ZoekFout extends Error {
  constructor(soort, status) { super(soort); this.soort = soort; this.status = status; }
}

async function runEsQuery(body, signal) {
  let res;
  try {
    res = await fetch(ES_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ZoekFout('netwerk');
  }
  if (!res.ok) throw new ZoekFout(res.status === 503 ? 'onbeschikbaar' : 'algemeen', res.status);
  return res.json();
}

export const search = (state, signal) => runEsQuery(buildQuery(state), signal);
export const searchAll = async (state) => (await runEsQuery(buildExportQuery(state))).hits.hits;

// Eén document op sitenummer (bijvoorbeeld een site openen via een gedeelde link).
export async function findBySiteNr(siteNr) {
  const data = await runEsQuery({ size: 1, query: { term: { [kw('siteNr')]: String(siteNr) } } });
  return data.hits.hits[0] || null;
}

// Handige lezer voor een hit: één waarde, alle waarden.
export function hitSource(hit) {
  const s = hit._source || {};
  const many = (f) => (Array.isArray(s[f]) ? s[f] : s[f] != null ? [s[f]] : []);
  const one = (f) => many(f)[0];
  return { hit, one, many, raw: s };
}

// Jaartal-weergave: v.Chr.-jaren zijn gewone negatieve gehele getallen in de index.
export function jaarTekst(jaar, bc = 'v.Chr.', ad = 'n.Chr.') {
  if (jaar == null || jaar === '') return null;
  const n = Number(jaar);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? `${-n} ${bc}` : `${n} ${ad}`;
}

// Een groep taxa staat in de bron met '|' ("Carex otrubae|Carex vulpina"); in de tekst als "a / b".
export const taxonTekst = (naam) => String(naam ?? '').replaceAll('|', ' / ');

// ---- URL-staat --------------------------------------------------------------------------
const LIJSTEN = { provincie: 'prov', archeoregio: 'regio', complextype: 'type', beginperiode: 'per', bewaringswijze: 'bew', plantdeel: 'deel', gebruiksplantCategorie: 'cat', familie: 'fam', taxon: 'taxon' };
const TEKSTEN = { plant: 'plant', plaats: 'plaats', spoor: 'spoor', literatuur: 'lit', nummer: 'nr' };

export function toParams(state = {}) {
  const p = new URLSearchParams();
  if (state.search) p.set('q', state.search);
  for (const [key, param] of Object.entries(LIJSTEN)) for (const v of state.filters?.[key] ?? []) p.append(param, v);
  for (const [key, param] of Object.entries(TEKSTEN)) if (state.filters?.[key]) p.set(param, state.filters[key]);
  if (state.filters?.vanaf != null) p.set('van', String(state.filters.vanaf));
  if (state.filters?.tot != null) p.set('tot', String(state.filters.tot));
  if (state.filters?.modus && state.filters.modus !== 'overlapt') p.set('modus', state.filters.modus);
  if (state.sort && state.sort !== 'relevantie') p.set('sorteer', state.sort);
  if (state.page) p.set('pagina', String(state.page + 1));
  if (state.resolution && state.resolution !== 'locaties') p.set('raster', state.resolution);
  if (state.site) p.set('site', String(state.site));
  return p;
}

export function fromParams(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const getal = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);
  const filters = {};
  for (const [key, param] of Object.entries(LIJSTEN)) { const v = p.getAll(param).filter(Boolean); if (v.length) filters[key] = v; }
  for (const [key, param] of Object.entries(TEKSTEN)) { const v = p.get(param); if (v) filters[key] = v; }
  const van = getal(p.get('van')), tot = getal(p.get('tot'));
  if (van != null) filters.vanaf = van;
  if (tot != null) filters.tot = tot;
  if (p.get('modus') === 'binnen') filters.modus = 'binnen';
  const sort = SORTEREN.includes(p.get('sorteer')) ? p.get('sorteer') : 'relevantie';
  const raster = Object.hasOwn(MAP_RESOLUTIONS, p.get('raster')) ? p.get('raster') : 'locaties';
  const pagina = getal(p.get('pagina'));
  const site = getal(p.get('site'));
  return { search: p.get('q') ?? '', filters, sort, resolution: raster, page: pagina && pagina > 0 ? Math.min(pagina - 1, 399) : 0, site };
}

// ---- export -----------------------------------------------------------------------------
const csvCel = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // geen formules in Excel
  return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toCsv(hits) {
  const kop = ['sitenummer', 'locatienaam', 'plaats', 'provincie', 'complextype', 'beginperiode', 'eindperiode', 'beginjaar', 'eindjaar', 'waarnemingsnummer', 'plantenwaarnemingen', 'taxa', 'uri'];
  const rijen = hits.map((hit) => {
    const s = hitSource(hit);
    return [
      s.one(fields.siteNr), s.one(fields.locatienaam), s.one(fields.plaats), s.one(fields.provincie), s.one(fields.complextype),
      s.one(fields.beginperiode), s.one(fields.eindperiode), s.one(fields.beginjaar), s.one(fields.eindjaar), s.one(fields.waarnemingsnummer),
      s.one(fields.aantalWaarnemingen), s.many(fields.wetenschappelijkeNaam).map(taxonTekst).join(' | '), hit._id,
    ];
  });
  return `﻿${[kop, ...rijen].map((r) => r.map(csvCel).join(';')).join('\r\n')}\r\n`;
}

export function toGeoJson(hits) {
  const features = [];
  for (const hit of hits) {
    const s = hitSource(hit);
    const m = /point\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(s.one(WKT_FIELD) || '');
    if (!m) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(m[1]), Number(m[2])] },
      properties: {
        sitenummer: s.one(fields.siteNr), locatienaam: s.one(fields.locatienaam), plaats: s.one(fields.plaats), provincie: s.one(fields.provincie),
        complextype: s.one(fields.complextype), beginjaar: s.one(fields.beginjaar), eindjaar: s.one(fields.eindjaar),
        plantenwaarnemingen: s.one(fields.aantalWaarnemingen), uri: hit._id,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

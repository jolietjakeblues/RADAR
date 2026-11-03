// Unit-tests voor de zoeksite (web/), zonder netwerk. Gebruik: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuery, buildExportQuery, filterClauses, jaarClause, textQuery, fields, kw, facets, TIJDVAKKEN, PERIODES, tijdAgg,
  toParams, fromParams, toCsv, toGeoJson, hitSource, jaarTekst, taxonTekst, MAP_RESOLUTIONS, PAGE_SIZE, WKT_FIELD, ES_ENDPOINT,
} from '../web/search.js';
import { groepeerPlanten, groepeerSporen, bewaringTotalen, plantenQuery, sporenQuery, literatuurQuery, safeUrl } from '../web/detail.js';
import { STRINGS, LANGS, setLang, t, bewaringLabel, bewaringSoort, deelLabel, facetLabel } from '../web/i18n.js';
import { parsePoint, centroidLatLon } from '../web/geo.js';
import { zoekdemoUrlVoor } from '../web/related.js';
import { readFileSync } from 'node:fs';

const SITE = 'https://linkeddata.cultureelerfgoed.nl/archeobotanie/id/radar/site/100';

test('Endpoint en veldnamen volgen de projectie (spaties in plaats van punten)', () => {
  assert.match(ES_ENDPOINT, /\/datasets\/archeobotanie\/radar-elastic\/services\/Radar\/_search$/);
  assert.equal(fields.provincie, 'https://linkeddata cultureelerfgoed nl/def/radar-elastic#provincie');
  assert.equal(WKT_FIELD, 'http://www opengis net/ont/geosparql#asWKT');
  assert.equal(kw('plantnaam'), `${fields.plantnaam}.keyword`);
});

test('Zoeken (query) en filteren (post_filter) blijven gescheiden; facetten tellen zonder hun eigen filter', () => {
  const body = buildQuery({ search: 'gerst', filters: { provincie: ['Gelderland'], bewaringswijze: ['carbonized/verkoold'] }, page: 2 });
  assert.equal(body.from, 2 * PAGE_SIZE);
  assert.equal(body.track_total_hits, true);
  assert.equal(body.query.multi_match.type, 'bool_prefix');
  assert.deepEqual(body.post_filter.bool.filter, [
    { terms: { [kw('provincie')]: ['Gelderland'] } },
    { terms: { [kw('bewaringswijze')]: ['carbonized/verkoold'] } },
  ]);
  assert.deepEqual(body.aggs.provincie.filter.bool.filter, [{ terms: { [kw('bewaringswijze')]: ['carbonized/verkoold'] } }]);
  assert.deepEqual(body.aggs.bewaringswijze.filter.bool.filter, [{ terms: { [kw('provincie')]: ['Gelderland'] } }]);
  assert.equal(Object.keys(body.aggs).filter((k) => facets.includes(k)).length, facets.length);
  assert.deepEqual(buildQuery().query, { match_all: {} });
});

test('Aanhalingstekens geven een exacte zin, zonder prefix-matching', () => {
  assert.ok(textQuery('"Hordeum vulgare"').simple_query_string);
  assert.ok(textQuery('Hord').multi_match);
  assert.deepEqual(textQuery('   '), { match_all: {} });
});

test('Taxonfilter: exacte wetenschappelijke naam; de lijst met meest gevonden planten negeert dat filter zelf', () => {
  const filters = { taxon: ['Hordeum vulgare'], provincie: ['Zeeland'] };
  assert.deepEqual(filterClauses(filters).slice(-1)[0], { terms: { [kw('wetenschappelijkeNaam')]: ['Hordeum vulgare'] } });
  const body = buildQuery({ filters });
  assert.deepEqual(body.aggs.topTaxa.filter.bool.filter, [{ terms: { [kw('provincie')]: ['Zeeland'] } }], 'wisselen tussen planten blijft mogelijk');
  assert.deepEqual(body.aggs.statistiek.filter.bool.filter.length, 2, 'de aantallen bovenaan volgen alle filters');
});

test('Tekstfilters zoeken met voorvoegsel in de juiste velden; nummers exact', () => {
  const f = filterClauses({ plant: 'gers', plaats: 'Zwo', spoor: 'put', literatuur: 'Bult', nummer: ' 100 ' });
  assert.equal(f.length, 5);
  assert.deepEqual(f[0].multi_match.fields, [fields.plantnaam, fields.wetenschappelijkeNaam]);
  assert.deepEqual(f[1].multi_match.fields, [fields.plaats, fields.locatienaam]);
  assert.deepEqual(f[4].bool.should.map((s) => Object.values(s.term)[0]), ['100', '100', '100']);
});

test('Jaarfilter: overlapt (standaard) of valt helemaal binnen; negatieve jaren zijn v.Chr.', () => {
  assert.deepEqual(jaarClause({ vanaf: -800, tot: 100 }).bool.filter, [
    { range: { [fields.beginjaar]: { lte: 100 } } },
    { range: { [fields.eindjaar]: { gte: -800 } } },
  ]);
  assert.deepEqual(jaarClause({ vanaf: -800, tot: 100, modus: 'binnen' }).bool.filter, [
    { range: { [fields.beginjaar]: { gte: -800 } } },
    { range: { [fields.eindjaar]: { lte: 100 } } },
  ]);
  assert.equal(jaarClause({ vanaf: 5 }).bool.filter.length, 1);
});

test('Tijdband: 39 aaneengesloten tijdvakken van 8800 v.Chr. tot 2000; de jongere perioden hebben meer kolommen', () => {
  assert.equal(TIJDVAKKEN.length, PERIODES.reduce((s, p) => s + p.kolommen, 0));
  assert.equal(TIJDVAKKEN[0].van, -8800);
  assert.equal(TIJDVAKKEN.at(-1).tot, 2000);
  // binnen een periode begint een kolom een jaar na de vorige; een nieuwe periode begint op het jaar waarop de vorige eindigt
  for (let i = 1; i < TIJDVAKKEN.length; i++) {
    const vorige = TIJDVAKKEN[i - 1], nu = TIJDVAKKEN[i];
    assert.equal(nu.van, nu.periode === vorige.periode ? vorige.tot + 1 : vorige.tot, `kolom ${i} sluit aan op de vorige`);
  }
  assert.ok(TIJDVAKKEN.every((v) => v.van <= v.tot));
  assert.equal(new Set(TIJDVAKKEN.map((v) => v.id)).size, TIJDVAKKEN.length);
  const agg = tijdAgg({ vanaf: 0, tot: 100, provincie: ['Utrecht'] });
  assert.equal(Object.keys(agg.aggs.vakken.filters.filters).length, TIJDVAKKEN.length);
  assert.deepEqual(agg.filter.bool.filter, [{ terms: { [kw('provincie')]: ['Utrecht'] } }], 'de band negeert het jaarfilter zelf');
});

test('Sorteren op plantenwaarnemingen en jaar; kaartraster', () => {
  assert.deepEqual(buildQuery({ sort: 'planten' }).sort, [{ [fields.aantalWaarnemingen]: { order: 'desc', missing: '_last' } }]);
  assert.deepEqual(buildQuery({ sort: 'jaar' }).sort, [{ [fields.beginjaar]: { order: 'asc', missing: '_last' } }]);
  assert.equal(buildQuery({ sort: 'relevantie' }).sort, undefined);
  assert.ok(buildQuery({ resolution: '5km' }).aggs.kaart.aggs.locaties.geotile_grid);
  assert.ok(buildQuery({ resolution: 'locaties' }).aggs.kaart.aggs.locaties.geohash_grid);
  assert.equal(Object.keys(MAP_RESOLUTIONS).length, 5);
});

test('Export: alle treffers, zonder aggregaties of highlight', () => {
  const q = buildExportQuery({ search: 'gerst', filters: { provincie: ['Zeeland'] } });
  assert.ok(q.size >= 1630);
  assert.equal(q.aggs, undefined);
  assert.equal(q.highlight, undefined);
});

test('Deelbare URL: heen en terug; onbekende waarden worden genegeerd', () => {
  const state = { search: 'gerst', filters: { provincie: ['Zeeland', 'Utrecht'], taxon: ['Hordeum vulgare'], plant: 'gers', vanaf: -800, tot: 100, modus: 'binnen' }, sort: 'planten', page: 2, resolution: '5km', site: 100 };
  const params = toParams(state);
  assert.deepEqual(fromParams(params), state);
  assert.equal(toParams({ search: '', filters: {}, sort: 'relevantie', page: 0, resolution: 'locaties' }).toString(), '');
  const rommel = fromParams('sorteer=niets&raster=1m&pagina=-4&van=abc&site=x&modus=raar&prov=');
  assert.equal(rommel.sort, 'relevantie'); assert.equal(rommel.resolution, 'locaties'); assert.equal(rommel.page, 0);
  assert.equal(rommel.filters.vanaf, undefined); assert.equal(rommel.site, null); assert.equal(rommel.filters.modus, undefined); assert.equal(rommel.filters.provincie, undefined);
  assert.equal(fromParams('pagina=99999').page, 399, 'niet voorbij het zoekvenster van Elasticsearch');
});

test('Hulpfuncties: jaartal, groepsnaam, hit lezen', () => {
  assert.equal(jaarTekst(-800), '800 v.Chr.');
  assert.equal(jaarTekst(1500, 'BC', 'AD'), '1500 AD');
  assert.equal(jaarTekst(null), null); assert.equal(jaarTekst('x'), null);
  assert.equal(taxonTekst('Carex otrubae|Carex vulpina'), 'Carex otrubae / Carex vulpina');
  const s = hitSource({ _source: { [fields.plaats]: ['Zwolle'], [fields.beginjaar]: '100' } });
  assert.equal(s.one(fields.plaats), 'Zwolle'); assert.deepEqual(s.many(fields.beginjaar), ['100']); assert.deepEqual(s.many(fields.titel), []);
});

test('CSV: puntkomma, quotes en geen formules; GeoJSON met punten', () => {
  const hits = [{ _id: SITE, _source: { [fields.siteNr]: ['100'], [fields.locatienaam]: ['=SOM(1)'], [fields.plaats]: ['A; "B"'], [fields.wetenschappelijkeNaam]: ['Avena', 'Carex a|Carex b'], [WKT_FIELD]: ['POINT (4.5 52.1)'] } }];
  const csv = toCsv(hits);
  assert.ok(csv.startsWith('﻿sitenummer;'));
  assert.ok(csv.includes("'=SOM(1)"));
  assert.ok(csv.includes('"A; ""B"""'));
  assert.ok(csv.includes('Avena | Carex a / Carex b'));
  const geo = toGeoJson([...hits, { _id: 'x', _source: {} }]);
  assert.equal(geo.features.length, 1);
  assert.deepEqual(geo.features[0].geometry.coordinates, [4.5, 52.1]);
});

test('WKT en kaartcentra', () => {
  assert.deepEqual(parsePoint('POINT (5.852071 51.779803)'), [5.852071, 51.779803]);
  assert.deepEqual(parsePoint(['Point(4 52)']), [4, 52]);
  assert.equal(parsePoint('POLYGON ((1 1))'), null); assert.equal(parsePoint(null), null);
  assert.deepEqual(centroidLatLon({ middelpunt: { location: { lat: 52, lon: 5 } } }), [52, 5]);
  assert.equal(centroidLatLon({}), null);
});

// ---- detail: planten, sporen, literatuur -----------------------------------------------------
test('Planten: rijen per (plant, bewaring, deel) worden één rij per plant, meeste waarnemingen eerst', () => {
  const rows = [
    { latijn: 'Avena', naam: 'Haver', bewaring: 'carbonized/verkoold', deel: 'seed s.l.', n: '5', monsters: '3' },
    { latijn: 'Avena', naam: 'Haver', bewaring: 'carbonized/verkoold', deel: 'chaff (unspecified)', n: '2', monsters: '2' },
    { latijn: 'Hordeum vulgare', naam: 'Gerst', bewaring: 'waterlogged/onverkoold', deel: 'seed s.l.', n: '9', monsters: '4' },
    { latijn: 'Avena', naam: 'Haver', bewaring: 'waterlogged/onverkoold', deel: 'seed s.l.', n: '1', monsters: '1' },
    { naam: 'zonder latijn', n: '3' },
  ];
  const planten = groepeerPlanten(rows);
  assert.deepEqual(planten.map((p) => [p.latijn, p.n]), [['Avena', 8], ['Hordeum vulgare', 9]].sort((a, b) => b[1] - a[1]));
  const avena = planten.find((p) => p.latijn === 'Avena');
  assert.equal(avena.monsters, 3, 'het maximum over de rijen is de ondergrens van het aantal monsters');
  assert.deepEqual([...avena.bewaring], [['carbonized/verkoold', 7], ['waterlogged/onverkoold', 1]]);
  assert.deepEqual(bewaringTotalen(planten), [{ key: 'waterlogged/onverkoold', n: 10 }, { key: 'carbonized/verkoold', n: 7 }]);
  assert.deepEqual(groepeerPlanten([]), []);
});

test('Sporen: gegroepeerd per soort, ongeacht hoofdletters, met jaarbereik', () => {
  const g = groepeerSporen([
    { soort: 'KUIL', jaarB: '-800', jaarE: '-500', monsters: '2', n: '10' },
    { soort: 'kuil', jaarB: '-900', jaarE: '-700', monsters: '1', n: '4' },
    { soort: 'Waterput', monsters: '0', n: '0' },
    { soort: null, monsters: '1', n: '2' },
  ]);
  const kuil = g.find((s) => s.soort === 'kuil');
  assert.deepEqual([kuil.sporen, kuil.monsters, kuil.waarnemingen, kuil.van, kuil.tot], [2, 3, 14, -900, -500]);
  assert.equal(g[0].soort, 'kuil', 'meeste sporen eerst');
  assert.ok(g.some((s) => s.soort === null));
});

test('SPARQL: alleen sites uit de eigen namespace komen in een query; literals worden veilig', () => {
  assert.match(plantenQuery(SITE), /<https:\/\/linkeddata\.cultureelerfgoed\.nl\/archeobotanie\/id\/radar\/site\/100>/);
  assert.match(sporenQuery(SITE), /ceo:Grondsporen/);
  assert.match(literatuurQuery(SITE), /schema:about <https:/);
  for (const slecht of ['http://evil.example/site/1', `${SITE}> } DROP ALL { <x`, `${SITE}x`, '']) {
    assert.throws(() => plantenQuery(slecht), /Onbekende vindplaats/, slecht);
    assert.throws(() => sporenQuery(slecht));
    assert.throws(() => literatuurQuery(slecht));
  }
});

test('Links uit de brondata: alleen http(s)', () => {
  assert.equal(safeUrl('http://www.biax.nl/resources/content/report_file_2153_567.pdf'), 'http://www.biax.nl/resources/content/report_file_2153_567.pdf');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('xxx'), null); assert.equal(safeUrl(null), null);
});

test('Kruislink naar het erfgoedregister: alleen een numerieke URI krijgt een diepe link', () => {
  const url = zoekdemoUrlVoor('https://linkeddata.cultureelerfgoed.nl/cho-kennis/id/vondstlocatie/6173291', 'Vondstlocatie');
  assert.match(url, /^https:\/\/erfgoed-cho-zoekdemo\.jolietjakeblues64\.workers\.dev\/\?q=%226173291%22&veld=Nummer&soort=vondstlocatie$/);
  assert.equal(zoekdemoUrlVoor('https://x/y/abc', 'Vondstlocatie'), null);
  assert.equal(zoekdemoUrlVoor(null, 'x'), null);
});

// ---- teksten -----------------------------------------------------------------------------
test('Teksten: NL en EN hebben dezelfde sleutels, en functies blijven functies', () => {
  const nl = Object.keys(STRINGS.nl).sort(), en = Object.keys(STRINGS.en).sort();
  assert.deepEqual(nl, en);
  for (const key of nl) assert.equal(typeof STRINGS.nl[key], typeof STRINGS.en[key], key);
  for (const key of ['facets', 'periodes', 'periodesKort', 'detailLabels', 'plantTable', 'mapResolutions']) assert.deepEqual(Object.keys(STRINGS.nl[key]).sort(), Object.keys(STRINGS.en[key]).sort(), key);
  assert.deepEqual(Object.keys(STRINGS.nl.periodes).sort(), PERIODES.map((p) => p.id).sort(), 'elke periode in de tijdband heeft een naam');
  assert.deepEqual(Object.keys(STRINGS.nl.facets).sort(), [...facets].sort(), 'elke facet heeft een label');
});

test('Teksten: elke data-i18n in de HTML bestaat, en er staat geen kop met een slogan meer in de hero', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 40);
  for (const key of keys) {
    if (key.startsWith('facet_')) assert.ok(STRINGS.nl.facets[key.slice(6)], key);
    else assert.ok(key in STRINGS.nl, key);
  }
  assert.equal((html.match(/<h1/g) || []).length, 1, 'één h1 (voor schermlezers)');
  assert.doesNotMatch(html, /Wat groeide en at men/);
  assert.ok(!('heroTitle' in STRINGS.nl) && !('heroTitle' in STRINGS.en));
});

test('Teksten: getallen, meervoud en taalwissel', () => {
  setLang('nl');
  assert.equal(t('resultCount', 1), '1 vindplaats');
  assert.equal(t('resultCount', 1630), '1.630 vindplaatsen');
  assert.equal(t('selection', 351, 59076, 1194), 'Deze selectie heeft 351 vindplaatsen, 59.076 plantenwaarnemingen en 1.194 taxa.');
  assert.equal(t('niet-bestaande-sleutel'), 'niet-bestaande-sleutel');
  setLang('en');
  assert.equal(t('resultCount', 1), '1 site');
  assert.match(t('selection', 2, 3, 1), /2 sites, 3 plant records and 1 taxon/);
  setLang('xx'); assert.equal(t('resultCount', 2), '2 sites', 'onbekende taal verandert niets');
  setLang('nl');
  assert.deepEqual(LANGS, ['nl', 'en']);
});

test('Waarden uit de data: bewaringswijze (kleur en taal), plantdeel, categorie', () => {
  setLang('nl');
  assert.equal(bewaringLabel('carbonized/verkoold'), 'verkoold');
  assert.equal(facetLabel('plantdeel', 'seed s.l.'), 'zaad');
  assert.equal(facetLabel('plantdeel', 'iets onbekends'), 'iets onbekends');
  assert.equal(facetLabel('gebruiksplantCategorie', 'kruid_specerij'), 'kruid / specerij');
  setLang('en');
  assert.equal(bewaringLabel('carbonized/verkoold'), 'carbonized');
  assert.equal(deelLabel('seed s.l.'), 'seed s.l.');
  setLang('nl');
  const soorten = { 'carbonized/verkoold': 'verkoold', 'waterlogged/onverkoold': 'onverkoold', 'mineralized/gemineraliseerd': 'gemineraliseerd', 'impression/indruk': 'indruk', '(sub)recent': 'recent', 'unknown/onbekend': 'onbekend', '?': 'onbekend' };
  for (const [waarde, soort] of Object.entries(soorten)) assert.equal(bewaringSoort(waarde), soort, waarde);
});

test('Site: geen verwijzing naar bestanden die niet bestaan; CSP laat alleen de Triply-host en PDOK toe', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const lokaal = [...html.matchAll(/(?:src|href)="([a-z0-9-]+\.(?:js|css|svg))"/g)].map((m) => m[1]);
  assert.ok(lokaal.length >= 3);
  for (const f of lokaal) assert.ok(server.includes(`'${f}'`), `${f} staat in server.mjs`);
  for (const f of ['app.js', 'search.js', 'geo.js', 'detail.js', 'related.js', 'i18n.js', 'style.css', 'index.html', '404.html', 'favicon.svg']) assert.ok(readFileSync(new URL(`../web/${f}`, import.meta.url)), f);
  const headers = readFileSync(new URL('../web/_headers', import.meta.url), 'utf8');
  assert.match(headers, /connect-src https:\/\/api\.linkeddata\.cultureelerfgoed\.nl;/);
  assert.match(headers, /img-src 'self' data: https:\/\/service\.pdok\.nl https:\/\/unpkg\.com;/);
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"name": "radar"/, 'de Cloudflare-worker heet radar');
  assert.equal(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name, 'radar');
});

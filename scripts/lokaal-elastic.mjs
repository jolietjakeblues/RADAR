// Test triply/elastic-service.json tegen een lokale Elasticsearch (Docker): start een eigen container,
// laadt de templates zoals Triply ze krijgt, indexeert de documenten van de projectie
// (output/radar_<naam>_elastic.ndjson, gemaakt door scripts/controleer_construct.py) en controleert
// de types en een reeks zoekvragen. De zoekvragen worden uit de documenten zelf afgeleid, zodat ze
// niet van vaste voorbeelden afhangen.
// Gebruik: node scripts/lokaal-elastic.mjs [pilot|full] [--keep]
//   --keep laat de container staan (poort 9202) om zelf in te zoeken; anders wordt hij verwijderd.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const NAAM = process.argv.find(a => ['pilot', 'full'].includes(a)) ?? 'pilot';
const KEEP = process.argv.includes('--keep');
const CONTAINER = 'radar-elastic-test';
const PORT = 9202;
const ES = `http://127.0.0.1:${PORT}`;
const IMAGE = 'docker.elastic.co/elasticsearch/elasticsearch:8.17.0';
const RE = 'https://linkeddata cultureelerfgoed nl/def/radar-elastic#';
const GEO = 'http://www opengis net/ont/geosparql#asWKT';
const v = n => RE + n;

let fouten = 0;
const ok = (gelukt, tekst) => { console.log(`${gelukt ? 'ok  ' : 'FOUT'}  ${tekst}`); if (!gelukt) fouten++; };
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

async function es(method, path, body, ndjson = false) {
  const res = await fetch(ES + path, {
    method,
    headers: { 'Content-Type': ndjson ? 'application/x-ndjson' : 'application/json' },
    body: body === undefined ? undefined : ndjson ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// 0. container
try { docker('rm', '-f', CONTAINER); } catch { /* bestond niet */ }
docker('run', '-d', '--name', CONTAINER, '-p', `${PORT}:9200`, '-e', 'discovery.type=single-node',
  '-e', 'xpack.security.enabled=false', '-e', 'ES_JAVA_OPTS=-Xms1g -Xmx1g', IMAGE);
let klaar = false;
for (let i = 0; i < 90 && !klaar; i++) {
  try { klaar = (await fetch(`${ES}/_cluster/health`)).ok; } catch { /* nog niet klaar */ }
  if (!klaar) await new Promise(r => setTimeout(r, 2000));
}
if (!klaar) { console.error('Elasticsearch startte niet'); process.exit(1); }
console.log(`Elasticsearch ${(await (await fetch(ES)).json()).version.number} draait op ${ES}`);

try {
  // 1. templates, zoals in de service-configuratie
  const service = JSON.parse(readFileSync(new URL('../triply/elastic-service.json', import.meta.url), 'utf8'));
  for (const ct of service.config.componentTemplates) {
    const r = await es('PUT', `/_component_template/${ct.name}`, { template: ct.template });
    ok(r.status === 200, `component template ${ct.name} (${r.status}${r.status === 200 ? '' : ' ' + JSON.stringify(r.json.error?.reason ?? r.json)})`);
  }
  for (const it of service.config.indexTemplates) {
    const r = await es('PUT', `/_index_template/${it.name}`, { index_patterns: [it.index_patterns].flat(), composed_of: it.composed_of });
    ok(r.status === 200, `index template ${it.name} (${r.status}${r.status === 200 ? '' : ' ' + JSON.stringify(r.json.error?.reason ?? r.json)})`);
  }

  // 2. documenten
  const regels = readFileSync(new URL(`../output/radar_${NAAM}_elastic.ndjson`, import.meta.url), 'utf8').split('\n').filter(Boolean);
  const docs = regels.filter((_, i) => i % 2 === 1).map(l => JSON.parse(l));
  const bulk = regels.map(l => l.startsWith('{"index"') ? l.replace('"_index": "radar"', '"_index": "index"').replace('"_index":"radar"', '"_index":"index"') : l).join('\n') + '\n';
  const b = await es('POST', '/_bulk?refresh=true', bulk, true);
  const mislukt = (b.json.items ?? []).filter(i => i.index.error);
  ok(b.status === 200 && !b.json.errors, `bulk: ${b.json.items?.length ?? 0} geïndexeerd, ${mislukt.length} fouten`);
  for (const i of mislukt.slice(0, 5)) console.log(`      ${i.index._id}: ${i.index.error.type} ${i.index.error.reason}`);

  // 3. types in de mapping
  const mapping = (await es('GET', '/index/_mapping')).json.index.mappings.properties;
  const type = veld => mapping[veld]?.type;
  const verwacht = {
    [v('locatienaam')]: 'text', [v('plantnaam')]: 'text', [v('plaats')]: 'text', [v('wetenschappelijkeNaam')]: 'text',
    [v('waarnemingsnummer')]: 'text', [v('siteNr')]: 'text',
    [v('taxonUri')]: 'keyword', [v('rapportUrl')]: 'keyword',
    [v('beginjaar')]: 'integer', [v('aantalWaarnemingen')]: 'integer', [v('publicatiejaar')]: 'integer',
    [v('waarnemingsnummerOnzeker')]: 'boolean', [GEO]: 'geo_point',
  };
  for (const [veld, t] of Object.entries(verwacht)) ok(type(veld) === t, `${veld.replace(RE, 'radar-elastic:')} is ${type(veld)} (verwacht ${t})`);
  ok(mapping[v('plantnaam')]?.analyzer === 'nl_index' && mapping[v('plantnaam')]?.search_analyzer === 'nl_zoeken', 'plantnaam: nl_index / nl_zoeken');
  ok(mapping[v('wetenschappelijkeNaam')]?.analyzer === 'nl_exact', 'wetenschappelijkeNaam: nl_exact (geen Nederlandse stamregels op Latijn)');
  const inIndex = Object.keys(mapping).filter(k => k.startsWith(RE));
  const vast = new Set(service.config.componentTemplates.flatMap(c => Object.keys(c.template.mappings.properties)));
  const dynamisch = inIndex.filter(k => !vast.has(k));
  ok(dynamisch.length === 0, `${inIndex.length} radar-elastic-velden in de index, ${dynamisch.length} via de dynamic template${dynamisch.length ? ': ' + dynamisch.join(', ') : ''}`);

  // 4. zoekvragen, afgeleid uit de documenten
  const id = d => d['@id'];
  const eerste = (veld, filter = () => true) => docs.find(d => d[veld]?.some(filter));
  async function zoek(tekst, body, verwachtIds, extra) {
    const r = await es('POST', '/index/_search', body);
    const ids = (r.json.hits?.hits ?? []).map(h => h._id);
    const gelukt = r.status === 200 && verwachtIds.every(i => ids.includes(i)) && (!extra || extra(r.json));
    ok(gelukt, `${tekst}: ${r.status === 200 ? `${r.json.hits.total.value} treffer(s)` : JSON.stringify(r.json.error?.root_cause?.[0] ?? r.json.error)}`);
    return r.json;
  }

  const nummer = eerste(v('waarnemingsnummer'));
  await zoek(`waarnemingsnummer ${nummer[v('waarnemingsnummer')][0]} (exact)`, {
    query: { term: { [v('waarnemingsnummer') + '.keyword']: nummer[v('waarnemingsnummer')][0] } },
  }, [id(nummer)], j => j.hits.total.value >= 1);

  const taxon = eerste(v('wetenschappelijkeNaam'), x => x.includes(' '));
  const latijn = taxon[v('wetenschappelijkeNaam')].find(x => x.includes(' '));
  const metTaxon = docs.filter(d => d[v('wetenschappelijkeNaam')]?.includes(latijn)).map(id);
  await zoek(`vindplaatsen met ${latijn} (facet .keyword)`, {
    query: { term: { [v('wetenschappelijkeNaam') + '.keyword']: latijn } }, size: 5000,
  }, metTaxon, j => j.hits.total.value === metTaxon.length);

  const plant = eerste(v('plantnaam'), x => /^[a-zë]{4,}$/i.test(x));
  const plantnaam = plant[v('plantnaam')].find(x => /^[a-zë]{4,}$/i.test(x));
  const metPlant = docs.filter(d => d[v('plantnaam')]?.includes(plantnaam)).map(id);
  await zoek(`plantnaam "${plantnaam}" (Nederlandse analyse)`, {
    query: { match: { [v('plantnaam')]: plantnaam } }, size: 5000,
  }, metPlant);

  await zoek('verkoolde resten (bewaringswijze, .keyword)', {
    query: { term: { [v('bewaringswijze') + '.keyword']: 'carbonized/verkoold' } }, size: 5000,
  }, docs.filter(d => d[v('bewaringswijze')]?.includes('carbonized/verkoold')).map(id));

  const periode = eerste(v('beginperiode'));
  const pl = periode[v('beginperiode')][0];
  await zoek(`beginperiode "${pl}" (ABR-label, .keyword)`, {
    query: { term: { [v('beginperiode') + '.keyword']: pl } }, size: 5000,
  }, docs.filter(d => d[v('beginperiode')]?.includes(pl)).map(id));

  const jaren = eerste(v('beginjaar'));
  const [bj, ej] = [Number(jaren[v('beginjaar')][0]), Number(jaren[v('eindjaar')]?.[0] ?? jaren[v('beginjaar')][0])];
  await zoek(`datering overlapt ${bj}-${ej} (jaren als getal)`, {
    query: { bool: { filter: [{ range: { [v('beginjaar')]: { lte: ej } } }, { range: { [v('eindjaar')]: { gte: bj } } }] } }, size: 5000,
  }, [id(jaren)]);

  await zoek('negatieve jaren werken als getal (voor Chr.)', {
    query: { range: { [v('beginjaar')]: { lt: 0 } } }, size: 5000,
  }, docs.filter(d => d[v('beginjaar')]?.some(x => Number(x) < 0)).map(id),
  j => j.hits.hits.every(h => h._source[v('beginjaar')].some(x => Number(x) < 0)));

  const punt = docs.find(d => d[GEO]);
  const [, lon, lat] = punt[GEO][0].match(/POINT \((-?[\d.]+) (-?[\d.]+)\)/).map(Number).length ? punt[GEO][0].match(/POINT \((-?[\d.]+) (-?[\d.]+)\)/) : [];
  await zoek('binnen 1 km van een vindplaats (geo_distance op geo_point)', {
    query: { geo_distance: { distance: '1km', [GEO]: { lat: Number(lat), lon: Number(lon) } } }, size: 5000,
  }, [id(punt)]);

  await zoek('facet provincie (.keyword)', {
    size: 0, aggs: { p: { terms: { field: v('provincie') + '.keyword' } } },
  }, [], j => j.aggregations.p.buckets.length >= 1);

  await zoek('sorteren op sitenummer als getal (.getal)', {
    query: { match_all: {} }, size: 5000, sort: [{ [v('siteNr') + '.getal']: 'asc' }],
  }, [], j => {
    const n = j.hits.hits.map(h => Number(h._source[v('siteNr')][0]));
    return n.length === docs.length && n.every((x, i) => i === 0 || n[i - 1] <= x);
  });

  await zoek('familie en gebruiksplantcategorie als facet', {
    size: 0, aggs: { f: { terms: { field: v('familie') + '.keyword', size: 5 } }, g: { terms: { field: v('gebruiksplantCategorie') + '.keyword', size: 5 } } },
  }, [], j => j.aggregations.f.buckets.length >= 1);

  // meervoud: "kuilen" moet "kuil" vinden (nl_zoeken), als de projectie een kuil als soort spoor heeft
  const kuil = eerste(v('soortSpoor'), x => /^kuil$/i.test(x));
  if (kuil) {
    await zoek('"kuilen" vindt het soort spoor "kuil" (nl_zoeken)', {
      query: { match: { [v('soortSpoor')]: 'kuilen' } }, size: 5000,
    }, [id(kuil)]);
  } else console.log('      (geen spoor "kuil" in deze set: meervoudstest overgeslagen)');

  // aantallen kloppen met de projectie
  const dok = docs.find(d => d[v('aantalWaarnemingen')]);
  const r = await es('GET', `/index/_doc/${encodeURIComponent(id(dok))}`);
  ok(r.json._source?.[v('aantalWaarnemingen')]?.[0] === dok[v('aantalWaarnemingen')][0], `aantalWaarnemingen van één document komt terug zoals geïndexeerd (${dok[v('aantalWaarnemingen')][0]})`);
} finally {
  if (KEEP) console.log(`\ncontainer ${CONTAINER} blijft draaien op ${ES} (docker rm -f ${CONTAINER} om op te ruimen)`);
  else { try { docker('rm', '-f', CONTAINER); } catch { /* al weg */ } }
}

console.log(fouten ? `\n${fouten} controle(s) mislukt` : '\nalle controles gelukt');
process.exit(fouten ? 1 : 0);

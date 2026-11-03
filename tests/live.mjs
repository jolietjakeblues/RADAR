// Controle van de queries van de website tegen de live service en het live SPARQL-endpoint.
// Gebruik: npm run test:live   (alleen lezen, geen token nodig)
import { buildQuery, ES_ENDPOINT, fields, kw, facets, TIJDVAKKEN, findBySiteNr } from '../web/search.js';
import { SPARQL_ENDPOINT, plantenQuery, sporenQuery, literatuurQuery, groepeerPlanten, groepeerSporen, fetchPlantnamen } from '../web/detail.js';
import { fetchErfgoed, fetchBoneInfo } from '../web/related.js';

let fouten = 0;
const ok = (gelukt, tekst) => { console.log(`${gelukt ? 'ok  ' : 'FOUT'}  ${tekst}`); if (!gelukt) fouten++; };
const es = async (body) => (await fetch(ES_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const sparql = async (query) => {
  const res = await fetch(SPARQL_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' }, body: query });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);
  return (await res.json()).results.bindings;
};
const SITE = 'https://linkeddata.cultureelerfgoed.nl/archeobotanie/id/radar/site/100';

// 1. de standaardquery
const alles = await es(buildQuery());
ok(alles.hits?.total?.value === 1630, `1.630 vindplaatsen in de index (${alles.hits?.total?.value})`);
ok(alles.hits.hits.length === 25, '25 resultaten op de eerste pagina');
for (const key of facets) ok((alles.aggregations[key]?.values?.buckets?.length ?? 0) > 0, `facet ${key} heeft waarden`);
const stat = alles.aggregations.statistiek;
ok(stat.doc_count === 1630 && Math.round(stat.waarnemingen.value) === 229828, `selectie: ${stat.doc_count} vindplaatsen, ${Math.round(stat.waarnemingen.value)} waarnemingen`);
ok(Math.round(stat.taxa.value) === 1791, `${Math.round(stat.taxa.value)} taxa (cardinality)`);
const vakken = alles.aggregations.tijd.vakken.buckets;
ok(Object.keys(vakken).length === TIJDVAKKEN.length && Object.values(vakken).some((b) => b.doc_count > 400), `tijdband: ${Object.keys(vakken).length} kolommen, hoogste ${Math.max(...Object.values(vakken).map((b) => b.doc_count))}`);
ok(alles.aggregations.topTaxa.values.buckets.length === 15, 'top 15 planten');
ok(alles.aggregations.kaart.locaties.buckets.length > 1000, `${alles.aggregations.kaart.locaties.buckets.length} locaties op de kaart`);

// 2. zoeken en filteren
const gerst = await es(buildQuery({ search: 'gerst' }));
ok(gerst.hits.total.value > 500 && gerst.hits.total.value < 1630, `zoeken op "gerst": ${gerst.hits.total.value}`);
const prefix = await es(buildQuery({ search: 'Hord' }));
ok(prefix.hits.total.value > 100, `voorvoegsel "Hord" vindt Hordeum: ${prefix.hits.total.value}`);
const taxon = await es(buildQuery({ filters: { taxon: ['Hordeum vulgare'] } }));
ok(taxon.hits.total.value > 500, `taxonfilter Hordeum vulgare: ${taxon.hits.total.value}`);
const periode = await es(buildQuery({ filters: { vanaf: 450, tot: 749 } }));
ok(periode.hits.total.value === 351, `450 tot 749 n.Chr.: ${periode.hits.total.value} vindplaatsen`);
const voor = await es(buildQuery({ filters: { vanaf: -800, tot: -12 } }));
ok(voor.hits.total.value > 100, `IJzertijd (negatieve jaren): ${voor.hits.total.value}`);
const verkoold = await es(buildQuery({ filters: { bewaringswijze: ['carbonized/verkoold'] } }));
ok(verkoold.hits.total.value > 800, `verkoold: ${verkoold.hits.total.value}`);
const nr = await es(buildQuery({ filters: { nummer: '100' } }));
ok(nr.hits.hits.some((h) => h._id === SITE), 'nummer 100 vindt site 100');
const zonderResultaat = await es(buildQuery({ search: 'xyzxyzxyz' }));
ok(zonderResultaat.hits.total.value === 0, 'onzin geeft nul resultaten, geen fout');
const meervoud = await es(buildQuery({ filters: { spoor: 'kuilen' } }));
ok(meervoud.hits.total.value > 300, `spoor "kuilen" vindt kuil (stam): ${meervoud.hits.total.value}`);
const site = await findBySiteNr(100);
ok(site?._id === SITE, 'findBySiteNr(100)');

// 3. detail uit SPARQL
const planten = groepeerPlanten((await sparql(plantenQuery(SITE))).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value]))));
ok(planten.length === 90 && planten.reduce((s, p) => s + p.n, 0) === 145, `site 100: ${planten.length} taxa, ${planten.reduce((s, p) => s + p.n, 0)} waarnemingen (verwacht 90 en 145)`);
const sporen = groepeerSporen((await sparql(sporenQuery(SITE))).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value]))));
ok(sporen.reduce((s, x) => s + x.sporen, 0) === 3, `site 100: ${sporen.map((s) => `${s.soort} ${s.sporen}`).join(', ')}`);
const lit = await sparql(literatuurQuery(SITE));
ok(lit.length >= 1 && lit[0].titel?.value, `literatuur: ${lit[0]?.titel?.value}`);
const namen = await fetchPlantnamen(['Hordeum vulgare', 'Chenopodium album']);
ok(namen.get('Hordeum vulgare')?.naam === 'Gerst', `plantnaam Hordeum vulgare = ${namen.get('Hordeum vulgare')?.naam}`);

// 4. kruislinks
const erfgoed = await fetchErfgoed('29770');
ok(erfgoed.length >= 1, `erfgoedregister: ${erfgoed.length} object(en) bij waarnemingsnummer 29770`);
const bone = await fetchBoneInfo('29770');
ok(Array.isArray(bone), `BoneInfo: ${bone.length} cluster(s)`);

console.log(fouten ? `\n${fouten} controle(s) mislukt` : '\nalle controles gelukt');
process.exit(fouten ? 1 : 0);

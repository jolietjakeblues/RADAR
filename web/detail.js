// Detailgegevens per vindplaats (planten, sporen, literatuur), rechtstreeks uit de brondataset
// (archeobotanie/radar), niet uit de platte Elastic-index.
//
// Waarom: de zoekprojectie zet planten, bewaringswijze en plantdeel elk als losse lijst in het document.
// Elasticsearch bewaart geen koppeling tussen die lijsten, dus een rij als "gerst, verkoold, zaad, in
// 14 monsters" is daar niet uit te halen. De projectie is een zoeksleutel, geen tweede bron.

export const SPARQL_ENDPOINT = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/archeobotanie/radar/sparql';
const GRAPH = 'https://linkeddata.cultureelerfgoed.nl/archeobotanie/graph/radar';

const PREFIXES = `
PREFIX ceo: <https://linkeddata.cultureelerfgoed.nl/def/ceo#>
PREFIX rad: <https://linkeddata.cultureelerfgoed.nl/archeobotanie/id/radar/>
PREFIX dwc: <http://rs.tdwg.org/dwc/terms/>
PREFIX schema: <https://schema.org/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
`;

// URI's die in een query komen, komen uit de index. Toch: alleen een IRI van onze eigen namespace
// is toegestaan, zodat er nooit iets anders in de query kan terechtkomen.
const SITE_URI = /^https:\/\/linkeddata\.cultureelerfgoed\.nl\/archeobotanie\/id\/radar\/site\/\d{1,9}$/;
const iri = (uri) => {
  if (!SITE_URI.test(uri)) throw new Error('Onbekende vindplaats');
  return `<${uri}>`;
};
const lit = (s) => `"${String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ')}"`;

async function runSelect(query, signal) {
  const res = await fetch(SPARQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
    credentials: 'omit',
    body: query,
    signal,
  });
  if (!res.ok) throw new Error(`SPARQL-opvraag mislukt (${res.status})`);
  return (await res.json()).results.bindings;
}
const val = (b, key) => (b[key] ? b[key].value : null);

// ---- planten ----------------------------------------------------------------------------
export function plantenQuery(siteUri) {
  return `${PREFIXES}
SELECT ?latijn (SAMPLE(?nl) AS ?naam) (SAMPLE(?en) AS ?naamEn) (SAMPLE(?fam) AS ?familie) (SAMPLE(?cat) AS ?categorie)
       ?bewaring ?deel (COUNT(DISTINCT ?occ) AS ?n) (COUNT(DISTINCT ?monster) AS ?monsters)
WHERE { GRAPH <${GRAPH}> {
  ${iri(siteUri)} ceo:bevatObject/ceo:bevatObject ?monster .
  ?monster ceo:bevatObject ?occ .
  ?occ rad:heeftTaxon ?taxon .
  ?taxon dwc:scientificName ?latijn .
  OPTIONAL { ?taxon dwc:vernacularName ?nl . FILTER(lang(?nl) = "nl") }
  OPTIONAL { ?taxon dwc:vernacularName ?en . FILTER(lang(?en) = "en") }
  OPTIONAL { ?taxon dwc:family ?fam }
  OPTIONAL { ?taxon rad:gebruiksplantCategorie ?cat }
  OPTIONAL { ?occ rad:heeftBewaringswijze/skos:prefLabel ?bewaring }
  OPTIONAL { ?occ rad:heeftPlantdeel/skos:prefLabel ?deel }
} }
GROUP BY ?latijn ?bewaring ?deel`;
}

// De query geeft één rij per (plant, bewaringswijze, plantdeel); hier wordt dat één rij per plant.
// De waarnemingen van één plant zijn de som over de rijen; de monsters van één plant kunnen in meer
// rijen voorkomen, dus het aantal monsters is een bovengrens (het maximum over de rijen is de ondergrens).
export function groepeerPlanten(rows) {
  const per = new Map();
  for (const r of rows) {
    const latijn = r.latijn;
    if (!latijn) continue;
    if (!per.has(latijn)) per.set(latijn, { latijn, naam: r.naam || null, naamEn: r.naamEn || null, familie: r.familie || null, categorie: r.categorie || null, n: 0, monsters: 0, bewaring: new Map(), delen: new Map() });
    const p = per.get(latijn);
    const n = Number(r.n) || 0;
    p.n += n;
    p.monsters = Math.max(p.monsters, Number(r.monsters) || 0);
    if (r.bewaring) p.bewaring.set(r.bewaring, (p.bewaring.get(r.bewaring) ?? 0) + n);
    if (r.deel) p.delen.set(r.deel, (p.delen.get(r.deel) ?? 0) + n);
  }
  return [...per.values()].sort((a, b) => b.n - a.n || a.latijn.localeCompare(b.latijn, 'nl'));
}

// Totaal per bewaringswijze over alle planten van de vindplaats, voor de balk bovenaan.
export function bewaringTotalen(planten) {
  const som = new Map();
  for (const p of planten) for (const [k, n] of p.bewaring) som.set(k, (som.get(k) ?? 0) + n);
  return [...som].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

export async function fetchPlanten(siteUri, signal) {
  const rows = await runSelect(plantenQuery(siteUri), signal);
  return groepeerPlanten(rows.map((b) => ({
    latijn: val(b, 'latijn'), naam: val(b, 'naam'), naamEn: val(b, 'naamEn'), familie: val(b, 'familie'), categorie: val(b, 'categorie'),
    bewaring: val(b, 'bewaring'), deel: val(b, 'deel'), n: val(b, 'n'), monsters: val(b, 'monsters'),
  })));
}

// ---- sporen -----------------------------------------------------------------------------
export function sporenQuery(siteUri) {
  return `${PREFIXES}
SELECT ?spoor ?soort ?jaarB ?jaarE (COUNT(DISTINCT ?monster) AS ?monsters) (COUNT(DISTINCT ?occ) AS ?n)
WHERE { GRAPH <${GRAPH}> {
  ${iri(siteUri)} ceo:bevatObject ?spoor .
  ?spoor a ceo:Grondsporen .
  OPTIONAL { ?spoor rad:soortSpoor ?soort }
  OPTIONAL { ?spoor ceo:heeftDatering/ceo:heeftBeginDatering/rad:jaar ?jaarB }
  OPTIONAL { ?spoor ceo:heeftDatering/ceo:heeftEindDatering/rad:jaar ?jaarE }
  OPTIONAL { ?spoor ceo:bevatObject ?monster . OPTIONAL { ?monster ceo:bevatObject ?occ } }
} }
GROUP BY ?spoor ?soort ?jaarB ?jaarE`;
}

// Eén rij per spoor; hier gegroepeerd per soort spoor (zonder onderscheid in hoofdletters).
export function groepeerSporen(rows) {
  const per = new Map();
  for (const r of rows) {
    const soort = (r.soort || '').trim();
    const key = soort.toLowerCase() || '?';
    if (!per.has(key)) per.set(key, { soort: soort ? soort.charAt(0).toLowerCase() + soort.slice(1).toLowerCase() : null, sporen: 0, monsters: 0, waarnemingen: 0, van: null, tot: null });
    const g = per.get(key);
    g.sporen += 1;
    g.monsters += Number(r.monsters) || 0;
    g.waarnemingen += Number(r.n) || 0;
    const b = r.jaarB != null && r.jaarB !== '' ? Number(r.jaarB) : null;
    const e = r.jaarE != null && r.jaarE !== '' ? Number(r.jaarE) : null;
    if (Number.isFinite(b)) g.van = g.van == null ? b : Math.min(g.van, b);
    if (Number.isFinite(e)) g.tot = g.tot == null ? e : Math.max(g.tot, e);
  }
  return [...per.values()].sort((a, b) => b.sporen - a.sporen || String(a.soort).localeCompare(String(b.soort), 'nl'));
}

export async function fetchSporen(siteUri, signal) {
  const rows = await runSelect(sporenQuery(siteUri), signal);
  return groepeerSporen(rows.map((b) => ({ soort: val(b, 'soort'), jaarB: val(b, 'jaarB'), jaarE: val(b, 'jaarE'), monsters: val(b, 'monsters'), n: val(b, 'n') })));
}

// ---- literatuur -------------------------------------------------------------------------
export function literatuurQuery(siteUri) {
  return `${PREFIXES}
SELECT ?pub ?titel ?jaar ?tijdschrift ?deel ?paginas ?uitgever ?url (GROUP_CONCAT(DISTINCT ?auteur; separator=" | ") AS ?auteurs) WHERE {
  GRAPH <${GRAPH}> {
    ?pub schema:about ${iri(siteUri)} .
    OPTIONAL { ?pub schema:name ?titel }
    OPTIONAL { ?pub schema:author ?auteur }
    OPTIONAL { ?pub schema:datePublished ?jaar }
    OPTIONAL { ?pub schema:isPartOf/schema:name ?tijdschrift }
    OPTIONAL { ?pub rad:deel ?deel }
    OPTIONAL { ?pub schema:pagination ?paginas }
    OPTIONAL { ?pub schema:publisher ?uitgever }
    OPTIONAL { ?pub schema:url ?url }
  }
} GROUP BY ?pub ?titel ?jaar ?tijdschrift ?deel ?paginas ?uitgever ?url ORDER BY ?pub`;
}

export async function fetchLiteratuur(siteUri, signal) {
  const rows = await runSelect(literatuurQuery(siteUri), signal);
  return rows.map((b) => ({
    auteurs: val(b, 'auteurs') ? val(b, 'auteurs').split(' | ').filter(Boolean) : [], titel: val(b, 'titel'), jaar: val(b, 'jaar'),
    tijdschrift: val(b, 'tijdschrift'), deel: val(b, 'deel'), paginas: val(b, 'paginas'), uitgever: val(b, 'uitgever'), url: safeUrl(val(b, 'url')),
  }));
}

// Alleen http(s)-links uit de brondata worden links.
export function safeUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

// ---- namen voor de grafiek met meest gevonden planten -----------------------------------
// De index heeft Nederlandse namen en wetenschappelijke namen als aparte lijsten; voor een lijst van
// 15 planten haalt één query de Nederlandse (en Engelse) naam erbij.
export async function fetchPlantnamen(latijn, signal) {
  const namen = [...new Set(latijn)].filter((x) => x && !x.includes('|'));
  if (!namen.length) return new Map();
  const query = `${PREFIXES}
SELECT ?latijn (SAMPLE(?nl) AS ?naam) (SAMPLE(?en) AS ?naamEn) WHERE { GRAPH <${GRAPH}> {
  VALUES ?latijn { ${namen.map(lit).join(' ')} }
  ?taxon dwc:scientificName ?latijn .
  OPTIONAL { ?taxon dwc:vernacularName ?nl . FILTER(lang(?nl) = "nl") }
  OPTIONAL { ?taxon dwc:vernacularName ?en . FILTER(lang(?en) = "en") }
} } GROUP BY ?latijn`;
  const rows = await runSelect(query, signal);
  return new Map(rows.map((b) => [val(b, 'latijn'), { naam: val(b, 'naam'), naamEn: val(b, 'naamEn') }]));
}

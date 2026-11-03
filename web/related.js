// Kruislinks, via het archis2-waarnemingsnummer dat RADAR deelt met de RCE-vondstlocatie en met BoneInfo.
//
// Geen owl:sameAs-koppeling in de triples zelf (bewuste keuze, zie README.md): het is een losse opzoeking
// op zoeknummer, geen identiteitsclaim. Een match betekent "zelfde waarnemingsnummer", niet "gegarandeerd
// hetzelfde object". Een nummer dat RADAR zelf als onzeker markeert wordt niet gebruikt (zie app.js).

const ERFGOED_ENDPOINT = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed/services/Erfgoed-ceo/_search';
const ERFGOED_ZOEKDEMO = 'https://erfgoed-cho-zoekdemo.jolietjakeblues64.workers.dev/';
const CE = 'https://linkeddata cultureelerfgoed nl/def/ceo-elastic#';

const BONEINFO_ENDPOINT = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/archeozoologie/boneinfo-elastic/services/Boneinfo/_search';
const BONEINFO_SITE = 'https://boneinfo-zoeksite.jolietjakeblues64.workers.dev/';
const BE = 'https://linkeddata cultureelerfgoed nl/def/boneinfo-elastic#';

const KLASSE_NL = {
  Rijksmonument: 'Rijksmonument', Complex: 'Complex', Gezicht: 'Beschermd gezicht', Werelderfgoed: 'Werelderfgoed',
  ArcheologischTerrein: 'Archeologisch terrein', ArcheologischOnderzoeksgebied: 'Archeologisch onderzoeksgebied',
  Vondstlocatie: 'Vondstlocatie', ArcheologischComplex: 'Archeologisch complex', Grondsporen: 'Grondsporen', Vondsten: 'Vondsten',
};

const een = (s, veld) => (Array.isArray(s[veld]) ? s[veld][0] : s[veld]);
const veel = (s, veld) => (Array.isArray(s[veld]) ? s[veld] : s[veld] != null ? [s[veld]] : []);

// Diepe link naar het object zelf op de erfgoed-zoekdemo: exact zoeken op het nummer in de URI, binnen de soort.
export function zoekdemoUrlVoor(uri, klasse) {
  if (!uri || !klasse) return null;
  const nummer = uri.split('/').filter(Boolean).pop();
  if (!/^\d+$/.test(nummer || '')) return null;
  const params = new URLSearchParams({ q: `"${nummer}"`, veld: 'Nummer', soort: klasse.toLowerCase() });
  return `${ERFGOED_ZOEKDEMO}?${params}`;
}

async function post(url, body, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function fetchErfgoed(waarnemingsnummer, signal) {
  if (!waarnemingsnummer) return [];
  const data = await post(ERFGOED_ENDPOINT, { size: 10, query: { term: { [`${CE}archis2Waarnemingsnummer.keyword`]: String(waarnemingsnummer) } } }, signal);
  return data.hits.hits.map((h) => {
    const s = h._source;
    const klasse = een(s, `${CE}klasse`)?.split('#').pop() ?? null;
    return {
      uri: h._id,
      zoekdemoUrl: zoekdemoUrlVoor(h._id, klasse),
      klasseLabel: KLASSE_NL[klasse] || klasse || 'Erfgoedobject',
      naam: een(s, `${CE}naam`) || een(s, `${CE}locatienaam`),
      gemeente: een(s, `${CE}gemeente`),
      provincie: een(s, `${CE}provincie`),
      aantalObjecten: veel(s, `${CE}bevatObject`).length,
    };
  });
}

export async function fetchBoneInfo(waarnemingsnummer, signal) {
  if (!waarnemingsnummer) return [];
  const data = await post(BONEINFO_ENDPOINT, { size: 10, query: { term: { [`${BE}waarnemingsnummer.keyword`]: String(waarnemingsnummer) } } }, signal);
  return data.hits.hits.map((h) => ({
    zoonr: een(h._source, `${BE}zoonr`),
    soorten: veel(h._source, `${BE}diersoort`),
    url: `${BONEINFO_SITE}?cluster=${encodeURIComponent(een(h._source, `${BE}zoonr`) ?? '')}`,
  }));
}

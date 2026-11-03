// Maakt triply/elastic-service.json: de configuratie van de Elasticsearch-service "Radar" op de
// zoekprojectie (construct/radar.rq). Velden staan hier één keer, per type. De Nederlandse analyse
// komt uit triply/nl-analyse.json (dezelfde als BoneInfo en elastic-ceo).
// Gebruik: node triply/maak-service.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const map = new URL('.', import.meta.url);
const analysis = JSON.parse(readFileSync(new URL('nl-analyse.json', map), 'utf8'));

// Veldnaam in Elastic: property-IRI met een spatie in plaats van elke punt (zo noemt TriplyDB ze)
const RE = 'https://linkeddata cultureelerfgoed nl/def/radar-elastic#';
const GEO = 'http://www opengis net/ont/geosparql#asWKT';

// Tekst met Nederlandse analyse, plus .keyword (facetten, sorteren) en .exact (zonder taalverwerking).
// Dit is ook de dynamic template: een veld dat hieronder niet staat, krijgt deze mapping.
const TEKST = [
  'locatienaam', 'omschrijving', 'complextype', 'soortSpoor', 'plantnaam', 'titel',
];

// Korte tekst: alleen kleine letters en accenten, plus .keyword. Plaatsnamen, labels van begrippen,
// codes, namen van personen en instanties, wetenschappelijke namen (geen Nederlandse stam- of
// meervoudsregels op Latijn) en periodes.
const KORT = [
  'plaats', 'provincie', 'archeoregio', 'beginperiode', 'eindperiode', 'periodecode',
  'bewaringswijze', 'plantdeel', 'monstertype', 'familie', 'gebruiksplantCategorie',
  'wetenschappelijkeNaam', 'auteur', 'tijdschrift', 'onderzoeksinstantie',
  'coordinaatNauwkeurigheid', 'dateringBron', 'biaxId',
];

// Nummers: korte tekst + .keyword + .getal (long), om op nummer te kunnen sorteren
const NUMMER = ['siteNr', 'waarnemingsnummer', 'zaaknummer'];

// URI's: alleen exact filteren (term, terms)
const URI = ['taxonUri', 'rapportUrl'];

const GETAL = ['beginjaar', 'eindjaar', 'publicatiejaar', 'aantalSporen', 'aantalMonsters', 'aantalWaarnemingen'];
const JANEE = ['waarnemingsnummerOnzeker'];

const alle = [TEKST, KORT, NUMMER, URI, GETAL, JANEE].flat();
const dubbel = alle.filter((v, i) => alle.indexOf(v) !== i);
if (dubbel.length) throw new Error(`dubbel: ${dubbel}`);

const keyword = { type: 'keyword', ignore_above: 256 };
const tekst = {
  type: 'text', analyzer: 'nl_index', search_analyzer: 'nl_zoeken',
  fields: { keyword, exact: { type: 'text', analyzer: 'nl_exact' } },
};
const kort = { type: 'text', analyzer: 'nl_exact', fields: { keyword } };
const nummer = { type: 'text', analyzer: 'nl_exact', fields: { keyword, getal: { type: 'long', ignore_malformed: true } } };
const uri = { type: 'keyword', ignore_above: 1024 };

const velden = (namen, mapping) => Object.fromEntries(namen.map(n => [RE + n, mapping]));

const config = {
  type: 'elasticSearch',
  name: 'Radar',
  config: {
    indexTemplates: [
      { name: 'radar-elastic', index_patterns: 'index', composed_of: ['radar-elastic-tekst', 'radar-elastic-typen'] },
    ],
    componentTemplates: [
      {
        name: 'radar-elastic-tekst',
        template: {
          settings: { analysis },
          mappings: {
            dynamic_templates: [{ tekst_nl: { match_mapping_type: 'string', mapping: tekst } }],
            properties: {
              '@id': { type: 'text', fields: { keyword } },
              ...velden(TEKST, tekst),
              ...velden(KORT, kort),
              ...velden(NUMMER, nummer),
            },
          },
        },
      },
      {
        name: 'radar-elastic-typen',
        template: {
          mappings: {
            properties: {
              ...velden(URI, uri),
              ...velden(GETAL, { type: 'integer', ignore_malformed: true }),
              ...velden(JANEE, { type: 'boolean' }),
              [GEO]: { type: 'geo_point', ignore_malformed: true },
            },
          },
        },
      },
    ],
  },
};

writeFileSync(new URL('elastic-service.json', map), JSON.stringify(config, null, 2) + '\n');
console.log(`velden: ${alle.length} + geometrie, geschreven naar triply/elastic-service.json`);

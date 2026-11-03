// Tweetalige UI-teksten (NL/EN). Vrije tekst uit de bron (locatienamen, omschrijvingen, complextypen,
// periodes, literatuur) blijft Nederlands: die is niet vertaald in de brondatabase. Wat wel wisselt:
// alle vaste schermteksten, de bewaringswijzen en plantdelen (de bron heeft die tweetalig of in het
// Engels) en de plantnaam (Nederlands of Engels, uit de brondata).

export const LANGS = ['nl', 'en'];
export const DEFAULT_LANG = 'nl';

const n = (x) => Number(x).toLocaleString('nl-NL');
const e = (x) => Number(x).toLocaleString('en-GB');
const mv = (x, een, meer) => `${n(x)} ${Number(x) === 1 ? een : meer}`;
const pl = (x, one, more) => `${e(x)} ${Number(x) === 1 ? one : more}`;

export const STRINGS = {
  nl: {
    pageTitle: 'RADAR: plantenresten uit Nederlandse opgravingen',
    brandSub: 'Relationele Archeobotanische Database voor Nederland',
    heroText: 'Plantenresten uit archeologische opgravingen in Nederland: zaden, graan, vruchten en pollen uit meer dan 1.600 vindplaatsen. Zoek op plant, plaats of periode.',
    searchLabel: 'Doorzoek RADAR',
    searchPlaceholder: 'Probeer gerst, Hordeum, Zwolle of verkoold…',
    searchButton: 'Zoeken',
    searchHint: 'Zoekt in plantnamen, plaatsen, perioden en literatuur. Zet een zin tussen aanhalingstekens voor een exacte zoekactie.',
    timeTitle: 'Vindplaatsen door de tijd',
    timeHint: 'Elke kolom is een tijdvak; de hoogte is het aantal vindplaatsen in je selectie waarvan de datering ermee overlapt. De schaal is niet lineair: de jongere perioden hebben meer, kortere kolommen. Klik of sleep om een periode te kiezen.',
    timeClear: 'Hele tijdlijn',
    timeSelected: (van, tot) => `Gekozen: ${van} tot ${tot}`,
    timeColumn: (van, tot, count) => `${van} tot ${tot}: ${mv(count, 'vindplaats', 'vindplaatsen')}`,
    periodes: { meso: 'Mesolithicum', neo: 'Neolithicum', brons: 'Bronstijd', ijzer: 'IJzertijd', romeins: 'Romeinse tijd', vme: 'Vroege Middeleeuwen', lme: 'Late Middeleeuwen', nt: 'Nieuwe tijd' },
    periodesKort: { meso: 'Meso', neo: 'Neo', brons: 'Brons', ijzer: 'IJzer', romeins: 'Rom', vme: 'VME', lme: 'LME', nt: 'NT' },
    selection: (sites, obs, taxa) => `Deze selectie heeft ${mv(sites, 'vindplaats', 'vindplaatsen')}, ${mv(obs, 'plantenwaarneming', 'plantenwaarnemingen')} en ${mv(taxa, 'taxon', 'taxa')}.`,
    filtersHeading: 'Verfijn',
    clearAll: 'Wis alles',
    activeFilters: 'Actieve filters',
    removeFilter: (label) => `Verwijder filter ${label}`,
    facets: { provincie: 'Provincie', archeoregio: 'Archeoregio', complextype: 'Soort vindplaats', beginperiode: 'Periode', bewaringswijze: 'Bewaringswijze', plantdeel: 'Plantdeel', gebruiksplantCategorie: 'Gebruiksplant', familie: 'Plantenfamilie' },
    facetEmpty: 'Geen resultaten',
    facetMore: (k) => `Toon alle ${k}`,
    facetLess: 'Toon minder',
    fieldPlant: 'Plant',
    fieldPlantPlaceholder: 'Nederlandse of Latijnse naam',
    fieldPlaats: 'Plaats of locatie',
    fieldPlaatsPlaceholder: 'Bijvoorbeeld Zwolle',
    fieldSpoor: 'Soort spoor',
    fieldSpoorPlaceholder: 'Bijvoorbeeld waterput',
    fieldLiteratuur: 'Literatuur',
    fieldLiteratuurPlaceholder: 'Auteur, titel of tijdschrift',
    fieldNummer: 'Nummer',
    fieldNummerPlaceholder: 'Sitenummer of Archis-waarnemingsnummer',
    moreFields: 'Meer zoekvelden',
    jaarLegend: 'Jaartallen',
    jaarVanaf: 'Vanaf jaar',
    jaarTot: 'Tot en met jaar',
    jaarModusOverlapt: 'Overlapt de periode',
    jaarModusBinnen: 'Valt helemaal binnen',
    jaarHint: 'Negatief is voor Christus. Vindplaatsen zonder jaartal vallen buiten dit filter.',
    sortLabel: 'Sorteer op',
    sortRelevantie: 'Relevantie',
    sortJaar: 'Oudste eerst',
    sortPlaats: 'Plaats A–Z',
    sortPlanten: 'Meeste planten',
    resultCount: (total) => mv(total, 'vindplaats', 'vindplaatsen'),
    resultsEmpty: 'Geen vindplaatsen gevonden. Haal een filter weg of probeer een andere zoekterm.',
    unknownLocation: 'Onbekende locatie',
    plants: 'Planten',
    noPlantData: 'Nog geen plantenwaarnemingen in de dataset',
    observations: (k) => mv(k, 'waarneming', 'waarnemingen'),
    obsWord: (k) => (Number(k) === 1 ? 'waarneming' : 'waarnemingen'),
    showSitesWithPlant: 'Alle vindplaatsen met deze plant',
    taxaCount: (k) => mv(k, 'taxon', 'taxa'),
    pagerPrev: 'Vorige',
    pagerNext: 'Volgende',
    pagerStatus: (a, b) => `Pagina ${a} van ${b}`,
    downloadCsv: 'CSV',
    downloadGeoJson: 'GeoJSON',
    mapTitle: 'Waar zijn de resten gevonden?',
    mapResolutionLabel: 'Raster',
    mapResolutions: { locaties: 'Brongegevens', '1km': '1 × 1 km', '5km': '5 × 5 km', '10km': '10 × 10 km', '25km': '25 × 25 km' },
    mapLegendHint: 'Een cirkel groepeert vindplaatsen op dezelfde locatie of in dezelfde rastercel. Klik om in te zoomen. Een groter raster is een weergavekeuze en zegt niets over de nauwkeurigheid.',
    mapStatus: (shown, total, without, raster) => `${raster ? pl2(shown, 'rastercel', 'rastercellen') : pl2(shown, 'locatie', 'locaties')} op de kaart, ${mv(total, 'vindplaats', 'vindplaatsen')}${without ? `, ${n(without)} zonder coördinaten` : ''}.`,
    topTitle: 'Meest gevonden planten',
    topHint: 'Klik op een plant om alleen vindplaatsen met die plant te tonen. De getallen zijn vindplaatsen.',
    topEmpty: 'Geen planten in deze selectie.',
    topSites: (k) => mv(k, 'vindplaats', 'vindplaatsen'),
    statusLoading: 'Laden…',
    statusLooking: 'Zoeken…',
    errNetwork: 'Kan de zoekservice niet bereiken. Controleer je verbinding en probeer het opnieuw.',
    errUnavailable: 'De zoekservice is tijdelijk niet beschikbaar. Probeer het over enkele minuten opnieuw.',
    errGeneric: (status) => `De zoekopdracht mislukte (status ${status}). Pas je zoekterm aan of probeer het opnieuw.`,
    retry: 'Opnieuw proberen',
    bc: 'v.Chr.',
    ad: 'n.Chr.',
    yes: 'ja',
    no: 'nee',
    detailKicker: 'Vindplaats',
    detailClose: 'Sluiten',
    detailCopyLink: 'Kopieer link',
    detailCopied: 'Link gekopieerd',
    detailLabels: {
      siteNr: 'Sitenummer', waarnemingsnummer: 'Archis-waarnemingsnummer', zaaknummer: 'Archis-zaaknummer', locatienaam: 'Locatie', plaats: 'Plaats',
      provincie: 'Provincie', complextype: 'Soort vindplaats', archeoregio: 'Archeoregio', periode: 'Periode', jaren: 'Jaren', biaxId: 'BIAX-code',
      sporen: 'Sporen', monsters: 'Monsters', waarnemingen: 'Plantenwaarnemingen', taxa: 'Taxa', nauwkeurigheid: 'Nauwkeurigheid coördinaten', dateringBron: 'Herkomst datering',
    },
    uncertainNumber: 'Dit waarnemingsnummer is volgens RADAR onzeker; er wordt niet mee gekoppeld.',
    coordPrecision: 'Coördinaten op de kilometer nauwkeurig',
    headingDescription: 'Omschrijving',
    headingPlants: 'Gevonden planten',
    headingFeatures: 'Sporen',
    headingLiterature: 'Literatuur',
    headingRelated: 'Verwant onderzoek',
    plantsFilter: 'Filter de planten',
    plantsCount: (k) => mv(k, 'taxon', 'taxa'),
    plantsMore: (k) => `Toon alle ${n(k)}`,
    plantsLess: 'Toon minder',
    plantsEmpty: 'Voor deze vindplaats staan nog geen plantenwaarnemingen in de dataset.',
    plantsEmptyNote: 'Een deel van de plantenregels is nog niet gekoppeld aan een monster en staat daarom niet in de dataset. Dat zegt niets over wat er gevonden is.',
    plantsLoadError: 'De planten konden niet worden geladen: ',
    plantTable: { plant: 'Plant', finds: 'Waarnemingen', samples: 'Monsters', preserved: 'Bewaring', parts: 'Delen' },
    plantObsHint: 'Een waarneming is één plant in één monster. Het aantal zegt niets over hoeveel zaden het waren: de hoeveelheden in RADAR zijn niet vergelijkbaar tussen waarnemingen.',
    preservation: 'Bewaringswijze',
    featuresEmpty: 'Geen sporen in de dataset.',
    featuresLoadError: 'De sporen konden niet worden geladen: ',
    featureCount: (k) => mv(k, 'spoor', 'sporen'),
    featureSamples: (k) => mv(k, 'monster', 'monsters'),
    litEmpty: 'Geen literatuur vermeld.',
    litLoadError: 'De literatuur kon niet worden geladen: ',
    litOpen: 'Open rapport',
    relatedLookup: 'Zoekt in het erfgoedregister en in BoneInfo op hetzelfde waarnemingsnummer.',
    relatedNone: 'Geen verwante gegevens gevonden.',
    relatedHeritage: 'Erfgoedregister (RCE)',
    relatedBone: 'Archeozoölogie (BoneInfo)',
    relatedBoneText: (k) => `${mv(k, 'diersoort', 'diersoorten')}`,
    relatedNote: 'Een gelijk waarnemingsnummer is een sterke aanwijzing dat het om hetzelfde onderzoek gaat, geen zekerheid.',
    relatedError: 'Verwante gegevens konden niet worden geladen: ',
    relatedContains: (k) => mv(k, 'object', 'objecten'),
    rawLink: 'Linked Data',
    footerSource: 'Bron: RADAR (BIAX Consult), als Linked Data gepubliceerd door de Rijksdienst voor het Cultureel Erfgoed. Een experiment.',
    footerData: 'Gegevens',
    footerDocs: 'Hoe het gemaakt is',
    skip: 'Naar de resultaten',
    openSite: (naam) => `Open ${naam}`,
    langLabel: 'Taal',
  },
  en: {
    pageTitle: 'RADAR: plant remains from Dutch excavations',
    brandSub: 'Relational Archaeobotanical Database for the Netherlands',
    heroText: 'Plant remains from archaeological excavations in the Netherlands: seeds, grain, fruits and pollen from more than 1,600 sites. Search by plant, place or period.',
    searchLabel: 'Search RADAR',
    searchPlaceholder: 'Try barley, Hordeum, Zwolle or charred…',
    searchButton: 'Search',
    searchHint: 'Searches plant names, places, periods and literature. Put a phrase in quotation marks for an exact search.',
    timeTitle: 'Sites through time',
    timeHint: 'Each column is a period of time; its height is the number of sites in your selection whose dating overlaps it. The scale is not linear: the younger periods have more, shorter columns. Click or drag to choose a period.',
    timeClear: 'Whole timeline',
    timeSelected: (van, tot) => `Selected: ${van} to ${tot}`,
    timeColumn: (van, tot, count) => `${van} to ${tot}: ${pl(count, 'site', 'sites')}`,
    periodes: { meso: 'Mesolithic', neo: 'Neolithic', brons: 'Bronze Age', ijzer: 'Iron Age', romeins: 'Roman period', vme: 'Early Middle Ages', lme: 'Late Middle Ages', nt: 'Modern period' },
    periodesKort: { meso: 'Meso', neo: 'Neo', brons: 'Bronze', ijzer: 'Iron', romeins: 'Roman', vme: 'EMA', lme: 'LMA', nt: 'Mod' },
    selection: (sites, obs, taxa) => `This selection has ${pl(sites, 'site', 'sites')}, ${pl(obs, 'plant record', 'plant records')} and ${pl(taxa, 'taxon', 'taxa')}.`,
    filtersHeading: 'Refine',
    clearAll: 'Clear all',
    activeFilters: 'Active filters',
    removeFilter: (label) => `Remove filter ${label}`,
    facets: { provincie: 'Province', archeoregio: 'Archaeological region', complextype: 'Site type', beginperiode: 'Period', bewaringswijze: 'Preservation', plantdeel: 'Plant part', gebruiksplantCategorie: 'Useful plant', familie: 'Plant family' },
    facetEmpty: 'No results',
    facetMore: (k) => `Show all ${k}`,
    facetLess: 'Show fewer',
    fieldPlant: 'Plant',
    fieldPlantPlaceholder: 'Dutch or Latin name',
    fieldPlaats: 'Place or location',
    fieldPlaatsPlaceholder: 'For example Zwolle',
    fieldSpoor: 'Feature type',
    fieldSpoorPlaceholder: 'For example waterput',
    fieldLiteratuur: 'Literature',
    fieldLiteratuurPlaceholder: 'Author, title or journal',
    fieldNummer: 'Number',
    fieldNummerPlaceholder: 'Site number or Archis observation number',
    moreFields: 'More search fields',
    jaarLegend: 'Years',
    jaarVanaf: 'From year',
    jaarTot: 'Up to and including year',
    jaarModusOverlapt: 'Overlaps the period',
    jaarModusBinnen: 'Falls entirely within',
    jaarHint: 'Negative means BC. Sites without a year fall outside this filter.',
    sortLabel: 'Sort by',
    sortRelevantie: 'Relevance',
    sortJaar: 'Oldest first',
    sortPlaats: 'Place A–Z',
    sortPlanten: 'Most plants',
    resultCount: (total) => pl(total, 'site', 'sites'),
    resultsEmpty: 'No sites found. Remove a filter or try another search term.',
    unknownLocation: 'Unknown location',
    plants: 'Plants',
    noPlantData: 'No plant records in the dataset yet',
    observations: (k) => pl(k, 'record', 'records'),
    obsWord: (k) => (Number(k) === 1 ? 'record' : 'records'),
    showSitesWithPlant: 'All sites with this plant',
    taxaCount: (k) => pl(k, 'taxon', 'taxa'),
    pagerPrev: 'Previous',
    pagerNext: 'Next',
    pagerStatus: (a, b) => `Page ${a} of ${b}`,
    downloadCsv: 'CSV',
    downloadGeoJson: 'GeoJSON',
    mapTitle: 'Where were the remains found?',
    mapResolutionLabel: 'Grid',
    mapResolutions: { locaties: 'Source data', '1km': '1 × 1 km', '5km': '5 × 5 km', '10km': '10 × 10 km', '25km': '25 × 25 km' },
    mapLegendHint: 'A circle groups sites at the same location or in the same grid cell. Click to zoom in. A larger grid is a display choice and says nothing about accuracy.',
    mapStatus: (shown, total, without, raster) => `${raster ? pl(shown, 'grid cell', 'grid cells') : pl(shown, 'location', 'locations')} on the map, ${pl(total, 'site', 'sites')}${without ? `, ${e(without)} without coordinates` : ''}.`,
    topTitle: 'Most frequently found plants',
    topHint: 'Click a plant to show only sites with that plant. The numbers are sites.',
    topEmpty: 'No plants in this selection.',
    topSites: (k) => pl(k, 'site', 'sites'),
    statusLoading: 'Loading…',
    statusLooking: 'Searching…',
    errNetwork: 'Cannot reach the search service. Check your connection and try again.',
    errUnavailable: 'The search service is temporarily unavailable. Try again in a few minutes.',
    errGeneric: (status) => `The search failed (status ${status}). Change your search term or try again.`,
    retry: 'Try again',
    bc: 'BC',
    ad: 'AD',
    yes: 'yes',
    no: 'no',
    detailKicker: 'Site',
    detailClose: 'Close',
    detailCopyLink: 'Copy link',
    detailCopied: 'Link copied',
    detailLabels: {
      siteNr: 'Site number', waarnemingsnummer: 'Archis observation number', zaaknummer: 'Archis case number', locatienaam: 'Location', plaats: 'Place',
      provincie: 'Province', complextype: 'Site type', archeoregio: 'Archaeological region', periode: 'Period', jaren: 'Years', biaxId: 'BIAX code',
      sporen: 'Features', monsters: 'Samples', waarnemingen: 'Plant records', taxa: 'Taxa', nauwkeurigheid: 'Coordinate precision', dateringBron: 'Dating source',
    },
    uncertainNumber: 'RADAR marks this observation number as uncertain; it is not used for linking.',
    coordPrecision: 'Coordinates accurate to the kilometre',
    headingDescription: 'Description',
    headingPlants: 'Plants found',
    headingFeatures: 'Features',
    headingLiterature: 'Literature',
    headingRelated: 'Related research',
    plantsFilter: 'Filter the plants',
    plantsCount: (k) => pl(k, 'taxon', 'taxa'),
    plantsMore: (k) => `Show all ${e(k)}`,
    plantsLess: 'Show fewer',
    plantsEmpty: 'The dataset has no plant records for this site yet.',
    plantsEmptyNote: 'Some plant rows are not yet linked to a sample and are therefore not in the dataset. That says nothing about what was found.',
    plantsLoadError: 'The plants could not be loaded: ',
    plantTable: { plant: 'Plant', finds: 'Records', samples: 'Samples', preserved: 'Preservation', parts: 'Parts' },
    plantObsHint: 'A record is one plant in one sample. The number does not say how many seeds there were: quantities in RADAR cannot be compared between records.',
    preservation: 'Preservation',
    featuresEmpty: 'No features in the dataset.',
    featuresLoadError: 'The features could not be loaded: ',
    featureCount: (k) => pl(k, 'feature', 'features'),
    featureSamples: (k) => pl(k, 'sample', 'samples'),
    litEmpty: 'No literature listed.',
    litLoadError: 'The literature could not be loaded: ',
    litOpen: 'Open report',
    relatedLookup: 'Looks in the heritage register and in BoneInfo for the same observation number.',
    relatedNone: 'No related data found.',
    relatedHeritage: 'Heritage register (RCE)',
    relatedBone: 'Archaeozoology (BoneInfo)',
    relatedBoneText: (k) => `${pl(k, 'animal species', 'animal species')}`,
    relatedNote: 'An equal observation number is a strong sign that it concerns the same research, not a certainty.',
    relatedError: 'Related data could not be loaded: ',
    relatedContains: (k) => pl(k, 'object', 'objects'),
    rawLink: 'Linked Data',
    footerSource: 'Source: RADAR (BIAX Consult), published as Linked Data by the Cultural Heritage Agency of the Netherlands. An experiment.',
    footerData: 'Data',
    footerDocs: 'How it is made',
    skip: 'Skip to the results',
    openSite: (naam) => `Open ${naam}`,
    langLabel: 'Language',
  },
};

// kleine hulpfunctie voor de kaartstatus (Nederlands meervoud)
function pl2(x, een, meer) { return `${n(x)} ${Number(x) === 1 ? een : meer}`; }

let lang = DEFAULT_LANG;
try {
  const opgeslagen = globalThis.localStorage?.getItem('radar-lang');
  if (LANGS.includes(opgeslagen)) lang = opgeslagen;
} catch { /* localStorage kan geblokkeerd zijn */ }

export const getLang = () => lang;
export function setLang(code) {
  if (!LANGS.includes(code)) return;
  lang = code;
  try { globalThis.localStorage?.setItem('radar-lang', code); } catch { /* geblokkeerd */ }
}

export function t(key, ...args) {
  const value = STRINGS[lang][key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

// ---- waarden uit de data, weergegeven in de gekozen taal ----------------------------------
// Bewaringswijze staat in de bron als "carbonized/verkoold" (Engels/Nederlands).
export function bewaringLabel(value) {
  const delen = String(value).split('/');
  if (delen.length < 2) return value;
  return lang === 'nl' ? delen.slice(1).join('/') : delen[0];
}

// Houtskool, blauwgroen, oker, grijs: de kleur zegt hoe de rest bewaard is gebleven.
export function bewaringSoort(value) {
  const v = String(value).toLowerCase();
  if (v.startsWith('carbon')) return 'verkoold';
  if (v.startsWith('waterlogged')) return 'onverkoold';
  if (v.startsWith('mineral')) return 'gemineraliseerd';
  if (v.startsWith('impression')) return 'indruk';
  if (v.includes('recent')) return 'recent';
  return 'onbekend';
}

// Plantdelen staan in de bron in het Engels (internationale standaard). Alleen de meest voorkomende
// zijn vertaald; de rest blijft Engels.
const DEEL_NL = {
  'seed s.l.': 'zaad', 'fruit, capsule, silicle, pod': 'vrucht, doosvrucht, hauwtje, peul', 'fragment(s)': 'fragment(en)', pollen: 'pollen',
  leaf: 'blad', 'glume base': 'kafbasis', 'spikelet fork': 'aartjesvork', '(rachis) internode (1 or more)': 'spilsegment(en)', stem: 'steel',
  'bud (-scale)': 'knop(schub)', 'chaff (unspecified)': 'kaf', twig: 'twijg', flower: 'bloem', 'perianth/perigon': 'bloemdek', 'awn(s) or -fragments': 'naald(en)',
  calyx: 'kelk', embryo: 'kiem', 'endocarp (malus)': 'endocarp', 'root/tuber/rhizome': 'wortel, knol, wortelstok',
};
export function deelLabel(value) {
  if (lang !== 'nl') return value;
  return DEEL_NL[String(value).toLowerCase()] ?? value;
}

// Gebruiksplantcategorie: 'kruid_specerij' -> 'kruid, specerij'
export const categorieLabel = (value) => String(value).replaceAll('_', ' / ');

export function facetLabel(key, value) {
  if (key === 'bewaringswijze') return bewaringLabel(value);
  if (key === 'plantdeel') return deelLabel(value);
  if (key === 'gebruiksplantCategorie') return categorieLabel(value);
  return value;
}

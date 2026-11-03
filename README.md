# RADAR — Linked Data pilot

RADAR is de archeobotanische referentiedatabase (BIAX Consult): 1.630
vindplaatsen, 7.429 sporen, 12.348 monsters en 263.910 plantenregels, met
1.334 literatuurverwijzingen en een taxonlijst van 4.059 namen. Bron:
`RADAR2022 2026-06-23 verstuurversie.mdb` (Access, 159 MB, staat in deze map,
wordt alleen gelezen). Documentatie: `report_file_31_20.pdf`, de RADAR-handleiding
van BIAX (Brinkkemper & Van Haaster, 1997, versie 2.0).

Dit is een **pilot** in de lijn van `C:\AI\BoneInfo`: dezelfde pijplijn en
dezelfde vocabulaires, zodat RADAR en BoneInfo later samen bevraagd kunnen
worden en aan `C:\AI\elastic-ceo` gekoppeld kunnen worden.

## Stand

| Onderdeel | Status |
|---|---|
| Export Access → CSV (`scripts/export_tables.ps1`) | gedaan, alle aantallen kloppen met de database |
| Periodes uit het ABR (`scripts/haal_abr_periodes.py`) | gedaan: 63 periode-concepten in `data/abr_periodes.json` |
| CSV → RDF + NDJSON (`scripts/radar_to_rdf.py`) | gedaan voor 30 sites (`--pilot 30`), TriG volledig herparsed |
| Pilot-output (`output/`) | 34.331 triples, 30 sites, 66 sporen, 117 monsters, 2.563 plantenregels, 458 taxa, 30 rapporten |
| Ontologie (`ontology/radar.ttl`) | **gedaan**: 37 properties en 7 SKOS-schema's, met label, omschrijving, domein, bereik en een voorbeeld uit de echte data per term; parset zonder fouten en dekt precies de termen die het script gebruikt |
| Volledige run (`python scripts/radar_to_rdf.py`) | **gedaan**: `output/radar_full.trig` (226 MB, 2.676.753 triples, herparse in 45 s) en `radar_full_es.ndjson` (1.630 documenten, 7,9 MB). 1.630 sites, 7.429 sporen, 11.168 monsters, 229.828 plantenregels, 1.791 taxa, 1.327 rapporten, 1.628 sites met geometrie. |
| Zoekprojectie (`construct/radar.rq`) | **gedaan**: één document per site, 36 velden in de namespace `radar-elastic:` (341.432 triples voor 1.630 sites; rdflib deed er 4,5 minuten over, zie hieronder). Alle documenten gecontroleerd: geen typeafwijkingen, aantallen planten en taxa gelijk aan het NDJSON. Lokaal getest met `scripts/controleer_construct.py` (zie "Zoekprojectie en Elasticsearch") |
| Elastic-template (`triply/elastic-service.json`, gemaakt door `triply/maak-service.mjs`) | **gedaan en getest** tegen een lokale Elasticsearch 8.17.0 in Docker (`scripts/lokaal-elastic.mjs`): templates geaccepteerd, alle 36 velden met het verwachte type, zowel de 30 pilotdocumenten als alle 1.630 documenten geïndexeerd zonder fouten, alle zoekvragen gelukt |
| Upload naar TriplyDB | dataset `archeobotanie/radar` is geladen (oudere versie, zie "Volgorde in TriplyDB") en `archeobotanie/radar-elastic` is gevuld met de projectie van die versie |
| Service `Radar` aanmaken, zoeksite | nog niet gedaan |
| Kruislink in `elastic-ceo` (`loadRadar()`) | **gedaan, staat uit**: `web/radar.js` en `loadRadar()` in `web/app.js` (ongecommit in `C:/AI/elastic-ceo`), 8 nieuwe unit-tests (26 in totaal, alle gelukt) en getest tegen de lokale Elasticsearch met de echte RADAR-documenten. De schakelaar `RADAR_ACTIEF` blijft `false` tot de service in TriplyDB draait |

## Opnieuw draaien

```bash
# 1. Exporteer de tabellen (32-bit PowerShell, Jet-provider)
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File scripts\export_tables.ps1

# 2. Haal de periodes uit het ABR (LDV, thesauri/archeologischbasisregister)
python scripts/haal_abr_periodes.py

# 3. Genereer de RDF
pip install -r scripts/requirements.txt
python scripts/radar_to_rdf.py --pilot 30   # pilot
python scripts/radar_to_rdf.py              # volledig
```

Naast `radar_<pilot|full>.trig` en `radar_<pilot|full>_es.ndjson` (een eigen document per site, rechtstreeks uit de CSV's, handig als controle) schrijft het script
`output/radar_conflicts.csv` (zie bevinding 1) en `output/radar_periodecodes.csv`
(welke RADAR-periodecode op welk ABR-concept uitkomt).

## Zoekprojectie en Elasticsearch

De TriplyDB-Elasticsearch-service maakt één document per subject. Omdat RADAR hiërarchisch is (site, spoor, monster, plantenregel), draait de service niet op de brondataset zelf maar op een **zoekprojectie**: één document per site, gemaakt met een CONSTRUCT-query. Zelfde opzet als BoneInfo (`construct/boneinfo.rq`) en `elastic-ceo` (`construct/alles.rq`). De projectie is een zoeksleutel, geen tweede bron; de brondataset blijft leidend.

```
output/radar_full.trig  --upload-->  TriplyDB-dataset archeobotanie/radar
                                       | construct/radar.rq (query-job)
                                       v
                                     TriplyDB-dataset archeobotanie/radar-elastic
                                       | triply/elastic-service.json
                                       v
                                     Elasticsearch-service "Radar"
```

| Bestand | Inhoud |
|---|---|
| [`construct/radar.rq`](construct/radar.rq) | De CONSTRUCT: een UNION-blok per veld, alle velden in `https://linkeddata.cultureelerfgoed.nl/def/radar-elastic#` (behalve `geo:asWKT`) |
| [`triply/maak-service.mjs`](triply/maak-service.mjs) | Maakt `elastic-service.json` (`node triply/maak-service.mjs`); velden staan er per type |
| [`triply/elastic-service.json`](triply/elastic-service.json) | De index template voor de service; niet met de hand bewerken |
| [`triply/nl-analyse.json`](triply/nl-analyse.json) | Nederlandse taalanalyse, een kopie van die van BoneInfo (en `elastic-ceo`) |
| [`scripts/controleer_construct.py`](scripts/controleer_construct.py) | Draait de CONSTRUCT lokaal op de TriG, zet de uitkomst om zoals TriplyDB, controleert de typen tegen de template en vergelijkt met het NDJSON |

**Velden per document** (36): sitenummer, BIAX-id, waarnemingsnummer (+ onzeker-vlag), zaaknummer, locatienaam, plaats, provincie (naam), complextype (label), archeoregio, omschrijving, nauwkeurigheid en herkomst datering, geometrie, begin- en eindperiode (ABR-label), periodecode, begin- en eindjaar, soorten sporen, aantal sporen/monsters/plantenregels, **taxa** (wetenschappelijke naam, Nederlandse naam, familie, gebruiksplantcategorie, taxon-URI), bewaringswijze, plantdeel, monstertype en de literatuur (auteur, titel, jaar, tijdschrift, instantie, URL). Een taxon dat op een site vaak is gevonden komt maar één keer in het document, want RDF kent geen dubbele triples.

Wat de CONSTRUCT niet meeneemt: de afzonderlijke plantenregels met aantallen. Een document zegt dat een taxon op de site is gevonden, niet hoeveel. Dat past ook bij de bevinding dat `Quantification` niet over regels heen vergelijkbaar is. Detail per monster hoort in de detailweergave, rechtstreeks uit de brondataset (zoals `web/detail.js` bij BoneInfo).

**Labels.** De query kan de externe thesaurus-graphs niet lezen. `radar_to_rdf.py` zet daarom het `skos:prefLabel` van de gebruikte ABR-periodes en TOOI-provincies in de brondataset zelf, hetzelfde patroon als BoneInfo voor de verwervingswijzen.

**Lokaal getest, niet in TriplyDB.** Twee scripts:

- `python scripts/controleer_construct.py pilot|full` draait de query met rdflib, zet de uitkomst om zoals TriplyDB en schrijft `output/radar_<naam>_elastic.ndjson`. Dit controleert de logica, niet de snelheid in TriplyDB: of één query-job volstaat voor 1.630 sites is nog niet geprobeerd (bij `elastic-ceo` was één job voor 1,2 miljoen objecten te traag).
- `node scripts/lokaal-elastic.mjs pilot|full [--keep]` start een eigen Elasticsearch 8.17.0 in Docker (poort 9202), laadt de template, indexeert die documenten en draait de zoekvragen: exact zoeken op waarnemingsnummer, taxon als facet, Nederlandse plantnaam, bewaringswijze, ABR-periode, datering als getal (ook voor Chr.), `geo_distance`, facetten, sorteren op sitenummer en meervoud ("kuilen" vindt "kuil"). De vragen worden uit de documenten afgeleid. Met `--keep` blijft de container staan om zelf in te zoeken.

De taalanalyse is dezelfde als die van de draaiende BoneInfo-service.

**Volgorde in TriplyDB** (de dataset `archeobotanie/radar-elastic` bestaat; de service nog niet):

1. Laad de nieuwste `output/radar_full.trig` (2.676.850 triples) in `archeobotanie/radar`, graph `.../archeobotanie/graph/radar`, en vervang de oude graph. Op 3 november stond er de versie van 2.676.753 triples, zonder de gecachete labels en zonder gesplitste plantcategorieën.
2. Draai de query-job met `construct/radar.rq` opnieuw naar `archeobotanie/radar-elastic` (eerst de oude graph leegmaken).
3. Controleer: `python scripts/vergelijk_triply.py`. Het moet *GELIJK* melden (1.630 documenten, 341.432 triples). Bij de eerste vergelijking misten `beginperiode`, `eindperiode` en `provincie` (de facetten zouden leeg zijn) en had `gebruiksplantCategorie` 7.126 in plaats van 7.264 triples.
4. Maak de service aan (hieronder) en wacht tot hij `running` is.
5. Zet `RADAR_ACTIEF` in `elastic-ceo/web/radar.js` op `true`.

Service aanmaken (PowerShell, TriplyDB-token met *Management access*; zet het token niet in een bestand of gesprek):

```bash
curl.exe -H "Authorization: Bearer $env:TRIPLY_TOKEN" -H "Content-Type: application/json" -X POST "https://api.linkeddata.cultureelerfgoed.nl/datasets/archeobotanie/radar-elastic/services" -d "@C:\AI\RADAR\triply\elastic-service.json"
```

De template wordt alleen bij het aanmaken gelezen: na een wijziging (`node triply/maak-service.mjs`) de service verwijderen en opnieuw aanmaken.

Status en aantal documenten (publiek, geen token nodig; wacht tot de status `running` is en het aantal 1.630 is):

```bash
curl.exe -s "https://api.linkeddata.cultureelerfgoed.nl/datasets/archeobotanie/radar-elastic/services"
(Invoke-RestMethod -Method Post -Uri "https://api.linkeddata.cultureelerfgoed.nl/datasets/archeobotanie/radar-elastic/services/Radar/_search" -ContentType "application/json" -Body '{"size":0,"track_total_hits":true}').hits.total.value
```

Gaat de service op *Error*, dan staat de melding op de servicekaart in TriplyDB.

## Model

Namespace instanties: `https://linkeddata.cultureelerfgoed.nl/archeobotanie/id/radar/`,
graph `.../archeobotanie/graph/radar` (voorlopige namen, nog af te stemmen).

| RADAR | RDF |
|---|---|
| `SITES` | `ceo:Vondstlocatie` + `ceo:ArcheologischComplex`, `ceo:archis2Waarnemingsnummer`, geometrie (RD → WGS84), datering via `ceo:heeftDatering` |
| `Cultural period` (sites en sporen) | `ceo:heeftPeriode` → ABR-concept, als `https://data.cultureelerfgoed.nl/term/id/rn/2/{uuid}` (zoals de CHO-data), oorspronkelijke code in `rad:periodecode` |
| `FEATURES` | `ceo:Grondsporen`, `ceo:ligtInObject` → site |
| `SAMPLES` | `dwc:MaterialSample`, `ceo:ligtInObject` → spoor |
| `PLANTS` | `dwc:Occurrence` + `ceo:Vondsten`, `ceo:ligtInObject` → monster, `rad:heeftTaxon` → taxon |
| `PLANTS.Remarks` | `rad:heeftOpmerkingscode` → SKOS-concept met het label uit de handleiding |
| `Taxa` + `Taxa thesaurus` + `Synonyms` | `dwc:Taxon` met namen (nl/en/de) en rangen tot familie; synoniemen als `skos:altLabel` |
| `REPORTS` | `schema:ScholarlyArticle`, `schema:about` → site; `Periodiek` als `schema:Periodical` |
| `Site_type`, `Pres_mode`, `Id_level`, `Parts`, `Sample_type`, `Archeoregio` | lokale SKOS-schema's |
| `Prov` | TOOI-provincie (`rad:heeftProvincie`), dezelfde URI's als BoneInfo |

Alleen kleine `rad:`-properties zijn nieuw (37 stuks, plus 7 codelijsten). Ze zijn formeel gedefinieerd in [`ontology/radar.ttl`](ontology/radar.ttl), net als [`boneinfo.ttl`](../BoneInfo/ontology/boneinfo.ttl) bij BoneInfo: labels (nl/en), omschrijving, domein en bereik, en een voorbeeld per term.

### Periodes en het ABR

RADAR zegt zelf (handleiding): *Cultural period = afkortingen zoals gebruikt door Archis*. In de data staan twee codesystemen door elkaar:

- **Huidige ABR-codes** (`MELB`, `NTV`, `ROMM`, …): staan als `skos:notation` in het ABR en worden rechtstreeks gebruikt. Dat is 957 van de 1.622 sites met een periode en 4.907 van de 7.421 sporen.
- **Oude Archis-codes** (`LMEA`, `LMEB`, `VMEA`–`VMED`, `LME`, `VME`, `XME`, `NTA`, `NTB`, `NTC`): komen niet meer in het ABR voor. Ze zijn gemapt op de hernoemde code (`LMEB` → `MELB`, `NTA` → `NTV`, `NTB` → `NTM`, `NTC` → `NTL`, `VMEx` → `MEVx`, `XME` → `ME`). De mapping rust op de namen en is getoetst aan de mediane begin- en eindjaren van de RADAR-sites per code (bijvoorbeeld `LMEB` ± 1300–1450 tegen `MELB` ± 1320–1500; `NTA` ± 1550–1600 tegen `NTV` ± 1597–1675). Zulke nodes krijgen `rad:periodecodeGemapt true`. **BIAX/RCE moet deze mapping nog bevestigen.**
- **Handmatig gemapt**: 14 typefouten en varianten (`IJT` → `IJZ`, `MBT` → `BRONSM`, `VIJT`/`VIJZ` → `IJZV`, `MRLB` → `MELB`, `VEMB` → `MEVB`, `VMAC` → `MEVA`, `MELV` → `MEV`, …) zijn door de gegevenseigenaar van een ABR-label voorzien en op dat label gematcht (`HANDMATIGE_PERIODECODES` in het script). Ze krijgen ook `rad:periodecodeGemapt true`. Oude en handmatig gemapte codes samen: 658 sites en 2.460 sporen krijgen hun periode alleen via een gemapte code.
- **Niet te mappen**: 8 codes houden alleen de originele code: `PREROM` ("pre romeins"), `LMED`, `LMEC` (het ABR kent geen Late Middeleeuwen C en D), `ROMBB` ("romeinse tijd B", onduidelijk welke periode), `MERV` ("Merovingische tijd", geen ABR-concept), `RT`, `??` en `????`. Dat zijn 6 sites en 33 sporen met een gedeeltelijk of niet te mappen periode.
- Samengestelde waarden zoals `LMEA/B`, `IJZM/L` en `BRONSL_IJZV` worden gesplitst; begin- en einddatering gebruiken de eerste en laatste code.

## Koppeling met RCE-data (`elastic-ceo`)

Sleutel: `SITES."Archis wnr"` = `ceo:archis2Waarnemingsnummer`. Gemeten op alle sites tegen `rce/cho`:

- 1.045 van de 1.630 sites hebben een waarnemingsnummer (923 verschillende nummers).
- **976 sites (93%) hebben een nummer dat bij precies één vondstlocatie in de CHO-data hoort** (858 van de 923 nummers; geen enkel nummer matcht met meer dan één).
- 87 nummers komen in RADAR bij meer dan één site voor; die sites verwijzen dus naar dezelfde vondstlocatie.
- Eén site heeft de vlag `ar?` (waarnemingsnummer onzeker volgens de handleiding). Die krijgt `rad:waarnemingsnummerOnzeker` en moet bij het koppelen worden overgeslagen.

Het blijft een "zelfde nummer"-koppeling, geen `owl:sameAs`. `Archis zaaknr` (10 cijfers, 610 sites) is **niet** gelijk aan `ceo:archis2Vondstmeldingsnummer` (6 cijfers) en wordt als `rad:archisZaaknummer` bewaard.

## Wat de handleiding verklaart

- **Structuur:** rapport → site → spoor → monster → plantenrest, zoals gemodelleerd.
- **`Remarks` bij planten** zijn codes die zeggen hoe `Quantification` gelezen moet worden: `esq` geschat aantal (181 in de pilot), `pre` alleen aanwezigheid gemeld, `per` percentage, `wei` gewicht, `frq`/`fr%` frequentie, `sum` opgeteld over monsters, `lar` groot aantal, en annotaties als `id?` (determinatie twijfelachtig), `cor`, `eye` (handvondst), `pm?`, `pp?`. **`Quantification` is dus niet over regels heen vergelijkbaar** zonder de code. Codes die niet in de handleiding staan (ongeveer 20 verschillende, samen circa 280 regels, vooral `frm` met 235; verder `div`, `kno`, `vl%`, …) blijven als literal `rad:opmerkingscode`.
- **`Remarks` bij sites:** `coo` = coördinaten uit de topografische atlas op de kilometer nauwkeurig (`rad:coordinaatNauwkeurigheid "1 km"`, 18 sites), `C14` en `dor` = herkomst datering, `BEL` = Belgisch rapport, `ar?` zie boven.
- **Id-level:** zonder code is de determinatie op soort of lager; `cf…` = onzeker. De codes `cfspc`/`cfgen` zijn in het RDF `dwc:identificationQualifier "cf."` plus het niveau als concept.
- **`Status` van rapporten:** `p` gepubliceerd, `i` intern rapport, `u` ongepubliceerde gegevens (nog niet in de RDF opgenomen).

## Bevindingen in de brondata

1. **Sleutelconflict in `PLANTS` (belangrijkste).** Voor 34.002 plantenregels (13%) wijst de overtollige kolom
   `PLANTS.BIAX_ID` naar een *ander* monster dan `Sample nr`. Voorbeeld: Sample nr 10619 heeft plantenregels met
   BIAX_ID `OOSTV-565` (Oostburg), maar monster 10619 is `SLOOS-239` (Goes). Het gaat om één aaneengesloten blok
   van 1.180 Sample nrs (9402–11819). De regels in dat blok worden **niet** in de RDF opgenomen; ze staan in
   `output/radar_conflicts.csv`, met voor 32.339 regels één kandidaat-monster via `BIAX_ID`.
   Een monster met conflict valt er als geheel uit (één monster had ook 80 gewone regels), zodat in totaal 34.082 van de 263.910
   plantenregels en 1.180 monsters ontbreken. **Gevolg in de volledige run: 153 van de 1.630 sites hebben daardoor geen enkele
   plantenregel in de RDF, en nog 1 site mist een deel.** Nog eens 6 sites hebben ook in de bron geen planten. Zo komt het
   dat maar 1.471 sites planten hebben; een zoeksite zou die 153 als "zonder plantendata" tonen terwijl de bron ze wel heeft.
   De handleiding legt de koppeling tussen `SAMPLES` en `PLANTS` via de *sample code* (versie 2.0); in de huidige database is
   `Sample code` niet uniek (131 dubbele codes) en `PLANTS.BIAX_ID` slechts bij 64.458 van de 263.910 regels gevuld.
   Wat de juiste koppeling is, kan alleen BIAX bevestigen. Tot die tijd is de pilot-output bewust conservatief.
2. **Geen sleutel per plantenregel.** `PLANTS` heeft geen id; de waarnemings-URI is `monster/{Sample nr}_{volgnummer}`
   in CSV-volgorde. Dat is stabiel zolang de export dezelfde volgorde houdt. 930 regels zijn dubbel (zelfde monster, taxon, plantdeel, bewaringswijze).
3. **Complextypes.** 176 van 1.630 sites hebben een oude code die niet in `Site_type` staat (`NLND` 58, `NX` 24, `NS` 24, …). Die blijven literal.
4. **Overig.** 193 sites zonder provinciecode, 2 zonder coördinaat; één URL met spaties in `REPORTS` (wordt gecodeerd); een deel van de URL's
   is een Access-hyperlink (`#…#`, wordt schoongemaakt) of de placeholder `xxx` (wordt weggelaten); 61 rapporten zonder status. De `Plakfouten*`-tabellen, de kolommen `F12`/`Veld1`
   en `Hogere_planten`/`WESTHOFF` zijn niet geëxporteerd of gemodelleerd. De codes voor monstertypen in de handleiding (`ABA`, `FLOT`, …) verschillen van die in de database (`MZ0,25`, …); de database is hier leidend.

## Open punten

- BIAX/RCE: akkoord op publicatie van de verstuurversie, uitsluitsel over het sleutelconflict (bevinding 1) en bevestiging van de mapping van oude Archis-periodecodes.
- Namen van dataset en namespace (`archeobotanie/radar` is voorlopig).
- Upload naar TriplyDB, de service `Radar` aanmaken en daarna `RADAR_ACTIEF` in `elastic-ceo/web/radar.js` op `true` zetten; een RADAR-zoeksite (`RADAR_SITE`) bestaat nog niet.
- `rad:heeftTaxon`: zelfde open vraag als `bo:heeftTaxon` in BoneInfo; liefst voor beide datasets dezelfde keuze maken.
- Taxa van RADAR en BoneInfo gezamenlijk modelleren (`dwc:Taxon`) is mogelijk, maar niet gedaan.
- Niets in `C:\AI\BoneInfo` of `C:\AI\elastic-ceo` is gewijzigd.

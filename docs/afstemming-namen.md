# RADAR als Linked Data: afstemming van namen

Stand van 3 november 2026. Deze notitie is bedoeld voor de beheerder van de Linked Data Voorziening (LDV), de beheerders van de ontologieën (CEO) en BIAX Consult. Er staan vragen in waar we een antwoord op nodig hebben. Alles is nu nog goedkoop te wijzigen; dat wordt duurder zodra anderen naar de adressen verwijzen.

## Waar het over gaat

RADAR, de archeobotanische referentiedatabase van BIAX (1.630 vindplaatsen, 229.828 plantenwaarnemingen, 1.791 taxa), is als Linked Data gepubliceerd naar het voorbeeld van BoneInfo. Er is een zoeksite (`https://radar.jolietjakeblues64.workers.dev/`) en een koppeling met de erfgoedzoeker en met BoneInfo, op het Archis-waarnemingsnummer. Alle namen hieronder zijn door ons gekozen, naar het voorbeeld van BoneInfo, en zijn niet met de RCE afgestemd.

## De namen nu

| Wat | Nu | Voorbeeld ernaast |
|---|---|---|
| Account in de LDV | `archeobotanie` | `archeozoologie` |
| Datasets | `archeobotanie/radar` (brondata) en `archeobotanie/radar-elastic` (zoekprojectie) | `archeozoologie/boneinfo`, `…/boneinfo-elastic` |
| Elastic-service | `Radar` | `Boneinfo` |
| Namespace van de gegevens | `https://linkeddata.cultureelerfgoed.nl/archeobotanie/id/radar/` | `…/archeozoologie/id/boneinfo/` |
| Graph | `https://linkeddata.cultureelerfgoed.nl/archeobotanie/graph/radar` | `…/archeozoologie/graph/boneinfo` |
| Eigen vocabulaire (`rad:`, 37 properties en 7 codelijsten) | in dezelfde namespace als de gegevens | BoneInfo doet hetzelfde |
| Namespace van de zoekvelden | `https://linkeddata.cultureelerfgoed.nl/def/radar-elastic#` | `…/def/boneinfo-elastic#`, `…/def/ceo-elastic#` |

## Wat we gemeten hebben

- **De adressen van de gegevens resolven niet.** `…/archeobotanie/id/radar/site/100` geeft een 404, net als `…/archeozoologie/id/boneinfo/cluster/299` bij BoneInfo. De URI's van CHO (`…/cho-kennis/id/vondstlocatie/6133975`) geven wel turtle terug. De dataset-pagina's (`…/archeobotanie/radar`) werken.
- **`/def/` geeft voor elk pad een lege 200.** Ook voor `/def/zzzzonbestaand`. Een lege 200 betekent dus niet dat er iets is gepubliceerd, en `radar-elastic#` en `boneinfo-elastic#` zijn dat ook niet.
- Bij `archeobotanie/radar` en `archeobotanie/radar-elastic` staan geen licentie en geen beschrijving ingevuld; de datasets staan op *public*. Bij `archeozoologie/boneinfo` is dat hetzelfde.

## Vragen per partij

### Beheerder van de LDV

1. **Account en datasetnamen.** Voorstel: `archeobotanie/radar` en `archeobotanie/radar-elastic` aanhouden. Het spiegelt `archeozoologie/boneinfo`, en RADAR is de eigen naam van de database. Alternatief: een andere accountnaam of een samenvoeging van beide accounts onder één naam voor archeologische referentiedata.
2. **Resolvbare URI's.** Moeten de gegevens-URI's (`…/id/radar/…` en `…/id/boneinfo/…`) opgevraagd kunnen worden, zoals bij CHO? Voor Linked Data hoort dat, maar het is een instelling van de LDV, niet van onze data. Wat is daarvoor nodig, en wanneer kan dat?
3. **Toegang en licentie.** Moeten de datasets openbaar zijn en onder welke licentie? Zie ook de vraag aan BIAX.

### Beheerders van de ontologieën (CEO)

4. **Vocabulaire onder `/def/`.** Onze 37 `rad:`-properties staan nu in de namespace van de gegevens, omdat dat bij BoneInfo ook zo is begonnen. Voorstel: beide verhuizen naar een eigen vocabulaire-namespace, `…/def/radar#` en `…/def/boneinfo#`, in één keer, zodat we de gegevens maar één keer opnieuw laden. Mag dat onder `/def/`, waar de officiële RCE-ontologieën staan, en wie publiceert het daar?
5. **De zoekvelden.** `…/def/radar-elastic#` is bedoeld voor de zoekindex en niet voor hergebruik. Is het acceptabel dat het onder `/def/` staat, zoals `ceo-elastic#`? Dit is ook een open punt bij `elastic-ceo`.
6. **Wat hoort in CEO zelf?** We hebben eigen properties gemaakt waar CEO niets had. Een kandidaat voor CEO is het 10-cijferige Archis-zaaknummer, dat niet gelijk is aan `ceo:archis2Vondstmeldingsnummer`. Ook `heeftTaxon` (verbindt een waarneming met een taxon) is een gedeelde keuze met BoneInfo; liefst één property voor beide.

### BIAX Consult

7. **De naam RADAR en de bronvermelding.** Mogen we de naam gebruiken voor de dataset, de site en de URI's, en hoe moet BIAX genoemd worden?
8. **Openbaar maken.** De bron is een *verstuurversie* (RADAR2022, 23 juni 2026). Mag die openbaar?
9. **Twee dataproblemen** (zie het README van het project): een sleutelconflict in de plantenregels (34.082 regels, 153 vindplaatsen zonder plantendata) en de mapping van oude Archis-periodecodes naar het ABR.

## Wat het kost om later te wijzigen

| Wijziging | Wat ermee moet gebeuren | Inschatting |
|---|---|---|
| Datasetnaam of servicenaam | Eindpunten aanpassen in de zoeksite, `elastic-ceo` en BoneInfo; service opnieuw aanmaken | klein |
| Namespace van de gegevens | Alle RDF opnieuw genereren, uploaden, query-job draaien, service opnieuw aanmaken; geen verwijzingen van buiten kapot zolang niemand ernaar linkt | een paar uur |
| Vocabulaire naar `/def/…#` | Als hierboven, plus `radar.ttl`, script, query en de bijbehorende teksten | een paar uur |
| Namespace van de zoekvelden | Als hierboven, plus de template en de veldnamen in drie sites | een paar uur |

De uren komen vooral van het opnieuw uploaden en het laten draaien van de query-job. Het genereren zelf duurt ongeveer vijf minuten.

## Voorstel samengevat

1. Accountnaam, datasetnamen en namespace van de gegevens aanhouden.
2. Het vocabulaire van RADAR en BoneInfo samen verhuizen naar `/def/radar#` en `/def/boneinfo#`, in één keer, nadat de ontologiebeheerders akkoord zijn.
3. De gegevens-URI's resolvbaar maken, als de LDV dat kan instellen.
4. BIAX om akkoord vragen op naam, openbaarheid en licentie, en om uitleg over het sleutelconflict en de periodecodes.

## Waar de namen in de code staan

- RADAR: `construct/radar.rq`, `ontology/radar.ttl`, `scripts/radar_to_rdf.py`, `scripts/vergelijk_triply.py`, `triply/maak-service.mjs`, `web/search.js`, `web/detail.js`, `web/index.html`, `wrangler.jsonc`, `tests/`.
- `elastic-ceo`: `web/radar.js` (eindpunt en veldnamen), `tests/web.test.mjs`, `docs/website.md`.
- BoneInfo: `web/related.js` (eindpunt en veldnamen van RADAR).

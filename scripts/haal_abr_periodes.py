"""
Haalt de periode-concepten (rnce:PeriodAbr) uit het Archeologisch Basisregister
in de Linked Data Voorziening van de RCE en schrijft data/abr_periodes.json:

    { "MELB": {"uuid": "2c559d8a-...", "label": "Late Middeleeuwen B"}, ... }

De CHO-data (ceo:heeftPeriode) gebruikt https://data.cultureelerfgoed.nl/term/id/rn/2/{uuid},
met dezelfde uuid als het ABR-concept. radar_to_rdf.py bouwt die URI uit de uuid.

Gebruik:  python scripts/haal_abr_periodes.py
"""
import json
import subprocess
from pathlib import Path

ENDPOINT = "https://api.linkeddata.cultureelerfgoed.nl/datasets/thesauri/archeologischbasisregister/sparql"
OUT = Path(__file__).resolve().parent.parent / "data" / "abr_periodes.json"

QUERY = """
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rnce: <https://data.cultureelerfgoed.nl/id/rnce#>
SELECT ?c ?n ?l WHERE {
  ?c a rnce:PeriodAbr ; skos:notation ?n ; skos:prefLabel ?l .
  FILTER(STRSTARTS(STR(?c), "https://data.cultureelerfgoed.nl/term/id/abr/2/"))
  FILTER(LANG(?l) = "nl")
}
"""


def main():
    r = subprocess.run(
        ["curl", "-s", "-m", "120", "-H", "Accept: application/sparql-results+json",
         "--data-urlencode", "query=" + QUERY, ENDPOINT],
        capture_output=True, text=True, check=True)
    rows = json.loads(r.stdout)["results"]["bindings"]
    periodes = {}
    for b in rows:
        periodes[b["n"]["value"]] = {
            "uuid": b["c"]["value"].rsplit("/", 1)[1],
            "label": b["l"]["value"],
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(periodes, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    print(f"{len(periodes)} ABR-periodes -> {OUT}")


if __name__ == "__main__":
    main()

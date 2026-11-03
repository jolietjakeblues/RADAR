"""
Vergelijkt de zoekprojectie in TriplyDB (dataset archeobotanie/radar-elastic, gemaakt door de
query-job met construct/radar.rq) met de lokale projectie (output/radar_full_elastic.ndjson, gemaakt
door scripts/controleer_construct.py full) per veld: aantal documenten en aantal triples.

Draai dit na het opnieuw laden van de brondataset en het draaien van de query-job, en voordat je
de Elastic-service aanmaakt: de service indexeert precies wat er dan in de dataset staat.
Alleen lezen; de datasets zijn publiek, er is geen token nodig.

Gebruik:  python scripts/vergelijk_triply.py [account/dataset]     (standaard archeobotanie/radar-elastic)
"""
import collections
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
dataset = sys.argv[1] if len(sys.argv) > 1 else "archeobotanie/radar-elastic"
ENDPOINT = f"https://api.linkeddata.cultureelerfgoed.nl/datasets/{dataset}/sparql"
RE = "https://linkeddata.cultureelerfgoed.nl/def/radar-elastic#"
GEO = "http://www.opengis.net/ont/geosparql#asWKT"


def sparql(query):
    r = subprocess.run(
        ["curl", "-s", "-m", "120", "-H", "Accept: application/sparql-results+json",
         "--data-urlencode", "query=" + query, ENDPOINT],
        capture_output=True, text=True)
    return json.loads(r.stdout)["results"]["bindings"]


def kort(iri):
    return "geo:asWKT" if iri == GEO else iri.replace(RE, "re:")


remote = {
    kort(b["p"]["value"]): (int(b["subjects"]["value"]), int(b["n"]["value"]))
    for b in sparql("SELECT ?p (COUNT(DISTINCT ?s) AS ?subjects) (COUNT(*) AS ?n) "
                    "WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?p")
}

# lokale documenten: Triply zet punten in veldnamen om in spaties
local = collections.defaultdict(lambda: [set(), 0])
for i, line in enumerate((ROOT / "output" / "radar_full_elastic.ndjson").open(encoding="utf-8")):
    if i % 2 == 0:
        continue
    doc = json.loads(line)
    for veld, waarden in doc.items():
        if veld == "@id":
            continue
        sleutel = kort(veld.replace(" ", "."))
        local[sleutel][0].add(doc["@id"])
        local[sleutel][1] += len(waarden)

verschillen = 0
print(f"{'veld':34}{'Triply (docs, triples)':>26}{'lokaal':>22}")
for veld in sorted(set(remote) | set(local)):
    r = remote.get(veld, (0, 0))
    l = (len(local[veld][0]), local[veld][1]) if veld in local else (0, 0)
    if r != l:
        verschillen += 1
    print(f"{veld[:33]:34}{str(r):>26}{str(l):>22}{'' if r == l else '   <-- verschil'}")

documenten = int(sparql("SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } }")[0]["n"]["value"])
lokaal_docs = len({d for v in local.values() for d in v[0]})
print(f"\ndocumenten: Triply {documenten}, lokaal {lokaal_docs}")
print(f"triples: Triply {sum(n for _, n in remote.values())}, lokaal {sum(v[1] for v in local.values())}")
print("GELIJK: de dataset is klaar voor de Elastic-service" if not verschillen and documenten == lokaal_docs
      else f"{verschillen} veld(en) verschillen: laad de brondataset opnieuw en draai de query-job opnieuw")
sys.exit(1 if verschillen or documenten != lokaal_docs else 0)

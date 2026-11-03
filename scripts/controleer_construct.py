"""
Draait construct/radar.rq op een TriG-bestand (pilot of volledig) en controleert de projectie:

  1. zet elk subject om zoals de TriplyDB-Elasticsearch-service dat doet: één document per subject,
     "@id" = de URI, veldnaam = property-IRI met spaties in plaats van punten, elke waarde een
     lijst van strings (datatype en taal vallen weg);
  2. controleert dat elke waarde past bij het type in triply/elastic-service.json (integer, boolean,
     geo_point) en dat elk veld in de template staat;
  3. vergelijkt per site het aantal plantenregels en taxa met het NDJSON dat radar_to_rdf.py schrijft;
  4. schrijft de documenten als bulk-NDJSON (output/radar_<naam>_elastic.ndjson), om lokaal in een
     Elasticsearch te laden of te bekijken.

Gebruik:  python scripts/controleer_construct.py pilot
          python scripts/controleer_construct.py full
"""
import collections
import json
import re
import sys
import time
from pathlib import Path

from rdflib import Dataset

ROOT = Path(__file__).resolve().parent.parent
naam = sys.argv[1] if len(sys.argv) > 1 else "pilot"
RE = "https://linkeddata.cultureelerfgoed.nl/def/radar-elastic#"

t = time.time()
ds = Dataset(default_union=False)
ds.parse(ROOT / "output" / f"radar_{naam}.trig", format="trig")
print(f"TriG gelezen: {len(ds)} triples in {time.time() - t:.0f} s", flush=True)

t = time.time()
triples = list(ds.query((ROOT / "construct" / "radar.rq").read_text(encoding="utf-8")))
print(f"CONSTRUCT: {len(triples)} triples in {time.time() - t:.0f} s", flush=True)

docs = {}
for s, p, o in triples:
    veld = str(p).replace(".", " ")
    docs.setdefault(str(s), {"@id": str(s)}).setdefault(veld, []).append(str(o))
for d in docs.values():
    for k, v in d.items():
        if k != "@id":
            v.sort()
print(f"documenten: {len(docs)}")

# 2. typecontrole tegen de template
template = json.loads((ROOT / "triply" / "elastic-service.json").read_text(encoding="utf-8"))
mapping = {}
for c in template["config"]["componentTemplates"]:
    mapping.update(c["template"]["mappings"]["properties"])
fouten = collections.Counter()
for d in docs.values():
    for veld, waarden in d.items():
        if veld == "@id":
            continue
        if veld not in mapping:
            fouten[f"veld niet in template: {veld}"] += 1
            continue
        typ = mapping[veld].get("type")
        fields = mapping[veld].get("fields", {})
        for w in waarden:
            if typ == "integer" and not re.fullmatch(r"-?\d+", w):
                fouten[f"geen integer: {veld} = {w[:30]}"] += 1
            elif typ == "boolean" and w not in ("true", "false"):
                fouten[f"geen boolean: {veld} = {w[:30]}"] += 1
            elif typ == "geo_point" and not re.fullmatch(r"POINT \(-?\d+(\.\d+)? -?\d+(\.\d+)?\)", w):
                fouten[f"geen WKT-punt: {veld} = {w[:30]}"] += 1
            elif "getal" in fields and not re.fullmatch(r"\d+", w):
                fouten[f"nummerveld niet numeriek: {veld} = {w[:30]}"] += 1
print("typecontrole:", "geen afwijkingen" if not fouten else dict(fouten.most_common(10)))

# 3. vergelijking met het NDJSON
es = {}
for i, line in enumerate((ROOT / "output" / f"radar_{naam}_es.ndjson").open(encoding="utf-8")):
    if i % 2 == 1:
        doc = json.loads(line)
        es[doc["uri"]] = doc
afwijkend = []
for uri, e in es.items():
    d = docs.get(uri, {})
    n = int(d.get(RE.replace(".", " ") + "aantalWaarnemingen", ["0"])[0])
    taxa = len(d.get(RE.replace(".", " ") + "wetenschappelijkeNaam", []))
    if n != e["aantal_plantwaarnemingen"] or taxa != len({x["naam"] for x in e["taxa"]}):
        afwijkend.append(uri)
print(f"sites in NDJSON: {len(es)}, in projectie: {len(docs)}, afwijkend aantal planten of taxa: {len(afwijkend)}")
print("sites zonder document:", len(set(es) - set(docs)))
aantal = [len(d.get(RE.replace(".", " ") + "wetenschappelijkeNaam", [])) for d in docs.values()]
print(f"taxa per document: max {max(aantal)}, mediaan {sorted(aantal)[len(aantal) // 2]}")
velden = collections.Counter(k for d in docs.values() for k in d if k != "@id")
print(f"velden in gebruik: {len(velden)}")

# 4. bulk-NDJSON
uit = ROOT / "output" / f"radar_{naam}_elastic.ndjson"
with uit.open("w", encoding="utf-8") as f:
    for uri, d in sorted(docs.items()):
        f.write(json.dumps({"index": {"_index": "radar", "_id": uri}}) + "\n")
        f.write(json.dumps(d, ensure_ascii=False) + "\n")
print(f"geschreven: {uit}")

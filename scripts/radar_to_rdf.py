"""
RADAR (Access) -> RDF (TriG) + NDJSON (Elasticsearch bulk) converter.

RADAR is the archaeobotanical reference database (BIAX Consult): sites ->
features -> samples -> plant records, with literature and a taxon list.
Same pipeline and vocabulary choices as the sibling project BoneInfo
(C:\\AI\\BoneInfo), so both datasets can later be queried together.

Input:  CSV exports of the RADAR Access tables (see export_tables.ps1).
Output: a TriG file (one named graph), an NDJSON bulk file for
        Elasticsearch (one document per site) and a data-quality report.

Vocabularies reused:
  - CEO        site = ceo:Vondstlocatie + ceo:ArcheologischComplex, feature =
               ceo:Grondsporen, plant record = ceo:Vondsten, datering/geometry.
  - GeoSPARQL  point geometry, RD (EPSG:28992) -> WGS84.
  - Darwin Core taxa (dwc:Taxon), samples (dwc:MaterialSample), plant records
               (dwc:Occurrence).
  - schema.org literature (CEO has no bibliographic model).
  - SKOS       local code lists (period, site type, preservation mode, ...).
  - TOOI       province (identifier.overheid.nl/tooi).
Only a small set of rad: properties is minted where nothing suitable exists.

Data-quality rule (see output/radar_conflicts.csv): PLANTS.Sample nr is the
relational key. For ~13% of the plant rows the redundant PLANTS.BIAX_ID points
to a different sample than Sample nr does. Those rows are NOT written to RDF;
they are listed in the conflicts report for the data owner to resolve.

Usage:
    python radar_to_rdf.py             # full dataset
    python radar_to_rdf.py --pilot 30  # pilot: 30 well-filled, clean sites
"""
import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote

from pyproj import Transformer
from rdflib import Dataset, Namespace, URIRef, Literal
from rdflib.namespace import RDF, RDFS, XSD, SKOS

REPO_ROOT = Path(__file__).resolve().parent.parent
IN_DIR = REPO_ROOT / "data" / "csv"
OUT_DIR = REPO_ROOT / "output"
OUT_DIR.mkdir(parents=True, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument("--pilot", type=int, default=None,
                help="process only N sites (clean, with wnr, coordinates, report and plants)")
args = ap.parse_args()
PILOT_SIZE = args.pilot

RAD = Namespace("https://linkeddata.cultureelerfgoed.nl/archeobotanie/id/radar/")
GRAPH = URIRef("https://linkeddata.cultureelerfgoed.nl/archeobotanie/graph/radar")
CEO = Namespace("https://linkeddata.cultureelerfgoed.nl/def/ceo#")
GEO = Namespace("http://www.opengis.net/ont/geosparql#")
DWC = Namespace("http://rs.tdwg.org/dwc/terms/")
SCHEMA = Namespace("https://schema.org/")
TOOI_PV = "https://identifier.overheid.nl/tooi/id/provincie/"

# RADAR 'Prov' two-letter code -> TOOI provincie (same ids as BoneInfo crosswalk)
PROVINCIE = {
    "DR": ("pv22", "Drenthe"), "FL": ("pv24", "Flevoland"), "FR": ("pv21", "Fryslân"),
    "GL": ("pv25", "Gelderland"), "GR": ("pv20", "Groningen"), "LI": ("pv31", "Limburg"),
    "NB": ("pv30", "Noord-Brabant"), "NH": ("pv27", "Noord-Holland"), "OV": ("pv23", "Overijssel"),
    "UT": ("pv26", "Utrecht"), "ZL": ("pv29", "Zeeland"), "ZH": ("pv28", "Zuid-Holland"),
}

# Id_level -> Darwin Core taxonRank (cf* codes keep the rank and add a qualifier)
RANK = {
    "sp": "species", "gen": "genus", "fam": "family", "subsp": "subspecies",
    "var": "variety", "subge": "subgenus",
}

# Periods: RADAR's "Cultural period" uses the Archis abbreviations (RADAR handbook, 1997).
# Current ABR codes (MELB, NTV, ...) resolve directly in data/abr_periodes.json (made by
# scripts/haal_abr_periodes.py). The older Archis codes below no longer exist in the ABR;
# they are mapped to the renamed ABR code. The mapping rests on the names ("Late
# Middeleeuwen A/B", "Nieuwe Tijd A/B/C") and was checked against the median begin/end
# years of the RADAR sites per code; it still has to be confirmed by BIAX/RCE.
ABR_PERIODES = json.loads((REPO_ROOT / "data" / "abr_periodes.json").read_text(encoding="utf-8"))
RN2 = "https://data.cultureelerfgoed.nl/term/id/rn/2/"
OUDE_PERIODECODES = {
    "LMEA": "MELA", "LMEB": "MELB", "LME": "MEL",
    "VMEA": "MEVA", "VMEB": "MEVB", "VMEC": "MEVC", "VMED": "MEVD", "VME": "MEV",
    "XME": "ME", "NTA": "NTV", "NTB": "NTM", "NTC": "NTL",
}
# Typos and variants in the source, mapped by hand: the ABR label was filled in by the data owner
# (3 November 2026, in output/radar_periodecodes.csv) and matched to the ABR concept with that label.
# Five codes whose label has no ABR concept stay unmapped: PREROM ("pre romeins"), LMED, LMEC,
# ROMBB ("romeinse tijd B", ambiguous) and MERV ("Merovingische tijd").
HANDMATIGE_PERIODECODES = {
    "MELV": "MEV", "IJT": "IJZ", "IJTL": "IJZL", "IJTM": "IJZM", "IJZ?": "IJZ",
    "ROMVROMVB": "ROMV", "MBT": "BRONSM", "LBT": "BRONSL", "VIJT": "IJZV", "VIJZ": "IJZV",
    "VEMC": "MEVC", "MRLB": "MELB", "VMAC": "MEVA", "VEMB": "MEVB",
}
# one source value that stands for two periods
SAMENGESTELDE_CODES = {"IJZML": ["IJZM", "IJZL"], "VMECD": ["VMEC", "VMED"]}

# RADAR handbook: codes in the Remarks column of PLANTS (how the quantification must be read)
OPMERKINGSCODES = {
    "esq": "geschat aantal", "esp": "geschat percentage", "fr%": "relatieve frequentie",
    "frq": "frequentie", "per": "kwantificering met percentage", "wei": "kwantificering door gewicht",
    "pre": "slechts aanwezigheid gemeld", "lar": "groot aantal", "sum": "aantallen van meerdere monsters opgeteld",
    "qu?": "manier van kwantificeren onduidelijk", "cor": "correctie van gepubliceerde identificatie",
    "eye": "handvondst", "id!": "meer gegevens over de determinatie in de publicatie",
    "id?": "determinatie twijfelachtig volgens RADAR-beheerder", "idp": "verouderde nomenclatuur in publicatie",
    "imp": "indruk van ander deel dan zaad", "pm?": "conserveringswijze onzeker",
    "pp!": "meer gegevens over plantdeel in publicatie", "pp?": "plantdeel onbekend of onzeker",
    "txt": "niet in tabel weergegeven, wel in de tekst van de publicatie",
}
# RADAR handbook: flags in SITES.Remarks
SITE_VLAGGEN = {"ar?", "bel", "c14", "coo", "dor"}

rd_to_wgs84 = Transformer.from_crs("EPSG:28992", "EPSG:4326", always_xy=True)


def parse_periodecodes(raw):
    """'LMEA/B' -> [('LMEA','MELA','oud'), ('LMEB','MELB','oud')]; unknown codes get abr=None.

    how is 'abr' (code exists in the ABR), 'oud' (old Archis code mapped to the ABR) or None."""
    raw = (raw or "").strip()
    raw = re.sub(r"\(.*?\)", "", raw)
    parts = [p.strip().upper() for p in re.split(r"[-/_\s]+", raw) if p.strip() and p.strip() != "?"]
    codes = []
    for i, p in enumerate(parts):
        if len(p) == 1 and codes:  # 'IJZM/L' or 'LMEA/B': suffix letter on the previous code
            p = codes[-1][:-1] + p
        if p in SAMENGESTELDE_CODES:
            codes.extend(SAMENGESTELDE_CODES[p])
        else:
            codes.append(p)
    out = []
    for c in codes:
        if c in ABR_PERIODES:
            out.append((c, c, "abr"))
        elif c in OUDE_PERIODECODES and OUDE_PERIODECODES[c] in ABR_PERIODES:
            out.append((c, OUDE_PERIODECODES[c], "oud"))
        elif c in HANDMATIGE_PERIODECODES and HANDMATIGE_PERIODECODES[c] in ABR_PERIODES:
            out.append((c, HANDMATIGE_PERIODECODES[c], "hand"))
        else:
            out.append((c, None, None))
    return out


def read_csv(name):
    with open(IN_DIR / f"{name}.csv", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def nz(v):
    if v is None:
        return None
    v = v.strip()
    return v if v else None


def as_int(v):
    v = nz(v)
    if v is None:
        return None
    try:
        return int(float(v.replace(",", ".")))
    except ValueError:
        return None


def clean_url(v):
    """Access hyperlink fields look like '#http://...#'; 'xxx' is a placeholder."""
    v = nz(v)
    if not v:
        return None
    v = v.strip("#").strip()
    if not v.startswith(("http://", "https://")):
        return None
    # some source URLs contain spaces or other characters that are invalid in an IRI
    return quote(v, safe=":/?#[]@!$&'()*+,;=%-._~")


def slug(s):
    return quote(s.strip(), safe="")


def main():
    sites = read_csv("SITES")
    features = read_csv("FEATURES")
    samples = read_csv("SAMPLES")
    plants = read_csv("PLANTS")
    reports = {r["Publicatienummer"]: r for r in read_csv("REPORTS")}
    taxa = {t["Name"]: t for t in read_csv("Taxa")}
    taxa_ci = {n.lower(): t for n, t in taxa.items()}
    thesaurus = {t["Nummer_code"]: t for t in read_csv("Taxa_thesaurus")}
    synonyms = defaultdict(list)
    for s in read_csv("Synonyms"):
        synonyms[s["Naam in RADAR"]].append(s["Synoniem"])
    site_types = {r["Site type code"]: r["Description"] for r in read_csv("Site_type")}
    pres_modes = {r["Pres mode"]: r["Description"] for r in read_csv("Pres_mode")}
    id_levels = {r["Id_level"]: r["Description"] for r in read_csv("Id_level")}
    sample_types = {r["Sample type"]: r["Description"] for r in read_csv("Sample_type")}
    parts = {r["Part preserved"]: r["Description"] for r in read_csv("Parts")}
    regios = {r["Regio_ID"]: r["ARCHREGIO"] for r in read_csv("Archeoregio")}

    feature_by_nr = {f["Feature nr"]: f for f in features}
    sample_by_nr = {s["Sample nr"]: s for s in samples}
    site_by_nr = {s["Site nr"]: s for s in sites}
    samples_by_feature = defaultdict(list)
    for s in samples:
        samples_by_feature[s["Feature nr"]].append(s)
    features_by_site = defaultdict(list)
    for f in features:
        features_by_site[f["Site nr"]].append(f)

    # ---- data-quality: PLANTS.BIAX_ID versus the sample that Sample nr points to ----
    conflict_samples = set()
    plants_by_sample = defaultdict(list)
    conflict_rows = []
    code_to_samples = defaultdict(list)
    for s in samples:
        code_to_samples[s["Sample code"]].append(s["Sample nr"])
        code_to_samples[s["BIAX_ID"]].append(s["Sample nr"])
    for p in plants:
        sm = sample_by_nr.get(p["Sample nr"])
        if sm is None:
            conflict_rows.append((p, "geen monster met dit Sample nr", ""))
            conflict_samples.add(p["Sample nr"])
            continue
        bid = nz(p["BIAX_ID"])
        if bid and bid not in (sm["Sample code"], sm["BIAX_ID"]):
            cands = sorted(set(code_to_samples.get(bid, [])))
            cand = cands[0] if len(cands) == 1 else ""
            conflict_rows.append((p, f"BIAX_ID {bid} wijst naar een ander monster dan Sample nr "
                                     f"({sm['Sample code']})", cand))
            conflict_samples.add(p["Sample nr"])
    for p in plants:
        if p["Sample nr"] not in conflict_samples:
            plants_by_sample[p["Sample nr"]].append(p)

    conflicts_path = OUT_DIR / "radar_conflicts.csv"
    with open(conflicts_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Sample nr", "BIAX_ID in PLANTS", "plant", "reden", "enige kandidaat-Sample nr via BIAX_ID"])
        for p, reason, cand in conflict_rows:
            w.writerow([p["Sample nr"], p["BIAX_ID"], p["Name"], reason, cand])

    # ---- which sites does this run cover? ----
    def site_samples(site):
        for f in features_by_site.get(site["Site nr"], []):
            for s in samples_by_feature.get(f["Feature nr"], []):
                yield f, s

    def site_has_clean_plants(site):
        return any(plants_by_sample.get(s["Sample nr"]) for _, s in site_samples(site))

    if PILOT_SIZE is None:
        run_sites = sites
    else:
        eligible = [
            s for s in sites
            if nz(s["Archis wnr"]) and as_int(s["X-coordinate"]) and nz(s["Prov"])
            and s["Report nr"] in reports and site_has_clean_plants(s)
            and nz(s["Cultural period"])
        ]
        step = max(1, len(eligible) // PILOT_SIZE)
        run_sites = eligible[::step][:PILOT_SIZE]
    run_site_nrs = {s["Site nr"] for s in run_sites}

    ds = Dataset()
    for prefix, ns in [("rad", RAD), ("ceo", CEO), ("geo", GEO), ("dwc", DWC),
                       ("schema", SCHEMA), ("skos", SKOS)]:
        ds.bind(prefix, ns)
    g = ds.graph(GRAPH)

    def scheme(name, label):
        uri = RAD[f"schema/{name}"]
        g.add((uri, RDF.type, SKOS.ConceptScheme))
        g.add((uri, SKOS.prefLabel, Literal(label, lang="nl")))
        return uri

    schemes = {
        "opmerkingscode": scheme("opmerkingscode", "RADAR opmerkingscodes bij plantenregels (handleiding 1997)"),
        "complextype": scheme("complextype", "RADAR complextypen (Site_type)"),
        "bewaringswijze": scheme("bewaringswijze", "RADAR bewaringswijzen (Pres_mode)"),
        "determinatieniveau": scheme("determinatieniveau", "RADAR determinatieniveaus (Id_level)"),
        "plantdeel": scheme("plantdeel", "RADAR plantdelen (Parts)"),
        "monstertype": scheme("monstertype", "RADAR monstertypen (Sample_type)"),
        "archeoregio": scheme("archeoregio", "Archeoregio's"),
    }
    seen_concepts = set()

    def concept(kind, code, label=None, lang="en"):
        uri = RAD[f"{kind}/{slug(code)}"]
        if (kind, code) not in seen_concepts:
            seen_concepts.add((kind, code))
            g.add((uri, RDF.type, SKOS.Concept))
            g.add((uri, SKOS.inScheme, schemes[kind]))
            g.add((uri, SKOS.notation, Literal(code)))
            g.add((uri, SKOS.prefLabel, Literal(label or code, lang=lang if label else "und")))
        return uri

    periode_gebruik = Counter()  # original code -> number of uses, for output/radar_periodecodes.csv
    used_abr = set()             # ABR period codes that ceo:heeftPeriode points to (labels cached below)
    used_provincies = set()

    def periode_node(node, code):
        """ceo:heeftPeriode -> ABR concept (as rn/2 URI, like the CHO data); the original RADAR
        code stays on the node. Unknown codes keep only the literal."""
        orig, abr, how = code
        periode_gebruik[orig] += 1
        g.add((node, RAD.periodecode, Literal(orig)))
        if abr:
            used_abr.add(abr)
            g.add((node, CEO.heeftPeriode, URIRef(RN2 + ABR_PERIODES[abr]["uuid"])))
            if how in ("oud", "hand"):
                g.add((node, RAD.periodecodeGemapt, Literal(True, datatype=XSD.boolean)))

    def add_datering(subj, key, raw_codes, begin_year, end_year):
        codes = parse_periodecodes(raw_codes)
        begin_code = codes[0] if codes else None
        end_code = codes[-1] if codes else None
        if begin_year is None and end_year is None and not codes:
            return
        d = RAD[f"datering/{key}"]
        g.add((subj, CEO.heeftDatering, d))
        g.add((d, RDF.type, CEO.Datering))
        if begin_code or begin_year is not None:
            b = RAD[f"begindatering/{key}"]
            g.add((d, CEO.heeftBeginDatering, b))
            g.add((b, RDF.type, CEO.BeginDatering))
            if begin_code:
                periode_node(b, begin_code)
            if begin_year is not None:
                g.add((b, RAD.jaar, Literal(begin_year, datatype=XSD.integer)))
        if end_code or end_year is not None:
            e = RAD[f"einddatering/{key}"]
            g.add((d, CEO.heeftEindDatering, e))
            g.add((e, RDF.type, CEO.EindDatering))
            if end_code:
                periode_node(e, end_code)
            if end_year is not None:
                g.add((e, RAD.jaar, Literal(end_year, datatype=XSD.integer)))

    used_taxa = set()
    used_reports = set()
    es_docs = []
    n_features = n_samples = n_plants = 0

    for site in run_sites:
        snr = site["Site nr"]
        site_uri = RAD[f"site/{snr}"]
        g.add((site_uri, RDF.type, CEO.Vondstlocatie))
        g.add((site_uri, RDF.type, CEO.ArcheologischComplex))
        g.add((site_uri, RAD.siteNr, Literal(as_int(snr), datatype=XSD.integer)))
        if nz(site["BIAX_ID"]):
            g.add((site_uri, RAD.biaxId, Literal(site["BIAX_ID"])))
        if nz(site["Archis wnr"]):
            g.add((site_uri, CEO.archis2Waarnemingsnummer, Literal(site["Archis wnr"])))
        if nz(site["Archis zaaknr"]):
            # 10-digit zaaknummer; NOT the same as ceo:archis2Vondstmeldingsnummer (6 digits)
            g.add((site_uri, RAD.archisZaaknummer, Literal(site["Archis zaaknr"])))

        toponym = nz(site["Toponiem"]) or nz(site["Plaats"])
        if toponym:
            loc = RAD[f"locatie/{snr}"]
            g.add((site_uri, CEO.heeftLocatieAanduiding, loc))
            g.add((loc, RDF.type, CEO.LocatieAanduiding))
            g.add((loc, CEO.locatienaam, Literal(toponym)))
        ctype = nz(site["Complextype"])
        ctype_label = site_types.get(ctype) if ctype else None
        label_bits = [b for b in [ctype_label or ctype, toponym] if b]
        if label_bits:
            g.add((site_uri, RDFS.label, Literal(", ".join(label_bits), lang="nl")))
        if nz(site["Plaats"]):
            g.add((site_uri, SCHEMA.addressLocality, Literal(site["Plaats"])))
        if ctype:
            g.add((site_uri, RAD.complextype, Literal(ctype)))
            if ctype_label:
                g.add((site_uri, RAD.heeftComplextype, concept("complextype", ctype, ctype_label, "nl")))
        prov = nz(site["Prov"])
        if prov:
            g.add((site_uri, RAD.provincie, Literal(prov)))
            if prov in PROVINCIE:
                used_provincies.add(prov)
                g.add((site_uri, RAD.heeftProvincie, URIRef(TOOI_PV + PROVINCIE[prov][0])))
        regio = nz(site["Regio_ID"])
        if regio and regio in regios:
            g.add((site_uri, RAD.heeftArcheoregio, concept("archeoregio", regio, regios[regio], "nl")))
        # SITES.Remarks: flags from the RADAR handbook (ar? coo C14 dor BEL) plus free text
        site_remarks = nz(site["Remarks"])
        vlaggen = {t.lower() for t in re.split(r"[\s,;]+", site_remarks or "")} & SITE_VLAGGEN
        if "ar?" in vlaggen:
            # Archis waarnemingsnummer uncertain: do not use it for linking
            g.add((site_uri, RAD.waarnemingsnummerOnzeker, Literal(True, datatype=XSD.boolean)))
        if "coo" in vlaggen:
            # coordinates taken from the topographic atlas, precision 1 km
            g.add((site_uri, RAD.coordinaatNauwkeurigheid, Literal("1 km")))
        if "c14" in vlaggen:
            g.add((site_uri, RAD.dateringBron, Literal("C14")))
        if "dor" in vlaggen:
            g.add((site_uri, RAD.dateringBron, Literal("andere referentie")))
        if "bel" in vlaggen:
            g.add((site_uri, RAD.belgischRapport, Literal(True, datatype=XSD.boolean)))
        if site_remarks:
            g.add((site_uri, SCHEMA.description, Literal(site_remarks, lang="nl")))

        x, y = as_int(site["X-coordinate"]), as_int(site["Y-coordinate"])
        geo_point = None
        if x and y:
            lon, lat = rd_to_wgs84.transform(x, y)
            geo_point = {"lat": lat, "lon": lon}
            geom = RAD[f"geometry/{snr}"]
            g.add((site_uri, CEO.heeftGeometrie, geom))
            g.add((geom, RDF.type, GEO.Geometry))
            g.add((geom, GEO.asWKT, Literal(f"POINT ({lon:.6f} {lat:.6f})", datatype=GEO.wktLiteral)))

        add_datering(site_uri, f"site{snr}", nz(site["Cultural period"]),
                     as_int(site["Begin date"]), as_int(site["End date"]))

        # literature
        rep = reports.get(site["Report nr"])
        if rep:
            used_reports.add(site["Report nr"])
            g.add((RAD[f"publicatie/{rep['Publicatienummer']}"], SCHEMA.about, site_uri))

        # features -> samples -> plant records
        site_taxa = Counter()
        site_pres = set()
        site_parts = set()
        n_site_plants = 0
        site_sample_count = 0
        for f in features_by_site.get(snr, []):
            fnr = f["Feature nr"]
            # samples whose plant rows have a key conflict are left out entirely, so a
            # sample never appears in the RDF as if it had no plants
            clean_samples = [s for s in samples_by_feature.get(fnr, [])
                             if s["Sample nr"] not in conflict_samples]
            f_uri = RAD[f"spoor/{fnr}"]
            g.add((f_uri, RDF.type, CEO.Grondsporen))
            g.add((f_uri, CEO.ligtInObject, site_uri))
            g.add((site_uri, CEO.bevatObject, f_uri))
            n_features += 1
            if nz(f["Feature code"]):
                g.add((f_uri, RAD.spoorcode, Literal(f["Feature code"])))
            if nz(f["Feature type"]):
                g.add((f_uri, RAD.soortSpoor, Literal(f["Feature type"], lang="nl")))
                g.add((f_uri, RDFS.label, Literal(f["Feature type"], lang="nl")))
            if nz(f["Local phase"]):
                g.add((f_uri, RAD.lokaleFase, Literal(f["Local phase"])))
            if nz(f["Remarks"]):
                g.add((f_uri, RDFS.comment, Literal(f["Remarks"], lang="nl")))
            add_datering(f_uri, f"spoor{fnr}", nz(f["Cultural period"]),
                         as_int(f["Begin date"]), as_int(f["End date"]))

            for s in clean_samples:
                sn = s["Sample nr"]
                s_uri = RAD[f"monster/{sn}"]
                g.add((s_uri, RDF.type, DWC.MaterialSample))
                g.add((s_uri, CEO.ligtInObject, f_uri))
                g.add((f_uri, CEO.bevatObject, s_uri))
                n_samples += 1
                site_sample_count += 1
                if nz(s["Sample code"]):
                    g.add((s_uri, RAD.monstercode, Literal(s["Sample code"])))
                if nz(s["BIAX_ID"]):
                    g.add((s_uri, RAD.biaxId, Literal(s["BIAX_ID"])))
                stype = nz(s["Sample type"])
                if stype and stype in sample_types:
                    g.add((s_uri, RAD.heeftMonstertype, concept("monstertype", stype, sample_types[stype], "nl")))
                elif stype:
                    g.add((s_uri, RAD.monstertype, Literal(stype)))
                if nz(s["Sample volume"]):
                    g.add((s_uri, RAD.monstervolume, Literal(s["Sample volume"])))
                if nz(s["Remarks"]):
                    g.add((s_uri, RDFS.comment, Literal(s["Remarks"], lang="nl")))

                for i, p in enumerate(plants_by_sample.get(sn, []), start=1):
                    occ = RAD[f"waarneming/{sn}_{i}"]
                    name = p["Name"].strip()
                    used_taxa.add(name)
                    n_plants += 1
                    n_site_plants += 1
                    site_taxa[name] += 1
                    g.add((occ, RDF.type, DWC.Occurrence))
                    g.add((occ, RDF.type, CEO.Vondsten))
                    g.add((occ, CEO.ligtInObject, s_uri))
                    g.add((s_uri, CEO.bevatObject, occ))
                    g.add((occ, RAD.heeftTaxon, RAD[f"taxon/{slug(name)}"]))
                    lvl = (nz(p["Id_level"]) or "").lower() or None  # the source has 'Cfspc', 'sp ' etc.
                    if lvl:
                        if lvl in id_levels:
                            g.add((occ, RAD.heeftDeterminatieniveau,
                                   concept("determinatieniveau", lvl, id_levels[lvl])))
                        base = lvl[2:] if lvl.startswith("cf") else lvl
                        if lvl.startswith("cf"):
                            g.add((occ, DWC.identificationQualifier, Literal("cf.")))
                        if base in RANK:
                            g.add((occ, DWC.taxonRank, Literal(RANK[base])))
                    part = (nz(p["Part preserved"]) or "").lower() or None  # the code lists are lower case
                    if part:
                        site_parts.add(part)
                        if part in parts:
                            g.add((occ, RAD.heeftPlantdeel, concept("plantdeel", part, parts[part])))
                        else:
                            g.add((occ, RAD.plantdeel, Literal(part)))
                    pm = nz(p["Pres mode"])
                    if pm:
                        site_pres.add(pm)
                        if pm in pres_modes:
                            g.add((occ, RAD.heeftBewaringswijze, concept("bewaringswijze", pm, pres_modes[pm])))
                    q = as_int(p["Quantification"])
                    if q is not None:
                        # a class value, not a count (e.g. 1, 2, 30, 75): meaning to be confirmed with BIAX
                        g.add((occ, RAD.kwantificatie, Literal(q, datatype=XSD.integer)))
                    if as_int(p["Min_numb"]) is not None:
                        g.add((occ, RAD.minAantal, Literal(as_int(p["Min_numb"]), datatype=XSD.integer)))
                    if as_int(p["Max_numb"]) is not None:
                        g.add((occ, RAD.maxAantal, Literal(as_int(p["Max_numb"]), datatype=XSD.integer)))
                    # Remarks holds codes that say how the Quantification value must be read
                    # (esq = estimated count, per = percentage, wei = weight, pre = presence only, ...)
                    for tok in re.split(r"[\s,;]+", p["Remarks"] or ""):
                        if not tok:
                            continue
                        if tok.lower() in OPMERKINGSCODES:
                            g.add((occ, RAD.heeftOpmerkingscode,
                                   concept("opmerkingscode", tok.lower(), OPMERKINGSCODES[tok.lower()], "nl")))
                        else:
                            g.add((occ, RAD.opmerkingscode, Literal(tok)))

        # ---- Elasticsearch document, one per site ----
        by_plant = {n: c for n, c in site_taxa.items()}
        es_docs.append({
            "uri": str(site_uri), "siteNr": as_int(snr), "biaxId": nz(site["BIAX_ID"]),
            "waarnemingsnr": nz(site["Archis wnr"]), "zaaknr": nz(site["Archis zaaknr"]),
            "toponiem": nz(site["Toponiem"]), "plaats": nz(site["Plaats"]),
            "provincie": prov, "complextype": ctype, "complextype_label": ctype_label,
            "archeoregio": regios.get(regio) if regio else None,
            "periode": nz(site["Cultural period"]),
            "periode_abr": [ABR_PERIODES[a]["label"] for _, a, _ in parse_periodecodes(site["Cultural period"]) if a],
            "beginjaar": as_int(site["Begin date"]), "eindjaar": as_int(site["End date"]),
            "location": geo_point,
            "aantal_sporen": len(features_by_site.get(snr, [])), "aantal_monsters": site_sample_count,
            "aantal_plantwaarnemingen": n_site_plants,
            "taxa": [{"naam": n, "nl": nz((taxa.get(n) or {}).get("Nederlands")), "waarnemingen": c}
                     for n, c in sorted(by_plant.items())],
            "bewaringswijze": sorted(pres_modes[m] for m in site_pres if m in pres_modes),
            "plantdelen": sorted(parts[m] for m in site_parts if m in parts),
            "rapport": ({
                "titel": rep["Artikel_titel"], "jaar": as_int(rep["Jaar"]),
                "auteurs": [rep[f"Author {i}"] for i in range(1, 6) if nz(rep[f"Author {i}"])],
            } if rep else None),
        })

    # ---- reports ----
    periodicals = {}
    for rn in used_reports:
        r = reports[rn]
        uri = RAD[f"publicatie/{rn}"]
        title = nz(r["Artikel_titel"]) or nz(r["Boektitel"])
        g.add((uri, RDF.type, SCHEMA.ScholarlyArticle if nz(r["Artikel_titel"]) else SCHEMA.CreativeWork))
        if title:
            g.add((uri, SCHEMA.name, Literal(title)))
        for i in range(1, 6):
            if nz(r[f"Author {i}"]):
                g.add((uri, SCHEMA.author, Literal(r[f"Author {i}"])))
        if nz(r["Overige auteurs"]):
            g.add((uri, SCHEMA.author, Literal(r["Overige auteurs"])))
        jaar = as_int(r["Jaar"])
        if jaar and jaar >= 1000:
            g.add((uri, SCHEMA.datePublished, Literal(str(jaar), datatype=XSD.gYear)))
        if nz(r["Periodiek"]):
            pk = RAD[f"periodiek/{slug(r['Periodiek'])}"]
            periodicals[pk] = r["Periodiek"]
            g.add((uri, SCHEMA.isPartOf, pk))
        if nz(r["Deel"]):
            g.add((uri, RAD.deel, Literal(r["Deel"])))
        if nz(r["Paginanummers"]):
            g.add((uri, SCHEMA.pagination, Literal(r["Paginanummers"])))
        if nz(r["Uitgever"]):
            g.add((uri, SCHEMA.publisher, Literal(r["Uitgever"])))
        if nz(r["Plaats van uitgave"]):
            g.add((uri, SCHEMA.locationCreated, Literal(r["Plaats van uitgave"])))
        if nz(r["Onderzoeksinstantie"]):
            g.add((uri, RAD.onderzoeksinstantie, Literal(r["Onderzoeksinstantie"])))
        url = clean_url(r["URL of DOI"])
        if url:
            g.add((uri, SCHEMA.url, URIRef(url)))
    for pk, name in periodicals.items():
        g.add((pk, RDF.type, SCHEMA.Periodical))
        g.add((pk, SCHEMA.name, Literal(name)))

    # ---- taxa ----
    unmatched_taxa = []
    for name in sorted(used_taxa):
        uri = RAD[f"taxon/{slug(name)}"]
        g.add((uri, RDF.type, DWC.Taxon))
        g.add((uri, DWC.scientificName, Literal(name)))
        # Access joins ignore case; the plant names sometimes differ in case from Taxa.Name
        t = taxa.get(name) or taxa_ci.get(name.lower())
        if t is None:
            unmatched_taxa.append(name)
            continue
        if nz(t["Nederlands"]):
            g.add((uri, DWC.vernacularName, Literal(t["Nederlands"], lang="nl")))
        if nz(t["Engels"]):
            g.add((uri, DWC.vernacularName, Literal(t["Engels"], lang="en")))
        if nz(t["Duits"]):
            g.add((uri, DWC.vernacularName, Literal(t["Duits"], lang="de")))
        if nz(t["Gebruiksplant"]):
            g.add((uri, RAD.gebruiksplant, Literal(t["Gebruiksplant"])))
        code = nz(t["Nummer_code"])
        if code:
            g.add((uri, RAD.nummercode, Literal(code)))
            th = thesaurus.get(code)
            if th:
                for prop, field in [(DWC.kingdom, "REGNUM"), (DWC.phylum, "PHYLUM"), (DWC["class"], "KLASSE"),
                                    (DWC.order, "ORDE"), (DWC.family, "FAMILIE")]:
                    if nz(th[field]):
                        g.add((uri, prop, Literal(th[field])))
                # 'sierplant|fruit': one triple per category, so a facet can count each of them
                for cat in (nz(th["Categorie gebruiksplant"]) or "").split("|"):
                    if cat.strip():
                        g.add((uri, RAD.gebruiksplantCategorie, Literal(cat.strip())))
        for syn in synonyms.get(name, []):
            g.add((uri, SKOS.altLabel, Literal(syn)))

    # Labels of the external concepts, cached locally (same pattern as BoneInfo does for the CHT
    # verwerving concepts): the Elastic projection (construct/radar.rq) cannot read the external
    # ABR and TOOI graphs, and without a label it could only show a URI.
    for abr in sorted(used_abr):
        g.add((URIRef(RN2 + ABR_PERIODES[abr]["uuid"]), SKOS.prefLabel, Literal(ABR_PERIODES[abr]["label"], lang="nl")))
    for prov in sorted(used_provincies):
        g.add((URIRef(TOOI_PV + PROVINCIE[prov][0]), SKOS.prefLabel, Literal(PROVINCIE[prov][1], lang="nl")))

    # overview of the period codes used in this run and what they resolved to
    codes_path = OUT_DIR / "radar_periodecodes.csv"
    code_rows = [["RADAR-code", "aantal", "ABR-code", "ABR-label", "ABR-concept (rn/2)", "herkomst"]]
    for orig, n in sorted(periode_gebruik.items(), key=lambda kv: -kv[1]):
        _, abr, how = parse_periodecodes(orig)[0] if parse_periodecodes(orig) else (orig, None, None)
        code_rows.append([orig, n, abr or "", ABR_PERIODES[abr]["label"] if abr else "",
                          RN2 + ABR_PERIODES[abr]["uuid"] if abr else "",
                          {"abr": "code bestaat in ABR", "oud": "oude Archis-code, gemapt (te bevestigen)",
                           "hand": "handmatig gemapt (ABR-label ingevuld door de gegevenseigenaar)"}.get(how, "niet te mappen")])
    try:
        with open(codes_path, "w", encoding="utf-8-sig", newline="") as f:
            csv.writer(f).writerows(code_rows)
    except PermissionError:
        # the file is open in another program (e.g. a spreadsheet): do not fail the whole run
        codes_path = OUT_DIR / "radar_periodecodes.nieuw.csv"
        print(f"WAARSCHUWING: radar_periodecodes.csv is in gebruik, geschreven naar {codes_path.name}")
        with open(codes_path, "w", encoding="utf-8-sig", newline="") as f:
            csv.writer(f).writerows(code_rows)
    onbekend = sorted(c for c in periode_gebruik if not any(a for _, a, _ in parse_periodecodes(c)))

    suffix = "full" if PILOT_SIZE is None else "pilot"
    trig_path = OUT_DIR / f"radar_{suffix}.trig"
    ds.serialize(destination=str(trig_path), format="trig")
    ndjson_path = OUT_DIR / f"radar_{suffix}_es.ndjson"
    with open(ndjson_path, "w", encoding="utf-8") as f:
        for doc in es_docs:
            f.write(json.dumps({"index": {"_index": "radar", "_id": doc["uri"]}}) + "\n")
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")

    print(f"Sites: {len(run_sites)}  features: {n_features}  samples: {n_samples}  plant records: {n_plants}")
    print(f"Taxa used: {len(used_taxa)} (not in Taxa table: {len(unmatched_taxa)})")
    print(f"Reports used: {len(used_reports)}")
    print(f"Period codes used: {len(periode_gebruik)}, not mappable to the ABR: {onbekend} -> {codes_path}")
    print(f"Plant rows skipped because of key conflict: {len(conflict_rows)} "
          f"({len(conflict_samples)} sample nrs) -> {conflicts_path}")
    print(f"Triples: {len(g)}")
    print(f"TriG:   {trig_path}")
    print(f"NDJSON: {ndjson_path}")


if __name__ == "__main__":
    main()

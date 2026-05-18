"""
Build disease_knowledge.json from local copies of Orphanet en_product4.xml and
HPO hp.obo. The resulting JSON is consumed by clario_extractor_service.py to
resolve canonical entity names to HPO IDs.

Inputs (download manually before running):
  - HPO            http://purl.obolibrary.org/obo/hp.obo
  - Orphanet       https://www.orphadata.com/data/xml/en_product4.xml

Output:
  - disease_knowledge.json (~75 MB)

Usage:
    pip install -e .[extractor]
    python -m scripts.build_knowledge \\
        --hpo-obo path/to/hp.obo \\
        --orphanet-xml path/to/en_product4.xml \\
        --out disease_knowledge.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pronto
from lxml import etree
from tqdm import tqdm


FREQUENCY_MAP = {
    "Obligate (100%)": "obligate",
    "Very frequent (99-80%)": "very_frequent",
    "Frequent (79-30%)": "frequent",
    "Occasional (29-5%)": "occasional",
    "Very rare (<4-1%)": "very_rare",
    "Excluded (0%)": "excluded",
}


def load_hpo(path: Path) -> dict:
    """Returns {hpo_id: {canonical_name, exact_synonyms, related_synonyms, definition}}."""
    ont = pronto.Ontology(str(path))
    out: dict[str, dict] = {}
    for term in ont.terms():
        if not term.id.startswith("HP:"):
            continue
        exact = [s.description for s in term.synonyms if s.scope == "EXACT"]
        related = [s.description for s in term.synonyms if s.scope == "RELATED"]
        out[term.id] = {
            "canonical_name": term.name or "",
            "exact_synonyms": exact,
            "related_synonyms": related,
            "definition": str(term.definition) if term.definition else "",
        }
    return out


def load_orphanet(path: Path, hpo_lookup: dict) -> list[dict]:
    tree = etree.parse(str(path))
    root = tree.getroot()
    diseases: list[dict] = []
    disorders = list(root.iter("Disorder"))
    for disorder in tqdm(disorders, desc="orphanet"):
        orpha_code_el = disorder.find("OrphaCode")
        name_el = disorder.find("Name")
        if orpha_code_el is None or name_el is None:
            continue
        orpha_id = f"ORPHA:{orpha_code_el.text}"
        phenotypes: list[dict] = []
        for assoc in disorder.iter("HPODisorderAssociation"):
            hpo_id_el = assoc.find("HPO/HPOId")
            freq_el = assoc.find("HPOFrequency/Name")
            if hpo_id_el is None:
                continue
            hpo_id = hpo_id_el.text
            info = hpo_lookup.get(hpo_id)
            if info is None:
                continue
            phenotypes.append({
                "hpo_id": hpo_id,
                "canonical_name": info["canonical_name"],
                "exact_synonyms": info["exact_synonyms"],
                "related_synonyms": info["related_synonyms"],
                "frequency_class": FREQUENCY_MAP.get(
                    freq_el.text if freq_el is not None else "", "unknown"
                ),
            })
        diseases.append({
            "orpha_id": orpha_id,
            "name": name_el.text,
            "phenotypes": phenotypes,
        })
    return diseases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hpo-obo", required=True, type=Path)
    ap.add_argument("--orphanet-xml", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    print(f"Loading HPO from {args.hpo_obo}")
    hpo_lookup = load_hpo(args.hpo_obo)
    print(f"  {len(hpo_lookup)} HPO terms")

    print(f"Loading Orphanet from {args.orphanet_xml}")
    diseases = load_orphanet(args.orphanet_xml, hpo_lookup)
    associations = sum(len(d["phenotypes"]) for d in diseases)
    print(f"  {len(diseases)} diseases, {associations} phenotype associations")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"hpo_lookup": hpo_lookup, "diseases": diseases}, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

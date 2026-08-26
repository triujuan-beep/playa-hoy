"""Actualiza el snapshot sanitario con informes oficiales de Málaga y Granada.

No se ejecuta en runtime. Requiere revisión del diff antes de publicar el JSON.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import unicodedata
import urllib.request
from datetime import datetime
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "data" / "sanitary-status.json"
MUNICIPALITIES = {
    "algarrobo": "ALGARROBO", "almunecar": "ALMUNECAR", "benalmadena": "BENALMADENA",
    "casares": "CASARES", "estepona": "ESTEPONA", "fuengirola": "FUENGIROLA",
    "malaga": "MALAGA", "manilva": "MANILVA", "marbella": "MARBELLA", "mijas": "MIJAS",
    "nerja": "NERJA", "rincon": "RINCON DE LA VICTORIA", "torremolinos": "TORREMOLINOS",
    "torrox": "TORROX", "velez": "VELEZ-MALAGA",
}
PROVINCES = {"almunecar": "GRANADA"}
ZONE_ALIASES = {
    "EL PADRON": ["DEL PADRON"], "EL SALADILLO": ["DEL SALADILLO"],
    "GUADALMINA-SAN PEDRO": ["GUADALMINA-SAN PEDRO"],
    "FONTANILLA-FARO": ["LA FONTANILLA-FARO"], "VENUS-BAJADILLA": ["VENUS-BAJADILLA"],
    "CALAHONDA 1, 2 Y 3": ["CALAHONDA 1", "CALAHONDA 2", "CALAHONDA 3"],
    "BOLICHES-GAVIOTAS": ["BOLICHES-GAVIOTAS"],
    "TORREMUELLE-CARVAJAL": ["TORREMUELLE - CARVAJAL"],
    "BIL BIL-ARROYO DE LA MIEL": ["BIL BIL - ARROYO DE LA MIEL"],
    "MALAPESQUERA-SANTA ANA": ["MALAPESQUERA - SANTA ANA"],
    "PEDREGALEJOS-ACACIAS": ["PEDREGALEJOS-ACACIAS"], "EL BAJONDILLO": ["BAJONDILLO"],
    "CHILCHES": ["CHILCHEZ"], "TORRE BENAGALBON Y LOS RUBIOS": ["TORRE BENAGALBON", "LOS RUBIOS"],
    "CENICERO-LAS LINDES": ["CENICERO-LAS LINDES"], "EL PENONCILLO": ["PENONCILLO"],
    "CALAS ORIENTALES (MARO)": ["CALAS ORIENTALES(MARO)"],
}


def normalized(value: str) -> str:
    value = value.replace("–", "-")
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", value.upper()).strip()


def read_pdf(source: str) -> tuple[bytes, str]:
    if source.startswith(("https://", "http://")):
        request = urllib.request.Request(source, headers={"User-Agent": "Playa-Hoy sanitary updater/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read(), source
    path = Path(source).resolve()
    return path.read_bytes(), path.as_uri()


def inspection_lines(pdf_bytes: bytes) -> list[str]:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        return [normalized(line) for page in pdf.pages for line in (page.extract_text() or "").splitlines()]


def province_for(beach_id: str) -> str:
    return PROVINCES.get(beach_id.split("-", 1)[0], "MALAGA")


def municipality_for(beach_id: str) -> str:
    prefix = beach_id.split("-", 1)[0]
    return MUNICIPALITIES["velez"] if prefix == "velez" else MUNICIPALITIES[prefix]


def official_zones(display_zone: str) -> list[str]:
    zone = re.sub(r"^PLAYA ", "", normalized(display_zone))
    return ZONE_ALIASES.get(zone, [zone])


def matching_lines(lines: list[str], beach_id: str, zone: str) -> list[str]:
    province, municipality = province_for(beach_id), municipality_for(beach_id)
    matches: list[str] = []
    for official_zone in official_zones(zone):
        needle = f"{province} {municipality} PLAYA {official_zone} "
        zone_matches = [line for line in lines if needle in line]
        if not zone_matches:
            raise RuntimeError(f"No se encontró {beach_id}: {province} / {municipality} / {official_zone}")
        matches.extend(zone_matches)
    return matches


def status_for(lines: list[str]) -> str:
    if any("ZONA NO APTA" in line for line in lines): return "closed"
    if all("ZONA APTA" in line for line in lines): return "safe"
    return "warning"


def latest_date(lines: list[str]) -> str:
    dates = [datetime.strptime(value, "%d/%m/%Y") for line in lines for value in re.findall(r"\b\d{2}/\d{2}/\d{4}\b", line)]
    if not dates: raise RuntimeError("El informe no contiene fechas de inspección reconocibles")
    return max(dates).date().isoformat()


def report_map(sources: list[str]) -> tuple[dict[str, list[str]], dict[str, str]]:
    lines_by_province: dict[str, list[str]] = {}
    urls_by_province: dict[str, str] = {}
    for source in sources:
        pdf_bytes, inferred_source = read_pdf(source)
        lines = inspection_lines(pdf_bytes)
        provinces = {line.split(" ", 1)[0] for line in lines if line.startswith(("MALAGA ", "GRANADA "))}
        if len(provinces) != 1: raise RuntimeError(f"No se pudo identificar una única provincia en {source}")
        province = provinces.pop()
        lines_by_province[province], urls_by_province[province] = lines, inferred_source
    return lines_by_province, urls_by_province


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", nargs="+", help="PDFs oficiales locales o URL HTTPS (Málaga y Granada)")
    parser.add_argument("--effective-until", required=True, help="Fin de vigencia revisado, YYYY-MM-DD")
    parser.add_argument("--source-url", action="append", default=[], metavar="PROVINCIA=URL", help="URL pública por provincia cuando el PDF es local")
    args = parser.parse_args()
    datetime.strptime(args.effective_until, "%Y-%m-%d")
    lines_by_province, urls_by_province = report_map(args.pdf)
    for override in args.source_url:
        if "=" not in override: raise RuntimeError("--source-url debe usar PROVINCIA=URL")
        province, url = override.split("=", 1)
        urls_by_province[normalized(province)] = url
    current = json.loads(OUTPUT.read_text(encoding="utf-8"))
    required_provinces = {province_for(beach_id) for beach_id in current}
    missing = required_provinces - lines_by_province.keys()
    if missing: raise RuntimeError(f"Faltan informes para: {', '.join(sorted(missing))}")
    updated: dict[str, dict] = {}
    for beach_id, previous in current.items():
        province, zone = province_for(beach_id), previous["sanitaryZone"]
        matches = matching_lines(lines_by_province[province], beach_id, zone)
        inspection, status = latest_date(matches), status_for(matches)
        association = previous.get("sanitaryAssociation", "individual")
        suffix = f" Zona sanitaria oficial asociada: {zone}." if association == "associated" else f" El resultado corresponde a la zona sanitaria agrupada {zone}." if association == "grouped" else ""
        updated[beach_id] = {**previous, "status": status, "message": f"Zona {'apta' if status == 'safe' else 'no apta' if status == 'closed' else 'con aviso'} para el baño. Inspección oficial del {datetime.fromisoformat(inspection).strftime('%d/%m/%Y')}.{suffix}", "updatedAt": f"{inspection}T00:00:00+02:00", "effectiveUntil": f"{args.effective_until}T23:59:59+02:00", "sourceUrl": urls_by_province[province]}
    if len(updated) != len(current): raise RuntimeError("El snapshot generado perdió asociaciones sanitarias")
    OUTPUT.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Actualizadas {len(updated)} playas con {len(required_provinces)} informes provinciales. Revisa git diff antes de publicar.")


if __name__ == "__main__":
    main()

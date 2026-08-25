"""Actualiza el snapshot sanitario local desde un informe oficial de la Junta.

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
    "algarrobo": "ALGARROBO", "benalmadena": "BENALMADENA", "casares": "CASARES",
    "estepona": "ESTEPONA", "fuengirola": "FUENGIROLA", "malaga": "MALAGA",
    "manilva": "MANILVA", "marbella": "MARBELLA", "mijas": "MIJAS", "nerja": "NERJA",
    "rincon": "RINCON DE LA VICTORIA", "torremolinos": "TORREMOLINOS", "torrox": "TORROX",
    "velez": "VELEZ-MALAGA",
}
ZONE_ALIASES = {
    "EL PADRON": ["DEL PADRON"], "EL SALADILLO": ["DEL SALADILLO"],
    "GUADALMINA-SAN PEDRO": ["GUADALMINA-SAN PEDRO"],
    "FONTANILLA-FARO": ["LA FONTANILLA-FARO"], "VENUS-BAJADILLA": ["VENUS-BAJADILLA"],
    "CALAHONDA 1, 2 Y 3": ["CALAHONDA 1", "CALAHONDA 2", "CALAHONDA 3"],
    "BOLICHES-GAVIOTAS": ["BOLICHES-GAVIOTAS"],
    "TORREMUELLE-CARVAJAL": ["TORREMUELLE - CARVAJAL"],
    "BIL BIL-ARROYO DE LA MIEL": ["BIL BIL - ARROYO DE LA MIEL"],
    "MALAPESQUERA-SANTA ANA": ["MALAPESQUERA - SANTA ANA"],
    "PEDREGALEJOS-ACACIAS": ["PEDREGALEJOS-ACACIAS"],
    "EL BAJONDILLO": ["BAJONDILLO"],
    "CHILCHES": ["CHILCHEZ"],
    "TORRE BENAGALBON Y LOS RUBIOS": ["TORRE BENAGALBON", "LOS RUBIOS"],
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


def municipality_for(beach_id: str) -> str:
    prefix = beach_id.split("-", 1)[0]
    if prefix == "velez": return MUNICIPALITIES["velez"]
    return MUNICIPALITIES[prefix]


def official_zones(display_zone: str) -> list[str]:
    zone = re.sub(r"^PLAYA ", "", normalized(display_zone))
    return ZONE_ALIASES.get(zone, [zone])


def matching_lines(lines: list[str], beach_id: str, zone: str) -> list[str]:
    municipality = municipality_for(beach_id)
    matches: list[str] = []
    for official_zone in official_zones(zone):
        needle = f"MALAGA {municipality} PLAYA {official_zone} "
        zone_matches = [line for line in lines if needle in line]
        if not zone_matches:
            raise RuntimeError(f"No se encontró {beach_id}: {municipality} / {official_zone}")
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", help="PDF oficial local o URL HTTPS")
    parser.add_argument("--effective-until", required=True, help="Fin de vigencia revisado, YYYY-MM-DD")
    parser.add_argument("--source-url", help="URL pública que se mostrará en la aplicación")
    args = parser.parse_args()
    datetime.strptime(args.effective_until, "%Y-%m-%d")
    pdf_bytes, inferred_source = read_pdf(args.pdf)
    lines = inspection_lines(pdf_bytes)
    current = json.loads(OUTPUT.read_text(encoding="utf-8"))
    updated: dict[str, dict] = {}
    for beach_id, previous in current.items():
        zone = previous["sanitaryZone"]
        matches = matching_lines(lines, beach_id, zone)
        inspection = latest_date(matches)
        status = status_for(matches)
        association = previous.get("sanitaryAssociation", "individual")
        suffix = f" Zona sanitaria oficial asociada: {zone}." if association == "associated" else f" El resultado corresponde a la zona sanitaria agrupada {zone}." if association == "grouped" else ""
        updated[beach_id] = {**previous, "status": status, "message": f"Zona {'apta' if status == 'safe' else 'no apta' if status == 'closed' else 'con aviso'} para el baño. Inspección oficial del {datetime.fromisoformat(inspection).strftime('%d/%m/%Y')}.{suffix}", "updatedAt": f"{inspection}T00:00:00+02:00", "effectiveUntil": f"{args.effective_until}T23:59:59+02:00", "sourceUrl": args.source_url or inferred_source}
    if len(updated) != 56: raise RuntimeError(f"Se esperaban 56 asociaciones y se obtuvieron {len(updated)}")
    OUTPUT.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Actualizadas {len(updated)} playas. Revisa git diff antes de publicar.")


if __name__ == "__main__":
    main()

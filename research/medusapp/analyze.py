from __future__ import annotations

import hashlib
import json
import math
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from provider import MedusAppProvider, MedusAppQuery, MedusAppRateLimitError


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[1]
RESULTS_DIR = ROOT / "results"
TIMEZONE = ZoneInfo("Europe/Madrid")
RADII = (2, 5, 10)
WINDOWS = (24, 48, 72)


def repair(value: str) -> str:
    replacements = {
        "M�laga": "Málaga", "Rinc�n": "Rincón", "Los �lamos": "Los Álamos",
    }
    result = value
    for broken, fixed in replacements.items():
        result = result.replace(broken, fixed)
    return result


def load_beaches() -> list[dict[str, Any]]:
    text = (PROJECT_ROOT / "src" / "lib" / "mock-beaches.ts").read_text(encoding="utf-8")
    pattern = re.compile(
        r'\{id:"(?P<id>[^"]+)",slug:"(?P<slug>[^"]+)",name:"(?P<name>[^"]+)",'
        r'municipality:"(?P<municipality>[^"]+)",latitude:(?P<latitude>-?[\d.]+),'
        r'longitude:(?P<longitude>-?[\d.]+),'
    )
    output = []
    for match in pattern.finditer(text):
        row = match.groupdict()
        row["name"] = repair(row["name"])
        row["municipality"] = repair(row["municipality"])
        row["latitude"] = float(row["latitude"])
        row["longitude"] = float(row["longitude"])
        output.append(row)
    if len(output) != 20:
        raise RuntimeError(f"Expected 20 Playa Hoy beaches, parsed {len(output)}")
    return output


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    value = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return earth * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def report_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.replace(tzinfo=TIMEZONE) if parsed.tzinfo is None else parsed.astimezone(TIMEZONE)
    except ValueError:
        return None


def recency_weight(age_hours: float) -> float:
    if age_hours < 0 or age_hours > 72:
        return 0.0
    if age_hours <= 12:
        return 1.0
    if age_hours <= 24:
        return 0.8
    if age_hours <= 48:
        return 0.5
    return 0.25


def distance_weight(distance_km: float) -> float:
    if distance_km <= 2:
        return 1.0
    if distance_km <= 5:
        return 0.7
    if distance_km <= 10:
        return 0.3
    return 0.0


def validation_weight(status: str) -> float:
    return 1.2 if status == "certified" else 1.0


def classify(positive: list[dict[str, Any]], negative: list[dict[str, Any]], pending: list[dict[str, Any]]) -> tuple[str, float, float]:
    positive_score = sum(
        item["recencyWeight"] * item["distanceWeight"] * item["abundanceSeverity"] * validation_weight(item["validationStatus"])
        for item in positive
    )
    negative_score = sum(
        item["recencyWeight"] * item["distanceWeight"] * validation_weight(item["validationStatus"])
        for item in negative
    )
    net = positive_score - 0.6 * negative_score
    close_fresh = any(item["ageHours"] <= 24 and item["distanceKm"] <= 5 for item in positive)
    if positive_score >= 4 and net >= 2:
        state = "STRONG_RECENT_PRESENCE"
    elif len(positive) >= 2 and positive_score >= 0.4 and net >= 0:
        state = "MULTIPLE_RECENT_SIGHTINGS"
    elif positive and (not negative or net >= 0 or close_fresh):
        state = "RECENT_SIGHTING"
    elif negative and (not positive or net < 0):
        state = "RECENT_NO_SIGHTINGS"
    elif pending and not positive and not negative:
        state = "UNKNOWN"
    elif not positive and not negative and not pending:
        state = "NO_RECENT_REPORTS"
    else:
        state = "UNKNOWN"
    return state, positive_score, negative_score


def conclusion(state: str, conflict: bool) -> str:
    messages = {
        "NO_RECENT_REPORTS": "Sin avistamientos recientes reportados; esto no demuestra ausencia de medusas.",
        "RECENT_NO_SIGHTINGS": "Existen reportes recientes sin medusas; no equivale a playa libre de medusas.",
        "RECENT_SIGHTING": "Presencia reciente reportada por usuarios.",
        "MULTIPLE_RECENT_SIGHTINGS": "Varias observaciones recientes próximas reportadas por usuarios.",
        "STRONG_RECENT_PRESENCE": "Evidencia reciente fuerte de presencia reportada por usuarios.",
        "UNKNOWN": "Información reciente insuficiente o no clasificable.",
    }
    suffix = " Hay evidencia positiva y negativa en conflicto." if conflict else ""
    return messages[state] + suffix


def enrich(report: dict[str, Any], beach: dict[str, Any], now: datetime) -> dict[str, Any] | None:
    timestamp = report_datetime(report.get("timestamp"))
    if timestamp is None:
        return None
    age = (now - timestamp).total_seconds() / 3600
    distance = haversine_km(beach["latitude"], beach["longitude"], report["latitude"], report["longitude"])
    return {
        **report,
        "ageHours": age,
        "distanceKm": distance,
        "recencyWeight": recency_weight(age),
        "distanceWeight": distance_weight(distance),
    }


def aggregate(beach: dict[str, Any], reports: list[dict[str, Any]], radius: int, window: int) -> dict[str, Any]:
    selected = [item for item in reports if 0 <= item["ageHours"] <= window and item["distanceKm"] <= radius]
    positive = [item for item in selected if item["reportType"] == "sighting"]
    negative = [item for item in selected if item["reportType"] == "no_sighting"]
    pending = [item for item in selected if item["reportType"] == "pending"]
    unknown = [item for item in selected if item["reportType"] == "unknown"]
    state, positive_score, negative_score = classify(positive, negative, pending)
    dates_positive = [report_datetime(item["timestamp"]) for item in positive]
    dates_negative = [report_datetime(item["timestamp"]) for item in negative]
    relevant = positive + negative + pending
    nearest = min((item["distanceKm"] for item in relevant), default=None)
    maximum = max((item["abundanceSeverity"] for item in positive), default=None)
    conflict = bool(positive and negative)
    return {
        "beach": beach["name"],
        "municipality": beach["municipality"],
        "radiusKm": radius,
        "windowHours": window,
        "positiveSightings": len(positive),
        "noSightings": len(negative),
        "pending": len(pending),
        "unknownOrOtherObjects": len(unknown),
        "certified": sum(item["validationStatus"] == "certified" for item in positive),
        "lastPositiveAt": max((item for item in dates_positive if item), default=None),
        "lastNoSightingAt": max((item for item in dates_negative if item), default=None),
        "nearestReportKm": nearest,
        "maximumAbundanceSeverity": maximum,
        "positiveEvidence": positive_score,
        "negativeEvidence": negative_score,
        "evidenceScore": positive_score - 0.6 * negative_score,
        "state": state,
        "conflict": conflict,
        "conclusion": conclusion(state, conflict),
    }


def anonymized_examples(all_reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    examples = []
    seen_types = set()
    for report in all_reports:
        report_type = report["reportType"]
        if report_type in seen_types:
            continue
        seen_types.add(report_type)
        examples.append({
            "anonymousId": hashlib.sha256(str(report["id"]).encode()).hexdigest()[:12],
            "latitudeApprox": round(report["latitude"], 3),
            "longitudeApprox": round(report["longitude"], 3),
            "timestamp": report["timestamp"],
            "beachName": report.get("beachName"),
            "species": report.get("species"),
            "abundanceRange": report.get("abundanceRange"),
            "sizeRange": report.get("sizeRange"),
            "validationStatus": report["validationStatus"],
            "reportType": report_type,
            "typeEvidence": report["typeEvidence"],
        })
    return examples


def json_default(value: Any) -> Any:
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.isoformat()
    raise TypeError(type(value).__name__)


def write_report(matrix: pd.DataFrame, comparison: pd.DataFrame, coverage: dict[str, Any], diagnostics: dict[str, Any], conflicts: pd.DataFrame, recommendation: str) -> None:
    standard = matrix[(matrix.radiusKm == 5) & (matrix.windowHours == 48)]
    lines = [
        "# MedusApp v1 — informe experimental",
        "",
        f"**Recomendación: {recommendation}**",
        "",
        f"Evaluación: {diagnostics['evaluatedAt']}. Consultas de red: {diagnostics['networkCalls']}; caché: {diagnostics['cacheHits']}; HTTP 429: {diagnostics['http429']}.",
        "",
        "## Cobertura (radio estándar 5 km)",
        "",
        "| ventana | playas con algún reporte relevante | con positivo | con no_sighting |",
        "|---:|---:|---:|---:|",
    ]
    for hours in WINDOWS:
        item = coverage[str(hours)]
        lines.append(f"| {hours} h | {item['beachesWithRelevantReports']}/20 | {item['beachesWithPositiveSightings']}/20 | {item['beachesWithNoSightings']}/20 |")
    lines.extend([
        "",
        "## Comparativa completa",
        "",
        "| radio | ventana | playas con positivo | con no_sighting | con pendiente | solo otros objetos | coincidencias positivas* |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for _, row in comparison.iterrows():
        lines.append(f"| {int(row.radiusKm)} km | {int(row.windowHours)} h | {int(row.beachesWithPositive)} | {int(row.beachesWithNoSighting)} | {int(row.beachesWithPending)} | {int(row.beachesWithOnlyOtherObjects)} | {int(row.positiveBeachReportMatches)} |")
    lines.extend(["", "\\* Una misma observación puede coincidir con varias playas cercanas; no representa reportes únicos."])
    lines.extend([
        "",
        "## Foto estándar: 5 km / 48 h",
        "",
        "| playa | + | sin medusas | pendientes | otros | estado |",
        "|---|---:|---:|---:|---:|---|",
    ])
    for _, row in standard.iterrows():
        lines.append(f"| {row.beach} | {row.positiveSightings} | {row.noSightings} | {row.pending} | {row.unknownOrOtherObjects} | {row.state} |")
    lines.extend([
        "",
        "## Conflictos",
        "",
        f"Se detectaron {len(conflicts)} combinaciones playa/radio/ventana con reportes positivos y negativos simultáneos.",
        "",
        "## Límites decisivos",
        "",
        "- La ausencia de reportes nunca se interpreta como ausencia de medusas.",
        "- El endpoint requiere iniciar una cookie de sesión desde el mapa oficial; no se intentó evitar esa protección.",
        "- La API no está documentada como contrato público estable y devuelve otros objetos marinos/contaminantes que deben excluirse.",
        "- No se guardaron popup HTML, usuarios, comentarios, fotos, vídeos ni nombres de fichero.",
        "- La licencia de datos es CC BY-NC-SA 4.0. Para uso comercial hay que contactar con MedusApp.",
        "",
        "Los estados son experimentales y no modifican scoring, ranking o UI.",
    ])
    (RESULTS_DIR / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    beaches = load_beaches()
    now = datetime.now(TIMEZONE)
    provider = MedusAppProvider()
    by_beach: dict[str, list[dict[str, Any]]] = {}
    source_errors = []
    for index, beach in enumerate(beaches):
        before = provider.network_calls
        try:
            response = provider.get_reports(
                MedusAppQuery(
                    beach["latitude"], beach["longitude"], 10,
                    now - timedelta(hours=72), now,
                )
            )
            enriched = [enrich(item, beach, now) for item in response["reports"]]
            by_beach[beach["id"]] = [item for item in enriched if item is not None]
        except MedusAppRateLimitError:
            raise
        except Exception as error:
            by_beach[beach["id"]] = []
            source_errors.append({"beach": beach["name"], "error": str(error)})
        if provider.network_calls > before and index < len(beaches) - 1:
            time.sleep(0.75)

    rows = []
    for beach in beaches:
        reports = by_beach[beach["id"]]
        for radius in RADII:
            for window in WINDOWS:
                rows.append(aggregate(beach, reports, radius, window))
    matrix = pd.DataFrame(rows)
    matrix.to_csv(RESULTS_DIR / "beach_radius_window_matrix.csv", index=False)
    matrix.to_json(RESULTS_DIR / "beach_radius_window_matrix.json", orient="records", force_ascii=False, indent=2, date_format="iso")
    matrix[(matrix.radiusKm == 5) & (matrix.windowHours == 48)].to_csv(RESULTS_DIR / "beaches_standard_5km_48h.csv", index=False)
    conflicts = matrix[matrix["conflict"]].copy()
    conflicts.to_csv(RESULTS_DIR / "conflict_cases.csv", index=False)
    comparison_rows = []
    for (radius, window), group in matrix.groupby(["radiusKm", "windowHours"]):
        relevant = group.positiveSightings + group.noSightings + group.pending
        comparison_rows.append({
            "radiusKm": radius,
            "windowHours": window,
            "beachesWithPositive": int((group.positiveSightings > 0).sum()),
            "beachesWithNoSighting": int((group.noSightings > 0).sum()),
            "beachesWithPending": int((group.pending > 0).sum()),
            "beachesWithOnlyOtherObjects": int(((group.unknownOrOtherObjects > 0) & (relevant == 0)).sum()),
            "positiveBeachReportMatches": int(group.positiveSightings.sum()),
        })
    comparison = pd.DataFrame(comparison_rows)
    comparison.to_csv(RESULTS_DIR / "radius_window_comparison.csv", index=False)
    comparison.to_json(RESULTS_DIR / "radius_window_comparison.json", orient="records", force_ascii=False, indent=2)

    unique_reports: dict[str, dict[str, Any]] = {}
    for reports in by_beach.values():
        for report in reports:
            unique_reports[str(report["id"])] = report
    examples = anonymized_examples(list(unique_reports.values()))
    (RESULTS_DIR / "real_anonymized_examples.json").write_text(json.dumps(examples, ensure_ascii=False, indent=2), encoding="utf-8")

    coverage: dict[str, Any] = {}
    for window in WINDOWS:
        subset = matrix[(matrix.radiusKm == 5) & (matrix.windowHours == window)]
        coverage[str(window)] = {
            "beachesWithRelevantReports": int(((subset.positiveSightings + subset.noSightings + subset.pending) > 0).sum()),
            "beachesWithPositiveSightings": int((subset.positiveSightings > 0).sum()),
            "beachesWithNoSightings": int((subset.noSightings > 0).sum()),
        }
    http429 = sum(item["status"] == 429 for item in provider.diagnostics)
    unknown_ratio = sum(item["reportType"] == "unknown" for item in unique_reports.values()) / max(1, len(unique_reports))
    coverage_72 = coverage["72"]["beachesWithRelevantReports"] / 20
    if http429 or source_errors or coverage_72 < 0.25:
        recommendation = "NO APTO"
    else:
        recommendation = "APTO CON LIMITACIONES"
    diagnostics = {
        "evaluatedAt": now.isoformat(),
        "networkCalls": provider.network_calls,
        "cacheHits": provider.cache_hits,
        "queriesRepresented": len(beaches),
        "httpStatuses": sorted(set(item["status"] for item in provider.diagnostics)),
        "http429": http429,
        "cookiesRequired": any(item["cookiesRequired"] for item in provider.diagnostics),
        "corsValues": sorted(set(str(item["cors"]) for item in provider.diagnostics)),
        "sourceErrors": source_errors,
        "uniqueNormalizedReports": len(unique_reports),
        "unknownOrOtherObjectRatio": unknown_ratio,
        "recommendation": recommendation,
    }
    (RESULTS_DIR / "coverage.json").write_text(json.dumps(coverage, ensure_ascii=False, indent=2), encoding="utf-8")
    (RESULTS_DIR / "diagnostics.json").write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(matrix, comparison, coverage, diagnostics, conflicts, recommendation)
    print(json.dumps({"coverage": coverage, "diagnostics": diagnostics}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from parser import parse_feature_collection


ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
ENDPOINT = "https://www.medusapp.net/php/consultaMedusas.php"
MAP_PAGE = "https://www.medusapp.net/mapa/mapa-portada.php"
LICENSE = "CC BY-NC-SA 4.0"
USER_AGENT = "Playa-Hoy-MedusApp-local-research/1.0"
CACHE_SECONDS = 30 * 60
PARSER_VERSION = 3


class MedusAppError(RuntimeError):
    pass


class MedusAppRateLimitError(MedusAppError):
    pass


@dataclass(frozen=True)
class MedusAppQuery:
    latitude: float
    longitude: float
    radiusKm: float
    fromDate: datetime
    toDate: datetime

    def parameters(self) -> dict[str, str]:
        return {
            "especie": "",
            "fechaIni": self.fromDate.date().isoformat(),
            "fechaFin": self.toDate.date().isoformat(),
            "idioma": "es",
            "versionApp": "web",
            "dispositivo": "web",
            "playaLat": f"{self.latitude:.6f}",
            "playaLon": f"{self.longitude:.6f}",
            "radio": f"{self.radiusKm:g}",
        }


class MedusAppProvider:
    """Research-only client. It stores normalized metadata, never popup HTML/media/user data."""

    def __init__(self, cache_seconds: int = CACHE_SECONDS) -> None:
        self.cache_seconds = cache_seconds
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self._session_ready = False
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.network_calls = 0
        self.cache_hits = 0
        self.diagnostics: list[dict[str, Any]] = []

    def _warm_session(self) -> None:
        if self._session_ready:
            return
        response = self.session.get(MAP_PAGE, timeout=20)
        if response.status_code >= 400:
            raise MedusAppError(f"Map session initialization HTTP {response.status_code}")
        # Intentionally do not parse or store the HTML response.
        self._session_ready = True

    @staticmethod
    def _cache_path(query: MedusAppQuery) -> Path:
        canonical = json.dumps(query.parameters(), sort_keys=True).encode()
        return CACHE_DIR / f"{hashlib.sha256(canonical).hexdigest()}.json"

    def _read_cache(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("parserVersion") != PARSER_VERSION:
                return None
            fetched = datetime.fromisoformat(payload["fetchedAt"])
            age = (datetime.now(timezone.utc) - fetched).total_seconds()
            if age <= self.cache_seconds:
                self.cache_hits += 1
                if isinstance(payload.get("diagnostic"), dict):
                    self.diagnostics.append({**payload["diagnostic"], "cache": True})
                return payload
        except (ValueError, KeyError, json.JSONDecodeError):
            return None
        return None

    def _request(self, query: MedusAppQuery) -> dict[str, Any]:
        self._warm_session()
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                response = self.session.get(
                    ENDPOINT,
                    params=query.parameters(),
                    headers={"Referer": MAP_PAGE},
                    timeout=25,
                )
                self.network_calls += 1
                diagnostic = {
                    "status": response.status_code,
                    "retryAfter": response.headers.get("retry-after"),
                    "cors": response.headers.get("access-control-allow-origin"),
                    "cookiesRequired": bool(self.session.cookies),
                }
                self.diagnostics.append(diagnostic)
                if response.status_code == 429:
                    raise MedusAppRateLimitError("MedusApp returned HTTP 429; research stopped")
                if response.status_code >= 500 and attempt == 0:
                    time.sleep(1.0)
                    continue
                response.raise_for_status()
                payload = response.json()
                if isinstance(payload, dict) and payload.get("error"):
                    raise MedusAppError(f"MedusApp JSON error: {payload['error']}")
                reports = parse_feature_collection(payload)
                return {
                    "source": "MedusApp",
                    "license": LICENSE,
                    "parserVersion": PARSER_VERSION,
                    "fetchedAt": datetime.now(timezone.utc).isoformat(),
                    "query": asdict(query) | {"fromDate": query.fromDate.isoformat(), "toDate": query.toDate.isoformat()},
                    "reports": reports,
                    "diagnostic": diagnostic,
                }
            except MedusAppRateLimitError:
                raise
            except (requests.RequestException, ValueError, MedusAppError) as error:
                last_error = error
                if attempt == 0:
                    time.sleep(1.0)
        raise MedusAppError(str(last_error) if last_error else "Unknown MedusApp failure")

    def get_reports(self, query: MedusAppQuery) -> dict[str, Any]:
        cache_path = self._cache_path(query)
        cached = self._read_cache(cache_path)
        if cached is not None:
            return cached
        result = self._request(query)
        # The result is already normalized: no popup, media filename/URL, user or comment.
        cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return result

    def query_area(self, parameters: dict[str, Any]) -> dict[str, Any]:
        """Dictionary adapter matching {latitude, longitude, radiusKm, from, to}."""
        def as_datetime(value: Any) -> datetime:
            if isinstance(value, datetime):
                return value
            if isinstance(value, str):
                return datetime.fromisoformat(value)
            raise TypeError("from/to must be datetime or ISO datetime strings")

        required = {"latitude", "longitude", "radiusKm", "from", "to"}
        missing = sorted(required - parameters.keys())
        if missing:
            raise ValueError(f"Missing MedusApp query fields: {', '.join(missing)}")
        return self.get_reports(
            MedusAppQuery(
                latitude=float(parameters["latitude"]),
                longitude=float(parameters["longitude"]),
                radiusKm=float(parameters["radiusKm"]),
                fromDate=as_datetime(parameters["from"]),
                toDate=as_datetime(parameters["to"]),
            )
        )

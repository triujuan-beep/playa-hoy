#!/usr/bin/env python3
"""Fetch the smallest official Copernicus subset needed by frozen V1.2."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import xarray as xr


DATASET_ID = "SST_MED_SST_L4_NRT_OBSERVATIONS_010_004_c_V2"
VARIABLE = "analysed_sst"
BOUNDS = {"minimumLongitude": -5.27, "maximumLongitude": -3.60, "minimumLatitude": 36.34, "maximumLatitude": 36.82}
POINTS = [
    ("Estepona", "western", 36.420739, -5.148896),
    ("Marbella", "western", 36.506503, -4.886251),
    ("Fuengirola", "central-west", 36.532737, -4.623467),
    ("Malaga", "Malaga Bay", 36.715699, -4.411388),
    ("Benajarafe", "Axarquia-west", 36.715436, -4.191691),
    ("Torrox", "Axarquia-central", 36.728322, -3.962194),
    ("Maro", "Axarquia-east", 36.753946, -3.834640),
    ("La Herradura", "Granada-west", 36.733183, -3.744979),
    ("Almunecar", "Granada-central", 36.730375, -3.686660),
]


def sanitized(message: str) -> str:
    result = message
    for name in ("COPERNICUSMARINE_SERVICE_USERNAME", "COPERNICUSMARINE_SERVICE_PASSWORD"):
        value = os.environ.get(name)
        if value:
            result = result.replace(value, "[REDACTED]")
    return " ".join(result.split())[-800:]


def write_payload(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def extract_points(dataset_path: Path) -> tuple[str, list[dict[str, object]], int]:
    with xr.open_dataset(dataset_path, engine="h5netcdf") as dataset:
        variable = dataset[VARIABLE]
        source_date = str(np.asarray(dataset["time"].values).max())[:10]
        units = str(variable.attrs.get("units", "")).lower()
        points: list[dict[str, object]] = []
        for name, region, latitude, longitude in POINTS:
            window = variable.where(
                (dataset["latitude"] >= latitude - 0.06)
                & (dataset["latitude"] <= latitude + 0.06)
                & (dataset["longitude"] >= longitude - 0.06)
                & (dataset["longitude"] <= longitude + 0.06),
                drop=True,
            )
            valid = window.notnull().any("time")
            if not bool(valid.any().item()):
                raise ValueError(f"no valid sea cell near {name}")
            squared_distance = (window.latitude - latitude) ** 2 + (window.longitude - longitude) ** 2
            distance = squared_distance.where(valid, np.inf)
            stacked = distance.stack(cell=("latitude", "longitude"))
            selected = stacked.idxmin("cell").item()
            series = window.sel(latitude=selected[0], longitude=selected[1])
            daily = []
            for instant, raw_value in zip(series.time.values, series.values):
                if np.isnan(raw_value):
                    continue
                value = float(raw_value)
                if "kelvin" in units or units == "k" or value > 100:
                    value -= 273.15
                daily.append({"date": str(instant)[:10], "sstC": round(value, 3)})
            points.append(
                {
                    "point": name,
                    "region": region,
                    "latitude": latitude,
                    "longitude": longitude,
                    "referenceLatitude": float(selected[0]),
                    "referenceLongitude": float(selected[1]),
                    "daily": daily,
                }
            )
        return source_date, points, int(variable.nbytes)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execution-date", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--work-directory", type=Path, required=True)
    args = parser.parse_args()
    execution_date = date.fromisoformat(args.execution_date)
    generated_at = datetime.now(timezone.utc).isoformat()
    missing = [name for name in ("COPERNICUSMARINE_SERVICE_USERNAME", "COPERNICUSMARINE_SERVICE_PASSWORD") if not os.environ.get(name)]
    if missing:
        raise SystemExit(f"Missing required GitHub Actions secrets: {', '.join(missing)}")

    args.work_directory.mkdir(parents=True, exist_ok=True)
    attempts: list[dict[str, object]] = []
    # Only source ages 0..2 can produce a current result. Older data is UNKNOWN,
    # so there is no value in issuing more provider requests.
    for offset in range(3):
        candidate = execution_date - timedelta(days=offset)
        start = candidate - timedelta(days=14)
        subset_path = args.work_directory / f"copernicus-{candidate.isoformat()}.nc"
        if subset_path.exists():
            subset_path.unlink()
        command = [
            "copernicusmarine",
            "subset",
            "--dataset-id",
            DATASET_ID,
            "--variable",
            VARIABLE,
            "--start-datetime",
            start.isoformat(),
            "--end-datetime",
            candidate.isoformat(),
            "--minimum-longitude",
            str(BOUNDS["minimumLongitude"]),
            "--maximum-longitude",
            str(BOUNDS["maximumLongitude"]),
            "--minimum-latitude",
            str(BOUNDS["minimumLatitude"]),
            "--maximum-latitude",
            str(BOUNDS["maximumLatitude"]),
            "--output-directory",
            str(args.work_directory),
            "--output-filename",
            subset_path.name,
            "--overwrite",
            "--raise-if-updating",
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0 or not subset_path.exists():
            message = sanitized(completed.stderr or completed.stdout or "Copernicus subset failed without output")
            attempts.append({"candidateDate": candidate.isoformat(), "status": "error", "exitCode": completed.returncode, "message": message})
            continue
        try:
            source_date, points, logical_bytes = extract_points(subset_path)
        except Exception as error:  # provider file/schema failures become auditable input errors
            attempts.append({"candidateDate": candidate.isoformat(), "status": "error", "exitCode": 0, "message": sanitized(f"{type(error).__name__}: {error}")})
            continue
        source_age = (execution_date - date.fromisoformat(source_date)).days
        attempts.append({"candidateDate": candidate.isoformat(), "status": "success", "sourceDate": source_date})
        write_payload(
            args.output,
            {
                "status": "ok",
                "provider": "Copernicus Marine Toolbox",
                "toolboxVersion": "2.4.1",
                "datasetId": DATASET_ID,
                "variable": VARIABLE,
                "bounds": BOUNDS,
                "generatedAt": generated_at,
                "executionDate": execution_date.isoformat(),
                "sourceDate": source_date,
                "sourceAge": source_age,
                "downloadBytes": subset_path.stat().st_size,
                "logicalBytes": logical_bytes,
                "attempts": attempts,
                "points": points,
            },
        )
        shutil.rmtree(args.work_directory, ignore_errors=True)
        return 0

    write_payload(
        args.output,
        {
            "status": "error",
            "provider": "Copernicus Marine Toolbox",
            "toolboxVersion": "2.4.1",
            "datasetId": DATASET_ID,
            "variable": VARIABLE,
            "bounds": BOUNDS,
            "generatedAt": generated_at,
            "executionDate": execution_date.isoformat(),
            "sourceDate": None,
            "sourceAge": None,
            "attempts": attempts,
            "points": [],
        },
    )
    shutil.rmtree(args.work_directory, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

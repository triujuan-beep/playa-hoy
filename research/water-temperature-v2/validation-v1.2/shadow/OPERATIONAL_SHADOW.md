# Water Confidence V1.2 — 14-day operational shadow

- Active window, inclusive: `2026-08-28` through `2026-09-10` (14 days).
- Schedule: `06:23 UTC`, approximately `08:23 Europe/Madrid` during this
  experiment.
- Detector: frozen V1.2, SHA-256
  `E5B251686A394A936C5440C20FC6095F73899E5C0A1D6022DB18A1EC6D43204F`.
- Official SST source: Copernicus Marine Toolbox 2.4.1, dataset
  `SST_MED_SST_L4_NRT_OBSERVATIONS_010_004_c_V2`, variable `analysed_sst`.
- Runtime sources: one successful regional Copernicus subset plus two parallel
  Open-Meteo batches. No Puertos del Estado or AEMET.
- History branch: `research/water-confidence-shadow`.
- History path: `research/water-temperature-v2/validation-v1.2/shadow/history/YYYY-MM-DD.json`, where the filename is the UTC execution date.

The workflow exits successfully without provider calls outside the active
window. A manual `workflow_dispatch` can run without persistence, or can test
the branch push when `persist=true`. Historical files are never overwritten.

Copernicus candidates are attempted newest-first (at most execution day and the
two previous days) with the official `--raise-if-updating` protection. The
actual maximum date inside the returned NetCDF becomes `sourceDate`. If none of
those three dates is accessible, or if the resulting age exceeds two days, the
run produces nine neutral `UNKNOWN` points. Provider failures also produce
`UNKNOWN` plus an explicit error and a failed Action after the diagnostic
snapshot has been preserved.

Vercel Git deployments are disabled only for the history branch in
`vercel.json`, preventing daily Preview or Production deployments from the
automatic snapshot commits.

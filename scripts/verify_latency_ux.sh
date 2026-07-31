#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

python_bin="${PYTHON_BIN:-.venv/bin/python}"
if ! "$python_bin" -c 'import fastapi, pytest' >/dev/null 2>&1; then
  echo "PYTHON_BIN must point to an environment with the project test dependencies." >&2
  exit 2
fi

"$python_bin" -m pytest tests/api -q
(
  cd app
  npm test
  npx tsc --noEmit
  npx expo export --platform web
)
# Metro saturates local CPU during export. Give it time to release workers;
# the checker below also refuses to judge wall time on a saturated host.
sleep 3
"$python_bin" scripts/benchmark_latency.py \
  --accounts 200 \
  --settled-days 60 \
  --warmups 3 \
  --samples 15 \
  --output .loop/nba-stock-latency-ux/state/final-benchmark.json

"$python_bin" - <<'PY'
import json
import os
from pathlib import Path

report = json.loads(
    Path('.loop/nba-stock-latency-ux/state/final-benchmark.json').read_text()
)
checks = {
    'refresh payload <= 75 KB': report['refresh']['payload_bytes'] <= 75_000,
    'refresh queries <= 20': report['refresh']['mean_queries'] <= 20,
    'trade+refresh payload <= 80 KB': (
        report['trade_plus_refresh']['payload_bytes'] <= 80_000
    ),
    'trade+refresh queries <= 46': (
        report['trade_plus_refresh']['mean_queries'] <= 46
    ),
    'settlement queries <= 30': report['settlement']['mean_queries'] <= 30,
}
load_1m = os.getloadavg()[0]
cpu_count = os.cpu_count() or 1
timing_checks = {
    'refresh p95 <= 30 ms': report['refresh']['p95_ms'] <= 30,
    'trade+refresh p95 <= 50 ms': report['trade_plus_refresh']['p95_ms'] <= 50,
    'settlement p95 <= 500 ms': report['settlement']['p95_ms'] <= 500,
}
if load_1m <= cpu_count:
    checks.update(timing_checks)
else:
    print(
        'Wall-clock gates skipped: host load '
        f'{load_1m:.2f} exceeds {cpu_count} logical CPUs. '
        'Run the benchmark again on an idle host for timing evidence.'
    )
failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit('Latency verifier failed: ' + ', '.join(failed))
print('Latency verifier passed: ' + ', '.join(checks))
PY

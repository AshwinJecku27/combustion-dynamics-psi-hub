#!/usr/bin/env bash
# Writes a copy of the SI dashboard (si/dashboard/si.html, corrected release r2) with the Worker URL baked in, WITHOUT modifying the
# verified release file. Output: si-integration/build/si.html (git-ignored).
# Usage: bash si-integration/configure_dashboard.sh https://psi-si-api.<you>.workers.dev
# Alternatives that need no build: set window.SI_API_BASE in a <script> before the app script,
# or (localhost only) open si.html?si_api=http://localhost:8787
set -euo pipefail
url="${1:?usage: configure_dashboard.sh <https://worker-origin>}"
[[ "$url" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || { echo "URL must be an origin like https://name.workers.dev (no path, no trailing slash)" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"; src="$here/../si/dashboard/si.html"; out="$here/build/si.html"
n=$(grep -o "__SI_API_BASE__" "$src" | wc -l); [ "$n" -ge 1 ] || { echo "placeholder not found in $src" >&2; exit 1; }
mkdir -p "$here/build"; sed "s#__SI_API_BASE__#${url}#g" "$src" > "$out"
echo "wrote $out (replaced $n placeholder occurrence(s) with $url)"
echo "Publishing it next to index.html (as si.html) keeps its 'Original dashboard' link working."

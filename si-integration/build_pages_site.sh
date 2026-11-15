#!/usr/bin/env bash
# Builds the GitHub Pages artifact. Called by .github/workflows/pages.yml; also run by the offline tests.
#   <out>/index.html     the original dashboard, byte-identical to the repository's index.html (checked against SHA256SUMS.txt)
#   <out>/si/index.html  the SI dashboard (si/dashboard/si.html) with two build-time substitutions only:
#                        1. its "Original dashboard" link 'index.html' -> '../index.html' (served from /si/, the bare
#                           name would point at the SI page itself);
#                        2. only if SI_API_BASE is set: the __SI_API_BASE__ placeholder -> that Worker origin.
#                           Unset or empty: the placeholder stays, so Ask SI sends nothing and says the service is
#                           not configured; the other three SI sections work offline from embedded data.
# si.html is self-contained (inline CSS/JS, embedded evidence data, no external assets), so nothing else is copied.
# Source files are never modified. Usage: SI_API_BASE=https://psi-si-api.<you>.workers.dev bash si-integration/build_pages_site.sh _site
set -euo pipefail
out="${1:?usage: build_pages_site.sh <output-dir>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
api="${SI_API_BASE:-}"
src="$root/si/dashboard/si.html"
[ ! -e "$out" ] || { echo "output $out already exists; refusing to overwrite" >&2; exit 1; }
if [ -n "$api" ] && ! [[ "$api" =~ ^https://[A-Za-z0-9.-]+$ ]]; then
  echo "SI_API_BASE must be an https origin such as https://psi-si-api.example.workers.dev (no path, no trailing slash)" >&2; exit 1
fi
# Root dashboard: must match the frozen v1 manifest before and after copying.
(cd "$root" && grep -E '  index\.html$' SHA256SUMS.txt | sha256sum -c --quiet -) || { echo "index.html does not match SHA256SUMS.txt" >&2; exit 1; }
[ "$(grep -c "href:'index.html'" "$src")" = 1 ] || { echo "expected exactly one href:'index.html' in $src" >&2; exit 1; }
[ "$(grep -o "__SI_API_BASE__" "$src" | wc -l)" -ge 1 ] || { echo "API placeholder not found in $src" >&2; exit 1; }
mkdir -p "$out/si"
cp "$root/index.html" "$out/index.html"
cmp -s "$root/index.html" "$out/index.html" || { echo "root copy differs" >&2; exit 1; }
sed "s#href:'index.html'#href:'../index.html'#" "$src" > "$out/si/index.html"
if [ -n "$api" ]; then sed -i "s#__SI_API_BASE__#${api}#g" "$out/si/index.html"; fi
echo "built $out: index.html (original dashboard, unchanged) and si/index.html (SI dashboard; API: ${api:-not configured})"

#!/usr/bin/env bash
# Checks the static company website in website/ before it is deployed (CI, job "website"):
#   - no open placeholder ("{{OFFEN: ...}}") is left, so an unfinished text never goes live
#   - no inline script or style and no file from another host: the site's CSP forbids them
#   - every internal link and asset points to a file that exists
set -euo pipefail
cd "$(dirname "$0")/../website"
fail=0
err() { echo "website: $*" >&2; fail=1; }

if grep -rn '{{OFFEN' --include='*.html' --include='*.css' --include='*.svg' . ; then
    err "open placeholders left (see above)"
fi
if grep -rniE '<script|<style|[[:space:]]style=|[[:space:]]on[a-z]+=' --include='*.html' . ; then
    err "inline script or style found (see above)"
fi
if grep -rnoE '(src|href)="(https?:)?//[^"]*"' --include='*.html' . | grep -v 'mailto:' ; then
    err "resource or link to another host found (see above); only files from this host are allowed"
fi

# Internal links: every src, srcset or href="/..." must name an existing file ("/x/" means x/index.html).
while IFS=: read -r file target; do
    target="${target#*=\"}"; target="${target%\"}"; target="${target%%#*}"
    path=".$target"
    case "$target" in */) path="${path}index.html" ;; esac
    [ -e "$path" ] || err "$file links to $target, which does not exist"
done < <(grep -roE '(src|srcset|href)="/[^"]*"' --include='*.html' . || true)

exit "$fail"

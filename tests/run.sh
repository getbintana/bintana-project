#!/usr/bin/env bash
# Fidelity harness over tests/corpus.
#
#   tests/run.sh [--update] [file]
#
# For every fixture the app round-trips the file (`check`, see MainForm.js) and
# reports what SaveXml touched; this script holds both the saved output and the
# touched report against the goldens in tests/expected/. A golden is a snapshot
# of **current** behaviour, not of desired behaviour -- tests/FIDELITY.md says
# what in it is deliberate and what is a known upstream bug. `--update`
# rewrites the goldens after a deliberate change, never by accident.
#
# BINTANA_ROOT points at the runtime checkout (default: ../bintana); BINTANA
# overrides the binary inside it; OUT is where the round-trip scratch lands
# (default: /tmp/bintana-project-check).
set -uo pipefail
cd "$(dirname "$0")/.."

UPDATE=0
if [[ ${1-} == --update ]]; then UPDATE=1; shift; fi

BINTANA_ROOT=${BINTANA_ROOT:-../bintana}
TRY=$BINTANA_ROOT/tests/try.sh
[[ -x $TRY ]] || { echo "run.sh: no try.sh at $TRY -- set BINTANA_ROOT" >&2; exit 1; }
export BINTANA=${BINTANA:-$BINTANA_ROOT/build/bintana}

OUT=${OUT:-/tmp/bintana-project-check}
EXPECTED=$PWD/tests/expected
mkdir -p "$OUT" "$EXPECTED"

if [[ $# -ge 1 ]]; then
    files=("tests/corpus/$1")
else
    files=(tests/corpus/*.xml)
fi

fail=0
for f in "${files[@]}"; do
    base=$(basename "$f"); name=${base%.xml}
    report="$OUT/$base.report"
    "$TRY" "$PWD" check "$PWD/$f" "$OUT" dump-touched > "$report" 2>&1
    status=$?
    out="$OUT/bintana-project-check-$base"
    grep '^touched:' "$report" > "$OUT/$base.touched"

    if [[ $status -ne 0 ]]; then
        echo "check $base: FAILED (app exit $status)"
        grep -E '^(file=|roundtrip|check )' "$report"
        fail=1
        continue
    fi
    if [[ ! -f $out ]]; then
        echo "check $base: NO OUTPUT"
        fail=1
        continue
    fi

    if [[ $UPDATE -eq 1 ]]; then
        cp "$out" "$EXPECTED/$name.out.xml"
        cp "$OUT/$base.touched" "$EXPECTED/$name.touched"
        echo "update $base: goldens written"
        continue
    fi

    if [[ ! -f $EXPECTED/$name.out.xml ]]; then
        echo "check $base: NO GOLDEN -- run with --update"
        fail=1
        continue
    fi

    if cmp -s "$out" "$EXPECTED/$name.out.xml"; then
        echo "check $base: output ok"
    else
        echo "check $base: OUTPUT CHANGED"
        diff -u "$EXPECTED/$name.out.xml" "$out" | head -30
        fail=1
    fi

    if cmp -s "$OUT/$base.touched" "$EXPECTED/$name.touched"; then
        echo "check $base: touched ok ($(wc -l < "$OUT/$base.touched") lines)"
    else
        echo "check $base: TOUCHED CHANGED"
        diff -u "$EXPECTED/$name.touched" "$OUT/$base.touched" | head -30
        fail=1
    fi
done

if [[ $fail -eq 0 ]]; then
    echo "HARNESS-OK"
    exit 0
fi
echo "HARNESS-FAILED"
exit 1

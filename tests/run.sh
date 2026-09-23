#!/usr/bin/env bash
# The fidelity harness over tests/corpus, and the scripted editing round trip.
#
#   tests/run.sh [--update] [file]
#
# For every fixture the app round-trips the file (`check`, see MainForm.js) and
# reports what SaveXml touched; the full run also plays one scripted round of
# the editing commands over 01-minimal (`check-edit`). Both the saved output
# and the touched report are held against the goldens in tests/expected/. A
# golden is a snapshot of **current** behaviour, not of desired behaviour --
# tests/FIDELITY.md says what in it is deliberate and what is known to be
# upstream. `--update` rewrites the goldens after a deliberate change, never by
# accident.
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

# The app is translated, so the harness pins the language: a golden written
# under one catalogue is not the golden of another. `LANGUAGE=en` picks the
# msgids (there is no `po/en.po`).
export LC_ALL=C LANGUAGE=en

OUT=${OUT:-/tmp/bintana-project-check}
EXPECTED=$PWD/tests/expected
mkdir -p "$OUT" "$EXPECTED"

# One road, one name: the app is told the command and the file, and this holds
# what it wrote and what it reported against the goldens of that name.
run_one() {
    local name=$1; shift
    local report="$OUT/$name.report"
    local out

    "$TRY" "$PWD" "$@" "$OUT" dump-touched > "$report" 2>&1
    local status=$?
    out=$(grep '^out=' "$report" | head -1 | cut -d= -f2-)
    grep '^touched:' "$report" > "$OUT/$name.touched"

    if [[ $status -ne 0 ]]; then
        echo "check $name: FAILED (app exit $status)"
        grep -E '^(file=|roundtrip|check |wiring)' "$report"
        return 1
    fi
    if [[ -z $out || ! -f $out ]]; then
        echo "check $name: NO OUTPUT"
        return 1
    fi

    if [[ $UPDATE -eq 1 ]]; then
        cp "$out" "$EXPECTED/$name.out.xml"
        cp "$OUT/$name.touched" "$EXPECTED/$name.touched"
        echo "update $name: goldens written"
        return 0
    fi
    if [[ ! -f $EXPECTED/$name.out.xml ]]; then
        echo "check $name: NO GOLDEN -- run with --update"
        return 1
    fi

    local fail=0
    if cmp -s "$out" "$EXPECTED/$name.out.xml"; then
        echo "check $name: output ok"
    else
        echo "check $name: OUTPUT CHANGED"
        diff -u "$EXPECTED/$name.out.xml" "$out" | head -30
        fail=1
    fi
    if cmp -s "$OUT/$name.touched" "$EXPECTED/$name.touched"; then
        echo "check $name: touched ok ($(wc -l < "$OUT/$name.touched") lines)"
    else
        echo "check $name: TOUCHED CHANGED"
        diff -u "$EXPECTED/$name.touched" "$OUT/$name.touched" | head -30
        fail=1
    fi
    return $fail
}

fail=0
if [[ $# -ge 1 ]]; then
    base=$(basename "$1"); name=${base%.xml}
    run_one "$name" check "$PWD/tests/corpus/$base" || fail=1
else
    for f in tests/corpus/*.xml; do
        base=$(basename "$f"); name=${base%.xml}
        run_one "$name" check "$PWD/$f" || fail=1
    done
    run_one "edit-01-minimal" check-edit "$PWD/tests/corpus/01-minimal.xml" || fail=1

    # The engine's arithmetic and the chart's pointer, asserted inside the
    # app -- no golden, because the values are the assertion.
    for what in cpm drag; do
        if "$TRY" "$PWD" "check-$what" > "$OUT/$what.report" 2>&1; then
            echo "check $what: $(grep -c "^$what " "$OUT/$what.report") assertions ok"
        else
            echo "check $what: FAILED"
            grep 'FAILED' "$OUT/$what.report"
            fail=1
        fi
    done
fi

if [[ $fail -eq 0 ]]; then
    echo "HARNESS-OK"
    exit 0
fi
echo "HARNESS-FAILED"
exit 1

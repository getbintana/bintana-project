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

    # The engine's arithmetic, the chart's pointer, the view's geometry, the
    # statistics the Project menu shows, the welcome page a bare start lands on
    # and the commands themselves pressed as commands -- asserted inside the app
    # -- no golden, because the values are the assertion.
    for what in cpm drag view stats welcome commands; do
        if "$TRY" "$PWD" "check-$what" > "$OUT/$what.report" 2>&1; then
            echo "check $what: $(grep -c "^$what " "$OUT/$what.report") assertions ok"
        else
            echo "check $what: FAILED"
            grep 'FAILED' "$OUT/$what.report"
            fail=1
        fi
    done

    # **The engine again, in zones whose clocks change.** Argentina's do not,
    # so the arithmetic was only ever run where a day is always 24 hours: one
    # 25-hour day stood the calendar walk still and finished a task in 1970,
    # and Bintana's QuickJS reads a midnight next to a change as the day before
    # (Schedule.js, `localMs`). check-cpm crosses the three changes with answers
    # that hold in every zone.
    for tz in America/New_York Europe/Madrid America/Santiago; do
        if TZ=$tz "$TRY" "$PWD" check-cpm > "$OUT/cpm-${tz//\//-}.report" 2>&1 ||
           { echo "check cpm in $tz: FAILED"; grep 'FAILED' "$OUT/cpm-${tz//\//-}.report" 2>/dev/null; false; }; then
            echo "check cpm in $tz: ok"
        else
            fail=1
        fi
    done

    # **The real plan, when there is one to point at.** `ORACLE=/ruta/plan.xml`
    # is opt-in because the file is not in the repository: the corpus is small
    # and synthetic, and the oracle is Project's own output on a real project.
    # Without it the oracle is only ever checked by hand, which is a habit
    # rather than a check -- so with it, the harness says out loud how many
    # elements of a real file the app does not model, and that number is the
    # measure of what is left to do.
    if [[ -n ${ORACLE-} ]]; then
        if [[ ! -f $ORACLE ]]; then
            echo "check oracle: NO SUCH FILE $ORACLE"
            fail=1
        else
            if "$TRY" "$PWD" check-oracle "$ORACLE" > "$OUT/oracle.report" 2>&1; then
                echo "check oracle: ok ($(grep '^oracle ' "$OUT/oracle.report" | tail -1 | cut -d: -f2-))"
            else
                echo "check oracle: FAILED"
                grep '^oracle ' "$OUT/oracle.report" | tail -25
                fail=1
            fi
        fi
    fi
fi

# **The schema, when there is one to point at.** `XSD=/ruta/mspdi_pj12.xsd`
# is opt-in for the same reason as the oracle -- the file is Microsoft's and
# not in the repository (tests/corpus/README.md says where it comes from). The
# XSD is a `sequence`, so it is the check that catches a field inserted out of
# order, which no golden can: a golden only says the output did not change.
# The validator is the runtime's (`Xml.Schema`, behind `check-xsd`), which
# remaps the namespace itself (Project writes the bare one, the XSD declares
# /2007); an output only fails when its input was valid -- a fixture that
# comes in broken is not the writer's fault.
if [[ -n ${XSD-} ]]; then
    outs=(); ins=()
    for out in "$OUT"/bintana-project-check-*.xml "$OUT"/bintana-project-edit-*.xml; do
        [[ -f $out ]] || continue
        name=$(basename "$out" .xml); name=${name#bintana-project-check-}
        name=${name#bintana-project-edit-}
        outs+=("$out"); ins+=("tests/corpus/$name.xml")
    done
    if [[ ${#outs[@]} -gt 0 ]]; then
        "$TRY" "$PWD" check-xsd "$XSD" "${outs[@]}" "${ins[@]}" > "$OUT/xsd.report" 2>&1
        xsd_bad=0
        for k in "${!outs[@]}"; do
            if grep -qE "^xsd ${outs[$k]}: [0-9]+ problems" "$OUT/xsd.report" &&
               grep -qE "^xsd ${ins[$k]}: valid" "$OUT/xsd.report"; then
                echo "check xsd $(basename "${outs[$k]}"): INVALID"
                grep -A5 -F "xsd ${outs[$k]}:" "$OUT/xsd.report" | grep '^xsd   ' | head -5
                xsd_bad=$((xsd_bad + 1)); fail=1
            fi
        done
        [[ $xsd_bad -eq 0 ]] && echo "check xsd: ${#outs[@]} outputs ok"
    fi
fi

if [[ $fail -eq 0 ]]; then
    echo "HARNESS-OK"
    exit 0
fi
echo "HARNESS-FAILED"
exit 1

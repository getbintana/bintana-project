#!/usr/bin/env bash
# La vuelta de aceptación: agarra un XML y deja la salida de la app en un
# directorio, con su informe. Lo que hay que abrir en MS Project es esa salida.
#
#   tests/aceptacion.sh "/ruta/al/plan.xml"
#
# La salida queda en /tmp/bintana-project-aceptacion/ (o en $OUT).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -lt 1 || ! -f $1 ]]; then
    echo "uso: tests/aceptacion.sh <archivo.xml>" >&2
    exit 2
fi

BINTANA_ROOT=${BINTANA_ROOT:-../bintana}
TRY=$BINTANA_ROOT/tests/try.sh
[[ -x $TRY ]] || { echo "no hay try.sh en $TRY -- seteá BINTANA_ROOT" >&2; exit 1; }
export BINTANA=${BINTANA:-$BINTANA_ROOT/build/bintana}

OUT=${OUT:-/tmp/bintana-project-aceptacion}
mkdir -p "$OUT"

# El idioma fijo, como el harness: la salida no depende de la máquina.
export LC_ALL=C LANGUAGE=en

"$TRY" "$PWD" check "$1" "$OUT" dump-touched | tee "$OUT/informe.txt"

echo
echo "Listo. Abrí en MS Project:"
grep '^out=' "$OUT/informe.txt" | head -1 | cut -d= -f2-

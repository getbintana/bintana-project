# Plans saved by MS Project

Each file here was opened and saved in **MS Project 16.0** (automatic
calculation on) during glpi-project's sample rounds
(`glpi-project/dev/samples`, `previous/roundN`): its dates, critical flags and
slack are Project's own answer. `tests/run.sh` round-trips each against its
goldens (`tests/expected/project-*`: opening and saving moves nothing) and
recalculates it with `check-oracle`, which fails on any start, finish or
critical flag that differs from Project's.

| File | What it holds | Round |
|---|---|---|
| `p1-minimo.xml` | two phases, an FS chain, a milestone | 9 |
| `p2-vinculos.xml` | the four link types, leads and an elapsed lag, a constraint, a manual task, 72 elapsed hours, a material resource | 10 |
| `p3-calendario.xml` | two shifts, recurring holidays, a task on its own calendar, progress | 9 |
| `p4-completo.xml` | all of the above in a 30-task plan, with progress | 12 |
| `p4-informe-glpi.xml` | GLPI's export of P4 as a report: done, in progress behind schedule (`ResumeValid`, a split), not started on forecast dates | 20 |
| `p4-informe-glpi-por-bintana.xml` | the same, opened and saved by bintana first | 22 |
| `b4-calendarios.xml` … `b9-manual.xml` | one request each (glpi-project `dev/samples/bintana/REQUESTS.md`), saved by bintana first | 21 |

Known, not counted by the oracle: in `p4-completo.xml` Project writes a
finished task's (Licencias) late finish as its actual finish, with 4 h of
slack; bintana answers from its successors.

To add one: save it in Project, copy it here under a short name, check that
`check-oracle` passes on it, write its goldens with
`tests/run.sh --update tests/project/<file>.xml`, and say here what it holds.

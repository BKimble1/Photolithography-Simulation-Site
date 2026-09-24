#!/bin/bash
# Round three's reviewed frame sequences: stills at chosen lesson points (scripts/frames.mjs),
# tiled into the contact sheets in docs/recordings/round3/sheet-*.jpg (scripts/recordings/sheet.py,
# which needs Python's Pillow). Run from the repository root, with the builds served:
#   NEW (this round's build):  npm run build && npm run preview          (port 4173)
#   PRE (the "before" build):  commit 77d06f4, built and served on port 4175 with
#                              npx vite preview --port 4175 --outDir <its dist>
# One browser at a time: several software-rendered browsers at once can time out while loading.
set -u
HERE=$(dirname "$0")
OUT=${OUT:-/tmp/r3-sheets}
mkdir -p $OUT
grab() { # name base path points...
  local name=$1 base=$2 path=$3; shift 3
  rm -rf $OUT/$name; timeout 1200 node scripts/frames.mjs $base "$path" $OUT/$name "$@" > $OUT/$name.log 2>&1
  python3 $HERE/sheet.py $OUT/$name $OUT/$name.jpg ${COLS:-4} 300 "$TITLE" >> $OUT/$name.log 2>&1
  echo "$name: $(tail -1 $OUT/$name.log)"
}
NEW=${NEW:-http://127.0.0.1:4173}
PRE=${PRE:-http://127.0.0.1:4175}
# enclosures stay readable: anneal (furnace), PEB (hot-plate lid), strip (ash plasma)
TITLE="Anneal: the camera goes down to the layers before the boat is sealed in the tube" grab anneal $NEW "/?step=anneal&virt=1" p=0.05 p=0.3 p=0.45 p=0.5 p=0.53 p=0.56 p=0.6 p=0.8
TITLE="Post-exposure bake, BEFORE: the die close-up under the raised lid and its exhaust" grab peb-before $PRE "/?step=peb&virt=1" p=0.02 p=0.08 p=0.13 p=0.17 p=0.21 p=0.25 p=0.3 p=0.45
TITLE="Post-exposure bake, AFTER: onto the plate, then into the layers from the plate before the lid closes" grab peb-after $NEW "/?step=peb&virt=1" p=0.02 p=0.08 p=0.13 p=0.17 p=0.21 p=0.25 p=0.3 p=0.45
TITLE="Develop, BEFORE: framed from above, the dispense bar sweeps across the lens" grab develop-before $PRE "/?step=develop&virt=1" p=0.2 p=0.26 p=0.32 p=0.37 p=0.42 p=0.47 p=0.52 p=0.6
TITLE="Develop, AFTER: the cup while the puddle is laid, then into the layers" grab develop-after $NEW "/?step=develop&virt=1" p=0.2 p=0.26 p=0.32 p=0.37 p=0.42 p=0.47 p=0.52 p=0.6
TITLE="Contact etch, BEFORE: the wafer and die framings sit inside the plasma's glow" grab etch-before $PRE "/?step=contact-etch&virt=1" p=0.3 p=0.36 p=0.4 p=0.43 p=0.46 p=0.5 p=0.55 p=0.6
TITLE="Contact etch, AFTER: the chamber as the plasma strikes, then into the layers" grab etch-after $NEW "/?step=contact-etch&virt=1" p=0.3 p=0.36 p=0.4 p=0.43 p=0.46 p=0.5 p=0.55 p=0.6
TITLE="Resist strip: into the layers as the oxygen plasma fills the ash chamber" grab strip $NEW "/?step=strip&virt=1" p=0.1 p=0.25 p=0.3 p=0.33 p=0.36 p=0.39 p=0.42 p=0.6
# the camera and moving wafers: before (the commit before the fix) and after
COLS=5 TITLE="Polisher flips the wafer (contact fill), BEFORE: the die framing follows the flip" grab cmpflip-before $PRE "/?step=contact-fill&virt=1" p=0.45 p=0.465 p=0.47 p=0.475 p=0.48 p=0.485 p=0.49 p=0.5 p=0.52 p=0.54
COLS=5 TITLE="Polisher flips the wafer (contact fill), AFTER: out of the layers onto the polisher, which turns the wafer in a steady view" grab cmpflip-after $NEW "/?step=contact-fill&virt=1" p=0.45 p=0.465 p=0.47 p=0.475 p=0.48 p=0.485 p=0.49 p=0.5 p=0.52 p=0.54
TITLE="Inspection review, BEFORE: the wafer framing follows the stage across each swath" grab review-before $PRE "/?step=inspect&virt=1" p=0.22 p=0.25 p=0.28 p=0.31 p=0.34 p=0.37 p=0.4 p=0.43
TITLE="Inspection review, AFTER: a steady view of the stage's whole travel, the optics and the SEM" grab review-after $NEW "/?step=inspect&virt=1" p=0.22 p=0.25 p=0.28 p=0.31 p=0.34 p=0.37 p=0.4 p=0.43
COLS=5 TITLE="Contact printing, BEFORE: the die framing follows the stepping stage" grab print-before $PRE "/?step=contact-print&virt=1" p=0.1 p=0.12 p=0.14 p=0.16 p=0.18 p=0.2 p=0.22 p=0.24 p=0.26 p=0.28
COLS=5 TITLE="Contact printing, AFTER: the machine, then down into the layers" grab print-after $NEW "/?step=contact-print&virt=1" p=0.1 p=0.12 p=0.14 p=0.16 p=0.18 p=0.2 p=0.22 p=0.24 p=0.26 p=0.28
echo sheets-done

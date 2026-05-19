#!/usr/bin/env bash
# Empirical verification: compile the fixtures, apply the codemod, compile
# again, and observe which files succeed vs fail. Reproduces the README's
# "Empirical results" section end-to-end.

set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EX="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/before/com/example" "$WORK/after/com/example"
cp "$EX"/src/*.java       "$WORK/before/com/example/"
cp "$EX"/broken/*.java    "$WORK/before/com/example/"
cp "$HERE"/LegacyUtilDate.java "$WORK/before/com/example/"
cp "$HERE"/Main.java           "$WORK/before/com/example/"
cp "$WORK/before/com/example/"*.java "$WORK/after/com/example/"

echo "=== 1. Compile BEFORE (all original fixtures + Main + LegacyUtilDate)"
(cd "$WORK/before" && javac -d ./out com/example/*.java)
echo "    ok: before/ compiles cleanly"
echo

echo "=== 2. Run BEFORE Main (depends on inner-class .label)"
(cd "$WORK/before" && java -cp ./out com.example.Main)
echo

echo "=== 3. Apply codemod to after/com/example"
(cd "$EX" && npx codemod jssg run ./rename-util-date.ts \
  --target "$WORK/after/com/example" \
  --language java --allow-dirty --no-interactive 2>&1 | tail -2)
echo

echo "=== 4. Compile AFTER — expect failure ONLY in Main.java"
if (cd "$WORK/after" && javac -d ./out com/example/*.java 2>&1); then
  echo "    UNEXPECTED: javac succeeded. The demo no longer demonstrates the bug."
  exit 1
else
  echo
  echo "    ok: javac failed. Note where the error lands — Main.java, NOT"
  echo "    BrokenInnerShadow.java. The codemod-touched file compiled silently;"
  echo "    only the downstream consumer carries the failure."
fi

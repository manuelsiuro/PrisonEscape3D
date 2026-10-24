#!/bin/sh
# After `git push --follow-tags`: waits for the CI run of HEAD to finish, then for the live
# bundle to carry package.json's version. Exits 1 if CI fails or either wait times out.
# Needs only curl and python3 (`gh` is not installed). Polls the API every 30 s, staying well inside
# its 60 calls an hour. Takes up to ~25 min: run it in the background.
REPO=manuelsiuro/PrisonEscape3D
SITE=https://manuelsiuro.github.io/PrisonEscape3D/
SHA=$(git rev-parse HEAD)
VERSION=$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')

run() {
  curl -s "https://api.github.com/repos/$REPO/actions/runs?head_sha=$SHA" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if "workflow_runs" not in d: print("limited" if "rate limit" in d.get("message", "") else "error"); sys.exit()
runs = d["workflow_runs"]
print(" ".join(w["name"] + ":" + w["status"] + ":" + str(w["conclusion"]) for w in runs) if runs else "none")'
}

echo "CI for ${SHA%"${SHA#???????}"} (v$VERSION)"
i=0
while :; do
  r=$(run)
  case "$r" in
    none|*queued*|*in_progress*|*waiting*|*pending*|*requested*) ;;
    # Out of API calls (60 an hour without a token): the deploy only runs once the tests pass,
    # so the bundle going live answers for CI as well.
    limited|error|"") echo "CI: GitHub API unavailable ($r); watching the bundle instead"; break ;;
    *) break ;;
  esac
  i=$((i + 1)); [ $i -ge 30 ] && { echo "CI: timed out ($r)"; exit 1; }
  sleep 30
done
case "$r" in limited|error|"") ;; *)
  echo "CI: $r"
  case "$r" in *:success*) ;; *) echo "CI FAILED: no deploy"; exit 1 ;; esac ;;
esac

i=0
while :; do
  js=$(curl -s "$SITE?$i" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
  # The bundle writes the version in backticks or quotes: match the bare number.
  [ -n "$js" ] && curl -s "$SITE$js" | grep -q "[\`\"']$VERSION[\`\"']" && { echo "live: $VERSION ($js)"; exit 0; }
  i=$((i + 1)); [ $i -ge 60 ] && { echo "live: still not $VERSION after 10 min ($js)"; exit 1; }
  sleep 10
done

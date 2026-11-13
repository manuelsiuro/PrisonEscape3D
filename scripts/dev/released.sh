#!/bin/sh
# After `git push --follow-tags`: waits for the tests of HEAD to pass on CI, then for the live
# bundle to carry package.json's version, and says which part failed or is still waiting:
#   exit 0  the tests passed and the version is live (or the push changed no game file: no deploy)
#   exit 1  the tests or the deploy failed, or the tests didn't finish in 25 min
#   exit 2  the tests passed, but after 25 min the site doesn't carry the version yet (GitHub
#           Pages is slow at times: check again later, with the same command)
# Needs only curl and python3 (`gh` is not installed). Polls the API once a minute, inside its 60
# calls an hour. Run it in the background, and read what it prints, not only its exit code.
REPO=manuelsiuro/PrisonEscape3D
SITE=https://manuelsiuro.github.io/PrisonEscape3D/
SHA=${SHA:-$(git rev-parse HEAD)}  # (another commit: SHA=<full sha> npm run released)
VERSION=$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')

# One line: "tests:<state> deploy:<state>", each pending, success, failure or skipped (the deploy:
# none once CI is done without one); or "limited" / "error" when the API can't be read.
jobs() {
  curl -s "https://api.github.com/repos/$REPO/actions/runs?head_sha=$SHA" | python3 -c '
import json, sys, urllib.request
d = json.load(sys.stdin)
if "workflow_runs" not in d:
    print("limited" if "rate limit" in d.get("message", "") else "error"); sys.exit()
tests, deploy = [], []
for run in d["workflow_runs"]:
    try:
        js = json.load(urllib.request.urlopen(run["jobs_url"]))["jobs"]
    except Exception:
        print("error"); sys.exit()
    for j in js:
        state = "pending" if j["status"] != "completed" else (j["conclusion"] or "pending")
        (tests if j["name"] == "check" else deploy).append(state)
def worst(states, empty):
    if not states: return empty
    for s in ("failure", "cancelled", "timed_out", "pending"):
        if s in states: return "failure" if s in ("cancelled", "timed_out") else s
    return "success" if "success" in states else "skipped"
print("tests:" + worst(tests, "pending") + " deploy:" + worst(deploy, "none"))'
}

live() {
  # Every script the page loads (since 2.34.2 the entry is a stub: the version is in the game's
  # file); the bundle writes the version in backticks or quotes: match the bare number.
  for js in $(curl -s "$SITE?$1" | grep -o 'assets/[A-Za-z0-9_.-]*\.js' | sort -u); do
    curl -s "$SITE$js" | grep -q "[\`\"']$VERSION[\`\"']" && return 0
  done
  return 1
}

echo "CI for ${SHA%"${SHA#???????}"} (v$VERSION)"
i=0
while :; do
  r=$(jobs)
  case "$r" in
    limited|error|"")
      # A new version going live proves the tests passed (the deploy waits for them); one already
      # live proves nothing about this commit (a docs push, a retry).
      live "a" && { echo "CI: GitHub API unavailable ($r), and the site was already at $VERSION: this commit's tests can't be read. Run again in an hour"; exit 2; }
      echo "CI: GitHub API unavailable ($r); watching the site instead (a deploy runs only once the tests pass)"; break ;;
    *tests:failure*) echo "TESTS FAILED ($r): nothing deployed"; exit 1 ;;
    *tests:success*) echo "tests passed"; break ;;
  esac
  i=$((i + 1)); [ $i -ge 25 ] && { echo "CI: the tests didn't finish in 25 min ($r)"; exit 1; }
  sleep 60
done

i=0
while :; do
  live "$i" && { echo "live: $VERSION"; exit 0; }
  # Every 2 minutes, what the deploy is doing (skipped: this push changed no game file).
  if [ $((i % 12)) -eq 0 ]; then
    r=$(jobs)
    case "$r" in
      *deploy:failure*) echo "DEPLOY FAILED ($r)"; exit 1 ;;
      # (Only once the tests are through: before that there's no deploy job yet, which isn't "none".)
      *tests:success*deploy:skipped*|*tests:success*deploy:none*) live "s$i" && { echo "live: $VERSION"; exit 0; }
        echo "no deploy for this push (docs and tools only), and the site isn't at $VERSION: was that release deployed?"; exit 1 ;;
    esac
  fi
  i=$((i + 1)); [ $i -ge 150 ] && { echo "tests passed, but the site still isn't at $VERSION after 25 min (deploy: ${r#*deploy:}): GitHub Pages is slow; run this again later"; exit 2; }
  sleep 10
done

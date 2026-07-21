#!/bin/sh
set -eu

REPOSITORY="SidneyMok/my-tools"
READY_LABEL="agent:ready"
IN_PROGRESS_LABEL="agent:in-progress"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/my-tools"
STATE_FILE="$STATE_DIR/dispatched-issues.txt"

mkdir -p "$STATE_DIR"
touch "$STATE_FILE"

issues=$(gh issue list --repo "$REPOSITORY" --state open --label "$READY_LABEL" --limit 100 --json number,title,url --jq '.[] | @base64')
[ -n "$issues" ] || exit 0

printf '%s\n' "$issues" | while IFS= read -r encoded; do
  issue=$(printf '%s' "$encoded" | base64 --decode)
  number=$(printf '%s' "$issue" | jq -r '.number')
  title=$(printf '%s' "$issue" | jq -r '.title')
  url=$(printf '%s' "$issue" | jq -r '.url')

  if grep -qx "$number" "$STATE_FILE"; then
    continue
  fi

  gh issue edit "$number" --repo "$REPOSITORY" --remove-label "$READY_LABEL" --add-label "$IN_PROGRESS_LABEL"
  printf '%s\n' "$number" >> "$STATE_FILE"
  printf 'DISPATCH issue #%s\t%s\t%s\n' "$number" "$title" "$url"
done

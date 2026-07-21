# Autonomous Issue Workflow

## Intent

GitHub Issues are the project demand queue. OpenClaw may implement only issues carrying the `agent:ready` label. It may create a branch, commit, push, open a pull request, comment on the issue, and change workflow labels. It must never merge a pull request, close an issue, delete a branch, or publish a release without Sidney's explicit approval.

## Labels

| Label | Meaning |
| --- | --- |
| `agent:ready` | Fully specified and allowed to start. |
| `agent:in-progress` | Claimed by TALOS and assigned to the project leader. |
| `agent:needs-clarification` | Issue needs a question answered before implementation. |
| `agent:blocked` | Work cannot proceed; a comment explains the blocker. |
| `agent:done` | Pull request exists and awaits human review/merge. |

## Dispatcher

The Gateway cron job runs `.automation/issue-dispatch.sh` every five minutes. It discovers open `agent:ready` issues, atomically changes each to `agent:in-progress`, persists the issue number in the local dispatch ledger, and prints one `DISPATCH` line per newly claimed issue.

TALOS receives the dispatcher output. For every line, TALOS sends the issue number, title, and URL to the matching project leader. The leader is responsible for the execution protocol below. The dispatcher intentionally does not use a public webhook, so the Mac mini does not need an Internet-accessible endpoint.

## Leader protocol

1. Read the issue and current `main` branch state.
2. If the acceptance criteria are ambiguous, add a concise Issue comment, add `agent:needs-clarification`, remove `agent:in-progress`, and stop.
3. Create one branch named `feat/issue-<number>-<slug>` or `fix/issue-<number>-<slug>`.
4. Delegate implementation to `my-tools-frontend` and independent validation to `my-tools-qa`.
5. Keep changes limited to the issue scope. Run relevant checks before creating a PR.
6. Push the branch and open a PR into `main`. Its body must include `Resolves #<number>`, summary, verification, and QA result.
7. Comment on the Issue with the PR URL and verification summary; add `agent:done`, remove `agent:in-progress`.

## Recovery

The dispatch ledger is at `~/.local/state/my-tools/dispatched-issues.txt`. It prevents duplicate dispatch after recurring runs. To intentionally retry an issue after cancellation or recovery, remove its line from the ledger, ensure no active branch/PR exists, then restore `agent:ready`.

If a worker cannot proceed, the leader leaves the issue open, comments with the blocking evidence, adds `agent:blocked`, and removes `agent:in-progress`.

## Human controls

- Add `agent:ready` only when autonomous work is desired.
- Remove `agent:ready` before the cron job claims it to cancel queued work.
- Review and merge the resulting PR manually.
- GitHub Pages publishes only after a human merges into `main`.

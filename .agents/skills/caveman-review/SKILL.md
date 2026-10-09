---
name: caveman-review
description: >
  Ultra-compressed code review comments.
  One line per finding: location, problem, fix.
  Use when user says "review this PR",
  "code review", "review the diff",
  or invokes /caveman-review.
inference_examples:
  - "review this PR"
  - "code review"
  - "review the diff"
  - "/caveman-review"
---

Write code review comments terse and actionable.
One line per finding. Location, problem, fix.
No throat-clearing.

## Rules

**Format:** `L<line>: <problem>. <fix>.`
Multi-file: `<file>:L<line>: ...`

**Severity prefix (when mixed):**
- `🔴 bug:` — broken behavior, will cause
  incident
- `🟡 risk:` — works but fragile (race, missing
  null check, swallowed error)
- `🔵 nit:` — style, naming. Author can ignore
- `❓ q:` — genuine question, not suggestion

**Drop:**
- "I noticed that...", "It seems like..."
- "This is just a suggestion but..." — use `nit:`
- "Great work!", "Looks good overall but..."
- Restating what the line does
- Hedging ("perhaps", "maybe") — use `q:`

**Keep:**
- Exact line numbers
- Exact symbol names in backticks
- Concrete fix, not "consider refactoring"
- The *why* if fix isn't obvious

## Examples

Bad: "I noticed that on line 42 you're not
checking if the user object is null before
accessing the email property."

Good: `L42: 🔴 bug: user can be null after
.find(). Add guard before .email.`

## Auto-Clarity

Drop terse mode for: security findings
(CVE-class bugs need full explanation),
architectural disagreements, onboarding contexts.

## Boundaries

Reviews only — does not write fix, does not
approve/request-changes, does not run linters.
Output ready to paste into PR. "stop
caveman-review" or "normal mode": revert.

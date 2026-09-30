# Journal 06 — First live smoke: UI bugs only a real backend reveals

**Phase:** manual owner walkthrough of S1–S5 against the real Go
backend + PostgreSQL + Redis in Docker.

## What manual QA found (all fixed)

1. **Invisible primary button text.** Root cause was a *design-token
   collision*: `--color-body` and `--text-body` both generated a
   `text-body` utility class — one a color (`#3c3c43`), the other a
   font size. `AppButton` combined `text-body text-bg`; the dark-gray
   color won the cascade, leaving gray text on a near-black button.
   Lesson: utility-class namespaces for colors and typography must be
   disjoint — the bug was invisible in the token file and only
   manifested on rendered contrast.
2. **OTP paste filled one cell.** `maxlength="1"` truncated the paste
   before the `input` event could distribute it. Fixed with an explicit
   `@paste` handler that reads `clipboardData` and spreads digits
   across cells.
3. **A dead "+ new" folder affordance** — rendered but never wired, and
   folder CRUD isn't in the API contract at all. Removed; UI must not
   promise what the contract can't deliver.

## Lesson

Mock-mode development passed all component tests while hiding a CSS
cascade bug, a paste-event ordering bug, and a phantom feature. The
first real walkthrough found them in minutes — schedule a live smoke
the moment any vertical slice is end-to-end, not at release.

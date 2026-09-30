# OpenGlass Build Journal (Course Material Capture)

This directory captures build journals and design narratives produced
while developing OpenGlass. They serve two purposes:

1. **Project documentation** — durable ADR-style records of why the
   system works the way it does (committed to the repo).
2. **Course material** — source notes for a future educational bundle
   (agent-driven development, contract-first frontend, realtime
   protocols, E2EE) to be produced *after* the MVP ships.

## Languages

- `journal/` and `modules.md` — **English**, committed (per project rule:
  all committed docs are English-only).
- `ru/` — Russian-language course drafts for monetization, **local-only**
  (gitignored). An English edition will be derived for YouTube video
  content later; nothing is published until the text material is complete.

## Cadence

One journal entry per completed phase/issue, written **before** the
knowledge-base refresh (`type:next` vectorization) so each entry feeds
both the course and the Qdrant index in the same pass. See
`AGENTS.md` → Workflow.

## Production plan

Text material first (journal → structured modules), video only after the
text is complete. No parallel course production during MVP.

# Documentation Review Checklist

Standards for PRs that modify files under `docs/` (primarily `docs/architecture/**`).

These rules come from the **Documentation Maintenance** section of `.claude/rules/development-rules.md`. Keep this checklist in sync with that rule file — if the rule changes, this checklist must follow.

---

## 1. Keep all explanations (SHOULD FIX)

Code examples, pattern demonstrations, config snippets, checklists, implementation steps, and cross-references are **explanations**, not clutter. Do not remove them during cleanup even if they look redundant.

**Violation:** PR removes code examples because "the reader can figure it out".
**Fix:** Keep the examples. They are load-bearing.

---

## 2. Remove exhaustive per-item listings (SHOULD FIX)

If the same pattern is repeated for every instance (e.g. listing every wrapper component's API individually), keep one representative example and summarize the rest.

**Violation:** A doc with 40 identically-shaped `lfx-*` wrapper subsections.
**Fix:** Keep one full example, then a summary table or one-line list for the rest.

---

## 3. Remove true duplicates (SHOULD FIX)

If the same code block or configuration appears twice in a file, keep the more detailed version and remove the duplicate.

---

## 4. Replace stale status trackers (SHOULD FIX)

"Implemented / Not Implemented" checklists go stale. Replace them with a concise summary of what is implemented.

**Violation:**

```markdown
- [x] Feature A implemented
- [ ] Feature B not implemented
- [x] Feature C implemented
```

**Fix:**

```markdown
Features A and C are implemented. Feature B is tracked in LFXV2-XXX.
```

---

## 5. Remove aspirational schedules (SHOULD FIX)

"Weekly / Monthly / Quarterly" maintenance schedules that aren't enforced by code don't belong in architecture docs. If a review cadence is genuinely needed, encode it in a process or GitHub action, not prose.

---

## 6. Remove stale version footers (SHOULD FIX)

"Last Updated: YYYY-MM-DD" footers go stale silently. Git history is the source of truth for when a doc changed.

---

## 7. Remove specific benchmark numbers (NIT)

Values like `Current: ~1.5MB ✅` go stale and are hard to maintain. Prefer qualitative statements ("bundle size is tracked in CI and alerts on regression") or link to a live dashboard.

---

## 8. Keep related-documentation and external links (SHOULD FIX — negative)

Cross-references help readers navigate the docs. Do not remove them during cleanup just because they look like "extra".

---

## 9. Keep real-world examples (SHOULD FIX — negative)

Real-world examples are explanations, even if two examples look similar — they usually show different use cases. Do not remove them just because they overlap.

---

## 10. Keep ops debugging commands only if architecture-relevant (SHOULD FIX)

`kubectl` / `snowsql` / runtime debugging commands may stay in `docs/architecture/**` when they help explain system behavior, topology, or component interactions. Otherwise — when they're purely runtime ops recipes — flag them for relocation to the appropriate runbook.

---

## DO NOT FLAG

- Typo fixes or grammar improvements
- Reorganizing sections without content loss
- Adding new sections that document newly-built features
- Deleting entire files where the system they documented has been removed

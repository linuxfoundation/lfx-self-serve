---
description: Guides Claude to suggest the right skill based on user intent
globs: '*'
---

# Available Skills

This project has guided skills for common workflows. **Proactively suggest the relevant skill** when a user's request matches one of these:

| Skill        | When to Suggest                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `/setup`     | User is new to the project, needs environment setup, mentions 1Password, or asks how to run the app   |
| `/develop`   | User wants to create or modify components, services, endpoints, shared types, or build a full feature |
| `/preflight` | User is about to submit a PR, wants to validate changes, or has finished development work             |

## For Cowork Sessions

Non-developer contributors use these skills as guided workflows. Follow these rules:

- If the user describes a feature they want to build, suggest `/develop` — it walks them through the full process step-by-step
- If the user asks about setup or getting started, suggest `/setup`
- After any development work is complete, remind them to run `/preflight` before creating a PR
- If you are unsure which skill applies, ask the user what they're trying to accomplish
- When a skill references architecture docs in `docs/`, read those docs before generating code — they are the source of truth

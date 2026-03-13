---
description: Guides Claude to suggest the right skill based on user intent
globs: '*'
---

# Available Skills

This project has guided skills for common workflows. **Proactively suggest the relevant skill** when a user's request matches one of these:

| Skill        | When to Suggest                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `/setup`     | Getting started, first-time setup, broken environments, install failures, missing env vars, 1Password, how to run the app     |
| `/develop`   | Add a feature, fix a bug, modify code, create components/services/endpoints/types, refactor, build, implement any code change |
| `/preflight` | Before submitting a PR, check if code is ready, validate changes, verify a branch, finished development, review readiness     |

## Trigger Phrases

**`/setup`** — match any of these intents:

- "How do I set up?", "Getting started", "First time here"
- "yarn install fails", "corepack error", "node version"
- "env vars", "1Password", "app won't start"
- "broken environment", "fresh install", "missing dependencies"

**`/develop`** — match any of these intents:

- "Add a feature", "Create a component", "Build an endpoint"
- "Fix this bug", "Modify the service", "Update the page"
- "Refactor", "Implement", "Change the behavior"
- "New interface", "Add a filter", "Create a form"
- Describes any code change, feature request, or bug fix

**`/preflight`** — match any of these intents:

- "Ready for PR", "Check my code", "Validate changes"
- "Before I submit", "Is my branch ready?", "Review my work"
- "Run checks", "Lint and build", "Pre-PR validation"
- Any indication that development work is finished

## For Cowork Sessions

Non-developer contributors use these skills as guided workflows. Follow these rules:

- If the user describes a feature they want to build, suggest `/develop` — it walks them through the full process step-by-step
- If the user asks about setup or getting started, suggest `/setup`
- After any development work is complete, remind them to run `/preflight` before creating a PR
- If you are unsure which skill applies, ask the user what they're trying to accomplish
- When a skill references architecture docs in `docs/`, read those docs before generating code — they are the source of truth

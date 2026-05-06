# Filing Issues

Thank you for helping improve the LFX Self Serve product! This document explains
how to report bugs, request features, and submit task tickets. Taking a few
minutes to follow these guidelines helps maintainers triage and resolve issues
faster — and keeps the community healthy.

## Before You File an Issue

### 1. Get Product Support First

If you have a **question about how to use the product**, please reach out
through the **in-application Intercom support bot** before opening a GitHub
issue. The support bot connects you with the product team and can often resolve
questions much faster than the GitHub issue tracker.

> GitHub issues are reserved for **bugs**, **feature requests**, and **tracked
> tasks** — not general usage questions or "how do I…" inquiries.

### 2. Search for Duplicates

Before opening a new issue, [search existing issues](../../issues) (including
closed ones) to see if the topic has already been reported or discussed. If a
relevant issue exists:

- Add a 👍 reaction to signal your interest rather than posting a "+1" comment.
- Add a comment only if you have new, substantive information (e.g., a different
  reproduction path, an affected version, or a workaround).

### 3. Check the Documentation

Review the project's README, docs site, and any relevant document pages. Your
question or concern may already be addressed.

## Issue Types

> When filing through GitHub's issue chooser, the appropriate label is applied
> automatically. Title prefixes (`[Bug]`, `[Feature]`, `[Task]`) are optional.

### 🐛 Bug Reports

Use this type when something is **broken or behaving unexpectedly**.

**A high-quality bug report includes:**

- **Summary** — A clear, one-sentence description of the problem.
- **Environment** — OS, runtime/language version, package version, browser (if applicable).
- **Steps to Reproduce** — A numbered, minimal list of steps that reliably triggers the issue.
- **Expected Behavior** — What you expected to happen.
- **Actual Behavior** — What actually happened.
- **Logs / Screenshots** — Paste relevant error output in a fenced code block.
  Attach screenshots or screen recordings where helpful.

> **Tip:** If you cannot reproduce the bug consistently, say so. Intermittent
> issues are still valid — just note the frequency and any patterns you've
> observed.

**Example title format:**

```code
[Bug] Login page throws 500 error when email contains a "+" character
```

### ✨ Feature Requests

Use this type when you want to **propose new functionality or a meaningful enhancement** to existing behavior.

**A high-quality feature request includes:**

- **Problem Statement** — Describe the problem or limitation you're facing. Focus on the *why*, not just the *what*.
- **Proposed Solution** — Describe the behavior or interface you'd like to see.
- **Alternatives Considered** — List any workarounds or alternative approaches you've explored and why they fall short.
- **Use Case / Impact** — Explain who benefits and how frequently this situation
  arises. Community use cases help maintainers prioritize.
- **Willingness to Contribute** — If you're open to submitting a pull request,
  say so! Maintainers prioritize requests backed by contributors.

> **Note:** Feature requests are not guarantees of implementation. The
> maintainer team evaluates proposals against project scope, roadmap, and
> available capacity.

**Example title format:**

```code
[Feature] Add a new table filter for the Me Lens -> Events view
```

### 📋 Task Tickets

Use this type for **well-scoped, actionable work items** that don't fit neatly
into bugs or features — such as refactors, documentation updates, dependency
upgrades, CI/CD improvements, or technical debt paydown.

**A high-quality task ticket includes:**

- **Objective** — What is the desired end state?
- **Motivation** — Why does this work matter now?
- **Acceptance Criteria** — A checklist of conditions that define "done."
- **Relevant Context** — Links to related issues, PRs, ADRs, or external references.
- **Estimated Scope** — Small / Medium / Large. Helps with triage and sprint planning.

> **Commit type note:** Task work maps to `build`, `refactor`, `docs`, or `ci` in
> commit messages — not `chore` or `task`, which commitlint does not accept. See
> [CONTRIBUTING.md](CONTRIBUTING.md#commit-messages) for the full list.

**Example title format:**

```code
[Task] Upgrade eslint to v9 and migrate to flat config
```

## Writing Good Issues: Universal Best Practices

| Practice | Why It Matters |
| :-------- | :--------------- |
| **One issue, one concern** | Bundled issues are hard to track, assign, and close cleanly. |
| **Be specific in the title** | Vague titles like "It's broken" are hard to search and triage. |
| **Use code blocks for code and logs** | Unformatted output is hard to read and easy to misinterpret. |
| **Avoid editorializing** | Describe facts, not frustrations. Maintainers are volunteers. |
| **Provide context, not conclusions** | "X is wrong" is less useful than "X produces Y, but I expected Z because of W." |
| **Follow up if asked** | If a maintainer requests more information, respond promptly or the issue may be closed. |
| **Respect the Code of Conduct** | All interactions must comply with this project's Code of Conduct. |

## Issue Lifecycle

```code
Open → Triaged → In Progress → Closed
              ↘ Won't Fix / Duplicate / Needs Info
```

- **Needs Info** — A maintainer requires more details before the issue can be
  triaged. Issues in this state may be closed after extended inactivity.
- **Triaged** — The issue has been reviewed and accepted into the backlog.
- **In Progress** — Actively being worked on; a linked PR may exist.
- **Won't Fix** — Out of scope, by design, or not reproducible. The reasoning
  will be explained in a comment.

## Security Vulnerabilities

**Do not file security vulnerabilities as public GitHub issues.**

Please follow the project's [Security Policy](SECURITY.md) and use GitHub's
[private vulnerability reporting](../../security/advisories/new). Responsible
disclosure protects all users while a fix is prepared.

## Contributing a Fix

Found a bug and want to fix it yourself? We welcome it! Please read
[CONTRIBUTING.md](CONTRIBUTING.md) for:

- How to fork and branch
- Coding standards and linting requirements
- How to write and run tests
- The pull request review process

Linking your PR to the relevant issue with `Closes #<issue-number>` in the PR
description helps maintainers track work and auto-closes the issue on merge.
Pull requests automatically request review from the code owners listed in
[`CODEOWNERS`](CODEOWNERS).

## Helpful Resources

- 📖 [Product Documentation](README.md)
- 💬 [Community Discussions](../../discussions)
- 🔒 [Security Policy](SECURITY.md)
- 🤝 [Contributing Guide](CONTRIBUTING.md)
- 📜 [Code of Conduct](CODE_OF_CONDUCT.md)

*Thank you for your patience and for contributing to the health of this project.*

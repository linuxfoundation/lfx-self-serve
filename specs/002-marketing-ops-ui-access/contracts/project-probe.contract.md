# Contract: Project fetch with marketing probe (Angular ↔ BFF)

**Endpoint**: `GET /api/projects/:slug`

**Change**: add an opt-in marketing probe that enriches the returned `Project` with `marketingAuditor` and `campaignManager` booleans, mirroring the existing `?meeting_coordinator=true` probe.

## Request

| Query param | Type     | Meaning                                                                                                                          |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `marketing` | `"true"` | When present, run `marketing_auditor` and `campaign_manager` checks for the current user on this project and attach the results. |

(Final param name/shape to confirm at task time; `marketing=true` requesting both relations in one batched access-check is preferred over two separate params to keep it to a single upstream round-trip.)

Existing params (`meeting_coordinator`) are unaffected and may be combined.

## Response

`Project` (see `data-model.md`) with, when `marketing=true` was requested:

```jsonc
{
  "uid": "…",
  "slug": "…",
  "writer": false,
  "marketingAuditor": true, // present only when probed
  "campaignManager": false, // present only when probed
}
```

- When `marketing=true` was requested, both fields are **always present as a `boolean`**: `true` = grant, `false` = no grant **or** a transient upstream failure (the probe uses `AccessCheckService.checkAccessOrdered`, a single batched round-trip that is fail-closed and coerces errors to `false`). Fields are `undefined` **only** when the probe was not requested. Callers MUST NOT treat `undefined` (unrequested) as denial; guards that DID request the probe treat `!== true` as no access (fail closed).

## Angular consumer

`ProjectService.getProject(slug, current, options)` gains a `marketing?: boolean` option:

```
getProject(slug, false, { marketing: true }) → Observable<Project | null>
```

- Cache key MUST include the marketing flag (as it already includes `:mc` for meeting-coordinator) so a marketing-probed fetch is not served from a non-probed cache entry, and vice-versa.
- Shared via `shareReplay(1)` so a guard and the page/section reading the same signal do not double-probe.

## Guards

| Guard                 | Requests                                       | Grants when                         |
| --------------------- | ---------------------------------------------- | ----------------------------------- |
| `marketingViewGuard`  | `getProject(slug, false, { marketing: true })` | `project.marketingAuditor === true` |
| `campaignAccessGuard` | `getProject(slug, false, { marketing: true })` | `project.campaignManager === true`  |

- Slug source: `route.queryParamMap.get('project') ?? activeContext()?.slug`.
- Denial: redirect to `/foundation/overview` with `?project=<slug>` preserved (no lens switch), matching `newsletterAccessGuard`.
- No ED persona fast-path (per-project correctness).

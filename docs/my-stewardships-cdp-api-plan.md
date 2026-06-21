# My Stewardships — CDP API Requirements

**Feature:** New "My Stewardships" page in LFX One (PCC)  
**Author:** Gašper Grom  
**Date:** 2026-06-20  
**Target repo:** `crowd.dev` (CDP backend — `backend/src/api/public/v1/akrites/`)

---

## Overview

The "My Stewardships" page gives an authenticated LFX user a personal view of the packages they steward (as `lead` or `co_steward`). It is distinct from the admin-scoped **Akrites Program** dashboard, which shows all packages across all stewards.

The page has two states:

- **Data state** — user has at least one active stewardship
- **Empty state** — user has no stewardships yet; shows an onboarding flow and suggested packages to claim

---

## Design Reference

Prototype: https://linuxfoundation-dxwx.dsp.so/g689Awpb-akrites-design-prototype (click "My Stewardships" in the left nav)

### Data State

```
My Stewardships  [Data] [Empty]                    ⓘ How it works  [Claim package stewardship]
Packages you steward across the Akrites program. Run assessments, post status updates, and respond to advisories.

Latest activity
Recent events on packages you steward that need your attention.

┌─────────────────────────┐  ┌─────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
│ 🔶 Needs attention       │  │ 🔴 Blocked               │  │ 🔴 Escalated             │  │ 🟣 Assessing             │
│ jackson-databind         │  │ node-fetch               │  │ minimist                 │  │ org.slf4j:slf4j-api      │
│ New security advisory    │  │ Blocker awaiting your    │  │ Escalation in progress   │  │ Assessment in progress   │
│ detected · 3h ago        │  │ resolution · 5d ago      │  │ — add context · 1d ago   │  │ — submit when ready      │
│                          │  │                          │  │                          │  │ · 2h ago                 │
│ [Review & respond] [···] │  │ [Resolve blocker] [···]  │  │ [Add escalation context] │  │ [Continue assessment]    │
└─────────────────────────┘  └─────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘

🔍 Search my packages...

[All 6] [Assessing 1] [Active 2] [Needs attention 1] [Escalated 1] [Blocked 1]    Sort: Risk priority ↓  [Filter]

PACKAGE              ECOSYSTEM   LIFECYCLE   HEALTH          OPEN VULNS    LAST ACTIVITY                  STEWARDSHIP
minimist             npm         Abandoned   Critical (18)   2 High        Escalated for intervention     [Escalated]
pkg:npm/minimist                                                           1d ago
node-fetch           npm         Declining   Concerning(34)  1 High        Assessment blocked             [Blocked]
pkg:npm/node-fetch                                                         5d ago
jackson-databind     Maven       Active      Fair (64)       1 High        New security advisory          [Needs attention]
...                                                                        3h ago
org.apache.logging   Maven       Active      Healthy (80)    —             Posted quarterly status update [Active]
...                                                                        6d ago
express              npm         Active      Healthy (78)    —             Logged remediation progress    [Active]
...                                                                        4h ago
```

### Empty State

```
My Stewardships  [Data] [Empty]

┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              🛡                                                                        │
│                  Start securing the open source you rely on                                          │
│  As a steward, you take responsibility for a critical open source package's security...              │
│                                                                                                      │
│  1 ──── 2 ──── 3 ──── 4 ──── 5                                                                      │
│  Claim a package  Run the assessment  Submit to go Active  Stay engaged  Escalate or step down       │
│                                                                                                      │
│                          [Claim package stewardship]                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘

Suggested packages to claim                                                                     [<] [>]
Based on the projects, organizations, and contributions on your LFX profile.

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ...
│ glob             │  │ semver           │  │ lodash           │  │ debug            │
│ pkg:npm/glob     │  │ pkg:npm/semver   │  │ pkg:npm/lodash   │  │ pkg:npm/debug    │
│ Common dep in    │  │ Used by nearly   │  │ Top transitive   │  │ Pulled in by     │
│ npm projects you │  │ every package    │  │ dep in your org  │  │ Express, which   │
│ contribute to    │  │ you maintain     │  │ apps             │  │ you already stew │
│ [npm] [Claim]    │  │ [npm] [Claim]    │  │ [npm] [Claim]    │  │ [npm] [Claim]    │
└──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## Existing CDP Endpoints (already implemented)

All under `GET /v1/akrites/*`, auth via OAuth2 bearer token.

| Endpoint                                     | What it returns                                 |
| -------------------------------------------- | ----------------------------------------------- |
| `GET /v1/akrites/packages`                   | All packages, all stewards, paginated           |
| `GET /v1/akrites/packages/detail?purl=`      | Single package detail with stewards             |
| `GET /v1/akrites/packages/metrics`           | Global totals (totalPackages, criticalPackages) |
| `GET /v1/akrites/packages/scatter`           | Scatter plot data (health × impact)             |
| `GET /v1/akrites/activity`                   | Global activity feed, all packages              |
| `POST /v1/akrites/stewardships/open`         | Create/open a stewardship                       |
| `POST /v1/akrites/stewardships/:id/assign`   | Assign a steward to a stewardship               |
| `PATCH /v1/akrites/stewardships/:id/status`  | Update stewardship status                       |
| `POST /v1/akrites/stewardships/:id/escalate` | Escalate a stewardship                          |

**Critical gap:** None of the existing read endpoints filter by the requesting user. `req.actor.id` is captured only for write/audit purposes. The `stewardship_stewards` table has a `user_id` column and an index on it (`(user_id) WHERE deleted_at IS NULL`), so user-scoped queries are fast — they just need to be wired up.

---

## New Endpoints Required

### 1. My Stewardship Packages

**`GET /v1/akrites/stewardships/me/packages`**

Returns packages where the authenticated user (`req.actor.id`) is an active steward (`deleted_at IS NULL` in `stewardship_stewards`). The user may be `lead` or `co_steward`.

#### Query parameters

| Param          | Type    | Default | Description                                                                                                                                                                                      |
| -------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page`         | integer | 1       | Page number                                                                                                                                                                                      |
| `pageSize`     | integer | 25      | Results per page (max 100)                                                                                                                                                                       |
| `status`       | string  | `all`   | Filter by stewardship status: `assessing`, `active`, `needs_attention`, `escalated`, `blocked` (note: `unassigned` / `open` are excluded — user cannot steward a package without being assigned) |
| `search`       | string  | —       | Filter by package name (case-insensitive prefix/contains)                                                                                                                                        |
| `ecosystem`    | string  | —       | One of: `npm`, `maven`, `pypi`, `go`, `cargo`                                                                                                                                                    |
| `healthBand`   | string  | —       | `healthy` (≥70), `fair` (50–69), `concerning` (30–49), `critical` (<30)                                                                                                                          |
| `vulnSeverity` | string  | —       | `high`, `critical` (filter to packages with at least one vuln of this severity)                                                                                                                  |
| `sortBy`       | string  | `risk`  | `risk`, `health`, `vulns`, `name`, `last_activity`                                                                                                                                               |
| `sortDir`      | string  | auto    | `asc` or `desc`                                                                                                                                                                                  |

#### Response shape

```json
{
  "data": [
    {
      "purl": "pkg:npm/minimist",
      "name": "minimist",
      "ecosystem": "npm",
      "lifecycle": "abandoned",
      "healthScore": 18,
      "openVulns": 2,
      "vulnSeverity": "high",
      "lastActivityDescription": "Escalated for intervention",
      "lastActivityAt": "2026-06-19T10:00:00Z",
      "stewardshipId": 42,
      "stewardshipStatus": "escalated",
      "myRole": "lead"
    }
  ],
  "meta": {
    "total": 6,
    "page": 1,
    "pageSize": 25,
    "statusCounts": {
      "assessing": 1,
      "active": 2,
      "needs_attention": 1,
      "escalated": 1,
      "blocked": 1
    }
  }
}
```

> **Note:** `myRole` indicates whether the user is `lead` or `co_steward`. No `stewards` array needed here — the user already knows they are the steward.

#### Implementation hint

```sql
SELECT p.*, s.id AS stewardship_id, s.status AS stewardship_status,
       ss.role AS my_role,
       last_act.content AS last_activity_description,
       last_act.created_at AS last_activity_at
FROM stewardship_stewards ss
JOIN stewardships s ON s.id = ss.stewardship_id
JOIN packages p ON p.id = s.package_id
LEFT JOIN LATERAL (
  SELECT content, created_at FROM stewardship_activity
  WHERE stewardship_id = s.id
  ORDER BY created_at DESC LIMIT 1
) last_act ON true
WHERE ss.user_id = $actorUserId
  AND ss.deleted_at IS NULL
  -- optional filters: AND s.status = $status, AND p.ecosystem = $ecosystem, etc.
ORDER BY ...
LIMIT $pageSize OFFSET ($page - 1) * $pageSize
```

---

### 2. My Stewardship Activity Feed

**`GET /v1/akrites/stewardships/me/activity`**

Returns the activity feed scoped to packages where the authenticated user is an active steward. This powers both:

- The **"Latest activity" cards** at the top of the data state (frontend will filter client-side or backend can accept a `statusFilter` param to return only attention-needed statuses)
- A potential "load more" activity list

#### Query parameters

| Param      | Type     | Default | Description                                                                                                                |
| ---------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `page`     | integer  | 1       | Page number                                                                                                                |
| `pageSize` | integer  | 25      | Results per page (max 100)                                                                                                 |
| `status`   | string[] | —       | Comma-separated stewardship statuses to filter (e.g. `needs_attention,blocked,escalated,assessing` for the activity cards) |

#### Response shape

Same structure as existing `GET /v1/akrites/activity`, but scoped to user's packages:

```json
{
  "data": [
    {
      "stewardshipId": 42,
      "packageName": "jackson-databind",
      "purl": "pkg:maven/com.fasterxml.jackson.core/jackson-databind",
      "stewardshipStatus": "needs_attention",
      "activityType": "advisory_detected",
      "description": "New security advisory detected",
      "createdAt": "2026-06-20T11:00:00Z"
    }
  ],
  "meta": {
    "total": 12,
    "page": 1,
    "pageSize": 25
  }
}
```

#### Implementation hint

```sql
SELECT sa.*, p.name AS package_name, p.purl, s.status AS stewardship_status
FROM stewardship_activity sa
JOIN stewardships s ON s.id = sa.stewardship_id
JOIN packages p ON p.id = s.package_id
WHERE s.id IN (
  SELECT stewardship_id FROM stewardship_stewards
  WHERE user_id = $actorUserId AND deleted_at IS NULL
)
-- optional: AND s.status = ANY($statusFilter)
ORDER BY sa.created_at DESC
LIMIT $pageSize OFFSET ($page - 1) * $pageSize
```

---

### 3. Suggested Packages to Claim

**`GET /v1/akrites/stewardships/me/suggested`**

Returns critical unstearded (or open) packages suggested for the authenticated user to claim. Powers the "Suggested packages to claim" carousel in the empty state.

This is the most complex endpoint. Suggestions should be ranked by relevance to the user. The recommended approach is a scored priority system:

#### Suggestion scoring (highest priority first)

| Priority | Signal                                                                                                      | How to detect                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1        | Package has no active stewards (`status = 'unassigned'` or `'open'`) AND user already contributes to it     | Cross-reference with LFX member contributions (see note below) |
| 2        | Package is a direct dependency of an LFX project the user is a maintainer of                                | LFX project → dependency graph lookup                          |
| 3        | Package is commonly depended on by the user's organization                                                  | LFX org → project → dependency lookup                          |
| 4        | Package is a transitive dependency of projects the user contributes to                                      | Broader dependency graph                                       |
| 5        | Package is critical (`is_critical = true`), unstearded, in the same ecosystem as user's most-used ecosystem | Fallback by ecosystem affinity                                 |

#### Query parameters

| Param       | Type    | Default | Description                                                   |
| ----------- | ------- | ------- | ------------------------------------------------------------- |
| `pageSize`  | integer | 10      | Number of suggestions to return (carousel shows ~6 at a time) |
| `page`      | integer | 1       | Page for carousel pagination                                  |
| `ecosystem` | string  | —       | Optional filter by ecosystem                                  |

#### Response shape

```json
{
  "data": [
    {
      "purl": "pkg:npm/glob",
      "name": "glob",
      "namespace": "npm",
      "ecosystem": "npm",
      "description": "Common dependency across the npm projects you contribute to",
      "stewardshipStatus": "unassigned",
      "suggestionReason": "common_contribution_dependency"
    }
  ],
  "meta": {
    "total": 24,
    "page": 1,
    "pageSize": 10
  }
}
```

> **Note on LFX profile integration:** Detecting "packages the user contributes to" requires either:
>
> - Querying the LFX member/contributions service (Go microservice upstream), or
> - Using data already in the CDP `packages` / `members` tables if contribution data is ingested.
>
> **Minimum viable fallback (V1):** Return unstearded critical packages sorted by `impact DESC`, filtered to ecosystems where the user has at least one active stewardship. If the user has no stewardships (empty state), return the top critical unstearded packages globally with generic descriptions. The `description` field can be system-generated based on the `suggestionReason`.
>
> **V2 enhancement:** Integrate LFX member profile data to personalize suggestions.

---

## Summary Table

| #   | Endpoint                                   | Scope                                     | New?   | Priority                               |
| --- | ------------------------------------------ | ----------------------------------------- | ------ | -------------------------------------- |
| 1   | `GET /v1/akrites/stewardships/me/packages` | User's stewarded packages + status counts | ✅ New | P0 — needed for data state             |
| 2   | `GET /v1/akrites/stewardships/me/activity` | Activity feed for user's packages         | ✅ New | P0 — needed for Latest activity cards  |
| 3   | `GET /v1/akrites/packages/suggested`       | Suggested packages for empty state        | ✅ New | P1 — needed for empty state onboarding |

---

## Auth & Scope Notes

- All three endpoints must read `req.actor.id` (Auth0 `sub` from the bearer token) and use it to filter `stewardship_stewards.user_id`.
- Required scope for all three: `READ_STEWARDSHIPS` (existing scope, already defined in `backend/src/security/scopes.ts`)
- No new OAuth scopes are needed.
- The `req.actor` pattern is already established in write endpoints — extend the same pattern to these read endpoints.

---

## No Schema Changes Required

All data needed for these endpoints is already present in the database:

| Table                     | Used for                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| `stewardship_stewards`    | Filter by `user_id` to get current user's stewardships                   |
| `stewardships`            | Status, opened_at, status_note                                           |
| `packages`                | Package metadata (name, purl, ecosystem, lifecycle, healthScore, impact) |
| `stewardship_activity`    | Latest activity description + timestamp                                  |
| `stewardship_assessments` | Needed if "Continue assessment" action needs assessment ID               |

The `(user_id) WHERE deleted_at IS NULL` index on `stewardship_stewards` already exists — queries will be fast.

---

## LFX One Integration Plan (frontend, for context)

Once the CDP endpoints are live, the frontend work will:

1. Add `GET /api/akrites/stewardships/me/packages` BFF proxy route in `apps/lfx-one/src/server/routes/akrites.route.ts`
2. Add `GET /api/akrites/stewardships/me/activity` BFF proxy route
3. Add `GET /api/akrites/stewardships/me/suggested` BFF proxy route
4. Create a new `akrites-my-stewardships` module/page under `apps/lfx-one/src/app/modules/akrites/`
5. Reuse existing shared components: activity cards, package table rows, status badges, stewardship drawer

The "Claim package stewardship" button will reuse the existing `POST /api/akrites/stewardships` endpoint.

---

## Questions for CDP Developer

1. **Suggested packages (endpoint 3):** What LFX member data is available in the CDP database to power personalized suggestions? Can we join on a contributions or member-project table, or do we need to call an upstream microservice?
2. **Activity card logic:** The design shows exactly one activity card per attention-needed status. Should endpoint 2 return the latest activity per status (group by status, latest per group) or just a flat list that the frontend filters?
3. **`me` vs `mine` naming:** Is `/stewardships/me/` or `/stewardships/mine/` the preferred convention in this codebase? Current write endpoints use `/:id/` style.
4. **Ecosystem affinity for suggestions:** If no LFX profile data is available yet, is it acceptable to return top critical unstearded packages globally as a V1 fallback?

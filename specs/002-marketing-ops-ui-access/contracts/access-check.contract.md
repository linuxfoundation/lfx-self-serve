# Contract: Access-Check (BFF ↔ upstream OpenFGA)

**Layer**: Express BFF `AccessCheckService` → `LFX_V2_SERVICE` `POST /access-check`

**Change**: extend the access-type union so the two marketing relations can be probed. No change to the wire format of `/access-check` itself.

## Request (unchanged shape)

`AccessCheckService.checkAccess(req, resources)` builds one probe string per resource:

```text
<resource>:<id>#<access>
```

New valid `<access>` values for `resource = project`:

- `marketing_auditor`
- `campaign_manager`

Example batched payload for one project (both relations in a single round-trip):

```json
{
  "requests": ["project:<project_uid>#marketing_auditor", "project:<project_uid>#campaign_manager"]
}
```

## Response (unchanged shape)

```json
{
  "results": ["project:<project_uid>#marketing_auditor@user:<username>\ttrue", "project:<project_uid>#campaign_manager@user:<username>\tfalse"]
}
```

Because both probes target the same project UID, the two marketing relations MUST be parsed
**positionally** into a `boolean[]` (results align to the request order) via
`AccessCheckService.checkAccessOrdered`, NOT the id-keyed `Map<id, boolean>` returned by
`checkAccess` — an id-keyed map would collapse the two same-UID entries into one. `checkAccess`
(the map form) remains correct only when each request targets a distinct id.

## Behavioral guarantees

- **Fail closed**: on upstream error/timeout, `checkAccess` returns all-`false` (existing fallback). Callers MUST treat this as no access.
- **ED resolution**: because the upstream model defines `marketing_auditor` and `campaign_manager` to include `executive_director`, EDs return `true` for their own projects with no persona logic in the BFF.
- **Cascade**: hierarchy cascade for `marketing_auditor` (and `campaign_manager` via `marketing_ops`) is resolved upstream; the BFF probes a single project UID and receives the effective result.

## ROOT marketing signal

`PersonaDetectionService.checkRootMarketingAuditor(req)`:

- Resolves the ROOT project UID (reuse existing `resolveRootUid`).
- Returns `checkSingleAccess(req, { resource: 'project', id: rootUid, access: 'marketing_auditor' })`.
- Fail closed to `false` on error (mirrors `checkRootWriter`).
- Surfaced on the personas API response as `isRootMarketingAuditor`.

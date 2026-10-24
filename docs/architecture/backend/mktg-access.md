# Marketing kit Access

`GET /api/mktg-agents/access?project=<uid>` requires the project's writer annotation
and reads settings once for the server-resolved project. It returns display-only
writers, nullable `executiveDirector`, nullable `tocChair`, and `warnings`. Settings
failures are typed failures, not empty lists. Omitted `writers` means zero writers
(upstream omits empty fields); a present non-array value is malformed. Optional names
fall back to the trimmed username, or an empty display name for the consuming UI.
Email is used in memory only to match username-less manual entries. Each writer's
`isExecutiveDirector` flag lets the browser merge roles without comparing display names
or receiving email. This response describes project settings, not a new entitlement
or approval policy. The Access tab and its presentation remain a separate, held child.

The named `MktgAccessService.resolveTocChair()` seam deliberately returns null until
`mktg-project-roles.service.ts` is wired; the response's `tocChair` is currently always
null. There is no second committee lookup. The lazy route memoizes one controller,
which shares its single `ProjectService` with the Access service.
The controller's private `resolveAccessProject(req, projectUid, operation)` checks the
writer annotation in the same shape as the Requests controller, without importing it.
Typed upstream authentication/authorization failures keep their 401/403 status and
code, without forwarding upstream messages or bodies. Missing settings remain a typed
404 (`ResourceNotFoundError` is preserved unchanged). Transport failures, other upstream
outages and malformed settings return contextual `MKTG_ACCESS_UNAVAILABLE` (502), never
an empty successful list. Failure logs contain only the project and upstream status/code;
no settings payload, upstream message or error cause is retained. Only a successful
settings read with zero or omitted writers returns an empty `writers` array.

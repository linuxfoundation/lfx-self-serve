# Marketing kit Access

`GET /api/mktg-agents/access?project=<uid>` requires the project's writer annotation
and reads settings once for the server-resolved project. It returns display-only
writers and the executive director; settings failures are typed failures, not empty lists.
Email is used in memory only to match username-less manual entries. Each writer's
`isExecutiveDirector` flag lets the browser merge roles without comparing display names
or receiving email. This response describes project settings, not a new entitlement
or approval policy. The Access tab and its presentation remain a separate, held child.

The named `MktgAccessService.resolveTocChair()` seam deliberately returns null until
`mktg-project-roles.service.ts` is wired; there is no second committee lookup.
The controller's private `resolveAccessProject(req, projectUid, operation)` checks the
writer annotation in the same shape as the Requests controller, without importing it.
Malformed settings or upstream read failures return `MKTG_ACCESS_UNAVAILABLE` (502),
never an empty successful list. Only a successful settings read with zero writers
returns an empty `writers` array.

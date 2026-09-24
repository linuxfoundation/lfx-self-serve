# LFX Insights API Tokens

## Overview

Key Contacts of a member organization create long-lived `lfi_…` tokens for the LFX Insights public API from **Profile → Settings → Developer Settings**. The BFF is a thin proxy over two upstream services and adds one server-side rule: only a Key Contact may create a token.

The Developer Settings UI for these endpoints ships separately and will be gated by the `insights-public-api` LaunchDarkly flag (`INSIGHTS_PUBLIC_API_FLAG`, default `false`). The flag is UI-only; it does not gate these routes.

## Endpoints

All four routes live in `profile.route.ts` and are handled by `insights-tokens.controller.ts`. While impersonating, list and eligibility stay readable and resolve to the impersonated user (the list is metadata only and never carries a secret). Create and revoke are mounted with `blockDuringImpersonation`: a minted token is a live credential the impersonator would keep, and neither call carries the impersonator's identity upstream. `profile.route.spec.ts` pins that split. List, eligibility and create responses set `Cache-Control: no-store`. Revoke returns an empty `204`.

| Route                                          | Upstream call                                          | Token     |
| ---------------------------------------------- | ------------------------------------------------------ | --------- |
| `GET /api/profile/insights-tokens`             | PAT service `GET /tokens?audience=insights`            | User      |
| `GET /api/profile/insights-tokens/eligibility` | Member service `GET /b2b_orgs/member-tiers/{username}` | M2M       |
| `POST /api/profile/insights-tokens`            | Eligibility check, then PAT service `POST /tokens`     | M2M, User |
| `DELETE /api/profile/insights-tokens/:uid`     | PAT service `DELETE /tokens/{uid}`                     | User      |

Both upstreams are reached through `LFX_V2_SERVICE`, so no new env var is needed. The BFF always sets `audience: "insights"` itself; the client never sends it. Upstream snake_case is mapped to camelCase in `insights-tokens.service.ts`.

## Eligibility (Key Contact check)

The member-tiers endpoint returns one entry per org where the user is a Key Contact. It accepts only M2M callers in the FGA team `member_tiers_caller`. The service therefore generates an M2M token and passes it as `{ bearerToken }` through `ApiRequestOptions`; it never mutates `req.bearerToken`. See "Authentication: User Tokens vs M2M Tokens" in `.claude/rules/development-rules.md`.

- Any entry with a non-empty `company_name` makes the user eligible. The `tier` value is not inspected.
- An empty list, or a session with no username, returns `INSIGHTS_TOKEN_INELIGIBLE`, which has `checkFailed: false`.
- An upstream or M2M error fails closed with `INSIGHTS_TOKEN_ELIGIBILITY_UNAVAILABLE`. That value has `canCreate: false` and `checkFailed: true`. The error is logged at warning level.

`checkFailed` lets the UI tell apart "you are not a Key Contact" (lock notice) from "we could not verify right now" (retryable notice).

## Create flow

`POST` does not trust the UI gate. It re-runs the eligibility check server-side before calling the PAT service:

1. It validates `name`: trimmed, 1–`INSIGHTS_TOKEN_NAME_MAX_LENGTH` characters, with no C0 control characters or DEL. A bad name returns `400`.
2. If `checkFailed` is set, it returns `503 SERVICE_UNAVAILABLE` with `upstreamCode: eligibility_unavailable`.
3. If `!canCreate`, it returns `403` with `upstreamCode: not_key_contact`.
4. Otherwise it calls PAT service create and returns `201 { token, secret }`.

PAT service `409` errors (`token_name_taken`, `token_limit_reached`) pass through `MicroserviceError` as `upstreamCode`. The codes are listed in `INSIGHTS_TOKEN_ERROR_CODES`.

The secret is returned exactly once, and only by create; list responses carry `lookupId` but never the secret. Tokens do not expire; they stay valid until revoked.

List and revoke are **not** gated on eligibility. A user who loses Key Contact status can still see and revoke their existing tokens.

## Related Documentation

- [Error Handling](./error-handling-architecture.md) — `MicroserviceError` and `upstreamCode`
- [Impersonation](./impersonation.md) — `blockDuringImpersonation`
- [Feature Flags](../frontend/feature-flags.md) — `getBooleanFlag`
- Upstream contracts: `linuxfoundation/lfx-v2-pat-service` (`docs/api.md`) and `linuxfoundation/lfx-v2-member-service` (`gen/http/openapi3.yaml`)

# LFX Insights API Tokens

## Overview

Key Contacts of a member organization create long-lived `lfi_…` tokens for the LFX Insights public API from **Profile → Settings → Developer Settings**. The BFF is a thin proxy over two upstream services and adds one server-side rule: only a Key Contact may list, create or revoke tokens.

The UI group (`lfx-insights-tokens`) is gated by the `insights-public-api` LaunchDarkly flag (`INSIGHTS_PUBLIC_API_FLAG`). The flag defaults to `false`, so SSR renders nothing. `AccountSettingsComponent` also holds the flag at `false` until `afterNextRender`, so a non-production localStorage override cannot render the group on the first client pass and mismatch the SSR DOM.

## Endpoints

All four routes live in `profile.route.ts` and are handled by `insights-tokens.controller.ts`. While impersonating, list and eligibility stay readable and resolve to the impersonated user (the list is metadata only and never carries a secret). Create and revoke are mounted with `blockDuringImpersonation`: a minted token is a live credential the impersonator would keep, and neither call carries the impersonator's identity upstream. `profile.route.spec.ts` pins that split. The UI loads eligibility first, lists tokens only for a Key Contact, and disables the create and revoke buttons while impersonating. List, eligibility and create responses set `Cache-Control: no-store`. Revoke returns an empty `204`.

| Route                                          | Upstream call                                                       | Token     |
| ---------------------------------------------- | ------------------------------------------------------------------- | --------- |
| `GET /api/profile/insights-tokens`             | Eligibility check, then PAT service `GET /tokens?audience=insights` | M2M, User |
| `GET /api/profile/insights-tokens/eligibility` | Member service `GET /b2b_orgs/member-tiers/{username}`              | M2M       |
| `POST /api/profile/insights-tokens`            | Eligibility check, then PAT service `POST /tokens`                  | M2M, User |
| `DELETE /api/profile/insights-tokens/:uid`     | Eligibility check, then PAT service `DELETE /tokens/{uid}`          | M2M, User |

Both upstreams are reached through `LFX_V2_SERVICE`, so no new env var is needed. The BFF always sets `audience: "insights"` itself; the client never sends it. Upstream snake_case is mapped to camelCase in `insights-tokens.service.ts`.

## Eligibility (Key Contact check)

The member-tiers endpoint returns one entry per org where the user is a Key Contact. It accepts only M2M callers in the FGA team `member_tiers_caller`. The service therefore generates an M2M token and passes it as `{ bearerToken }` through `ApiRequestOptions`; it never mutates `req.bearerToken`. See "Authentication: User Tokens vs M2M Tokens" in `.claude/rules/development-rules.md`.

- Any entry with a non-empty `b2b_org_uid` makes the user eligible. The `tier` value is not inspected. `company_name` is optional upstream; when it is missing the org is returned without a `name`, and the UI does not show one.
- An empty list, or a session with no username, returns `INSIGHTS_TOKEN_INELIGIBLE`, which has `checkFailed: false`.
- An upstream or M2M error, a successful response that is not a list, or a non-empty list with no usable `b2b_org_uid` fails closed with `INSIGHTS_TOKEN_ELIGIBILITY_UNAVAILABLE`. That value has `canCreate: false` and `checkFailed: true`. The failure is logged at warning level with only its status and error code, because the tier URL, and so the error's path, carries the username.

`checkFailed` lets the UI tell apart "you are not a Key Contact" (lock notice) from "we could not verify right now" (retryable notice). The Angular service maps a failed eligibility request to the same unavailable value.

## Create flow

`POST` does not trust the UI gate. The controller validates the name, and `InsightsTokensService.createToken` re-runs the eligibility check before calling the PAT service, so every caller of the service gets the same enforcement:

1. The controller validates `name`: trimmed, 1–`INSIGHTS_TOKEN_NAME_MAX_LENGTH` characters counted as code points (the PAT service counts runes), with no C0 control characters or DEL. A bad name returns `400`.
2. If `checkFailed` is set, it returns `503 SERVICE_UNAVAILABLE` with `upstreamCode: eligibility_unavailable`.
3. If `!canCreate`, it returns `403` with `upstreamCode: not_key_contact`.
4. Otherwise it calls PAT service create and returns `201 { token, secret }`.

PAT service `409` errors (`token_name_taken`, `token_limit_reached`) pass through `MicroserviceError` as `upstreamCode`. The create dialog maps each code in `INSIGHTS_TOKEN_ERROR_CODES` to an inline message. Before rethrowing, the service drops the refusal's prose, keeping only status and code (the `withoutUpstreamBody` approach from `cla.service.ts`), because a `token_name_taken` message repeats the token name and the error handler logs both `message` and `error_body`.

The secret is returned exactly once. It exists only in the reveal dialog's data, and the list displays `lfi_{lookupId}` followed by a mask. Tokens do not expire; they stay valid until revoked.

## Key Contact gate on every token call

List, create and revoke all run the same check, `InsightsTokensService.assertKeyContact`, before calling the PAT service, and fail with the same `503 eligibility_unavailable` or `403 not_key_contact` described above. Only the eligibility endpoint is ungated, because the UI needs it to explain why the group is locked.

A user who loses Key Contact status therefore loses access to their existing tokens too: they can no longer list or revoke them. This is a product decision. The tokens stay valid at the PAT service until revoked some other way (the PAT service, or an admin), but they stop working against the Insights API. The Insights Worker re-checks org and tier on every exchange and fails closed with a `403` once its tier cache expires (about 10 minutes), per [Insights ADR-0010](https://github.com/linuxfoundation/insights/pull/1879). That ADR also expects Self-Serve to revoke a user's PATs when their membership lapses; nothing does that automatically yet.

The `insights-public-api` LaunchDarkly flag is enforced in the UI only. The server has only env-var flags (`server-feature-flag.helper.ts`), which cannot target individual users, so the server gate is Key Contact status alone.

## Related Documentation

- [Error Handling](./error-handling-architecture.md) — `MicroserviceError` and `upstreamCode`
- [Impersonation](./impersonation.md) — `blockDuringImpersonation`
- [Feature Flags](../frontend/feature-flags.md) — `getBooleanFlag`
- Upstream contracts: `linuxfoundation/lfx-v2-pat-service` (`docs/api.md`) and `linuxfoundation/lfx-v2-member-service` (`gen/http/openapi3.yaml`)

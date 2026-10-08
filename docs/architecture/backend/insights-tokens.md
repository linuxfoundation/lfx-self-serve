# LFX Insights API Tokens

## Overview

Key Contacts of a member organization create long-lived `lfi_…` tokens for the LFX Insights public API from **Profile → Settings → Developer Settings**. The BFF is a thin proxy over two upstream services and adds one server-side rule: only a Key Contact, or a user the `insights-public-api-token-access` flag targets (see [Flag bypass](#flag-bypass)), may list, create or revoke tokens.

The UI group (`lfx-insights-tokens`) is gated by the `insights-public-api` LaunchDarkly flag (`INSIGHTS_PUBLIC_API_FLAG`). This flag controls visibility only and grants no access. The flag defaults to `false`, so SSR renders nothing. `AccountSettingsComponent` also holds the flag at `false` until `afterNextRender`, so a non-production localStorage override cannot render the group on the first client pass and mismatch the SSR DOM.

## Endpoints

All four routes live in `profile.route.ts` and are handled by `insights-tokens.controller.ts`. While impersonating, list and eligibility stay readable and resolve to the impersonated user (the list is metadata only and never carries a secret). Create and revoke are mounted with `blockDuringImpersonation`: a minted token is a live credential the impersonator would keep, and neither call carries the impersonator's identity upstream. `profile.route.spec.ts` pins that split. The UI loads eligibility first, lists tokens only for a Key Contact, and disables the create and revoke buttons while impersonating. List, eligibility and create responses set `Cache-Control: no-store`. Revoke returns an empty `204`.

| Route                                          | Upstream call                                                                      | Token     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | --------- |
| `GET /api/profile/insights-tokens`             | Eligibility check, then PAT service `GET /tokens?audience=insights`                | M2M, User |
| `GET /api/profile/insights-tokens/eligibility` | Member service `GET /b2b_orgs/member-tiers/{username}` (skipped for flagged users) | M2M       |
| `POST /api/profile/insights-tokens`            | Eligibility check, then PAT service `POST /tokens`                                 | M2M, User |
| `DELETE /api/profile/insights-tokens/:uid`     | Eligibility check, then PAT service `DELETE /tokens/{uid}`                         | M2M, User |

Both upstreams are reached through `LFX_V2_SERVICE`, so they need no env var of their own. Only the flag bypass reads one, `LD_SDK_KEY` (see [Flag bypass](#flag-bypass)). The BFF always sets `audience: "insights"` itself; the client never sends it. Upstream snake_case is mapped to camelCase in `insights-tokens.service.ts`.

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

List, create and revoke all run the same check, `InsightsTokensService.assertKeyContact` (which a flagged user passes, see [Flag bypass](#flag-bypass)), before calling the PAT service, and fail with the same `503 eligibility_unavailable` or `403 not_key_contact` described above. Only the eligibility endpoint is ungated, because the UI needs it to explain why the group is locked.

A user who loses Key Contact status therefore loses access to their existing tokens too: they can no longer list or revoke them. This is a product decision. The tokens stay valid at the PAT service until revoked some other way (the PAT service, or an admin), but they stop working against the Insights API. The Insights Worker re-checks org and tier on every exchange and fails closed with a `403` once its tier cache expires (about 10 minutes), per [Insights ADR-0010](https://github.com/linuxfoundation/insights/pull/1879). That ADR also expects Self-Serve to revoke a user's PATs when their membership lapses; nothing does that automatically yet.

Visibility and access use separate LaunchDarkly flags. `insights-public-api` is evaluated in the browser for visibility only. `insights-public-api-token-access` (`INSIGHTS_PUBLIC_API_TOKEN_ACCESS_FLAG`) is evaluated on the server for access. Widening the visibility flag to launch the group never widens who may use the token endpoints.

### Flag bypass

Users the `insights-public-api-token-access` flag targets can do anything a Key Contact can in this group. They also need `insights-public-api` to see the group. `InsightsTokensService.getEligibility` first asks `LaunchDarklyServerService.isFlagEnabled` (`@launchdarkly/node-server-sdk`) whether the access flag is on for the session user. If it is, it returns `INSIGHTS_TOKEN_FLAG_ELIGIBLE` (`canCreate: true`, no orgs) without calling member-service, so every `assertKeyContact` call passes.

- The context is `{ kind: 'user', key }`, where the server derives `key` exactly like the browser's `targetingKey`: `preferred_username`, then `username`, then the LF username claim, all read from the signed OIDC session. One username therefore targets a user on both flags. While impersonating, the target's stored username is used, so the impersonator's own targeting never shows in the target's read-only view. Nothing from the client is trusted; there is no request header.
- It needs the **server-side** SDK key in `LD_SDK_KEY`. `LD_CLIENT_ID` is client-side only and cannot be used. A missing key is logged at warning level once per process, then at debug level.
- It fails closed. With no `LD_SDK_KEY`, no username, LaunchDarkly not ready within `LAUNCHDARKLY_SERVER_INIT_TIMEOUT_SECONDS`, or an evaluation error, the answer is `false` and the normal Key Contact check runs.
- The SDK connects lazily on the first evaluation. Only that first evaluation waits for the connection; while LaunchDarkly stays unreachable later requests fail closed without waiting. It is closed on server shutdown and never reconnects afterwards.
- **Target individual users only.** A fallthrough or percentage rollout of the access flag would remove the Key Contact gate for everyone it reaches.

The PAT service still scopes the token to the caller, and the Insights Worker re-checks org and tier on every exchange, so a token minted by a flagged user who is not a Key Contact of a member org does not work against the Insights API.

## Related Documentation

- [Error Handling](./error-handling-architecture.md) — `MicroserviceError` and `upstreamCode`
- [Impersonation](./impersonation.md) — `blockDuringImpersonation`
- [Feature Flags](../frontend/feature-flags.md) — `getBooleanFlag` in the browser for the visibility flag; the server evaluates the access flag through `LaunchDarklyServerService`
- Upstream contracts: `linuxfoundation/lfx-v2-pat-service` (`docs/api.md`) and `linuxfoundation/lfx-v2-member-service` (`gen/http/openapi3.yaml`)

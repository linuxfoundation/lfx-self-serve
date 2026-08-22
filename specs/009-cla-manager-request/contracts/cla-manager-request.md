# Contract: CLA manager request (BFF ↔ producer)

**Feature**: [../spec.md](../spec.md) | **Satisfies**: FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-014 | **Date**: 2026-08-20

---

## Self Serve routes

```text
GET  /api/me/clas/:signatureId/cla-managers
POST /api/me/clas/:signatureId/cla-manager-requests
```

|               | GET                                              | POST                                                                  |
| ------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| Auth          | Session (`getUsernameFromAuth`)                  | Session                                                               |
| Impersonation | Allowed (read). Target `bearerToken` upstream    | **`blockDuringImpersonation`**                                        |
| Success       | `200` + `{ signatureId, managers, resultCount }` | `200` + `{ requestId, signatureId, requestType, status, recipients }` |
| Identity      | `resolveIdentity` + `identityQuery`              | same                                                                  |

POST body: `{ "requestType": "approval"|"removal", "recipients": ["lfuser"], "message?": "..." }`.

POST 400 when `requestType` is missing, `contact`, or anything else; when `recipients` is missing, empty, or contains blanks; when `message` exceeds 4096; when `signatureId` is not a UUID.

GET 404 when producer 404s (unknown / not-owned / ICLA). Do not map 404 to an empty manager list.

---

## Upstream

```text
GET  {claServiceBaseUrl()}/v4/my-clas/{signatureID}/cla-managers?{identityQuery}
POST {claServiceBaseUrl()}/v4/my-clas/{signatureID}/cla-manager-requests?{identityQuery}
```

Gateway: `/cla-service/v4/...`. Swagger `basePath: /v4`. Producer: [easycla#5151](https://github.com/linuxfoundation/easycla/pull/5151).

POST body:

```json
{
  "requestType": "removal",
  "recipients": ["jdoe"],
  "message": "optional"
}
```

Omit `message` when blank. Recipients are LF usernames from GET `managers[].lfUsername`.

GET impersonation: `bearerToken: isImpersonating(req) ? req.bearerToken : undefined` (same as PDF / my-clas).

POST: no `bearerToken` override — route is blocked while impersonating.

Headers: usual gateway. BFF does not set `X-ACL`.

**Do not** call `/notify-cla-managers` or company/project manager admin APIs.

---

## Errors

| Producer / BFF    | Client                                               |
| ----------------- | ---------------------------------------------------- |
| Bad UUID / body   | 400                                                  |
| Impersonated POST | 403 `IMPERSONATION_READ_ONLY`                        |
| Producer 404      | 404 `Signed agreement not found` (same class as PDF) |
| Producer 400      | 400, message passed through                          |
| 401 / ACS 403     | existing gateway mapping                             |
| 500 / timeout     | existing `MicroserviceError`                         |

Unauthenticated DEV: plain-text `401 no token provided`.

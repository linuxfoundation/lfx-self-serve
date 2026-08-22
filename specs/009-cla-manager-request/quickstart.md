# Quickstart: Contact CLA Manager

**Feature**: [spec.md](./spec.md) | **Date**: 2026-08-20

This pass does **not** start the dev server. After review, run `/run-dev` on worktree `/Users/ahmedlf/lfx-self-serve-feat-GH-1372` only. Check `lsof -nP -iTCP:4200 -sTCP:LISTEN` first; do not kill other trees’ processes.

## Tests (this pass)

From the worktree:

```bash
yarn workspace @lfx-one/shared test -- cla-manager-actions.utils.spec.ts
yarn workspace lfx-one-ui test:server -- src/server/services/cla.service.spec.ts src/server/controllers/clas.controller.spec.ts src/server/routes/clas.route.spec.ts
yarn workspace lfx-one-ui test:app -- --include='**/contact-cla-manager*.spec.ts'
```

Exact workspace script names follow `apps/lfx-one/package.json` / `packages/shared/package.json`. Prefer the repo’s usual vitest file filter if those wrappers differ.

## Manual (after `/run-dev`)

1. Confirm Agent A has spread the factory **and** `my-clas-m2-enabled` is on (or temporarily force the spread). Without that, the modal is unreachable from the table.
2. Needs-attention ECLA with `not_on_approval_list`: kebab shows Request approval, Request Removal, Contact CLA Manager.
3. Approval Send → toast; network POST `requestType=approval`.
4. Contact Send → no `cla-manager-requests` POST.
5. Valid ECLA: Request Removal only (from this factory). ICLA / Revoked: none of these items.
6. Impersonation: GET managers works; POST 403 `IMPERSONATION_READ_ONLY`.

## DEV producer

`GET/POST https://api-gw.dev.platform.linuxfoundation.org/cla-service/v4/my-clas/{signatureID}/cla-managers` (and `cla-manager-requests`). Same user token as My CLAs. 404 on ICLA ids is correct.

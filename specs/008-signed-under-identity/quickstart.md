# Quickstart: Show identity each CLA was signed under

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

No new service to run. The identity fields arrive on the existing My CLAs list.

## Automated

From the `lfx-self-serve` checkout on `feat/GH-1256`:

```bash
yarn workspace @lfx-one/shared test src/utils/cla-view.utils.spec.ts
yarn workspace lfx-one-ui test:server src/server/services/cla.service.spec.ts
yarn workspace lfx-one-ui ng test --watch=false --include='**/profile-clas.component.spec.ts'
```

Expect: three copy shapes, omit-when-blank, pass-through of `signedVia`/`signedAs`, line under the date on Valid / Revoked / Invalidated, no line when both fields omitted.

## Manual (after `/run-dev` on this checkout)

Ahmed starts the stack. Then:

1. Open `/profile/clas` as a user with mixed GitHub / email history.
2. Confirm Signed is still one column: date, then `Signed as …` underneath on rows that have an identity.
3. Confirm a Revoked row (if present) still has no kebab and still shows the identity line.
4. Confirm a GitLab-signed row, if DEV has one, shows `(GitLab)` even without a linked GitLab account.

DEV already serves the producer fields from [easycla#5151](https://github.com/linuxfoundation/easycla/pull/5151). If a row has no line, the producer omitted both fields — that is a valid empty-identity record, not a consumer miss.

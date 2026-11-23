# Event share kits

Each event's public share kit lives in its own folder here:

```text
content/events/<eventSlug>/share-kit.json
```

The folder name is the event slug (lowercase letters, digits and hyphens) and must match `eventSlug` in the file. The app reads every file once at startup and serves it at `GET /public/api/events/<eventSlug>/share-kit`; the public page renders it at `/events/<eventSlug>/share-kit`.

## Rules

- **Plain text only.** Every text field is shown as text, never as HTML. Tags are rejected.
- **Links must be `https://`.** Post text never includes the link: the page appends the registration, event or CFP link with tracking parameters.
- **Graphics** use an `https://` URL or a file committed under `apps/lfx-one/public/share-kits/<eventSlug>/`, referenced as `/share-kits/<eventSlug>/<file>`. Give every graphic real alt text.
- **No member discount codes or other secrets.** This repository is public. Unknown fields, including `memberOffer`, are rejected.
- The schema is `shareKitContentSchema` in `packages/shared/src/server/share-kit-schema.utils.ts`; the TypeScript shape is `ShareKitContent` in `packages/shared/src/interfaces/share-kit.interface.ts`.

## Checking a change

`yarn workspace lfx-one-ui test:server src/server/services/share-kit.service.spec.ts` validates every file in this folder and fails with the field and problem for anything invalid. CI runs the same check, so an invalid file fails the PR rather than production.

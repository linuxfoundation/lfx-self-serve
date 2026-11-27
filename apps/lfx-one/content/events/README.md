# Event share kits

Each event's public share kit lives in its own folder here:

```text
content/events/<eventSlug>/share-kit.json
```

The folder name is the event slug (lowercase letters, digits and hyphens) and must match `eventSlug` in the file. The app reads every file once at startup and serves it at `GET /public/api/events/<eventSlug>/share-kit`; the public page renders it at `/events/<eventSlug>/share-kit`.

## Rules

- **Plain text only.** Every text field is shown as text, never as HTML. Tags are rejected.
- **Links must be `https://`.** Post text never includes the link: the page appends the registration, event or CFP link with tracking parameters.
- **Posts must fit once the link is added.** X counts the link as 23 characters and CJK characters and most emoji twice, so X text can be at most 255 plain characters. Bluesky counts the link as about 40, so its text can be at most 258. The check below names any post that is too long.
- **Graphics** use an `https://` URL or a file committed under `apps/lfx-one/public/share-kits/<eventSlug>/`, referenced as `/share-kits/<eventSlug>/<file>`. Give every graphic real alt text.
- **No member discount codes or other secrets.** This repository is public. Unknown fields, including `memberOffer`, are rejected.
- The schema is `shareKitContentSchema` in `packages/shared/src/server/share-kit-schema.utils.ts`; the TypeScript shape is `ShareKitContent` in `packages/shared/src/interfaces/share-kit.interface.ts`.

## Turning kits on and off

Every kit is behind the `event-share-kit` LaunchDarkly flag (`EVENT_SHARE_KIT_FLAG`). While it is off, the page shows "not found" for every event. Turn it on for named LFIDs first to check a kit in production, then for everyone. Signed-out visitors are one audience, so they get it all at once, and can take up to five minutes to see a change. No deploy is needed either way. Remove the flag once the feature is stable.

## Member discount

A kit can describe a member-only discount in `memberBenefit`. Everything the member box says about the organisation comes from these fields, so set them for each new event:

| Field            | Example (AGNTCon + MCPCon NA 2027) | Where it shows                                                                      |
| ---------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `membershipSlug` | `aaif`                             | Not shown. The LFX project whose active member companies qualify                    |
| `membershipName` | `AAIF`                             | Heading ("AAIF Members Get …"), "is a member of AAIF", "isn't a member of AAIF yet" |
| `discountLabel`  | `20% Off Registration`             | End of the heading. Write it in Title Case, as the heading is                       |
| `joinUrl`        | `https://aaif.io/members#join`     | The "Learn About Membership" button for visitors whose company isn't a member       |

The rest of the box ("Work at a member company?", "Sign In to See Your Code", "Enter it when you register") names no organisation, so it needs no change per event. Post titles, the graphic label and the CFP heading and guide title are shown as written, so write those in Title Case too.

The code itself never goes in this repository: it is read from the `SHARE_KIT_MEMBER_CODES` environment variable, a JSON object of event slug to code set from the deployment's secret store, and is only sent to a signed-in visitor whose verified email belongs to an active member company of that membership. With no code configured for an event, the page shows no offer.

To set or rotate codes:

1. Add the JSON to the environment's secret store under a key such as `SHARE_KIT_MEMBER_CODES`, for example `{"agntcon-mcpcon-na-2027": "CODE"}`.
2. Bind it in that environment's Helm values. The chart only sets the variables listed under `environment`; it does not load the whole secret:

   ```yaml
   environment:
     SHARE_KIT_MEMBER_CODES:
       valueFrom:
         secretKeyRef:
           name: <the environment's app secret>
           key: SHARE_KIT_MEMBER_CODES
   ```

3. Restart the pods (`kubectl rollout restart deployment/lfx-self-serve`, or let the Argo CD sync roll them). Each pod reads the variable once, on the first share kit request, so a changed secret only takes effect after a restart.

A company that joins or leaves is reflected within about 15 minutes: a signed-in visitor's membership answer is reused for five minutes, and the membership list it comes from is refreshed every ten (`MEMBER_BENEFIT_DOMAIN_INDEX_TTL_MS`).

## Checking a change

`yarn workspace lfx-one-ui test:server src/server/services/share-kit.service.spec.ts` validates every file in this folder and fails with the field and problem for anything invalid. CI runs the same check, so an invalid file fails the PR rather than production.

# Placement Decision Trees (Self Serve)

Where new code goes inside `lfx-self-serve`. Self Serve-specific only — cross-repo routing ("should this go in Self Serve at all?") routes to `/lfx-skills:lfx`.

These trees are intentionally concrete. Default the answer if you can; only escalate to a code owner where called out.

## Where does my component go?

```text
Is it a route/page (has its own URL)?
  YES -> modules/<module>/<component-name>/
  NO  -> Is it used by multiple modules?
          YES -> shared/components/<component-name>/
          NO  -> Is it a PrimeNG wrapper?
                  YES -> shared/components/<component-name>/  (lfx- prefix)
                  NO  -> modules/<module>/components/<component-name>/
```

See `docs/architecture/frontend/component-architecture.md` for the underlying placement guidance and the existing module list.

## Do I need a new module?

```text
Does the feature represent a distinct domain not covered by existing modules?
  NO  -> Extend the existing module.
  YES -> Does it have its own route(s)?
          NO  -> Probably a shared component, not a module.
          YES -> Does it have enough components/services to justify isolation?
                  NO  -> Add to the closest existing module.
                  YES -> Create a new module under apps/lfx-one/src/app/modules/<name>/.
                         New routes must be wired in apps/lfx-one/src/app/app.routes.ts
                         (protected file -> code-owner review).
```

Current modules: `badges`, `committees`, `dashboards`, `documents`, `events`, `mailing-lists`, `meetings`, `profile`, `settings`, `surveys`, `trainings`, `transactions`, `votes`.

## Where does my type go?

```text
Is it used across modules or between frontend and backend?
  YES -> packages/shared/src/interfaces/<name>.interface.ts
  NO  -> Is it purely component-internal state?
          YES -> Define locally in the component file.
          NO  -> packages/shared/src/interfaces/<name>.interface.ts (default to shared)
```

Enums go in `packages/shared/src/enums/<name>.enum.ts`; constants in `packages/shared/src/constants/<name>.constants.ts`. Each directory has a barrel `index.ts` — every new file must be exported there.

See `docs/architecture/shared/package-architecture.md` for full naming, exports, and import-alias rules.

## Backend: new service or extend existing?

```text
Does the domain already have a service file in src/server/services/?
  YES -> Add a method to the existing service.
  NO  -> Create a new service following the three-file pattern
         (service -> controller -> route). See:
         .claude/skills/self-serve-dev/references/backend-endpoint.md
```

Services are organized by **domain** (meetings, committees, votes, etc.), not by HTTP method or feature size.

Route registration in `apps/lfx-one/src/server/server.ts` is a protected file -> ask a code owner to add the route registration.

## User token or M2M token?

```text
Is this a public endpoint (/public/api/**) with no user session?
  YES -> Use M2M token.
  NO  -> Is the upstream call a privileged operation that user tokens cannot perform?
          YES -> Already enforced user-level authorization in-app?
                  NO  -> Stop. Enforce user-level auth first.
                  YES -> Temporarily swap req.bearerToken to an M2M token,
                         make the single privileged call, restore immediately after.
          NO  -> Use the user bearer token (DEFAULT).
```

Full rule plus the rationale (audit attribution, per-user authorization, secret scope) lives in `.claude/rules/development-rules.md` under "Authentication: User Tokens vs M2M Tokens".

## Do I need an upstream backend change first?

```text
Does the feature need a field, query, or operation the upstream microservice does not expose?
  YES -> STOP. Switch to the upstream repo and follow its develop workflow.
         Only return to Self Serve once the upstream contract is finalized.
         Use `/lfx-skills:lfx` to identify the owning repo.
  NO  -> Continue. Validate the contract per Step 3 of /self-serve-dev.
```

No mock data, no placeholder APIs, no stubbed responses to "unblock" frontend work.

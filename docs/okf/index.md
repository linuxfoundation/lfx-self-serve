# LFX Self-Serve Knowledge Catalog

> OKF v0.1 bundle. Start here — follow links to individual concepts.
>
> `okf_version: 0.1`

## Services

Backend Express.js services that proxy to upstream microservices or external APIs.

- [AI Service](services/ai-service.md) — Claude Sonnet integration for meeting agenda generation
- [Auth Service](services/auth-service.md) — Auth0 / Authelia authentication and JWT handling
- [Committee Service](services/committee-service.md) — Committee CRUD proxy to lfx-v2-committee-service
- [Mailing List Service](services/mailing-list-service.md) — Mailing-list subscription proxy
- [Meeting Service](services/meeting-service.md) — Meeting scheduling with calendar integration
- [NATS Service](services/nats-service.md) — Inter-service pub/sub messaging
- [Newsletter Service](services/newsletter-service.md) — Newsletter proxy to lfx-v2-newsletter-service
- [Snowflake Service](services/snowflake-service.md) — Analytics query pool with deduplication
- [Survey Service](services/survey-service.md) — Survey CRUD and NPS analytics
- [Valkey Service](services/valkey-service.md) — In-process Redis-compatible cache

## Feature Modules

Angular 20 feature modules under `apps/lfx-one/src/app/modules/`.

- [Badges](modules/badges.md) — LFX credentialing badges
- [Committees](modules/committees.md) — Project committee management
- [Dashboards](modules/dashboards.md) — Lens-based dashboards (Me / Foundation / Project / Org)
- [Events](modules/events.md) — LFX events browsing and attendance
- [Mailing Lists](modules/mailing-lists.md) — Mailing-list subscription management
- [Meetings](modules/meetings.md) — Meeting scheduling and calendar integration
- [Newsletters](modules/newsletters.md) — Newsletter management and analytics
- [Surveys](modules/surveys.md) — Survey creation and NPS analytics
- [Votes](modules/votes.md) — Voting and polling

## APIs

Express route groups and their access model.

- [Authenticated API](apis/authenticated-api.md) — Protected `/api/**` routes requiring bearer token
- [Public API](apis/public-api.md) — Unauthenticated `/public/api/**` routes with rate limits
- [SSR Server](apis/ssr-server.md) — Express entry point, middleware stack, and SSR pipeline

## Data Models

Shared TypeScript interfaces and contracts.

- [Shared Package](data-models/shared-package.md) — `@lfx-one/shared` interfaces, enums, utils, validators
- [Auth Context](data-models/auth-context.md) — AuthContext shape and M2M vs user-token rules

## Runbooks

Operational how-tos for this repository.

- [Local Dev Setup](runbooks/local-dev-setup.md) — First-time setup, env vars, dev server
- [Commit Workflow](runbooks/commit-workflow.md) — DCO + GPG, commitlint, pre-commit hooks
- [Post-Commit Review](runbooks/post-commit-review.md) — Mandatory reviewer trio and PR-readiness flow

## Architecture Decisions

Significant decisions baked into the codebase.

- [Angular Zoneless SSR](decisions/angular-zoneless-ssr.md) — Angular 20 with stable zoneless change detection + SSR
- [Monorepo Turborepo](decisions/monorepo-turborepo.md) — Turborepo monorepo with shared package
- [Auth0 Authentication](decisions/auth0-authentication.md) — Auth0 / Authelia authentication approach
- [PrimeNG Wrapper Pattern](decisions/primeng-wrapper-pattern.md) — UI library independence via component wrappers

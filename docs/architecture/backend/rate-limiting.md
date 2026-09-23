# Rate Limiting

All API routes and auth flows sit behind rate limiters implemented with [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit). The limiters live in `apps/lfx-one/src/server/middleware/rate-limit.middleware.ts`. Most are wired into `server.ts` as global middleware on their URL prefixes; a route-scoped limiter is instead mounted on the individual route in its router.

## Limiters

| Limiter                | Mounted at                                             | Window | Max req | Keyed on                     | Purpose                                          |
| ---------------------- | ------------------------------------------------------ | ------ | ------- | ---------------------------- | ------------------------------------------------ |
| `apiRateLimiter`       | `/api/*`                                               | 1 min  | 500     | IP                           | General authenticated API traffic.               |
| `publicApiRateLimiter` | `/public/api/*`                                        | 1 min  | 100     | IP                           | Unauthenticated surfaces (e.g. public meetings). |
| `authRateLimiter`      | `/login`, `/passwordless/callback`, `/social/callback` | 1 min  | 20      | IP                           | Auth flows — brute-force mitigation.             |
| `aiRateLimiter`        | `POST /api/meetings/generate-agenda`                   | 1 min  | 10      | `req.oidc.user.sub`, else IP | LiteLLM-backed AI generation.                    |

All four limiters use `standardHeaders: true` (modern `RateLimit-*` response headers) and `legacyHeaders: false` (no `X-RateLimit-*`). The window is 1 minute across the board.

`aiRateLimiter` is the one limiter that is not per-IP and not mounted on a prefix. It stacks on top of `apiRateLimiter` (which still applies, since the route sits under `/api/`) and is keyed on the authenticated user so a single caller on a shared egress IP can't exhaust the budget for everyone behind it; anonymous callers fall back to a /56-masked IP key via `ipKeyGenerator`. Two known limits: it is not yet applied to the other LiteLLM callers (newsletter generation, weekly-brief action-item extraction), and its counter lives in the default in-process `MemoryStore`, so the effective ceiling is `limit × replicas` — exact today, since `ecosystem.config.js` runs a single instance, but a shared store would be needed under horizontal scaling.

## Wiring in `server.ts`

```typescript
// apps/lfx-one/src/server/server.ts (excerpt)
app.use('/public/api/', publicApiRateLimiter);
app.use('/api/', apiRateLimiter);

app.use('/login', authRateLimiter);
app.get('/passwordless/callback', authRateLimiter /* handler */);
app.get('/social/callback', authRateLimiter /* handler */);
```

```typescript
// apps/lfx-one/src/server/routes/meetings.route.ts (excerpt)
router.post('/generate-agenda', aiRateLimiter, (req, res, next) => meetingController.generateAgenda(req, res, next));
```

- `app.use(prefix, limiter)` applies the limiter to every request matching the prefix.
- The explicit `.get()` registrations on the Auth0 callbacks layer the limiter in front of the callback-specific handler so it runs before any token exchange work.
- Public routes are rate-limited **before** the generic `/api/` limiter would match, because `/public/api/*` has the stricter budget.
- A route-scoped limiter like `aiRateLimiter` is registered in its own router rather than `server.ts`, and runs _after_ the prefix limiter — both budgets have to allow the request.

## Behavior on limit hit

- Returns **HTTP 429** with the standard `RateLimit-*` headers indicating remaining budget and reset time.
- No body payload beyond the library default — clients should surface "too many requests, please retry" to the user.
- Limiters count per-IP using the default `req.ip` key unless they declare a `keyGenerator` (`aiRateLimiter` keys on the authenticated user). In production behind load balancers, ensure Express `trust proxy` is configured upstream so the correct client IP is used.

## Adding a new limiter

When adding a new rate-limited surface (e.g. a privileged admin endpoint), follow the pattern:

1. Declare the limiter in `rate-limit.middleware.ts` alongside the existing ones — reuse `standardHeaders: true`, `legacyHeaders: false`, and the 1-minute window unless there's a specific reason to diverge.
2. Mount it in `server.ts` via `app.use(prefix, limiter)` or inline on the route `.get(limiter, handler)`.
3. If the route is extremely sensitive (credential flows, password reset) or expensive per call (AI generation), prefer a lower max and add a per-identity key via the `keyGenerator` option instead of relying on IP alone — fall back to `ipKeyGenerator(req.ip)` rather than the raw IP, so IPv6 callers are grouped by prefix.
4. Note that the default `MemoryStore` is per-process: a limit enforced across replicas needs a shared store.

## Related

- [Authentication](authentication.md) — Auth0 / Authelia flows that sit behind `authRateLimiter`.
- [Public Meetings](public-meetings.md) — the main `/public/api/*` consumer that the stricter limiter is tuned for.

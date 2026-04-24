# Rate Limiting

All API routes and auth flows sit behind per-IP rate limiters implemented with [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit). The limiters live in `apps/lfx-one/src/server/middleware/rate-limit.middleware.ts` and are wired into `server.ts` as global middleware on their URL prefixes.

## Limiters

| Limiter                | Mounted at                                             | Window | Max req/IP | Purpose                                          |
| ---------------------- | ------------------------------------------------------ | ------ | ---------- | ------------------------------------------------ |
| `apiRateLimiter`       | `/api/*`                                               | 1 min  | 500        | General authenticated API traffic.               |
| `publicApiRateLimiter` | `/public/api/*`                                        | 1 min  | 100        | Unauthenticated surfaces (e.g. public meetings). |
| `authRateLimiter`      | `/login`, `/passwordless/callback`, `/social/callback` | 1 min  | 20         | Auth flows — brute-force mitigation.             |

All three limiters use `standardHeaders: true` (modern `RateLimit-*` response headers) and `legacyHeaders: false` (no `X-RateLimit-*`). The window is 1 minute across the board.

## Wiring in `server.ts`

```typescript
// apps/lfx-one/src/server/server.ts (excerpt)
app.use('/public/api/', publicApiRateLimiter);
app.use('/api/', apiRateLimiter);

app.use('/login', authRateLimiter);
app.get('/passwordless/callback', authRateLimiter /* handler */);
app.get('/social/callback', authRateLimiter /* handler */);
```

- `app.use(prefix, limiter)` applies the limiter to every request matching the prefix.
- The explicit `.get()` registrations on the Auth0 callbacks layer the limiter in front of the callback-specific handler so it runs before any token exchange work.
- Public routes are rate-limited **before** the generic `/api/` limiter would match, because `/public/api/*` has the stricter budget.

## Behavior on limit hit

- Returns **HTTP 429** with the standard `RateLimit-*` headers indicating remaining budget and reset time.
- No body payload beyond the library default — clients should surface "too many requests, please retry" to the user.
- The limiter counts per-IP using the default `req.ip` key. In production behind load balancers, ensure Express `trust proxy` is configured upstream so the correct client IP is used.

## Adding a new limiter

When adding a new rate-limited surface (e.g. a privileged admin endpoint), follow the pattern:

1. Declare the limiter in `rate-limit.middleware.ts` alongside the existing ones — reuse `standardHeaders: true`, `legacyHeaders: false`, and the 1-minute window unless there's a specific reason to diverge.
2. Mount it in `server.ts` via `app.use(prefix, limiter)` or inline on the route `.get(limiter, handler)`.
3. If the route is extremely sensitive (credential flows, password reset), prefer a lower max and consider adding a per-identity key via the `keyGenerator` option instead of relying on IP alone.

## Related

- [Authentication](authentication.md) — Auth0 / Authelia flows that sit behind `authRateLimiter`.
- [Public Meetings](public-meetings.md) — the main `/public/api/*` consumer that the stricter limiter is tuned for.

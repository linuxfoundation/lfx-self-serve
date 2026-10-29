# Login-Free Vote Links

## Overview

A voter can open a personalized link, `https://app.lfx.dev/votes/{vote_uid}#vote_token={token}`, and vote without signing in. The link is minted by the voting service (`POST /votes/{uid}/bulk_resend` with `personalized_links: true`) and emailed by ITX. The token is the only credential: treat it like a password.

## Where the token lives

| Place                                 | Token present?                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| URL fragment (`#vote_token=`)         | Yes, until the page drops it. Browsers never send a fragment to a server, so SSR never sees it. |
| `VoteLinkBallotComponent` signal      | Yes, in memory only, for the life of the page                                                   |
| Request bodies to `/public/api/votes` | Yes, forwarded unchanged to the voting service                                                  |
| Address bar and history after load    | No (`history.replaceState` removes the fragment)                                                |
| Server logs, error handler            | No. Handlers never log `req.body`; the request serializer whitelists id, method, URL            |
| Datadog RUM                           | No. `redactRumUrl` strips every URL fragment; Session Replay stays off while a URL has one      |
| localStorage, sessionStorage, cookies | No                                                                                              |
| Any server-side cache or shared state | No                                                                                              |

## Flow

1. `auth.middleware.ts` classifies single-segment `/votes/:id` as optional-auth SSR (`/votes/create`, `/votes/:id/edit`, `/votes/:id/present` stay `required`). The fragment is invisible to the server, so for an anonymous server render `voteAnonymousSsrMatchGuard` mounts the neutral chrome-less ballot page (its loading state) ahead of the authenticated shell, whose server-side `authGuard` assumes Express already authenticated the request. Signed-in visitors get today's shell.
2. In the browser, `voteTokenMatchGuard` (`canMatch`) matches the top-level `votes/:id` route only when `window.location.hash` carries `vote_token`. Every other `/votes/*` URL is unchanged.
3. `VoteLinkBallotComponent` reads the token, calls `replaceState`, and posts it to `POST /public/api/votes/link-ballot`. The page sets `<meta name="referrer" content="no-referrer">`, and the server sends `Referrer-Policy: no-referrer` for `/votes/*`.
4. Submit uses `POST /public/api/votes/link-responses` (first ballot) or `PUT` (update), chosen from `ballot.already_voted`. A `400 vote is not awaiting response` on POST flips to PUT once; a `400 vote is not responded` on PUT flips to POST once.

## Server contract

`public-vote-link.controller.ts` forwards the ballot and response requests to `/vote_links/ballot` and `/vote_links/responses` through `VoteService`. It sends no bearer token: `ApiRequestOptions.bearerToken: ''` overrides `req.bearerToken`, which the optional-auth `/public/api` surface may have set for a signed-in visitor. Token mode never uses the visitor's identity. Responses carry `Cache-Control: private, no-store`. The anonymous body is validated and rebuilt from allowlisted fields before it is forwarded (bounded string `vote_token`, boolean `abstain`, well-formed answers, comments within the length limit, no extra properties), using the same helper as the authenticated ballot submit; upstream status and message pass through.

`publicApiRateLimiter` (100 requests per minute per IP, per pod) applies. A board of 30 opening links behind one office IP makes about 60 calls (a ballot read and a submit each), inside the budget.

## Project branding and the thank-you screen (#4692)

The ballot payload carries `project_uid` (and optionally `project_slug`) from the voting service (lfx-v2-voting-service#76); both are typed optional until that release ships. `VoteLinkBallotComponent` calls `GET /public/api/projects/:identifier/summary` with `project_uid`, falling back to `project_slug`, and shows the returned logo and name in `lfx-vote-link-header`. The route returns only `{ name, slug, logo_url, is_foundation }`, reads the project through the query service with an M2M token, and answers a non-public or Formation - Confidential project exactly like an unknown identifier (non-cacheable 404). Branding never comes from the voting service, nothing public maps a vote uid to a project, and a missing key or a summary 404 renders the page unbranded with the LFX mark. A 503 on the ballot call itself (for example the voting service cannot map the project) is the try-again error state, not an unbranded ballot.

After a successful submit or update, `lfx-vote-link-thank-you` replaces the form. It recaps one line per question from the in-memory submission, or says the ballot is secret on a pseudo-anonymous vote (a missing `pseudo_anonymity` counts as secret), and shows the deadline in the viewer's locale. It has no navigation, sign-in prompt or identity.

## Send ballots now

`POST /api/votes/:uid/send-ballots` (writer-only via `assertVoteWrite`) re-resolves the members who haven't voted from the voters index, sends their `vote_response` uids to `bulk_resend` with `personalized_links: true` in batches of `VOTE_SEND_BALLOTS_BATCH_SIZE`, and returns `{ sent, skipped }`. ITX rejects a whole call if any recipient is invalid, so a rejected batch counts as skipped and the rest still go out; the call fails only when nothing was sent. It logs counts only (no actor identifier). A rejected batch (4xx) counts as skipped and the rest go out; a timeout or 5xx stops the run, since that batch may already be queued, and the unsent remainder counts as skipped. The UI (`lfx-vote-send-ballots`) disables the action for `VOTE_SEND_BALLOTS_COOLDOWN_MS` after a send. That cooldown is a UX guard only, per component instance: the BFF has no per-vote cooldown beyond `voteWriteRateLimiter`.

`isBrowserCredentialUrlPath` also treats a `/votes/:id` URL with a `vote_token` fragment as a credential URL, so Segment, Plausible and the startup Intercom boot stay off for it.

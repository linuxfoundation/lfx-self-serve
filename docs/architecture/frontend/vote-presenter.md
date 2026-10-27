# Vote Presenter View

Full-screen, chrome-less view a chair uses to run a vote live (epic #4140). Route: `/votes/:id/present`.

**Location:** `apps/lfx-one/src/app/modules/votes/vote-presenter/`

## Route placement

The route is a **top-level sibling in `app.routes.ts`**, next to `meetings/:id` and the other chrome-less pages, before the in-shell `**` catch-all. It is deliberately not a child of `votes.routes.ts`: every child of the `votes` mount renders inside `MainLayoutComponent` (navbar and sidebar) and passes through `lensRedirectGuard`. `/votes/:id` (the permalink) is `pathMatch: 'full'`, so it never captures `/votes/:id/present`.

Guards: `authGuard`, then `votePresenterGuard`. Route data `preload: false`.

## Permission: `vote#writer`

`GET /api/votes/:uid?include_writer=true` decorates the vote with `writer` (the `vote#writer` FGA relation, via `AccessCheckService.addAccessToResource`). The flag is opt-in so existing callers and the 5-second polls pay no extra FGA lookup. `votePresenterGuard` reads it once per navigation (uncached) and the Present entry points read the same flag.

`writerGuard` is not reused: it checks project and committee writer, not `vote#writer`. On denial the guard redirects to `/votes?_notice=access` (the standard "Access Denied" toast, which also works on an SSR load); a transient lookup failure redirects with `_notice=error`.

## Data and secrecy

- The live count comes only from `GET /api/votes/:uid` (`num_response_received`, `total_voting_request_invitations`) through `computeVoteRowParticipation`; there is no second calculation.
- The voting service does not gate `/results` while a vote is open, so secrecy is enforced client-side: the presenter requests `/results` exactly once per transition to `ended` and never calls `/voters`, `/reminder-recipients` or `/my-response`. No choices, tallies or voter names are rendered while the vote is open.
- `quorum_percentage` and `winning_threshold_percentage` are not in the `GET /votes/{uid}` payload, so the quorum marker is hidden and the ended banner is neutral ("Vote ended", or "Ranked result" for `isRankedPollType`). Approved / Not approved is never inferred.
- Close vote is rendered disabled behind `TODO(#4370)` until the voting service can end a vote early.

## Visibility-aware polling

`createVisibilityPoll` (`shared/utils/visibility-poll.util.ts`) is the reusable poller: `timer` plus sequential `expand`, so requests never overlap. It fetches immediately and every `VOTE_PRESENTER_POLL_INTERVAL_MS`, cancels timers and in-flight requests while `document.visibilityState` is `hidden`, fetches immediately on `visible`, and retries failures on capped exponential backoff without ending the stream. `shouldContinue` stops the loop (the presenter stops on `ended`); the next `visible` event restarts it, which is how a reopened or extended vote is noticed.

It is browser-only: the caller passes `DOCUMENT` and only subscribes when `isPlatformBrowser`. SSR renders the loading skeleton.

## Share panel and Copy slide

Link first: the large vote link and a Copy link button (Clipboard API, inline confirmation), then the QR. The QR is generated in the browser by `uqr` (MIT, zero dependencies), dynamic-imported inside `lfx-vote-qr`, which draws the modules as one SVG path with `role="img"`. Copy slide renders the static `lfx-vote-slide` artboard off-screen at 1920x1080 with `html-to-image` (dynamic import), copies the PNG with `ClipboardItem`, and falls back to a download named `<vote-slug>-vote-slide.png`. Title truncation (`truncateVoteTitle`, 80 characters, word-safe) is shared by the presenter and the slide.

## Entry points

The votes-table row menu (writers of an open or ended vote) and the creator results drawer open the presenter in a new tab. The detail page from #4149 is not merged, so it has no entry point yet.

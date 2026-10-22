<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Marketing OS document revisions

`MktgDocumentStoreService` owns document history over the private object-store
purpose `marketing-os-artifacts`. The existing project writer entitlement and
server-resolved project partition still gate every route.

## Intake size boundary

The Brand Kit, Messaging Framework, Boilerplates, FAQ and ICP generate endpoints
validate intake answer lengths in the shared validators before parsing attached
framework JSON or calling a generation service. Oversized answers return HTTP 400
through the existing `ServiceValidationError` path; no Guild session is created.
The policy lives in `packages/shared/src/constants/mktg-intake.constants.ts`.

Limits count submitted UTF-16 code units **before trimming**, including whitespace:
project names take up to 200 characters, individual URLs 2,048, and descriptions,
notes and short ICP answers 4,000. The Messaging Framework's `links` answer keeps
its existing link-count limit, with a per-URL cap and an aggregate budget allowing
CRLF separators. Whole ICP sibling documents take up to 400,000 characters each;
attached messaging-framework JSON keeps the existing 400,000-character limit.
Uploaded document text and logo payloads retain their separate existing budgets.
These intake limits do not change the chat-message or ICP-feedback size gates.

## Current is not newest

Revision bundles remain immutable JSON at
`documents/{project}/{agentKey}/{documentId}/{sequence}-{sha256}.json`.
`current.json` in the same document prefix selects current, which is not
necessarily approved. Without that record, the newest historical revision is
current: existing documents need no migration, and no approval is invented.

Make current (the compatibility HTTP endpoint remains `POST …/restore`) changes
only `current.json`. It does not copy a bundle or add history. One-off run
documents refuse this action. New runs append through `recordRevision`, which
records their current base. When current is approved, a new Draft extends the
manifest without moving the pointer or its selection attribution. Otherwise the
newest generation becomes current. The future comment-and-revise
writer uses that same method with its actual `basedOnId` and comments; this
change does not introduce a Revise endpoint or UI.

## Conditional publication

The current record also holds the IDs of committed revisions. Appends and Make
current preserve every previously committed ID even if its object is temporarily
missing or unreadable; restoring the object makes it visible again. An immutable
bundle is first created with `If-None-Match: *`, then a compare-and-swap of the
current record atomically publishes its ID and the chosen selection. Generation
can preserve approved current while publishing a newer Draft. An interrupted or
losing write can leave an immutable object, but it is not visible history.
New objects carry `managed` metadata so an interrupted first save is not mistaken
for historical data when no current record exists yet. First publication initializes
the manifest from all valid, eligible historical keys without validating their bodies;
managed orphan objects and malformed keys stay out. Display summaries still require
readable historical bodies, so repair restores visibility without rewriting the manifest.

A bounded retry handles competing new writers. Each attempt derives an automatic
base from its fresh committed snapshot and sequence listing. A caller's explicit
`basedOnId`, including null, remains stable because it names the writer's actual
base. The generation token in revision metadata deduplicates overlapping result
polls, including one-off run polls.
Historical revisions without that token are matched by session and content hash.
A failed revision write drops the receipt so a later poll retries. Pre-revision
artifacts become revision 1 on the next run, excluding that run's own artifact.
Make current never retries a stale comparison: it returns 412 so the caller can
reload rather than silently overwrite a concurrent choice. The file backend
uses an exclusive per-key directory across processes for the same comparison;
a crash leaves that lock for operator recovery rather than stealing it from a
possibly live writer. All file puts take the lock, so unconditional writes cannot
bypass a conditional comparison; unlike S3, an overlapping unconditional put can
return 412. For recovery, first confirm no writer is active, then remove the
`<key>.lock.partial` directory under the purpose folder. Never remove a live
writer's lock. S3 passes the original ETag through `If-Match`.

## Approval and consumers

The optional `approvals` map on the same current record stores each revision's
`approvedAt` and opaque effective-sub `approvedBy`; it is never part of hashed
revision bytes. Missing or malformed optional annotations mean no approvals,
not a corrupt critical pointer. Approve uses the existing `writeCurrent` CAS to
add an annotation and select that revision atomically. Already approved and
current is a no-op; selecting an earlier approval preserves its original
approval time and actor. Make current only moves selection: it never approves
a Draft. Both operations fail fast on a stale CAS with 412, without retries.
One-off run documents cannot be approved. A true pre-revision document must have
a stored revision before approval; the API returns a field validation error
and the UI omits Approve rather than migrating it.

Public summaries and revision responses expose nullable name-only `approval`.
Detail and listing expose nullable `approvedCurrent: { revisionId, number }`,
derived only when the current revision has an annotation, using the same
current snapshot already read for the document. Directory resolution never
substitutes the generator or pointer mover for an approver.

All dependent attachments and actual PDF/Slides bytes use approved current:
plain and sidecar `readLatest` return null when none is approved. Read failures
propagate rather than being mislabeled as missing approval. Only the server's
true pre-revision plain fallback remains; browser runs never supply attachments.
Explicit export selectors must match approved current or fail instead of
silently changing bytes. Asset export freshness compares the last deck's content
hash with approved current via `readApprovedCurrentSummary`, not the newest Draft.
The existing `latestRevision` response field carries that approved identity, or
null when none is approved (no stale badge). Selecting older approved content can
also mark a deck out of date; revision number alone never determines freshness.

### Family exports

Family exports have their own scope under `/api/mktg-agents/slides-export/family`:
`POST /start` selects each catalog member's approved current, `POST /result` polls
that immutable selection using an owner token, and `GET /last` reports the last
family deck and its approved-current freshness. Freshness reads approved summaries
in parallel. Revisions with content-sha metadata need no body read for this lookup;
historical revisions without it are hydrated by the normal listing path. Export start
explicitly loads and integrity-checks each selected approved body for composition;
last-export lookup does not perform that additional export-body load.
All require project writer access;
every family route, including last-export reads, is blocked during impersonation. Members without approval are
listed as skipped; a family with none is refused with 409 (`FAMILY_NOTHING_APPROVED`).
An approved asset that cannot be composed is refused with `FAMILY_ASSET_UNREADABLE`;
FAQ groups are flattened to answered `{q, a}` entries, omitting unanswered rows and
refusing an FAQ with no exportable answers before calling Guild. Storage failures
are not misreported as missing approval. The deployed exporter supports framework, kit,
boilerplates and FAQ; the kit's full book and tokens provide branding.

Family records use `slides-exports/{project}/families/{familyId}/{time}-{sha}.json`,
separate from document records, with the deck id/link, mode/date and each member's
revision id, number and content hash. Update uses only the stored family's last deck
id; Create makes a new deck. Polling keeps the originally selected revisions even
if approval moves, and the server finishes polling when the browser leaves.
Freshness compares exact approved member/ref sets, including lost or newly gained
approvals and restored older revisions. A new Draft alone does not stale a family
export. No personal identity is written into export records.

The Family page eagerly checks last export independently of its document-list read.
A failed check disables export rather than guessing Create. Download PDF composes
the existing approved framework print and kit book, in exporter order, using the
family print body class and each rendering's named page size. Boilerplates and FAQ
are provisionally omitted from PDF because no print layouts exist; the UI says so.
Slides still exports those approved assets. Neither export changes the on-screen
asset rendering or grants Google Drive access.

### Asset approval UI

Approval and the board's approval attribution live on the document Asset view.
Standalone results are Draft previews with Open in Documents: an available
canonical receipt key selects its exact revision; otherwise the document default
opens. Receipt keys retained in memory never expand persisted run schemas, and
content hashes never infer revision identity or approval.

## Framework provenance and rebuilds

Downstream generation captures the approved current framework's exact revision ID,
number and content SHA before creating its Guild session. The capture is accepted
only when the submitted framework content matches the integrity-checked stored
content. A private, immutable project/agent/session capture is committed before the
session capability is returned; a failed write fails the generation request. The
result writer copies this server-owned `upstreamFramework` into the dependent
sidecar, not the content bytes. It removes any agent-supplied value of that field.
Historical sessions and mismatched submitted content retain unknown provenance.
A run-page generation also retains unknown provenance if project entitlement or
framework reads cannot be verified, rather than changing its existing start
behavior. Rebuilds pass an expected identity and fail those checks instead.

New revision HEAD metadata also carries this small reference. The project listing
projects `needsRebuild` using each dependent's **current** summary and the framework's
**approved current** summary, without adding revision-body reads. Only boilerplates,
FAQ and brand kit are eligible. An ID or content-hash mismatch marks them; revision
numbers are display-only. Missing assets remain Missing; unknown provenance,
Draft frameworks, historical noncurrent approvals and one-off runs never mark.
The Kit, Family and framework Downstream card consume this same server projection.
Existing historical summary fallbacks remain unchanged.

The [rebuild chain](./mktg-rebuild.md) runs only stale downstream agents, preserving
approved selection through the existing CAS writer. Family Slides-export freshness
belongs to the separate family-export flow, not this projection.

## Reads and attribution

Listings provide IDs, sequence and time; bounded metadata-only HEAD requests
provide new revision summaries. Opening a revision downloads and integrity-checks
only that revision's body. Status metadata is capped at 200 characters (with an
ellipsis); opening the body supplies the full status. Historical writers stored
only origin/sequence metadata; those entries load their immutable bodies under
the same concurrency bound to preserve date, intake mode, status, comments, and
restoration provenance without migration. Missing intake modes render a neutral
label, not an invented form run. Project listings read at most four documents
concurrently with serial reads inside each; individual document histories also
cap metadata/body and directory lookups at four. Dependent reads reuse one current
snapshot. A corrupt current never silently selects a different revision for
dependent agents; listings warn and omit an unreadable document without hiding
authentication or permission failures.

New revision metadata stores only an opaque effective user ID in `author-id`.
The mutable current record stores the selector's opaque ID in `changedBy` plus
a timestamp. If an impersonation target has no effective subject, generation and
Make current still succeed with `author-id` absent and `changedBy: null`; neither
the impersonator's subject nor any username is a fallback. These writes remain
unattributed and use the existing absent-author label on reads. Ordinary writers
without a subject still receive an authentication error. No names, usernames or
emails are persisted as attribution in these objects, and no personal attribution
is embedded in immutable revision bytes.
Names are resolved at read time through `UserService.getUserInfo` and the existing
NATS `USER_METADATA_READ` directory lookup, which accepts Auth0 subjects. Lookups
are memoized per request and bounded like revision reads. A stored author whose
name is empty or whose lookup failed renders “name unavailable”; only an absent
author record renders the historical no-name label. Failures warn once per ID
and never fail a document read. There is no username fallback.

Detail, revision, and Make current responses expose `revisionId`, `changedAt` and
name-only `changedBy` as `current`; neither stored user IDs nor the internal
revision manifest cross the API. A successful Make current returns attribution
from the committed CAS itself; a no-op keeps the original selection time and
actor. No record means `current` is null and no selection attribution is invented.
The document-view list shows “Current since” only on the current row, separately
from revision authorship. No client body can choose either identity. The UI labels
the selected current revision even when it is not newest, and shows a
nonsequential base and comment count only when stored data supplies them.
In-flight Make current writes are not cancelled by page destruction; late
acknowledgements cannot update another project or view.

The pre-revision artifact compatibility write carries `revision-managed`
metadata. Failed new saves therefore cannot manufacture a pre-revision v1 from
their leftover artifact.

## Durable started runs

Starts use the same private purpose, at
`document-runs/{project}/{sha256(sessionId)}.json`. The body binds the resolved
project, registered agent, document, private Guild session and opaque `creatorSubject`.
Owner tokens are never written; legacy missing subjects mean unattributed writes.
Mutable metadata holds attempt id, a bounded accepted-attempt ledger, original Started date,
retry/answers budget origin, answered questions id, prior revision, persist retry count,
`failure-text`, `revision-id` and state. Tracking metadata still uses HEAD/check/unconditional PUT:
concurrent writers can overwrite a completion with stale failed/storing metadata and lose its receipt.
This accepted limitation is reproduced in the run-service specs; “Make metadata-only retirement
conditional across writers” is a separate storage-contract WorkItem, not an atomic guarantee here.
The record body remains unchanged. The 384-byte ASCII ACK ledger never evicts an accepted id: a full ledger
rejects a new turn and requires a new session rather than allowing an old ACK to reopen it.
Public progress is an explicit projection: opaque run id, project/agent/document,
Started, state and plain-text failure text (agent reply or server-authored deadline /
storage-exhaustion reason); no session capability or starter identity is exposed.

States are `writing`, `questions`, `storing`, `failed`, `completed` and
`superseded`. Questions pause the writing deadline until accepted answers renew
the same attempt, preserving Started. Only a successful Guild lookup can spend
the writing deadline. A ready receipt equal to the prior attempt's revision is
not fresh completion evidence: it follows the pending path and can exhaust the
writing deadline. Ready without a recorded revision enters storing first,
with its own three-retry persistence budget, never the writing deadline. A
matching late receipt can finish a failed attempt on a creator poll or explicit
detail refresh. Effective start/run-id order retires older same-document runs.
Retirement is best-effort, off the durable ACK path; LIST failures cannot force a new Generate.
Reconciliation keeps the visiting writer's authorization but uses immutable per-generation
creator attribution (legacy unknown), never the visitor. Retry checks the exact stored session;
it creates no generation and does not change the document's current pointer.

The prefix LIST still enumerates keys. Run-discovery HEAD/GET/Guild work uses
the newest-mtime **128-record discovery window**, with concurrency four per operation for both
navigation reconciliation and Generate's supersede scan. Both paths HEAD first
and skip completed/superseded bodies; Generate GETs unfinished/failed candidates
only. A per-process **256-entry LRU terminal key/mtime cache** skips repeated terminal reads;
it is disposable, invalidated on writes/mtime changes and never an authority.
Fresh write timestamps are not memoized within S3's current write second. Failed,
completed and superseded runs are not automatically queried against Guild.
Failures keep a UTF-8/base64 snapshot capped at 768 source bytes, within object
metadata's size budget; one scoped detail-navigation refresh can return the full
reply. Errors are isolated per record. Terminal-record pruning/TTL is a follow-up;
there is no second active-run index or bucketed listing in this item.

Coverage is a private BFF count plus retained unfinished IDs, never a full list of
outside-window keys. The count includes unchecked history whose state is unknown
(and may already be closed); retained IDs require HEAD evidence or a matching
terminal cache and are capped at discovery + cache limits (384). Matching closed
cache entries contribute neither IDs nor count. Timer skips within the discovery
window HEAD first to exclude closed records, without GET/Guild work. The Documents transport treats
this as opaque partial coverage: retain known rows, never echo coverage IDs to
the client or interpret an unchecked count as active work or a current revision.

`readProgress` consumes this private coverage before HTTP serialization. It reuses
known cached public rows or materializes at most 384 retained IDs through bounded
tracking-store reads (concurrency 4), without Guild calls. Only validated public
rows leave the BFF, never coverage IDs/counts or private sessions. A real lookup
failure adds `progressUnavailable` so clients can warn/retry even with no row;
intentional window coverage alone never manufactures active work or endless retries.
Window-skipped unfinished writing/storing snapshots are last-known, not fresh
liveness: poll reads mark them unavailable, so the client's existing bounded
availability budget stops automatic checks. Closed-history coverage is not flagged.
Explicit detail navigation may pass `refreshRun` to refresh ONE scoped failed run;
timer reads reject that selector. A stale/foreign selector or transient tracking
error retains the stored document/known rows with an availability warning, never
a run-id-based document 404. Detail is loaded after refresh so late persistence
is visible. Retry POSTs recheck the stored session, never submit Generate or move
the approved-current pointer. Overview polls cancel on project/effective-subject
changes and destruction. Same-scope reloads and polls retain last loaded documents
on transient errors; 401/403 clears inaccessible data. Consecutive unavailable
reads back off to eight intervals and stop after the normal poll timeout, leaving
a warning/manual refresh; healthy reads reset the budget. Questions-only rows do
not start automatic polling. Unavailable tracking retains missing same-scope
run rows and suppresses absence claims, without hiding a known stored-current badge.

Document navigation keeps `?generation=` (single-use in-memory prepared intake)
separate from `?run=` (durable selected run). Only a fresh prepared proof can
submit Generate; restored intake needs explicit action. Metadata/body failures
share one bounded read budget and manual refresh, without hiding an acknowledged
current-pointer write. Structured views come from the document/intake registry;
malformed structured assets are unsupported, never Markdown fallback. ICP is unchanged.

Persistence receipts carry the exact `document_location` with `agent_key`,
`document_id`, `revision_id`; it is not a lookup of whichever revision is current.
UI models normalize this to their camel-case location. JSON content, sidecars,
CAS publication, current selection and attribution stay on the shared writer.
`getRawEventPayloads` replaces user/trigger content with
`mktg_session_turn_started`; a full unfiltered page appends
`mktg_session_events_truncated`. These content-free markers prevent an old
completion or finalize replay from ending a queued/truncated turn. Reasoning
MIME is filtered before any text, questions, envelope or reply extraction.

Retained opaque attempt ids reject sequential ACK replay but do not order distinct concurrent same-session
ACKs. Shipping intake submissions use fresh sessions and serialize their UI
handoff; arbitrary concurrent chat callers can still reorder start ACKs. A
monotonic admission token for that uncommon API path is a follow-up, not an
ordering guarantee supplied by this metadata refresh predicate.

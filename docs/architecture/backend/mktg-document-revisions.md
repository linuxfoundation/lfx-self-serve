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

## Run outcomes

Catalog result controllers await `GuildService.resolveRunOutcome` after authorization
and before logging or recording their response. It only adds failure to pending/questions;
validated ready/refused and already-returned failed results are unchanged. The request's existing raw-event read is reused.
The existing idle-runtime completion path uses failed/failureText for a final plain
reply without an asset. Provider error events add failed/failure when no output
arrives; both fields are additive, and terminal outcomes are never replaced.
An error outside a tool task must settle for 30 seconds without recovery. Only
explicit new work (`llm_start`, `runtime_start`, `llm_done`, `tool_*`) or trusted
agent text, including progress/questions, proves recovery. Status, heartbeat,
unknown and lifecycle/completion events leave the error standing at any age.
Tool-task errors are excluded using the same `isMktgToolTaskEvent` metadata predicate
as Member 360. Queued-turn boundaries discard prior-turn errors; capped pages
remain inconclusive rather than proving a terminal outcome.
Slides shares this strict recovery rule too. Its undated-error policy is unchanged;
the five-second constant remains exported for compatibility, not recovery evidence.
The recorded healthy stream supports immediate new-work recovery and long silent
model turns; a recorded failed stream is still unavailable. No unverified session
metadata probe is used. Lookup failures log a warning and preserve the result.
Generic browser history retains versions/answers/Q&A on failure, marks session reuse
invalid, and retries the exact failed request including feedback on a new session.

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
newest generation becomes the preview selection. A comment redraft uses that
same writer with its actual selected `basedOnId`, origin `revised`, and no automatic
approval. Host revision `comments` stays `[]`: frozen comment IDs and resolutions
are joined through the private descriptor and the validated agent sidecar, not
copied into new hashed host fields. Optional `redraft-run-id` and `comment-count`
object metadata do not change the revision's content hash.

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

### Internal two-role sign-off

The optional `signOff` map on `current.json` freezes opaque directory subjects
for the ED and TOC chair per revision. Names are resolved at read time. The
TOC chair's role and per-role approval names come only from the caller-scoped
role resolver when its visible chair has the same frozen subject and a non-null
name; otherwise those names are null (render the role label, not a directory
fallback). The request-cached resolver is shared by both projections. Unknown
optional shapes are ignored without invalidating the critical pointer. Generation
and Make current preserve these annotations; sign-off state never substitutes for
an `approvals` entry when deciding whether content is Approved.

`transitionSignOff` is an internal store seam, not an HTTP endpoint. A future
writer-entitled orchestrator must supply directory-resolved roles and pre-send
checks. Send and the first role decision preserve selection and its attribution.
The second explicit approval writes both role decisions, the `approvals` entry
and current selection in one `writeCurrent` CAS. Contention returns 412 without
retry. A second unapproved pending request returns 409; a stale pending annotation
on a revision already in `approvals` does not block a new request. Terminal
requests cannot be resent on the same revision. The explicit close/supersede
path (NB3) must ship before Send is mounted in the UI; unapproved stale pending
requests still need that operator-visible path. Changes requested requires an already-prepared comment
receipt; this seam does not itself create comments or submit agent redrafts.

The policy service owns `project-settings/{project}/sign-off.json` in the same
private artifact purpose, not the upstream project-service settings. Confirmed
absence means `single-writer`; malformed or failed policy reads fail closed.
Existing Approve refuses with 409 when persisted mode is `two-role`, including
an otherwise approved/current no-op. There is no separate publish operation.

`GET /api/mktg-agents/sign-off/settings?project=<uid>` and `PUT /api/mktg-agents/sign-off/settings`
(body `{project, mode}`) share the canonical project-writer boundary. Responses
contain mode, name-only ED/TOC-chair projections, canEnable and a role/policy reason,
never subjects, addresses, selector metadata or conditional-write tokens. PUT uses
the one observed private ETag (or create-if-absent), fails on stale comparison
with 412 and never retries. Writes are blocked during impersonation and capture
only the effective opaque subject. Switching off does not erase pending annotations
or modify any document/approval object.

Enable eligibility checks resolved role subjects, then the explicitly unimplemented
`approversCanWriteProject` policy seam. Until the approver-access ruling, GET
explains canEnable=false and PUT two-role fails with 409 rather than inventing a
grant; existing stored modes remain readable, and an authorized writer can switch
off with missing roles. This settings layer introduces no switch UI or Send/decide
HTTP activation.

### Sign-off checks (read-only)

`GET /api/mktg-agents/documents/:agentKey/:documentId/revisions/:revisionId/sign-off/checks?project=<uid>`
uses the same canonical project-writer boundary as document reads. It returns
`{ checks: [{ id, label, status, detail }] }` with five findings: verbatim tagline,
goal/audience coverage, avoid-list phrases, word limits and unanswered FAQ.
Stored agent findings add a sixth row when available. No role decision or write
occurs; this endpoint does not activate Send or decide authorization policy.

Checks use the selected stored JSON (kit chapters come from its sidecar), not
Markdown rendering or browser-supplied content. Dependent checks read only the
approved-current framework through the existing store seam; failed reads remain
errors, while confirmed absence produces explained `n/a` findings. A missing or
empty applicable goal/word-limit/FAQ structure does not pass by an empty loop.
Counts are recomputed, not trusted from agent sidecar counts. Avoid-list scanning
uses escaped, Unicode-aware phrase boundaries on explicit prose fields, excluding
definitions, SVG bytes, URLs, input records and source labels. No approved-current
selection, immutable bytes, comment thread or redraft is mutated by this read.

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
Recording a finished document or family export integrity-checks its start revision without requiring today's approved current to be readable; last-family freshness still fails closed if approved current is unreadable.
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

## Last scalar intake

A separate private snapshot at
`document-last-intake/{project}/{agentKey}.json` remembers the registered scalar
fields of the latest accepted Generate for an active living agent. It uses the
existing `marketing-os-artifacts` purpose and server-resolved writer partition.
The BFF starts this best-effort write only after sending the Generate acknowledgement;
a stalled or rejected snapshot never delays that acknowledgement. Explicitly submitted
blank fields are retained; absent fields are not invented as last-run answers.
Dependency attachment answer keys are excluded and dependencies must be resolved afresh,
not replayed from this snapshot.

This mutable key is deliberately last-PUT-wins, without CAS, LIST or chronological
conflict resolution. It holds run ID and start time, scalar answers, and document/logo
counts only; it does not retain an author identifier because there is no audit consumer.
Existing snapshots with the former author field remain readable, but that field is ignored
and never projected in the response. It never stores uploaded bytes,
extracted source text, source filenames, Guild sessions or capability tokens.
`GET /api/mktg-agents/intakes/:agentKey/last?project=<uid>` is writer-gated and
`private, no-store`; its explicit DTO exposes answers and counts only. Confirmed
absence returns `{ intake: null }`; failed or malformed reads return an error,
not absence. A failed post-start snapshot write warns without rejecting the
already accepted Generate, avoiding a retry that could create a second session.
There is no historical backfill, new source-file store or attachment-reuse claim.

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

## Field comments

Field comments use the existing private `marketing-os-artifacts` purpose at
`document-comments/{project}/{agentKey}/{documentId}.json`. Including the agent
prevents the living-document ID from colliding across asset types. Both reads
and writes use the existing Documents project's writer authorization and
server-resolved partition; this is not a broader reader entitlement.

`GET …/documents/:agentKey/:documentId/comments?project=<uid>&revision=<id>`
lists one revision's comments, including comments whose redraft result names
that revision. `POST` to the same path takes `project`, `revisionId`,
`anchor: { kind, key }`, `text` and an opaque `clientRequestId`. It verifies
revision membership and the source JSON's own field paths. The Brand Kit uses
a stable JSON field key internally and captures its verbatim stored string as
the agent's passage; caller-supplied passages, authors and timestamps are
rejected. Framework and Boilerplates use their contract's field paths.

Adds retry bounded ETag comparisons with `putConditionalObject`. Retrying the
same request preserves the original comment ID/time; reusing it for different
content or an effective author conflicts. Concurrent adds preserve both entries.
Missing objects mean known-empty; unreadable, wrong-scope, oversized, missing-ETag
or malformed records fail closed and are never overwritten. The whole-object
store is bounded to 500 comments and 2 MB without deleting history; exceeding
a write bound requires operator follow-up rather than silently losing comments.

Only the effective opaque subject is stored for authorship; an impersonated
target without a subject remains unattributed. Display names are resolved on
reads through `MktgDocumentAuthorService`, which also owns revision attribution.
The comments service shares that helper instance with its revision reader, so
both use one per-request name cache, with bounded fan-out. Lookup failures resolve
to `{ name: null }` without failing the comments read; thrown errors retain
structured `err` metadata, and unsuccessful directory responses warn without
inventing an error. Explicit public projection excludes subjects, request IDs
and the private send ledger. Bodies
and attribution are not logged. Direct asset editing and revision overwrite are
never allowed; redrafts append ordinary Drafts through the existing writer.

## Reserved comment sends and release

The lifecycle support alone registers no route; its additive producer exposes
writer-gated `POST /documents/:agentKey/:documentId/revise` with ID-only
`project`, `revisionId`, ordered `commentIds`, and `clientRequestId`.
`POST /documents/:agentKey/:documentId/revise/:requestId/release` is gated on
both the writer grant and the original send creator; its body carries only project. No caller previous JSON or routing is
accepted. The existing private comment ledger holds opaque `requestedBy`,
creation time, base/selected IDs, state, and an optional run hash; never a raw
session ID or owner token. Only a fresh committed reservation can call Guild.
The start ACK includes `priorVersion` from the immutable sidecar/context used to
start the Run, including on same-request replay; display revision metadata is
not its version authority. Unknown requests and existing requests owned by someone
else both release as `{ state: 'unknown' }` without creating or rewriting a ledger;
the distinction is logged only at DEBUG. Writer and effective-subject checks still
run, and only the creator may change an existing reservation.

Known window (a tracked follow-up): unknown releases write no tombstone. After a transport
failure, an original revise request still in flight can reserve after its unknown
release returns and the browser clears recovery intent. A creator-owned failed
tombstone would close that window; this round does not add one or auto-resubmit.

States are `reserved`, `started`, `uncertain`, `failed`, and `completed`.
Conclusive non-acceptance before a session exists marks the reservation failed
and reopens its threads in one CAS. Same-ID replay reports that recorded failure;
only an explicit new send uses a new ID. Unknown transport or a partial start
records uncertain and leaves threads sent. A successful but unusable Guild ACK,
HTTP 408, and HTTP 429 are also unknown acceptance, never proof of rejection.
An already-confirmed `started` row remains started on replay failure (including
concurrent confirmation); a 503 does not make that live run releasable.
Once a session may exist, fresh and replayed starts convert context/tracking/bind validation, conflict and authorization
failures to `503 MKTG_REDRAFT_START_UNCERTAIN`, never a definitive primary 4xx.
A failed uncertainty write is logged and still returns 503 to preserve recovery.
The creator can explicitly release
uncertainty to failed/open, retaining the old hash without rebinding it. Any expired
reserved send can also be released by its creator.
Uncertain/failed and unbound reserved sends older than the existing Run timeout
are not busy. Late bind/release/result work cannot touch a newer reservation.
No recovery path automatically resubmits to Guild.

The bounded immutable per-send descriptor is
`document-redrafts/{sha256(sessionId)}.json` in the same private artifact purpose.
It contains scope, base/version and frozen ID/anchor/text/time snapshots only;
no identity, capability, lifecycle index, LIST or worker. The descriptor precedes
public run tracking; raw session recovery comes only from the existing private
`document-runs` record after creator/scope/nonce checks.

Existing Run deadlines/retries remain authoritative. Conclusive refusal/failure,
invalid redraft echo, supersession, and an expired recorded run settle their own
send to failed/open. Bound questions (including an existing pause) and exhausted
persistence budgets also fail/reopen; a failed send stays failed on a late ready.
Ready settlement requires a scoped new revision receipt and
the exact guarded, ordered prior-version/comment echoes with resolutions.
History reads join each result's immutable descriptor and sidecar, so later sends
never overwrite an earlier result's resolutions. Names still resolve at read time.

Producer refusal guards keep redraft-bound sessions out of ICP result persistence,
generic chat and typed free-text answer turns. Ordinary sessions are unchanged.
Descriptor reads fail closed. One ready domain result pass performs up to three
private descriptor GETs for Markdown or two for JSON. Documents reconciliation
adds one settlement lookup (four/three total). A public result endpoint also
rechecks through the trusted Run reader, so it can perform seven/five respectively.
This bounded read cost is explicit; no second cache or lifecycle authority is added.

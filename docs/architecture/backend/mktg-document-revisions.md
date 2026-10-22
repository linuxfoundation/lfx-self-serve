<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Marketing OS document revisions

`MktgDocumentStoreService` owns document history over the private object-store
purpose `marketing-os-artifacts`. The existing project writer entitlement and
server-resolved project partition still gate every route.

## Run outcomes

Catalog result controllers await `GuildService.resolveRunOutcome` after authorization
and before logging or recording their response. It only adds failure to pending/questions;
validated ready/refused and already-returned failed results are unchanged. The request's existing raw-event read is reused.
The existing idle-runtime completion path uses failed/failureText for a final plain
reply without an asset. Provider error events add failed/failure when no output
arrives; both fields are additive, and terminal outcomes are never replaced.
A non-tool error must settle for 30 seconds without recovery. Agent text, including
progress text and questions, and new LLM/runtime/tool work recover immediately.
Only completion/lifecycle-end events inside five seconds can count as teardown.
These timings are inherited from the Slides export contract: no recorded failed
stream verifies that teardown assumption yet. The recorded healthy stream supports
immediate recovery on new work and long silent model turns, not failure teardown.
Slides deliberately shares this rule: new work or text inside five seconds now
recovers; its undated-error policy is unchanged. No session metadata probe is used
because its status vocabulary is unverified. Lookup failures log a warning and
preserve the original outcome.
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
silently changing bytes. `readNewestRevisionRef` deliberately retains newest
identity for export freshness comparison, so an approved export can be out of
date when a newer Draft exists.

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

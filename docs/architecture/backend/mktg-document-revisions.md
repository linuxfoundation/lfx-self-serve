<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Marketing OS document revisions

`MktgDocumentStoreService` owns document history over the private object-store
purpose `marketing-os-artifacts`. The existing project writer entitlement and
server-resolved project partition still gate every route.

## Current is not newest

Revision bundles remain immutable JSON at
`documents/{project}/{agentKey}/{documentId}/{sequence}-{sha256}.json`.
`current.json` in the same document prefix selects the revision dependent agents
read. Without that record, the newest historical revision is current: existing
documents need no migration.

Make current (the compatibility HTTP endpoint remains `POST …/restore`) changes
only `current.json`. It does not copy a bundle or add history. One-off run
documents refuse this action. New runs append through `recordRevision`, which
records their current base and moves current. The future comment-and-revise
writer uses that same method with its actual `basedOnId` and comments; this
change does not introduce a Revise endpoint or UI.

## Conditional publication

The current record also holds the IDs of committed revisions. An immutable
bundle is first created with `If-None-Match: *`, then a compare-and-swap of the
current record publishes its ID and selects it together. An interrupted or
losing write can leave an immutable object, but it is not visible history.
New objects carry `managed` metadata so an interrupted first save is not mistaken
for historical data when no current record exists yet.

A bounded retry handles competing new writers. The generation token in revision
metadata deduplicates overlapping result polls, including one-off run polls.
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
a timestamp. No names, usernames or emails are persisted as attribution in these
objects, and no personal attribution is embedded in immutable revision bytes.
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

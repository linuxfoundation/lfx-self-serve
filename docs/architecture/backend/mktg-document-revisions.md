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
only that revision's body. Historical writers stored only origin/sequence metadata;
those entries load their immutable bodies under the same concurrency bound to
preserve date, intake mode, status, comments, and restoration provenance without
migration. Missing intake modes render a neutral label, not an invented form run.
Project listings read at most four documents concurrently with serial reads inside
each; individual document histories also cap metadata/body reads at four. Dependent
reads reuse one current snapshot. A corrupt current never silently selects a
different revision for dependent agents; listings flag and omit a document whose
current revision is missing instead of failing the whole project.

New revision metadata holds the signed-in writer's LFID username and display
name. Those values are outside hashed immutable bytes, allowing attribution to
be anonymized without invalidating history. Historical revisions have no name.
The mutable current record holds the selecting person and timestamp. Detail,
revision, and Make current responses expose its `revisionId`, `changedAt` and
`changedBy` as `current`, without exposing the internal revision manifest. A
successful Make current returns the attribution from the committed CAS itself;
a no-op keeps the original selection time and actor. No record means `current`
is null and no selection attribution is invented. The document-view list shows
“Current since” only on the current row, using the selector's name or LFID; it is
separate from the revision author's attribution. No client body can choose
either identity. The UI labels the selected current revision even
when it is not newest, and shows a nonsequential base and comment count only when
stored data supplies them. In-flight Make current writes are not cancelled by
page destruction; late acknowledgements cannot update another project or view.

The pre-revision artifact compatibility write carries `revision-managed`
metadata. Failed new saves therefore cannot manufacture a pre-revision v1 from
their leftover artifact.

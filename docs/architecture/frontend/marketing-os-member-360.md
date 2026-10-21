<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Member 360 documents

Member 360 is a form-only catalog agent. Its run page collects a window, comparison
choice, and optional CSV/XLSX trackers. It never accepts a project name, UID, prior
ranking, or routing handle from an editable field. The BFF resolves the selected
project under the caller's token and requires its writer grant **before** starting
Guild. It renders the upstream intake with that project's authoritative UID, name,
and slug. The shared catalog's `formOnly` property also rejects the free-text chat
route, for both new sessions and follow-ups.

## Contract and persistence

The server-only `@lfx-one/shared/server` schemas and form renderer mirror `agents/member-360/src/{form,envelope}.ts`
in `linuxfoundation/marketing-os-agents` at
`45734bc6aad658545b1b60f1ceb6a57d0bdb6e2f` (`member-360-output/v1`). The BFF reads raw
Guild system events, validates each candidate, recomputes SHA-256 over the **original**
`JSON.stringify(tabs)` property order, checks the entitled project, and selects the
highest valid version. User and trigger events are excluded by the existing Guild
service. The previous stored Member Ranking is loaded server-side for trends;
a failed comparison read is a classified `MEMBER_360_COMPARISON_UNAVAILABLE` conflict, never a silent “no previous run”. The form explains that the user can turn off comparison or retry.

Every session produces one immutable run document through the existing document
store. The Markdown bundle keeps its existing summary hash; the sidecar contains the
complete six-tab envelope with its independent tabs hash. Revision reads validate
that schema and hash again before returning the optional `member360` typed field.
Navigation and persistence share `buildMktgRunDocumentId`; repeated result polls address that same document ID, including after a storage failure. The full envelope is stored once as the typed sidecar, independently of the summary's Markdown hash.

## One Document component

Generate navigates to `documents/member-360/:documentId`. The existing Document
component waits for a successful storage result before fetching the revision, then
renders its Member 360 type: summary, ranking, expanded member evidence, team actions,
Evidence, Method, and history. There is no second document viewer. The generic generating label comes from the registered document type; entity document-title binding is limited to Member 360, leaving other document title behavior unchanged. Pending capabilities
are stored only in tab-scoped session storage, keyed by effective user, project and
document, and expire after the shared run-storage TTL. Owner tokens never enter URLs.
The BFF domain-separates them from chat and binds them to the user, project and session.
Polling uses `exhaustMap` so slow result requests cannot overlap or be cancelled by a tick. Transient failures become pending ticks; authorization errors fail fast and the overall deadline remains bounded.

The intake and ranking filters use LFX wrappers with reactive FormGroups. The file-upload wrapper exposes custom upload events rather than a ControlValueAccessor: its handler writes parsed files into the tracker FormControl, with synthetic stable IDs independent of filenames. The chooser stays mounted; its wrapper clears the custom-upload queue and restores focus after parsing. Classified tracker validation reasons reach the form unchanged; only unclassified library errors use the generic fallback. The shared, browser-safe ranking policy supplies the same ordering to the view and workbook; schema constructors remain outside browser barrels.

The Member 360-specific generating handoff is intentionally minimal on `origin/main`.
The broader **Runs land on the document** work must reconcile this seam when it lands;
no sibling branch is a dependency of this implementation.

## Trackers, export and verification

`POST /api/mktg-agents/member-360/tracker?project=&filename=` receives raw
`application/octet-stream` bytes, capped at 5 MB. The BFF requires the resolved
project's writer grant before parsing. XLSX expansion is streamed and bounded before
ExcelJS reads XML; trackers have one sheet, unique non-empty headers, at most 2,000
rows and 100 columns. The form accepts up to ten files with a 5 MB combined parsed
payload cap. The BFF validates that form contract again on Generate. No uploaded
workbook is executed or sent to Guild as a binary.

`GET /api/mktg-agents/member-360/documents/:documentId/workbook?project=` requires
the project's writer grant, reads the stored hash-checked run, and assembles its six
tabs on demand. It accepts no client-supplied tabs and does not persist the XLSX blob.
Workbook metadata and ZIP entry dates are normalized to the run date inside `tabs`,
so repeated downloads are byte-identical. Downloads are private, non-cacheable XLSX
attachments; browser Blob URLs are revoked after download or immediately on view destruction. Empty Evidence exports a header-only worksheet without a structured table definition or invented evidence row. ExcelJS and JSZip are server-only; neither is in the client bundle.
Browser download APIs remain guarded by `isPlatformBrowser`.

`mktg-os-member-360.spec.ts` and `mktg-os-member-360-robust.spec.ts` stub the API,
writer grants, feature flag, and a synthetic auth TransferState in the public docs
asset shell. They require a served app but no real session, edit rights or Guild key.
The synthetic shell is test-only and does not alter production authentication.
The developer collects and type-checks these specs; UI QA executes them and checks
the 1440/1280/390 screenshots before the owner hand test.

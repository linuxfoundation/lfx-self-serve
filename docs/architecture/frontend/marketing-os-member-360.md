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
`45734bc6aad658545b1b60f1ceb6a57d0bdb6e2f` (`member-360-output/v1`). The BFF accepts envelopes only from successful
`finalize_member_360` results paired with their tool call in Guild events, never from
model prose, runtime output, tool inputs or another tool's results. It validates each candidate and recomputes SHA-256 over the **original**
`JSON.stringify(tabs)` property order, checks the entitled project, and selects the
highest valid version. Optional 2.0 additions at the top level, inside the existing
`inputs` object (including 2.0's `inputs.research` provenance), and on typed tab rows
are tolerated and stripped by validation; required
1.0 fields, enums and numeric bounds remain mandatory. The selected sidecar is the
stripped validated object, then privacy-sanitized and rehashed, never the raw candidate.
The original-byte check still authenticates the upstream payload before that projection.
User and trigger events are excluded by the existing Guild service. Raw events remain available for the shared activity feed, agent-authored questions and root termination; after the terminal-state layer, raw contract candidates supply privacy-only contact masks, never accepted output. The previous stored Member Ranking is loaded server-side for trends;
a failed comparison read is a classified `MEMBER_360_COMPARISON_UNAVAILABLE` conflict, never a silent “no previous run”. The form explains that the user can turn off comparison or retry.

Every session produces one immutable run document through the existing document
store. After validating the upstream hash, the BFF clears every ranking row's
`key_contact` before persistence and recomputes the sanitized tabs hash: immutable
revisions never retain that field's free-text contact identity. A typed, known-field
mapper redacts email addresses and exact original contact strings throughout the tabs
and summary Markdown before hashing. Exact matches use escaped Unicode word-boundary patterns;
short values and known placeholders are skipped to avoid corrupting unrelated words. Organization/project identity fields use the email pass only.
The sanitized envelope is schema-validated before storage; if redaction contracts the
summary below the minimum length, a neutral summary replaces it and is revalidated. A fallback that still fails validation returns a distinct terminal error, not a persistence retry.
This is a bounded deterministic policy, not name detection: model-authored prose may
still repeat names that require the upstream contract to forbid identity or use opaque IDs.
The Markdown bundle has its own summary hash. Revision reads validate the sidecar schema and sanitized tabs hash
again before returning the optional `member360` typed field. Navigation and persistence
share `buildMktgRunDocumentId`; repeated result polls address that same document ID,
including after a storage failure. The sanitized envelope is stored once as the typed
sidecar, independently of the summary's Markdown hash.

## One Document component

Generate navigates to `documents/member-360/:documentId`. The existing Document
component waits for a successful storage result before fetching the revision, then
renders its Member 360 type: summary, ranking, expanded member evidence, team actions,
Evidence, Method, and history. There is no second document viewer. While the run is
pending, its result endpoint reports the shared web/LFX activity feed, rendered by
`lfx-mktg-run-activity` in the Document's generating state. Its title comes from the
registered document type; phases and an expandable step list show progress, with no
questions phase for the 1.0 form-only intake. A 2.0 text turn headed by the questions
marker returns only `needs_input` and activity (no question text) without persisting a document. The generating view retains
the feed and states that this page cannot answer yet and the run stays open; polling
stops without discarding the pending session. There is no question parser or answer UI.
Entity document-title
binding is limited to Member 360, leaving other document title behavior unchanged. Pending capabilities
are stored only in tab-scoped session storage, keyed by effective user, project and
document, and expire after the shared run-storage TTL. Owner tokens never enter URLs.
The BFF domain-separates them from chat and binds them to the user, project and session.
Polling uses `exhaustMap` so slow result requests cannot overlap or be cancelled by a
tick. Activity updates do not release the storage gate. Transient failures become
pending ticks without erasing the last successful feed; authorization errors fail
fast and the overall deadline remains bounded.

The intake and ranking filters use LFX wrappers with reactive FormGroups. The file-upload wrapper exposes custom upload events rather than a ControlValueAccessor: its handler writes parsed files into the tracker FormControl, with synthetic stable IDs independent of filenames. The chooser stays mounted; its wrapper clears the custom-upload queue and restores focus after parsing. Classified tracker validation reasons reach the form unchanged; only unclassified library errors use the generic fallback. The shared, browser-safe ranking policy supplies the same ordering to the view and workbook; schema constructors remain outside browser barrels.

## Trackers, export and verification

`POST /api/mktg-agents/member-360/tracker?project=&filename=` receives raw
`application/octet-stream` bytes, capped at 5 MB. The BFF requires the resolved
project's writer grant before parsing. XLSX expansion is streamed and bounded before
ExcelJS reads XML; trackers have one sheet, unique non-empty headers, at most 2,000
rows and 100 columns. The form accepts up to ten files with a 5 MB combined parsed
payload cap. Generate re-validates the shared form contract, including the tracker
filename's single-line CSV/XLSX allowlist (no CR, LF, slash or backslash); the renderer
also flattens CR/LF defensively before placing a filename in a tracker delimiter.
The mirrored upstream schema retains its literal limits, while the browser/parser
use shared tracker-cap constants. No uploaded workbook is executed or sent to Guild
as a binary.

`GET /api/mktg-agents/member-360/documents/:documentId/workbook?project=` requires
the project's writer grant, reads the stored hash-checked run, and assembles its six
tabs on demand, without a Key Contact column. It accepts no client-supplied tabs and
does not persist the XLSX blob.

The Summary is a width-bounded QBR canvas with metadata, a tier table/bar chart,
optional movers, the complete watchlist, team action counts and data coverage;
large watchlists continue vertically. Ranking dates are real date cells; values,
scores and contact counts remain numbers with currency/decimal/integer formats.
A single category-block heat scale accompanies engagement, renewal, tier and
priority highlighting. Renewal thresholds and tier tones are shared policy;
widths, formats, LFX fill shades and chart layout stay in server-side presentation
constants. ExcelJS has no chart API, so JSZip injects native DrawingML parts,
relationships and content-type overrides after writing. This writer requires
Summary to be the first worksheet and to contain table parts; an unexpected layout
fails with `500 MEMBER_360_WORKBOOK_INVALID` rather than emitting a partial chart.

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

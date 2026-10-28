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
`45734bc6aad658545b1b60f1ceb6a57d0bdb6e2f` (`member-360-output/v1`). The direct successful `finalize_member_360` result paired with its tool call stays first and unchanged.
Since agent 2.1.1, the paired result may instead be a `member-360-finalize/v1` receipt `{ok, sha256, rows, partial}`, with `sha256` equal to the validated envelope's `content_sha256`.
Without a direct valid envelope, the BFF accepts a root agent task's final `runtime_done` text or `agent_notification_message` carrier only when its `content_sha256` is in the successful receipt map.
The candidate's `partial` status (`summary_markdown` starts with `Partial report.`) and ranking/evidence row counts must match that receipt.
Both paths validate schema and size, recompute SHA-256 over the **original** `JSON.stringify(tabs)` property order, check the entitled project, and select the highest valid version.
The hash binds tabs only; `summary_markdown` stays model prose and is redacted as before, alongside the tabs, before persistence.
Unmatched or prose-only envelopes, tool inputs and another tool's results remain refused.
Optional 2.0 additions at the top level, inside the existing
`inputs` object (including 2.0's `inputs.research` provenance), and on typed tab rows
are tolerated and stripped by validation; required
1.0 fields, enums and numeric bounds remain mandatory. The selected sidecar is the
stripped validated object, then privacy-sanitized and rehashed, never the raw candidate.
The original-byte check still authenticates the upstream payload before that projection.
User and trigger events are excluded by the existing Guild service. Raw events remain available for the shared activity feed, agent-authored questions and root termination; after the terminal-state layer, raw contract candidates supply privacy-only contact masks, never accepted output. The previous stored Member Ranking is loaded server-side for trends;
a failed comparison read is a classified `MEMBER_360_COMPARISON_UNAVAILABLE` conflict, never a silent “no previous run”. The form explains that the user can turn off comparison or retry.

The result scope requires an exact project name and either an exact UID with an
absent or matching slug, or an exact slug when the UID differs or is absent.
The MCP and LFX One use different UID namespaces; agent 2.1.0's exact-name fallback
can therefore return the MCP record's UID. Before storage the BFF normalizes
`project_uid` to LFX One's UID and retains a differing agent UID as `lfx_project_uid`.
This leaves stored-run readers, including the workbook's UID guard, scoped to the
same entitled LFX One project. The intake is unchanged.

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

## Run-page questions

Generate stays on the Member 360 run page, polling with the creator capability kept in the subject-keyed attempt registry (same visit; cross-entry = B2). The shared activity feed covers pending work; `needs_input` opens the shared one-question-at-a-time stepper under “Member 360 needs your answers to finish.” Accepted answers resume the same poll, ignoring the answered digest, and a stored ready result opens the finished document. Guild failures open the existing classified document failure view. At the Member ceiling polling slows and says “Still running”; a clock never fails the run. Same-visit re-entry restores the subject-keyed attempt; the explicit cross-entry `?run=` receiver is a separate layer. Documents questions entries target the Member 360 run page; the document page shows only a plain continuation notice for its creator.

## One Document component

Generate navigates to `documents/member-360/:documentId?run=<opaqueRunId>` after the
server records the start. The existing Document component uses its shared document
metadata polling cycle, not a Member-specific result receiver or browser pending cache.
It waits for a committed revision before rendering the existing Member 360 type:
summary, ranking, expanded member evidence, team actions, Evidence, Method, and history.
A plain document URL in another browser works without the run selector, owner token,
session storage or the initiating tab: authorized reads reconcile the saved session.
Owner tokens never enter URLs. The creator-bound result endpoint remains compatible
for existing callers, but the page does not poll it directly.

The shared generating card renders optional server-filtered activity through the
existing `lfx-mktg-run-activity` below its existing lines, for any tracked document
whose progress carries activity (including living assets). Only the original creator receives
activity; another project writer sees the same generating card without a feed or extra placeholder.
Member activity also uses the stored-envelope contact/email redactor. Cached activity is bound to
the viewer identity at its read: an identity change hides it immediately, without re-reading the
subject-independent Member document. A response begun for another viewer cannot re-expose its feed. Its title and breadcrumbs
come from the registered type. No questions text or reasoning reaches this feed.
Member's `needs_input` maps to `questions` with validated `member-360-questions/v1` items and a SHA-256 digest of the boundary-trimmed turn. Internal question `basis` is omitted from the creator response. Unlike the agent's strict schemas, the BFF intentionally strips unknown question extensions for forward compatibility.

`POST /api/mktg-agents/member-360/answers` requires the creator/project-bound owner token, the questions digest and one bounded `{id,text,origin}` answer per question. It rereads the current turn, rejects stale answers after the next turn is queued, renders guarded `member-360-answers/v1` blocks and sends them on the same Guild session with the catalog mention on its own line. Tracking resumes to writing. A superseded questions turn cannot pause a resumed run again; Guild-ended sessions retain the existing failure precedence (#4267).

Follow-ups: concurrent-submit idempotency keyed on `questionsId`, and self-healing a failed `resumeAfterQuestions` tracking write (today durable `questions` can remain until a ready/failed result). A classified
failure keeps the short reason, collapsed Details and host-scoped Run again; the
server-projected `failureReason` preserves that classification independently of prose on failed runs only.
The `MktgRunFailureReason` union currently contains `Member360FailureReason`; the dedicated
`isMktgRunFailureReason` guard accepts only the codes in the Member failure-message allow-list,
not arbitrary metadata/attempt IDs. A new one-off's classified failures extend that union and
its guard's explicit allow-list together, with their own safe message presentation; no prose matching.
A Guild-ended Member session is a classified failure that offers Run again, not Retry or paused Refresh:
the Member failure view hides the shared retry card, so it cannot reopen a dead session. The BFF retry API is unchanged; this is a document-page action policy.
Entity document-title binding remains limited to Member 360. Transient reads retain
last-known content/progress within the shared bounded backoff policy; access errors
clear inaccessible data. The Member-specific browser pending transport is removed.
On the server, Member 360's result fails only when Guild ends the session without a valid envelope (`member360TerminalResult`), never by the clock while Guild still works; a questions turn followed by a session end is reported as that failure, not as `needs_input` (#4267).

Member 360 fails only when Guild confirms the session ended without a valid result;
error-typed events alone remain pending, and the shared settled-error overlay is not
applied to this receiver. A questions turn stays `needs_input` through its own root
`runtime_done`; only a later reply, a newer turn's completion or a session end
recognized by the shared questions-precedence helper supersedes it. A status-only
ended event does not currently supersede unanswered questions under that helper.
Polling has a two-hour safety ceiling measured from the
stored `startedAt`, not a fresh ten-minute timeout on navigation; this ceiling is
absolute from the run's start, and questions do not extend it. Reaching the ceiling
stops polling with a non-failure check-again notice and retains the pending capability.
After that ceiling, reload or Retry makes one result check without restarting the
polling window; a nonterminal response keeps the capability and shows the notice again.
Only a ready or failed result (or a permanent transport error) forgets it.

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
priority highlighting. The workbook and result page read renewal thresholds and
tier tones from shared constants. Widths, formats, LFX fill shades and
chart layout stay in server-side presentation constants. ExcelJS has no chart API, so JSZip injects native DrawingML parts,
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

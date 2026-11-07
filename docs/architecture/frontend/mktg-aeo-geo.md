<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# AEO/GEO audits in Marketing OS

The catalog's `aeo-geo` entry and `AEO_GEO_INTAKE` register the live agent's
form-only flow. The existing run route hosts `AeoGeoRunComponent`: website
prefill comes from the active LFX project, remains editable, and loses its
provenance label when changed. Key pages are optional: none, or two to five
distinct absolute http(s) URLs. A new audit never revises an earlier report.

`POST /api/mktg-agents/aeo-geo/generate` requires the effective user and project
writer grant, validates the intake, takes routing from the shared catalog and
sends the live agent's canonical rendered text. The form includes optional
`project_name` and `project_uid` from LFX context; the BFF replaces those hints
with the writer-entitled project's canonical name and UID. The renderer's
`LFX SCOPE` JSON line matches the 2.0 form renderer. The 1.0 rendered-text
parser ignores it safely; its strict structured-form schema would reject the
extra fields, so generation continues to send text, never a raw form object.
The response includes a stable run-document id and creator-bound owner token.
`MktgPendingDocumentService` retains that capability under the effective user,
project and document, with the existing run TTL; it never travels in a URL.
Research stays on the run page with the shared activity feed. A 2.0 run may
pause there on a single questions round; a 1.0 run never emits that contract.
After the answers are acknowledged (or a no-questions report is ready), the
page opens `documents/:agentKey/:documentId` and waits for storage there.

The one Document component handles both pending and stored reports. If a
not-yet-stored document has a matching pending capability, it polls the result
endpoint and displays a generating state until the persistence receipt arrives.
A ready Markdown result without that receipt is not a stored document. Polling
is bounded, retries transient failures and cancels on destruction or scope
change. A refresh can resume the pending run; another user cannot load it.
The audit receiver stays separate from the shared living-asset Runs-land lifecycle; it does not create a generic run record.
Document reads preserve the shared client's poll/refresh arguments and use its trailing expected-404 flag only for the matching pending audit.

While generating, the existing result endpoint projects Guild session events
with `buildMktgRunActivity`, just like the Messaging Document flow. The pending
service forwards this optional activity before filtering for storage completion;
the Document view reuses `MktgRunActivityComponent` and its shared stage labels.
First polls and older runs without activity keep a generating state. Feed
state resets with the effective user, project or document and polling is
cancelled on that change. Reloading the run route finds the user-scoped
pending capability and resumes research/questions; a saved writing phase
continues to the Document route. Reloading that route resumes storage polling.

Only a final-answer `aeo-geo-questions/v1` turn becomes questions, never a
progress message or fetched tool text. A shared guard validates the one fenced
JSON block. `MktgRunQuestionsComponent` presents it one question at a time,
with Back/Continue, suggestion acceptance or editing, and no skip. The new
`POST /api/mktg-agents/aeo-geo/answers` checks creator proof, project writer
rights, the session's document id and the actual questions before posting a
byte-compatible, protocol-guarded `aeo-geo-answers/v1` user message to the SAME
Guild session. Omitted API answers remain caveats; the interactive stepper
requires an answer to each question. A history read recognizes an acknowledged
answers turn after a lost response/reload; history is never read as a report.
A plain transport/domain-confirmation refusal stays an error on the run page,
with no invented question round or report. Malformed questions fail visibly.
Question position and edits stay in the same user/project/session-scoped pending record, with its existing TTL/pruning; they are not proof of writing.
Acknowledged answers, the writing handoff or termination clear the question draft. Reloading or leaving/returning restores the current question and edits.
The intake remains domain plus optional key pages, not messaging sources or
uploaded documents. The agent is reachable at `/mktg-os-agents/aeo-geo`
through the existing `:agentId` route. The dedicated run breadcrumb reads
`<project> kit › Website & web › AEO/GEO`. The kit crumb links to the existing
Marketing OS home; both the run and report use the shared linked Kit/Family breadcrumbs. The Kit's
`families/website-web` page links its Run action to the catalog's `aeo-geo`
intake and stored rows to `documents/aeo-geo/:documentId`. The shared document
type remains `kind: 'run'`, so the family counts independent reports this month,
not asset revisions. Its agent key, catalog id and display name come from the
existing document-type registry. The dedicated audit dispatch matches that
registered intake id, not every `oneOffDocument` intake (which now also includes
LinkedIn). Main's JSON asset views and approved-current pointers stay separate
from this Markdown one-off path.

The BFF reads only the named finalize tool's results, validates
`aeo-geo-output/v1`, recomputes each
candidate's content hash before version selection, then uses the shared artifact
and revision stores. Each session addresses a separate immutable document.
Concurrent polls use the store's current-pointer CAS and generation token so only one revision becomes visible for a session. Reopening serves
validated verdict/score fields from the revision sidecar, alongside its original
Markdown. A 2.0 sidecar may also carry the frozen typed `report`: headline,
six-category scorecard with summaries, overall/verdict, findings/evidence,
priority-ordered recommendations, caveats and typed sources. The shared
`isAeoGeoReport` guard validates those fields and the envelope checks their
scores, overall and verdict agree, with sources covering the audited pages.
The server projects it through the existing optional `aeoGeoReport` field;
no browser input becomes a report sidecar. The guard mirrors the frozen min-length/HTTP-regex gates; link safety is separately enforced by the renderer. The Document view uses
`AeoGeoReportComponent` for both web and print. A 1.0 report without that field
uses the original Markdown renderer without a special legacy label; a malformed
typed report is not silently treated as legacy. Download PDF uses the shared
`MktgPrintService` browser dialog (Save as PDF) and the asset pages' print-only
CSS. Only the validated report prints, never
the navigation, and a scope change or destruction cancels a pending print.
No Markdown file is downloaded. Refusal and permanent polling failures clear recovery and offer Run again without Check again. A timeout keeps the capability until its TTL: “The audit is taking longer than expected.” offers Check again, which resumes result polling so a late report can be stored. Explicit Run again clears the old capability before re-entry or a fresh generation. A transient poll fallback is marked, never treated as proof that answers landed. It offers Run again, never comments, revision
or restore controls for a report. Its single immutable revision row and About share the right column at laptop width and stack below on narrow screens.
Slides export is a separate capability,
not a simulated control here.

The content and structural `mktg-os-aeo-geo` Playwright specs stub every Marketing
OS call and project entitlement and run against the served branch.
They cover validation, storage-dependent generating state, independent runs,
research/questions re-entry, same-session answers, writing recovery, typed
report presentation, PDF printing, refusal/errors, access denial and responsive
layouts. The existing typed-report case checks About to the right at 1440px and below at 390px.
The contract fixtures retain the provided 2.0 key-mode QA's event and
protocol shapes with synthetic identities, project slogans and reserved URLs; non-identifying technical observations and numeric gates are retained. No raw task/author metadata or fetched HTML is copied into tests.

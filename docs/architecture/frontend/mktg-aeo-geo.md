<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# AEO/GEO audits in Marketing OS

The catalog's `aeo-geo` entry and `AEO_GEO_INTAKE` register the live agent's
form-only flow. The existing run route hosts `AeoGeoRunComponent`: website
prefill comes from the active LFX project, remains editable, and loses its
provenance label when changed. Key pages are optional: none, or two to five
distinct absolute http(s) URLs. Notes are optional context (the audience,
comparison targets), at most 10,000 characters, in the Notes field the
family's other forms carry. A new audit never revises an earlier report.

`POST /api/mktg-agents/aeo-geo/generate` requires the effective user and project
writer grant, validates the intake, takes routing from the shared catalog and
sends the live agent's canonical rendered text. The form includes optional
`project_name` and `project_uid` from LFX context; the BFF replaces those hints
with the writer-entitled project's canonical name and UID. The renderer's
`LFX SCOPE` JSON line matches the 2.0 form renderer. The 1.0 rendered-text
parser ignores it safely; its strict structured-form schema would reject the
extra fields, so generation continues to send text, never a raw form object.
Notes are rendered last, as the agent's `NOTES (untrusted context):` …
`END NOTES` block, after the structural key-page lines its parser reads, with
every protocol-looking line inside them quoted (`guardAeoGeoText`, the agent's
`guardText`); blank notes send no block.
Every audit is a tracked one-off run (`tracksDocumentRun`, the
[durable started runs](../backend/mktg-document-revisions.md#durable-started-runs)
LinkedIn and Member 360 use). Generate preflights tracking storage and the
creator's active slot before any Guild session exists: a second start while the
creator's audit is `writing`, `questions` or `storing` in that project is 409
`MKTG_RUN_ACTIVE` with who started it and when, and only `discard: <activeRunId>`
closes that run and starts the new one. The accepted session is recorded with
`startForOneOff`. The run page hands that 409 to the shared
`MktgActiveRunGuardService` dialog ("Your AEO/GEO report run is in progress",
"Started …"): "Open it" opens the run's document, "Discard and start over"
re-sends the same audit with `discard`. A refused start leaves a capability this
browser already holds in place; an earlier capability, and that of a run the
person discards, is cleared only once the replacement start is accepted, so a
failed discard request leaves it. "Open it" opens the run's Document page; in the browser that holds the
capability, that page shows an audit in its writing phase as generating and
sends one that is still researching or waiting for answers back to the run page
(see the Document component below), so the person can answer here.
The response includes a stable run-document id, the public `runId` and a creator-bound owner token.
`MktgPendingDocumentService` retains that capability under the effective user,
project and document, with the existing run TTL; it never travels in a URL.
Research stays on the run page with the shared activity feed. A 2.0 run may
pause there on a single questions round; a 1.0 run never emits that contract.
After the answers are acknowledged (or a no-questions report is ready), the
page opens `documents/:agentKey/:documentId` and waits for storage there.

The one Document component handles both pending and stored reports. If a
not-yet-stored document has a matching pending capability in its writing phase
(`phase: 'writing'`, set by the run page before it opens the Document route), it
polls the result endpoint and displays a generating state until the persistence
receipt arrives. A capability that has not reached that phase (research, or a
questions turn), or whose run the server records as waiting for answers, is not
waited on here: the storage wait drops a `questions` result and would only time
out. The page navigates to the run page instead (`replaceUrl`, without `run`),
which resumes research or the questions from the same capability, and the
wait's anchor (`waitStartedAt`) is not set until the audit is writing, so the
600 s storage budget is never spent on research or answering. This covers the
409 dialog's "Open it", a Started runs "Open" link during research and a typed
URL. If that navigation fails the page says "This audit is not finished. Open
AEO/GEO from the kit to continue it." and keeps the capability. A stored report
always opens, whatever the capability's phase.
A ready Markdown result without that receipt is not a stored document. Polling
is bounded, retries transient failures and cancels on destruction or scope
change. A refresh can resume the pending run; another user cannot load it.
The audit's result endpoint reads through the tracker (`ownedOneOffResult`), so each poll records the run's state, and a
writer's Documents read advances the same record and stores the report as the creator's. A poll for a stored run that is
discarded or superseded is refused before the audit result is read (409 `MKTG_RUN_CLOSED`), so a stale tab cannot store a
late report of a discarded audit; the run page and the Document page end on "This audit was closed. Start a new audit."
and poll no further. The audit keeps its own receiver on
the run and Document pages (its browser capability), not the shared run-progress view: opened without that capability (another
browser, another writer, a Started runs row), the Document page shows the same generating state and re-reads until the
recorded run is stored; a recorded run waiting for answers or failed is a plain line with Run again. That re-read
trusts only its own answer: a run the server no longer lists (discarded, superseded or dismissed) is a 404 and ends on
the plain not-found line, while a read whose run record the server could not read (`progressUnavailable`, no revision)
is a transient failure the shared poller retries on its capped backoff, and the loop ends at `MKTG_RUN_POLL.timeoutMs` from the view's first read of the run as
running ("The audit is taking longer than expected."), the server's writing budget, which a tab return never restarts.
On the Documents page a Started runs row of an audit waiting for answers reads "Answer the questions" and opens the
run page only in the browser that holds its capability; anywhere else the row reads "Open" and opens the run's
Document page (`?run=`), where that waiting line explains it, never a blank intake form. A `writing` row always reads
"Open" and opens the Document page; research is recorded as `writing`, so in the capability's browser that page
forwards a run still in research to the run page, where questions that arrive later are shown.
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
with Back/Continue, suggestion acceptance or editing, and no skip: every answer
has to say something, and only the question about what to leave out of the
audit (always the id `exclude`, listed in `MKTG_NONE_ALLOWED_QUESTION_IDS`) may
be answered with a literal `none`. The BFF applies the same rule. The new
`POST /api/mktg-agents/aeo-geo/answers` checks creator proof, project writer
rights, the session's document id and the actual questions, then claims the
questions turn named by `questionsId` on the run tracker (`claimSessionAnswers`,
as LinkedIn does) before posting a byte-compatible, protocol-guarded
`aeo-geo-answers/v1` user message to the SAME Guild session. The first answer
wins: any later one for that turn (a stale window, a retry after a lost
response) is 409 `MKTG_RUN_ANSWERED` and sends nothing, and the run page shows
"<name> already answered these — the agent is writing." and opens the report.
A 404 from the answers endpoint (an audit started before audits were tracked has
no run record) is final: the run page clears the capability and shows "This audit
can no longer take answers. Start a new audit." without re-reading the run.
The claim requires one answer per asked question, as the interactive stepper
does; invalid answers are a 400 that leaves the turn unclaimed, and a delivery
that fails after the claim keeps it. A claimed turn is not offered again while
the run record can be read: as long as Guild still shows it open (the delivery
is in flight, or failed after the claim) the result endpoint answers `pending`,
not the same `questions` (`ownedOneOffResult`, shared with LinkedIn), so after a
failed answers POST the run page's re-read opens the report instead of a stepper
whose second send could only be refused. The exception, a poll whose record read
fails transiently and so returns what Guild reports, is named in the
`ownedOneOffResult` paragraph of
[durable started runs](../backend/mktg-document-revisions.md#durable-started-runs).
The same questions otherwise come back only when the server did not take
the turn (the POST failed before the claim); they are offered with the answers
kept and the retry goes through. When the answers never reached the agent, the
report page waits to the run's deadline ("The audit is taking longer than
expected.") and the tracker fails the run at its writing deadline, as for any
audit that stops; a new audit before then gets the active-run dialog. A history read still recognizes an answered
turn so a reload does not ask again; history is never read as a report.
A plain transport/domain-confirmation refusal stays an error on the run page,
with no invented question round or report. Malformed questions fail visibly.
Question position and edits stay in the same user/project/session-scoped pending record, with its existing TTL/pruning; they are not proof of writing.
Acknowledged answers, the writing handoff or termination clear the question draft. Reloading or leaving/returning restores the current question and edits.
The intake remains domain plus optional key pages and notes, not messaging sources or
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
`AeoGeoReportComponent` for both web and print. A finding's or recommendation's
detail renders through the shared `MarkdownRendererComponent` in restricted mode,
so the agent's inline code spans render as code (not as literal backticks) on both
surfaces, in the report's own type; scorecard summaries stay plain text, and
each caveat renders as the reader sentences of `aeoGeoReaderCaveat` (shared
utils): a failed third-party search and an LFX record the agent could not read
map to fixed wording, and the known plumbing shapes (a snake_case field name, a
slug, a uid, a credits or quota phrase, a provider subject quoting a failure)
are left out of the sentence that carries them; a quoted result title and any
sentence about the audited site pass through unchanged — the stored report is
unchanged, and, on screen and in print alike (one shared component), a report
with no caveats shows no Caveats section and two caveats that map to the same
sentence print it once (`aeoGeoReaderCaveats`). The print
of a typed report opens with the report's title and facts, then the score card,
then the report without a second headline, and its headings, scorecard rows,
findings, recommendations and list items carry CSS Fragmentation `break-after:
avoid` / `break-inside: avoid` so no heading is orphaned and no block splits
across pages; a Sources list of up to `AEO_GEO_SOURCES_KEEP_TOGETHER_MAX` items
is one such block with its heading, a longer one flows (no page numbers: the zero-margin page setup has no
margin area for a counter). The shared `MktgPrintSheetComponent` takes an optional
`head` template, rendered as a row of its table head group under the page room,
which the report uses for the shared `MktgPrintRunningHeadComponent` (project,
"AEO/GEO report", date; no version) in the project's kit brand or the LF look —
Chromium repeats it on every page, WebKit prints it once. A 1.0 report without that field
uses the original Markdown renderer without a special legacy label; a malformed
typed report is not silently treated as legacy. Download PDF uses the shared
`MktgPrintService` browser dialog (Save as PDF) and the asset pages' print-only
CSS. Only the validated report prints, never
the navigation, and a scope change or destruction cancels a pending print. A
press before the project's Brand Kit read settles (a kit, or the LF look after
a failed read) is kept as one press and prints after the render that follows;
the button stays enabled, and a document change or destruction drops the
waiting press.
No Markdown file is downloaded. Refusal and permanent polling failures clear recovery and offer Run again; there is no Check again button. A timeout keeps the capability until its TTL: “The audit is taking longer than expected.” stays as a plain line. The storage wait's deadline is absolute from when the wait started, so a tab return or window focus does not restart it; a wake re-reads the stored report once through the shared visibility poller. A late report is stored only when a result read happens; after the deadline the page makes none, and Run again starts fresh. A transient stored-report read outage keeps checking on its own behind the one plain line. Explicit Run again clears the old capability before re-entry or a fresh generation. A transient poll fallback is marked and never opens the report; a `pending` read after the run page's own answers POST failed does open it, but proves the claim and not the delivery, so the page first shows one notice: “Your answers may not have reached the agent. If the report does not arrive, start a new audit.” (never after a POST that succeeded). The report page offers Run again, never comments, revision
or restore controls for a report. Its single immutable revision row and About share the right column at laptop width and stack below on narrow screens.
Slides export is a separate capability,
not a simulated control here.

The content and structural `mktg-os-aeo-geo` Playwright specs stub every Marketing
OS call and project entitlement and run against the served branch.
They cover validation, storage-dependent generating state, independent runs,
research/questions re-entry, same-session answers, the active-run dialog on a
second start, the answered notice on a second answer, writing recovery, typed
report presentation, PDF printing, refusal/errors, access denial and responsive
layouts. The existing typed-report case checks About to the right at 1440px and below at 390px.
The contract fixtures retain the provided 2.0 key-mode QA's event and
protocol shapes with synthetic identities, project slogans and reserved URLs; non-identifying technical observations and numeric gates are retained. No raw task/author metadata or fetched HTML is copied into tests.

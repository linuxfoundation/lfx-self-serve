# Project Marketing kit

The UI sections below land with layers 2–4 of the kit stack; layer 1 provides the shared contract and source-reader adapter.

The project opens its kit. `MKTG_KIT_FAMILIES` owns the Main board's family order,
asset membership and lead copy. Agent names, routing and availability come from
`MKTG_AGENTS`; declared ids without a catalog entry create no tile or enabled Run action.
The Kit tab keeps all nine families; the Agents tab groups only catalog-backed agents.
All five tabs (Kit, Agents, Requests, Access and Documents) share `lfx-mktg-kit-header`
(the project h1), the `max-w-screen-2xl` page width and `lfx-mktg-kit-tabs`.
Requests and Access are placeholders. Documents lists all stored assets by default;
`?type=<agentKey>` filters to a document type, and an absent or unknown type shows All documents.
The `/documents` route remains a deep-link target. Its Documents title/description sit below the tab strip.
The listing refreshes on entry and type changes; below the page container's 800px content-box breakpoint,
a type change brings the selected panel into view once its content renders. A successful restore cancels
any pre-write listing refetch and reads the committed current pointer before accepting new list data.
The five Kit tabs stay in one horizontally scrollable row on narrow screens.

## Plan-of-record conformance

ICPs are the framework's `icp` section within its `{ mf, icp, mh, nums }` bundle,
not a separate kit asset or agent. The explicit document exclusion list contains only
legacy `icp`; those documents stay accessible in Documents, not the kit. The agent
exclusions are `icp` and `website-builder`, which is not a kit agent.
Contract tests assert the exact exclusions, pending ids and complete catalog/store coverage.
FAQ and Boilerplates are live store-backed assets in Positioning & brand, in the board's run order.
Assets without a registered store type show Coming soon. Agent availability always
comes from the catalog; the kit never invents entries.
Unbuilt families show their description and lead on Kit, never placeholder asset rows.

## Reads, states and Current

Kit and Agents use `GET /api/mktg-agents/documents?project=<uid>` through the existing
client. There is no kit storage or BFF. Browser-only reads keep SSR stable and cancel
on scope changes. Failed reads never assert an empty kit or invented zero counts.

Without approval metadata a populated living document is **Draft**; a registered type
without a document is **Missing**; an unbuilt asset is **Coming soon**. **Approved · vN**
reads only the store's valid `approvedCurrent` (non-empty revision id, positive revision number).
The service passes listing items unchanged, never inventing approval. **Needs rebuild**
comes from the server's `needsRebuild` projection: each downstream asset's current-revision
provenance is compared by revision identity and content hash against the approved-current
framework. Unknown provenance and one-off outputs never mark; a timestamp or revision
count alone is never approval or staleness. See [downstream rebuild](../backend/mktg-rebuild.md).

Current prefers the store's valid `currentRevisionNumber`; older listings fall back to the
sequence in the selected `latestRevisionId`, **never `revisionCount`**. Its date is `updatedAt`. Non-sequence legacy ids show no invented
version. A valid approved-current seam supplies the approved revision number; the only
listing date remains `updatedAt` until an approved-current date is exposed. One-off assets use
`createdAt`: never run means **Not run yet** (`missing`); a run in the current UTC calendar month
shows **N this month**; an earlier run shows **Last run d MMM**. The newest run is selected by
`createdAt` without mutating listing order. Counts, the en-GB last-run label and the Family
Current cell all use UTC, including month boundaries; Current shows the run date, never a
revision version. Unknown historical dates remain unknown (**Last run —**). A registered
type with an unavailable agent reads **Coming soon**, not Not run yet.

State filters read `?state=` (All by default), retaining all family cards. A user filter click
pushes a history entry, so browser Back restores the previous filter. Never-run one-offs join
Not run yet. Already-run one-offs appear under All only (decided by the operator, 23 Oct:
they have no approval workflow), never Approved/Draft/Needs rebuild. Kit cards consume the shared Family rule's
row states and labels without adding buttons or changing the board's card layout. `summarizeMktgKit` centralizes provisional
formulas: In the kit counts **Approved only**, Core floor counts families with at least one
approved asset out of the catalog length, and Kit level is Core only once every store-backed
Positioning asset is approved; otherwise an em dash. With no approvals the tiles show 0 assets,
0 of 9 and an em dash captioned No approved assets yet (provisional empty-state copy).
Drafts and individual runs do not enter these counts. Open requests is unknown (em dash plus
Coming soon), never zero. Live-family Core tags do not imply approval.

At the Family header's shared 800px content-query threshold, the title stays left of the tiles;
tiles use two columns at laptop width and four at 980px content width. Below 800px they sit
under the title. These thresholds reserve headroom for the navigation and page gutters.

## Agents board

There is one catalog-driven card template, with no search or Documents button. State lines
are Live (plus Last run date from the listing when known), Needs an approved framework for
a framework-gated tile, Needs <document> for other missing dependencies, or Coming soon.
There are no category tags or generated-version badges. Dependency resolution stays generic;
while a new project's initial state resolves, all tiles stay disabled with a neutral state line.
Same-project refreshes retain the current snapshot without relocking tiles. No project shows
an explicit selection message. Only Positioning & brand has board-provided run-order guidance.
A failed listing read omits last-run dates; known catalog availability remains unchanged.
Unregistered agent ids create no tile or Run action. Catalog Coming soon entries remain
disabled; design examples never override the catalog.

## Family and exports

The Family page links the real asset view `documents/:agentKey/:documentId`, preserving
lens/project context. `resolveMktgFamilyActions` is the pure shared policy for Family header,
row actions and Kit card row data. Availability requires an active, non-excluded catalog
agent with a registered intake; unavailable rows read Coming soon and offer no Run action.
Every available row, living or one-off, offers **Run X** when never run and **Run again**
when a document exists. Copy comes from the asset's board `runName` or label; catalog
identity controls routing. Required non-optional approved JSON dependencies disable the
action with the same reason as the run page; optional dependencies do not block.

The header priority is **Rebuild what is stale** (only Positioning has a rebuild panel),
then **Run next agent** with **Next: X** for the first never-run available asset in family
order, then **Run <lead asset>**. Unavailable leads retain a disabled action with pending
copy. No header action renders while the kit read is pending or after a non-access error.
A 403 resolves access, not document state: readers still see a disabled lead header with
**You need write access to this project to run its agents**, but no private rows. The service
tracks access denial separately from generic read errors. Loading status remains mounted.
Accessible names include the next asset or the disabled reason; focusable tooltip notes
announce the same reason on keyboard focus and hover. `lfxTooltipHostFocus` keeps focus
activation on the wrapper rather than PrimeNG's disabled descendant component.

All enabled header and row Run actions are real anchors. Native Cmd/Ctrl-click opens a new
tab without navigating the original family. Replacement query params preserve the selected
project and drop stale questions/generation/revision/run selectors. Living actions use
`?mode=new` to restore last inputs; Sources still waits for explicit Start. Member 360 has
no intake fields beyond the project, so its plain project-scoped route carries its complete
input. LinkedIn uses its existing plain route in phase 1; last-input persistence and
`mode=new` prefill are phase 2, pending the one-off landing integration before the parent
merges. The mode policy lives in `MKTG_FAMILY_ONE_OFF_RUN_MODES`. Breadcrumbs and row headings
are unchanged.
Made by shows the agent only; approved-by/comment attribution stays absent until its producer
supplies real read-time metadata. On the `positioning-brand` Family page, Rebuild runs
`lfx-mktg-rebuild` for the stale downstream set in family order, with live progress and
questions answered in place on the same session. Other families do not mount a rebuild panel.
The framework Asset view's Downstream action enters that flow through one-shot router
navigation state, never a URL write command. See [the API and sequencing contract](../backend/mktg-rebuild.md).

`lfx-mktg-family-export-actions` uses the required `familyId` and stable
`family-export-pdf` / `family-export-slides` IDs for the live Family-only export actions.
PDF composes the approved framework print and kit book; boilerplates/FAQ are
provisionally omitted with an explicit note because they have no print rendering.
Slides exports the supported approved family assets and branding, offers Update or
Create for an existing deck, shows progress and a dated revision-linked last export,
and marks changed approved member sets stale. Families without an export target render only
the export title and one unsupported line: no PDF/Slides buttons, Positioning PDF note or
Drive note. Supported families retain their actions, tooltip notes and export behaviour.
Readers see disabled supported actions and the write-access note. A failed last-export lookup blocks creation until retried rather
than guessing that no deck exists. Lookup starts independently of document-list loading;
the slot stays available after a listing error/403. Browser family and document clients
share one polling deadline/attempt/error policy. The family BFF and record model are
documented in [Family exports](../backend/mktg-document-revisions.md#family-exports).

`lfx-mktg-family-details` adds the board's static Approve explainer and Family-only source
read. It reads only the framework row's latest document revision via the existing endpoint,
then renders the validated `sidecar.report.sources_read` / `sources_failed`
(name/reason) as the board's sentences. Missing documents/reports omit the source block;
loading and failure/retry are explicit, never a fabricated list. Project/family switches
cancel old reads. Kit and Agents never make these detail reads.

## Routing and verification

Static Kit/Agents/Requests/Access/Documents/Family routes precede `:agentId`; Documents routes remain
unchanged, and the deleted standalone brand-kit-form route stays deleted. The empty Kit tab uses
exact matching so it is not active everywhere; named tabs use subset matching with query params ignored.
Family titles follow the family name.

Up is a fixed-parent `lfx-mktg-breadcrumb`, independent of the entry route. The pure shared
`mktgKitRootCrumb` builds the `<Project> kit` label once; `mktgKitCrumbsFor` derives a document or
agent's family from the shared catalog/family registries. Every crumb except the last is a link;
the last has `aria-current="page"`. Kit home is the root and has no breadcrumb. Tab pages show
`<Project> kit › <Tab>`; a family shows `<Project> kit › <Family>`; generic run and shared document
views show `<Project> kit › <Family> › <Agent or asset>`. Unmapped legacy documents use Documents
as their middle parent. Parent links use the active project slug and do not inherit asset-only query state;
an absent project is omitted, not serialized as `?project=`. Separate run/document/Marketing OS back
arrows are removed. The Member 360 and LinkedIn run pages use the same component and fixed family parents.
Their final crumbs use the catalog agent names. Run again, including Member 360's New run,
targets the catalog run route via `mktgRunRouteFor` and drops document-only state.
Downstream and Rebuild links derive their lens root with `mktgKitRootPath` and use the active
project slug. Export actions stay on the asset or Family page; external deck links still open in a new tab.

Back is the browser's history. A user tab or filter click **pushes** one history entry:
Kit uses `state=`, Documents uses `type=`, and Framework/Brand Kit/Boilerplates/FAQ views use `tab=`
through `createMktgAssetTab`. Asset tab switches merge unrelated query parameters so project,
revision and `profile=edit` survive. Missing or unknown tab ids render the view's default panel;
selecting that default clears `tab=`. Back then restores the preceding tab/filter rather than
skipping it. Member 360 ranking filters use `tier=`, `owner=`, `search=` and its ordering uses
`sort=` / `direction=`. Tier/owner selections and sort clicks push once per change. Free-text search
filters locally as typed but pushes only once per settled term, after a 300 ms debounce and a current-URL
equality check; Back restores the previous settled term, not individual keystrokes. URL echoes do not
rewrite the search input while typing.
LinkedIn content sources use `source=`; profile editing keeps `profile=edit` until Save or Cancel.
Run-page and document Edit actions mark their pushed history entry with `mktgEditPushed: true`.
Cancel and persisted profile saves return through history only for a marked entry. An unmarked cold
edit stays cold after Family → Back: Save/Cancel clear `profile` with `replaceUrl: true` in place.
A setup-only Continue is not a persisted save; it always stays on intake with the answers in `setup`
and clears `profile` in place, rather than destroying those answers by returning to the document.
Browser Back/Forward restores these query-backed views without starting a run or repeating a write.
Only automatic hops replace history: the generic unknown/coming-soon/intake-less agent redirect
uses `replaceUrl: true`. Main's generic run renders result and questions inline.

No-project branches are defensive and unit-covered, not stable route-level e2e states:
`projectQueryParamGuard` permits an absent slug, but `NavigationService.applyDefaultSelection`
selects an available project or sends an empty lens to Me through `handleEmptyLensResponse`.
A no-cookie/empty-nav e2e therefore reaches the Me lens Dashboard, not an unselected kit.

Content/robust Playwright pairs stub synthetic listing and revision data, including a
Boilerplates document and framework source report. They pin the local flag and project grants,
suppress the cookie banner, wait for hydration, and cover 1440/1280/390px plus each filter.
No live generation is part of these specs. Unit tests cover exact order/exclusions/labels,
latest-sequence versus revision count, scope cancellation, SSR and the framework-only source read.

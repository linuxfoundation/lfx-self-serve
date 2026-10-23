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
listing date remains `updatedAt` until an approved-current date is exposed. Run assets instead show current-local-calendar-month counts from `createdAt`, and
the Family Current cell shows the run date, not a revision version.

State filters read `?state=` (All by default), retaining all family cards. A user filter click
pushes a history entry, so browser Back restores the previous filter. Count-only
runs appear under All, not workflow-state chips. `summarizeMktgKit` centralizes provisional
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
lens/project context. The first declared agent is runnable only with an active catalog entry;
unregistered agents keep a disabled button with catalog-independent pending copy from the
family constants. Member 360 explains that its page is on its way, without a disabled tooltip;
its button automatically enables once an active catalog entry lands. Family Run action
wording uses the matching asset's board `runName` (or row label), not the catalog's agent
name; header pending copy remains a fallback. Catalog identity still controls routing and
availability. Row headings and the Agents grid's catalog names are not renamed.
Every available living row offers Run for its active, non-excluded catalog agent with a
registered intake, whether Missing, Draft, Approved or Needs rebuild. Coming-soon and one-off
rows do not gain this action. Required approved-document dependencies still disable row actions
with the same reason as the run page. The header keeps its state-driven priority: Rebuild what
is stale, otherwise Run next agent for the first missing asset, otherwise the lead agent.
Adding built-row actions does not change which missing asset the header selects.
Living header/row Run and asset Run again open `?mode=new`,
clearing old questions/generation/revision/run selectors; the Sources page still waits for
explicit Start. This per-row action is a provisional addition: the Family board depicts only
the header framework Run. Dedicated one-off routing/availability and breadcrumbs stay unchanged.
Made by shows the agent only; approved-by/comment attribution stays absent until its producer
supplies real read-time metadata. On the `positioning-brand` Family page, Rebuild runs
`lfx-mktg-rebuild` for the stale downstream set in family order, with live progress and
questions answered in place on the same session. Other families retain Coming soon.
The framework Asset view's Downstream action enters that flow through one-shot router
navigation state, never a URL write command. See [the API and sequencing contract](../backend/mktg-rebuild.md).

`lfx-mktg-family-export-actions` uses the required `familyId` and stable
`family-export-pdf` / `family-export-slides` IDs for the live Family-only export actions.
PDF composes the approved framework print and kit book; boilerplates/FAQ are
provisionally omitted with an explicit note because they have no print rendering.
Slides exports the supported approved family assets and branding, offers Update or
Create for an existing deck, shows progress and a dated revision-linked last export,
and marks changed approved member sets stale. Readers see disabled actions and the
write-access note. A failed last-export lookup blocks creation until retried rather
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
`buildMktgBreadcrumbs(page, kitRootPath, projectName)` takes a typed kit/tab/family/asset/run page
and derives labels and fixed parents from the shared catalog/family registries. Pages pass only
that identity to the component, which reads name and slug from `ProjectContextService` and tracks
`NavigationEnd` URLs for the absolute lens root (matched on a full path segment). Until the project
resolves, every page uses the neutral `Marketing kit` label. The shared Node unit suite guards
against breadcrumb nav markup outside `components/mktg-breadcrumb/mktg-breadcrumb.component.html`. Every crumb except the last is a link;
the last has `aria-current="page"`. Kit home is the root and has no breadcrumb. Tab pages show
`<Project> kit › <Tab>`; a family shows `<Project> kit › <Family>`; generic run and shared document
views show `<Project> kit › <Family> › <Agent or asset>`. Unmapped legacy documents use Documents
as their middle parent. Parent links use the active project slug and do not inherit asset-only query state;
an absent project is omitted, not serialized as `?project=`. Separate run/document/Marketing OS back
arrows are removed. The Member 360 and LinkedIn run pages use the same component and fixed family parents.
Their final crumbs use the catalog agent names. Run again, including Member 360's New run,
targets the catalog run route via `mktgRunRouteFor` and drops document-only state.
Stored AEO/GEO report crumbs add the revision's UTC date and never carry the list's `type` filter.
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
Edit actions mark their pushed history entry with `mktgEditPushed: 'run' | 'document'`.
Cancel and persisted saves return through history only for a marked entry. Cold entries strip `profile`
in place, including after Family → Back. Setup-only Continue keeps its answers and returns through
history only for run origin; document origin stays on intake with `replaceUrl: true` to avoid losing
unpersisted answers. Legacy boolean markers conservatively retain document-origin behavior.
Browser Back/Forward restores these query-backed views without starting a run or repeating a write.
Automatic run-to-document, post-research, questions and selected-revision landings replace history,
including navigation retries; the exact receipt revision is preserved. Unknown-agent redirects replace.
Run again/New run push with the active project and the owned `mode=new` entry intent for living assets.
Draft another and dependency-agent links push with active-project-only params. Automatic landings clear entry-only mode.
Manual Open intake remains a user push and may carry its owned questions continuation token.

No-project branches are defensive and unit-covered, not stable route-level e2e states:
`projectQueryParamGuard` permits an absent slug, but `NavigationService.applyDefaultSelection`
selects an available project or sends an empty lens to Me through `handleEmptyLensResponse`.
A no-cookie/empty-nav e2e therefore reaches the Me lens Dashboard, not an unselected kit.

Content/robust Playwright pairs stub synthetic listing and revision data, including a
Boilerplates document and framework source report. They pin the local flag and project grants,
suppress the cookie banner, wait for hydration, and cover 1440/1280/390px plus each filter.
No live generation is part of these specs. Unit tests cover exact order/exclusions/labels,
latest-sequence versus revision count, scope cancellation, SSR and the framework-only source read.

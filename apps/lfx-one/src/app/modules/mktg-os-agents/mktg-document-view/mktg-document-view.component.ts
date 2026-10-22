// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import {
  LINKEDIN_POST_INTAKE,
  LINKEDIN_SHARE_LINK_ANSWER_KEY,
  LINKEDIN_SHARE_LINK_HINT,
  LINKEDIN_SHARE_LINK_MAX_CHARS,
  MKTG_DOCUMENT_REVISION_PREVIEW_COUNT,
  MKTG_KIT_FRAMEWORK_KEY,
  MKTG_DOCUMENT_TYPES,
  MKTG_AGENTS,
  MKTG_RUN_POLL,
  MKTG_STARTED_RUN_STATE_ORDER,
  MKTG_DOCUMENT_PROGRESS_POLL,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_AGENT_INTAKES,
  MKTG_LIVING_DOCUMENT_ID,
} from '@lfx-one/shared/constants';
import {
  BrandKitRevision,
  MktgBoilerplatesAsset,
  MktgFaqAsset,
  MktgFrameworkAsset,
  MktgRevisionResponse,
  MktgRevisionRow,
  MktgRevisionSummary,
  MktgSlidesExportTarget,
  MktgApprovedRevisionState,
  MktgDocumentDetailResponse,
  MktgDocumentReadCycle,
  MktgDocumentLocalProgress,
  MktgDocumentRunProgress,
  MktgGenerateProgress,
  MktgPendingGeneration,
} from '@lfx-one/shared/interfaces';
import {
  boilerplatesAssetOfRevision,
  describeMktgRevision,
  describeMktgRevisionAuthor,
  faqAssetOfRevision,
  foundationMessageAssetOfRevision,
  findMktgRunIntake,
  isMktgSlidesExportAgentKey,
  mktgAssetHeaderMetadata,
  mktgKitCrumbsFor,
  mktgKitRootPath,
  mktgRunRouteFor,
  parseMktgLegacyRevisionId,
  normalizeLinkedinShareLink,
  readBrandKitRevision,
  readLinkedinDocumentContent,
} from '@lfx-one/shared/utils';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { TooltipModule } from 'primeng/tooltip';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  defer,
  filter,
  finalize,
  map,
  of,
  startWith,
  switchMap,
  tap,
  EMPTY,
  expand,
  ignoreElements,
  merge,
  throwError,
  timer,
  Observable,
  shareReplay,
  take,
} from 'rxjs';

import { MktgBreadcrumbComponent } from '../components/mktg-breadcrumb/mktg-breadcrumb.component';
import { MktgAssetMetaComponent } from '../components/mktg-asset-meta/mktg-asset-meta.component';
import { BrandKitWebViewComponent } from '../brand-kit-web-view/brand-kit-web-view.component';
import { LinkedinPostOptionsComponent } from '../components/linkedin-post-options/linkedin-post-options.component';
import { MktgBoilerplatesViewComponent } from '../mktg-boilerplates-view/mktg-boilerplates-view.component';
import { MktgFaqViewComponent } from '../mktg-faq-view/mktg-faq-view.component';
import { MktgFrameworkViewComponent } from '../mktg-framework-view/mktg-framework-view.component';
import { MEMBER_360_FAILURE_MESSAGES } from '@lfx-one/shared/constants';
import { Member360Result, MktgDocumentListItem, MktgRunActivity } from '@lfx-one/shared/interfaces';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import { Member360Service } from '@services/member-360.service';
import { Member360ResultComponent } from '../components/member-360-result/member-360-result.component';
import { MktgRunActivityComponent } from '../mktg-run-activity/mktg-run-activity.component';
import { MktgDownstreamComponent } from '../components/mktg-downstream/mktg-downstream.component';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { isTransientHttpError } from '@shared/utils/http-error.utils';

// One revision of a Marketing OS document (design of record: "Document
// store", DocumentView board): the header says which revision of how many,
// the body is the revision's Markdown — or, for a Messaging Framework
// revision (JSON content), the framework's own view, for a Boilerplates
// revision (JSON content) the Boilerplates view, for an FAQ revision the FAQ
// view, and for a Brand Kit revision the kit's web view, rendered from the
// revision's sidecar — and the
// Revisions panel opens or makes another revision current. `?revision=` picks
// the revision; without it current is shown. Fetched in the browser only,
// after hydration.
@Component({
  selector: 'lfx-mktg-document-view',
  // Excluding layout gutters: 800px leaves classic-scrollbar headroom.
  host: { class: '@container block w-full min-w-0', 'data-testid': 'mktg-document-view-width' },
  imports: [
    DatePipe,
    ButtonComponent,
    NgClass,
    NgTemplateOutlet,
    MktgAssetMetaComponent,
    MktgDownstreamComponent,
    MktgBreadcrumbComponent,
    RouterLink,
    BrandKitWebViewComponent,
    MarkdownRendererComponent,
    MessageComponent,
    MktgBoilerplatesViewComponent,
    MktgFaqViewComponent,
    MktgFrameworkViewComponent,
    TooltipModule,
    LinkedinPostOptionsComponent,
    ReactiveFormsModule,
    InputTextComponent,
    Member360ResultComponent,
    MktgRunActivityComponent,
  ],
  templateUrl: './mktg-document-view.component.html',
})
export class MktgDocumentViewComponent {
  // === Injections ===
  private readonly dependencyService = inject(MktgDependencyService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentStore = inject(MktgDocumentStoreService);
  private readonly member360 = inject(Member360Service);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly userService = inject(UserService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runService = inject(MktgAgentRunService);
  private readonly attempts = inject(MktgRunAttemptService);

  protected readonly frameworkKey = MKTG_KIT_FRAMEWORK_KEY;

  protected readonly linkForm = new FormGroup({ share_link: new FormControl('', { nonNullable: true }) });
  protected readonly shareLinkAnswerKey = LINKEDIN_SHARE_LINK_ANSWER_KEY;
  protected readonly shareLinkHint = LINKEDIN_SHARE_LINK_HINT;
  protected readonly maxShareLinkChars = LINKEDIN_SHARE_LINK_MAX_CHARS;

  // === Signals ===
  protected readonly loading = signal(true);
  protected readonly generating = signal(false);
  protected readonly needsInput = signal(false);
  protected readonly runFailed = signal(false);
  protected readonly failureDetails = signal('');
  protected readonly runActivity = signal<MktgRunActivity[]>([]);
  protected readonly runStartedAt = signal(0);
  protected readonly runHistory = signal<MktgDocumentListItem[]>([]);
  protected readonly historyError = signal('');
  protected readonly reload = signal(0);
  protected readonly errorText = signal('');
  protected readonly notice = signal('');
  protected readonly view = signal<MktgRevisionResponse | null>(null);
  protected readonly restoringId = signal<string | null>(null);
  protected readonly showAllRevisions = signal(false);
  protected readonly writer = signal(false);
  protected readonly approvingId = signal<string | null>(null);
  protected readonly approvalError = signal('');
  protected readonly approvalAnnouncement = signal('');
  protected readonly editingLink = signal(false);
  protected readonly savingLink = signal(false);
  protected readonly linkError = signal('');
  protected readonly runDetail = signal<MktgDocumentDetailResponse | null>(null);
  protected readonly localProgress = signal<MktgDocumentLocalProgress>(null);
  protected readonly failureText = signal('');
  private readonly unconfirmed = signal(false);
  protected readonly refreshWarning = signal('');
  protected readonly restoreNotice = signal('');
  protected readonly retrying = signal(false);
  protected readonly submittingGeneration = signal(false);
  private readonly reloads = signal(0);
  private readonly handoffRunId = signal('');
  private readonly refreshedFailures = new Set<string>();
  private restoreEpoch = 0;
  private loadedScope = '';

  private readonly params = toSignal(
    this.route.paramMap.pipe(map((params) => ({ agentKey: params.get('agentKey') ?? '', documentId: params.get('documentId') ?? '' }))),
    { initialValue: { agentKey: '', documentId: '' } }
  );
  private readonly revisionParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('revision') ?? '')), { initialValue: '' });

  // === Computed ===
  protected readonly writePending = computed(() => this.submittingGeneration() || this.approvingId() !== null || this.restoringId() !== null);
  protected readonly proseView = computed(() => (this.view()?.member360 ? null : this.view()));
  protected readonly isLinkedinDocument = computed(() => this.view()?.type.agentKey === LINKEDIN_POST_INTAKE.agentId);
  protected readonly linkedinContent = this.initLinkedinContent();
  protected readonly generatingLabel = computed(
    () => `Working on ${MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === this.params().agentKey)?.label ?? 'the document'}`
  );
  protected readonly title: Signal<string> = this.initTitle();
  protected readonly crumbs = computed(() =>
    mktgKitCrumbsFor(this.params().agentKey, this.projectName(), mktgKitRootPath(this.router.url), this.view()?.type.itemLabel ?? 'Document')
  );
  protected readonly revisionRows: Signal<MktgRevisionRow[]> = computed(() => {
    const view = this.view();
    return view
      ? view.revisions.map((revision) => ({
          revision,
          how: describeMktgRevision(revision, view.type),
          authorLabel: describeMktgRevisionAuthor(revision.author),
        }))
      : [];
  });
  protected readonly currentSelectorLabel = computed(() => describeMktgRevisionAuthor(this.view()?.current?.changedBy));
  protected readonly savingStatus = computed(() => {
    const revision = this.view()?.revisions.find((entry) => entry.id === this.restoringId());
    return revision ? `Saving revision ${revision.number}…` : this.approvalAnnouncement();
  });
  protected readonly viewedAuthorLabel: Signal<string> = this.initViewedAuthorLabel();
  protected readonly currentRevision: Signal<MktgRevisionSummary | null> = this.initCurrentRevision();
  protected readonly visibleRevisionRows: Signal<MktgRevisionRow[]> = this.initVisibleRevisionRows();
  protected readonly shortHash: Signal<string> = computed(() => {
    const sha = this.view()?.revision.contentSha256 ?? '';
    return sha ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : '';
  });
  /**
   * The revision as a framework asset, when it is one: a JSON revision of the
   * foundation-message document whose text parses as a framework. Null for
   * every Markdown revision — and for a JSON revision that does not parse,
   * which is explicitly unsupported rather than rendered as Markdown.
   */
  protected readonly asset: Signal<MktgFrameworkAsset | null> = computed(() => {
    const view = this.view();
    if (!view || view.revision.format !== 'json' || this.assetViewKind() !== 'messaging-framework') {
      return null;
    }
    return foundationMessageAssetOfRevision(view.markdown, view.sidecar);
  });
  /**
   * The revision as the Boilerplates, when it is one: a JSON revision of the
   * boilerplates document whose text parses as the four lengths, with the
   * report and checks from its sidecar. Null otherwise — a JSON revision
   * that does not parse is explicitly unsupported.
   */
  protected readonly boilerplates: Signal<MktgBoilerplatesAsset | null> = computed(() => {
    const view = this.view();
    if (!view || view.revision.format !== 'json' || this.assetViewKind() !== 'boilerplates') {
      return null;
    }
    return boilerplatesAssetOfRevision(view.markdown, view.sidecar);
  });
  /** The FAQ of a JSON revision of the FAQ document, when its text parses as one; null for everything else. */
  protected readonly faq: Signal<MktgFaqAsset | null> = computed(() => {
    const view = this.view();
    if (!view || view.revision.format !== 'json' || view.type.agentKey !== 'faq') {
      return null;
    }
    return faqAssetOfRevision(view.markdown, view.sidecar);
  });
  /** The Brand Kit of a brand-kit revision, read from its sidecar; null for every other document, and for a kit stored by the earlier agent as Markdown alone. */
  protected readonly brandKit: Signal<BrandKitRevision | null> = computed(() => {
    const view = this.view();
    return view && this.assetViewKind() === 'brand-kit' ? readBrandKitRevision(view.sidecar) : null;
  });
  /** Boilerplates, FAQ and Brand Kit stay full width; the framework keeps Revisions and Downstream in the right column. */
  protected readonly fullWidth = computed(() => this.boilerplates() !== null || this.faq() !== null || this.brandKit() !== null);
  /** The project name the framework view titles itself with. */
  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name ?? '');
  protected readonly projectSlug = computed(() => this.projectContext.activeContext()?.slug ?? null);
  protected readonly hasAssetView = computed(() => Boolean(this.asset() || this.brandKit() || this.boilerplates() || this.faq()));
  protected readonly hasAssetMetadata = computed(() => this.hasAssetView() || this.view()?.revision.format === 'json');
  protected readonly header = computed(() => {
    const view = this.view();
    return view && !this.loading() ? mktgAssetHeaderMetadata(view) : null;
  });
  protected readonly runAgainLink = computed(() => {
    const key = this.view()?.type.agentKey ?? this.runDetail()?.type.agentKey ?? this.params().agentKey;
    return key ? mktgRunRouteFor(key, mktgKitRootPath(this.router.url)) : undefined;
  });
  protected readonly runAgainParams = computed(() => ({ project: this.projectContext.activeContext()?.slug ?? null }));
  protected readonly approvedView: Signal<MktgApprovedRevisionState> = this.initApprovedView();
  protected readonly approvedVersion = computed(() => this.approvedView().revision?.revision.number ?? null);
  protected readonly approvedFramework = computed(() => {
    const approved = this.approvedView().revision;
    return approved?.type.agentKey === 'foundation-message' ? foundationMessageAssetOfRevision(approved.markdown, approved.sidecar) : null;
  });
  protected readonly approvedKit = computed(() => {
    const approved = this.approvedView().revision;
    return approved?.type.agentKey === 'brand-kit' ? readBrandKitRevision(approved.sidecar) : null;
  });
  /** The project's stored Brand Kit, which a framework revision's print (Download PDF) is set in; null for the LF look. */
  protected readonly printKit: Signal<BrandKitRevision | null> = this.initPrintKit();
  /** Read-only deck lookup belongs to the viewed document, not its approved bytes. */
  protected readonly exportLookupTarget: Signal<MktgSlidesExportTarget | null> = computed(() => {
    const view = this.view();
    return view && isMktgSlidesExportAgentKey(view.type.agentKey) && (this.asset() || this.brandKit())
      ? { project: view.project, agentKey: view.type.agentKey, documentId: view.documentId }
      : null;
  });
  /** Approved-current bytes for Slides export, independent of viewed-document history. */
  protected readonly exportTarget: Signal<MktgSlidesExportTarget | null> = computed(() => {
    const view = this.view();
    const approved = this.approvedView().revision;
    const agentKey = approved?.type.agentKey;
    if (
      !view ||
      !approved ||
      approved.project !== view.project ||
      approved.revision.id !== view.approvedCurrent?.revisionId ||
      !isMktgSlidesExportAgentKey(agentKey) ||
      (!this.approvedFramework() && !this.approvedKit())
    ) {
      return null;
    }
    return { project: approved.project, agentKey, documentId: approved.documentId, revisionId: approved.revision.id };
  });

  protected readonly mayApprove = computed(() => {
    const view = this.view();
    return Boolean(
      view &&
      this.writer() &&
      !this.userService.impersonating() &&
      this.hasAssetView() &&
      view.type.kind === 'living' &&
      !parseMktgLegacyRevisionId(view.revision.id) &&
      !view.revision.approval
    );
  });

  private readonly runParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('run') ?? '')), { initialValue: '' });
  private readonly generationParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('generation') ?? '')), { initialValue: '' });

  private readonly request$ = toObservable(
    computed(() => ({
      project: this.projectContext.activeContextUid(),
      slug: this.projectContext.activeContext()?.slug ?? '',
      user: this.params().agentKey === 'member-360' ? this.userService.user()?.sub : undefined,
      subject: this.userService.user()?.sub ?? '',
      ...this.params(),
      revisionId: this.revisionParam(),
      runId: this.runParam(),
      generation: this.generationParam(),
      reload: this.reloads() + this.reload(),
    }))
  );

  protected readonly selectedRun: Signal<MktgDocumentRunProgress | null> = this.initSelectedRun();
  protected readonly runState: Signal<MktgDocumentRunProgress['state'] | null> = this.initRunState();

  protected readonly runFailure = computed(() => this.selectedRun()?.failureText || this.failureText() || '');

  protected readonly runRecorded = computed(() => !this.submittingGeneration() && (!!this.handoffRunId() || !!this.selectedRun()));

  protected readonly liveState: Signal<string> = this.initLiveState();

  protected readonly runAgentId = computed(() => {
    const type = this.runDetail()?.type ?? MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === this.params().agentKey);
    const id = type?.catalogAgentId;
    return type?.kind === 'living' && id && MKTG_AGENT_INTAKES[id] && MKTG_AGENTS.some((agent) => agent.id === id && agent.status === 'active') ? id : '';
  });

  private readonly assetViewKind = computed(() => {
    const type = this.view()?.type;
    return type?.structuredView ?? MKTG_AGENT_INTAKES[type?.catalogAgentId ?? '']?.assetView;
  });

  protected readonly unsupportedAsset = computed(
    () => this.view()?.type.kind === 'living' && !!this.assetViewKind() && !this.asset() && !this.boilerplates() && !this.brandKit() && !this.faq()
  );

  public constructor() {
    bindLfxDocumentTitle(computed(() => (this.view()?.member360 ? this.title() : '')));
    if (isPlatformBrowser(this.platformId)) {
      let observedSubject = this.userService.user()?.sub ?? '';
      // Action rights follow user context without cancelling document or last-export reads.
      const actionContext = computed(() => ({ subject: this.userService.user()?.sub, impersonating: this.userService.impersonating() }));
      combineLatest([this.request$, toObservable(actionContext)])
        .pipe(
          tap(() => this.writer.set(false)),
          switchMap(([request]) => (request.slug ? this.projectService.getProject(request.slug, false) : of(null))),
          takeUntilDestroyed()
        )
        .subscribe((project) => this.writer.set(!!project?.writer));
      this.request$
        .pipe(
          distinctUntilChanged((previous, current) => {
            const equal = JSON.stringify(previous) === JSON.stringify(current);
            const firstResolution =
              !observedSubject &&
              !!current.subject &&
              !current.generation &&
              JSON.stringify({ ...previous, subject: current.subject }) === JSON.stringify(current);
            observedSubject ||= current.subject;
            if (firstResolution) {
              this.loadedScope = JSON.stringify([current.project, current.subject, current.agentKey, current.documentId]);
            }
            const handoffOnly =
              !!previous.generation &&
              !current.generation &&
              current.runId === this.handoffRunId() &&
              !!current.runId &&
              JSON.stringify({ ...previous, generation: current.generation, runId: current.runId }) === JSON.stringify(current);
            return equal || firstResolution || handoffOnly;
          }),
          tap((request) => {
            this.errorText.set('');
            this.notice.set('');
            this.runHistory.set([]);
            this.historyError.set('');
            this.runActivity.set([]);
            this.needsInput.set(false);
            this.runFailed.set(false);
            this.failureDetails.set('');
            this.refreshWarning.set('');
            const scope = JSON.stringify([request.project, request.agentKey === 'member-360' ? '' : request.subject, request.agentKey, request.documentId]);
            if (scope !== this.loadedScope) {
              this.loadedScope = scope;
              this.approvalError.set('');
              this.approvalAnnouncement.set('');
              this.editingLink.set(false);
              this.savingLink.set(false);
              this.linkError.set('');
              this.linkForm.enable({ emitEvent: false });
              this.view.set(null);
              this.runDetail.set(null);
              this.localProgress.set(null);
              this.submittingGeneration.set(false);
              this.failureText.set('');
              this.unconfirmed.set(false);
              this.retrying.set(false);
              this.handoffRunId.set('');
              this.refreshedFailures.clear();
              this.showAllRevisions.set(false);
              this.notice.set('');
              this.restoringId.set(null);
              this.restoreEpoch++;
              this.restoreNotice.set('');
              this.loading.set(true);
            }
          }),
          switchMap((request) => {
            if (!request.project || !request.agentKey || !request.documentId) {
              this.generating.set(false);
              return EMPTY;
            }
            if (request.agentKey === 'member-360') {
              const pending = !!request.user && this.member360.isPending(request.project, request.documentId);
              this.generating.set(pending);
              this.runStartedAt.set(pending ? (this.member360.pendingStartedAt(request.project, request.documentId) ?? Date.now()) : 0);
              const ready$: Observable<Member360Result | null> = pending
                ? this.member360
                    .waitForStored(request.project, request.documentId, (activity) => this.runActivity.set(activity))
                    .pipe(
                      tap((result) => {
                        this.needsInput.set(result.status === 'needs_input');
                        if (result.status === 'failed') {
                          this.runFailed.set(true);
                          this.errorText.set(MEMBER_360_FAILURE_MESSAGES[result.reason ?? 'agent_stopped'] ?? MEMBER_360_FAILURE_MESSAGES.agent_stopped);
                          this.failureDetails.set(result.message ?? '');
                        }
                      }),
                      filter((result) => result.status !== 'needs_input')
                    )
                : of(null);
              // Preserve this dedicated receiver's owner capability and stored-read lifecycle.
              const revision$ = defer(() =>
                request.revisionId
                  ? this.documentStore.getRevision(request.project, request.agentKey, request.documentId, request.revisionId)
                  : this.documentStore.getDocument(request.project, request.agentKey, request.documentId).pipe(
                      switchMap((detail) => {
                        const revisionId = detail.current?.revisionId ?? detail.revisions.find((revision) => revision.latest)?.id ?? detail.revisions[0]?.id;
                        if (!revisionId) {
                          this.generating.set(true);
                          return EMPTY;
                        }
                        return this.documentStore.getRevision(request.project, request.agentKey, request.documentId, revisionId);
                      })
                    )
              );
              return ready$.pipe(
                switchMap((result) => (result?.status === 'failed' ? of(null) : revision$)),
                switchMap((view) => {
                  if (!view?.member360) return of(view);
                  return this.documentStore.listDocuments(request.project).pipe(
                    tap((listing) => this.runHistory.set(listing.groups.find((group) => group.type.agentKey === 'member-360')?.documents ?? [])),
                    map(() => view),
                    catchError(() => {
                      this.historyError.set('Run history could not be loaded.');
                      return of(view);
                    })
                  );
                }),
                catchError((error: HttpErrorResponse) => {
                  this.errorText.set(
                    pending
                      ? 'This run could not be loaded yet. Retry to check the same run; nothing is overwritten.'
                      : this.loadErrorText(error.status, error.error?.code)
                  );
                  return of(null);
                })
              );
            }
            const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === request.agentKey);
            const prepared =
              type?.kind === 'living' && type.catalogAgentId && request.subject && request.generation
                ? this.attempts.consume(request.generation, request.project, type.catalogAgentId)
                : null;
            this.submittingGeneration.set(!!prepared && !prepared.pending.attempt);
            if (!prepared) {
              this.localProgress.set(null);
              this.handoffRunId.set('');
              this.failureText.set('');
              this.restoreNotice.set('');
            }
            if (prepared) {
              this.localProgress.set('writing');
              this.handoffRunId.set(prepared.pending.attempt?.runId ?? '');
              this.loading.set(false);
            }
            // A manual return has no single-use handoff token. Resolve its accepted attempt from the live registry,
            // but let the public metadata confirm that this exact run is still active before reconnecting its result poll.
            const intake = findMktgRunIntake(request.agentKey);
            const saved =
              request.subject && !request.generation && !request.revisionId && request.documentId === MKTG_LIVING_DOCUMENT_ID && intake?.endpoints.result
                ? this.attempts.load(request.project, intake.agentId)
                : null;
            const recoverable = saved?.state === 'writing' && saved.attempt?.runId && (!request.runId || request.runId === saved.attempt.runId) ? saved : null;
            const resume = (pending: MktgPendingGeneration) =>
              this.runService.resume(pending).pipe(
                tap((progress) => this.onProgress(progress, pending)),
                ignoreElements(),
                catchError((error: unknown) => {
                  const errorType = error instanceof Error ? error.name : typeof error;
                  console.error('Failed to confirm Marketing OS run', error instanceof HttpErrorResponse ? { status: error.status } : { errorType });
                  this.unconfirmed.set(true);
                  this.localProgress.set('failed');
                  this.failureText.set('The run could not be confirmed. Your intake is kept; return to the intake form to try again.');
                  return EMPTY;
                }),
                finalize(() => this.submittingGeneration.set(false))
              );
            const generation$ = prepared ? resume(prepared.pending) : EMPTY;
            const existingView = this.view();
            let known: MktgDocumentReadCycle | null = existingView ? { detail: existingView, view: existingView } : null;
            if (!known && prepared && type) {
              known = {
                detail: { project: request.project, type, documentId: request.documentId, revisions: [], approvedCurrent: null, runs: [] },
                view: null,
              };
            }
            let unavailableSince: number | null = null;
            let unavailableCount = 0;
            let observedRun = false;
            const unavailable = () => {
              unavailableSince ??= Date.now();
              unavailableCount++;
              this.refreshWarning.set('Could not fully refresh. Showing the last loaded asset; retrying.');
            };
            const read = (poll: boolean) => {
              const metadata$ = defer(() => this.documentStore.getDocument(request.project, request.agentKey, request.documentId, poll)).pipe(
                switchMap((detail) => {
                  const id = (MKTG_STARTED_RUN_ID_REGEX.test(request.runId) ? request.runId : '') || this.handoffRunId();
                  const selected = id ? detail.runs?.find((run) => run.runId === id) : detail.runs?.[0];
                  if (poll || this.localProgress() || selected?.state !== 'failed' || this.refreshedFailures.has(selected.runId)) return of(detail);
                  this.refreshedFailures.add(selected.runId);
                  return this.documentStore
                    .getDocument(request.project, request.agentKey, request.documentId, false, selected.runId)
                    .pipe(
                      catchError((error: unknown) => (isTransientHttpError(error) ? of({ ...detail, progressUnavailable: true }) : throwError(() => error)))
                    );
                }),
                catchError((error: HttpErrorResponse) => {
                  if (error.status === 404 && prepared && type) {
                    return of<MktgDocumentDetailResponse>({
                      project: request.project,
                      type,
                      documentId: request.documentId,
                      revisions: [],
                      approvedCurrent: null,
                      runs: [],
                    });
                  }
                  return throwError(() => error);
                })
              );
              const cycle$ =
                request.revisionId && !request.runId && !prepared
                  ? this.documentStore
                      .getRevision(request.project, request.agentKey, request.documentId, request.revisionId, poll)
                      .pipe(map((view): MktgDocumentReadCycle => ({ detail: view, view })))
                  : metadata$.pipe(
                      switchMap((detail) => {
                        const revisionId =
                          request.revisionId ||
                          detail.current?.revisionId ||
                          detail.revisions.find((revision) => revision.latest)?.id ||
                          detail.revisions[0]?.id;
                        if (!revisionId) return of<MktgDocumentReadCycle>({ detail, view: null });
                        return this.documentStore
                          .getRevision(request.project, request.agentKey, request.documentId, revisionId, true)
                          .pipe(map((view): MktgDocumentReadCycle => ({ detail, view })));
                      })
                    );
              return cycle$.pipe(
                tap((cycle) => {
                  known = cycle;
                  if (cycle.detail.progressUnavailable || cycle.view?.progressUnavailable) unavailable();
                  else {
                    unavailableSince = null;
                    unavailableCount = 0;
                    this.refreshWarning.set('');
                  }
                  this.runDetail.set(cycle.detail);
                  const selected = cycle.detail.runs?.find((run) => run.runId === this.handoffRunId());
                  if (selected) observedRun = true;
                  if (selected?.state === 'failed' || (observedRun && !selected && cycle.detail.revisions.length)) this.localProgress.set(null);
                }),
                catchError((error: unknown) => {
                  if (!known || !isTransientHttpError(error)) return throwError(() => error);
                  unavailable();
                  return of<MktgDocumentReadCycle>({ detail: known.detail, view: this.view() ?? known.view });
                })
              );
            };
            const detail$ = read(false).pipe(
              expand((cycle) => {
                const elapsed = unavailableSince === null ? 0 : Date.now() - unavailableSince;
                if (unavailableSince !== null && elapsed >= MKTG_RUN_POLL.timeoutMs) {
                  this.refreshWarning.set('Automatic checks are paused. Showing the last loaded asset; refresh to check again.');
                  return EMPTY;
                }
                const active = cycle.detail.runs?.some((run) => run.state === 'writing' || run.state === 'storing');
                if (this.selectedRun()?.state === 'questions' && unavailableSince === null) return EMPTY;
                const local = this.localProgress();
                if (!active && local !== 'writing' && local !== 'storing' && unavailableSince === null) return EMPTY;
                let delay: number = MKTG_RUN_POLL.intervalMs;
                if (unavailableCount) delay = Math.min(delay * 2 ** Math.min(unavailableCount - 1, 3), MKTG_DOCUMENT_PROGRESS_POLL.maxBackoffMs);
                if (unavailableSince !== null) delay = Math.min(delay, MKTG_RUN_POLL.timeoutMs - elapsed);
                return timer(delay).pipe(switchMap(() => read(true)));
              }),
              map((cycle) => cycle.view),
              catchError((error: HttpErrorResponse) => {
                this.localProgress.set(null);
                this.runDetail.set(null);
                this.errorText.set(this.loadErrorText(error.status, error.error?.code));
                return of(null);
              })
            );
            const reads$ = recoverable ? detail$.pipe(shareReplay({ bufferSize: 1, refCount: true })) : detail$;
            const recovery$ =
              recoverable && intake
                ? reads$.pipe(
                    filter(() => this.runDetail() !== null && !this.runDetail()?.progressUnavailable),
                    take(1),
                    switchMap(() => {
                      const recorded = this.runDetail()?.runs?.find((run) => run.runId === recoverable.attempt?.runId);
                      if (recorded?.state !== 'writing' && recorded?.state !== 'storing') return EMPTY;
                      this.localProgress.set('writing');
                      this.handoffRunId.set(recorded.runId);
                      return resume({ ...recoverable, request: { ...recoverable.request, intake } });
                    })
                  )
                : EMPTY;
            return merge(generation$, reads$, recovery$);
          }),
          takeUntilDestroyed()
        )
        .subscribe((view) => {
          this.view.set(view);
          this.linkForm.controls.share_link.setValue(this.linkedinContent()?.answers[LINKEDIN_SHARE_LINK_ANSWER_KEY] ?? '');
          this.loading.set(false);
          this.generating.set(false);
        });
    }
  }

  // === Protected methods ===
  protected onRetryRun(): void {
    const run = this.selectedRun();
    const project = this.projectContext.activeContextUid();
    if (!run || run.state !== 'failed' || !project || this.retrying()) {
      return;
    }
    this.retrying.set(true);
    const scope = this.loadedScope;
    const subject = this.userService.user()?.sub;
    this.documentStore
      .retryRun(project, run.agentKey, run.documentId, run.runId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          if (this.loadedScope !== scope || this.projectContext.activeContextUid() !== project || this.userService.user()?.sub !== subject) {
            return;
          }
          this.retrying.set(false);
          this.runDetail.set(detail);
          this.localProgress.set(null);
          this.failureText.set('');
          this.reloads.update((count) => count + 1);
        },
        error: (error: HttpErrorResponse) => {
          if (this.loadedScope !== scope || this.projectContext.activeContextUid() !== project || this.userService.user()?.sub !== subject) {
            return;
          }
          this.retrying.set(false);
          if (error.status === 401 || error.status === 403) {
            this.view.set(null);
            this.runDetail.set(null);
            this.localProgress.set(null);
          }
          this.errorText.set(
            error.status === 401 || error.status === 403 ? this.loadErrorText(403) : 'The run could not be checked. Try again; no new generation was started.'
          );
        },
      });
  }

  protected onOpenIntake(): void {
    const agentId = this.runAgentId();
    if (!agentId) return;
    const project = this.projectContext.activeContextUid();
    const pending = project ? this.attempts.load(project, agentId) : null;
    const token = pending ? this.attempts.prepare(pending.request, true) : null;
    void this.router.navigate([mktgKitRootPath(this.router.url), agentId], {
      queryParams: { ...this.runAgainParams(), questions: token },
    });
  }

  protected onRefreshProgress(): void {
    if (this.submittingGeneration()) return;
    this.reloads.update((count) => count + 1);
  }

  protected onToggleAllRevisions(): void {
    this.showAllRevisions.update((expanded) => !expanded);
  }

  protected onApprove(): void {
    const view = this.view();
    const project = this.projectContext.activeContextUid();
    if (!view || !project || view.project !== project || this.loading() || !this.mayApprove() || this.writePending()) {
      return;
    }
    this.approvingId.set(view.revision.id);
    this.approvalError.set('');
    this.approvalAnnouncement.set(`Approving revision ${view.revision.number}…`);
    const selection = this.revisionParam();
    const epoch = this.restoreEpoch;
    // The one-shot write outlives navigation; only its presentation is view-scoped.
    this.documentStore
      .approveRevision(project, view.type.agentKey, view.documentId, view.revision.id)
      .pipe(finalize(() => this.approvingId.update((id) => (id === view.revision.id ? null : id))))
      .subscribe({
        next: (approved) => {
          this.dependencyService.notifyDocumentsChanged(project);
          if (epoch === this.restoreEpoch && this.sameView(project, view, selection)) {
            this.view.set(approved);
            this.approvalAnnouncement.set(`Revision ${view.revision.number} is approved and current.`);
          }
        },
        error: (error: unknown) => {
          if (epoch === this.restoreEpoch && this.sameView(project, view, selection)) {
            const message = extractErrorMessage(error, 'The approval could not be confirmed. Reload to see the current state before trying again.');
            this.approvalError.set(message);
            this.approvalAnnouncement.set(message);
          }
        },
      });
  }

  protected onEditProfile(): void {
    if (!this.linkedinContent()?.isAuthor) return;
    void this.router.navigate([LINKEDIN_POST_INTAKE.agentId], {
      relativeTo: this.route.parent,
      queryParams: { profile: 'edit', revision: null, type: null },
      queryParamsHandling: 'merge',
    });
  }

  protected onEditLink(): void {
    if (!isPlatformBrowser(this.platformId) || this.savingLink()) return;
    this.editingLink.set(true);
    this.linkError.set('');
    afterNextRender(
      () => {
        if (this.destroyRef.destroyed || !this.editingLink()) return;
        const input = this.host.nativeElement.querySelector<HTMLInputElement>('#linkedin-document-share-link');
        input?.focus();
        input?.scrollIntoView({ block: 'center' });
      },
      { injector: this.injector }
    );
  }

  protected onCancelLink(): void {
    if (this.savingLink()) return;
    this.linkForm.controls.share_link.setValue(this.linkedinContent()?.answers[LINKEDIN_SHARE_LINK_ANSWER_KEY] ?? '');
    this.editingLink.set(false);
    this.linkError.set('');
  }

  protected onSaveLink(): void {
    const current = this.view();
    const content = current?.linkedinPost;
    if (!current || !content || !this.editingLink() || this.savingLink()) return;
    const link = normalizeLinkedinShareLink(this.linkForm.controls.share_link.value);
    if (link === null) {
      this.linkError.set('Enter one HTTPS link or leave it empty.');
      return;
    }
    this.savingLink.set(true);
    this.linkError.set('');
    this.linkForm.disable({ emitEvent: false });
    this.documentStore
      .saveLinkedinShareLink(current.project, current.documentId, link)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (this.view() !== current) return;
          this.view.set({ ...current, linkedinPost: { ...content, answers: { ...content.answers, [LINKEDIN_SHARE_LINK_ANSWER_KEY]: response.share_link } } });
          this.linkForm.enable({ emitEvent: false });
          this.linkForm.controls.share_link.setValue(response.share_link);
          this.savingLink.set(false);
          this.editingLink.set(false);
        },
        error: () => {
          if (this.view() !== current) return;
          this.linkForm.enable({ emitEvent: false });
          this.savingLink.set(false);
          this.linkError.set('The link could not be saved. Your saved post is unchanged. Try again or cancel.');
        },
      });
  }

  protected onDraftAnother(): void {
    void this.router.navigate([LINKEDIN_POST_INTAKE.agentId], {
      relativeTo: this.route.parent,
      queryParams: { profile: null, revision: null, type: null },
      queryParamsHandling: 'merge',
    });
  }

  protected retryLoad(): void {
    if (this.submittingGeneration()) return;
    this.reload.update((value) => value + 1);
  }

  protected onRestore(revision: MktgRevisionSummary): void {
    const view = this.view();
    const project = this.projectContext.activeContextUid();
    if (!view || view.type.kind === 'run' || !project || this.writePending()) {
      return;
    }

    this.restoringId.set(revision.id);
    this.notice.set('');
    this.errorText.set('');
    const selection = this.revisionParam();
    const subject = this.userService.user()?.sub;
    const epoch = ++this.restoreEpoch;
    // This one-shot write outlives the page. Only its presentation is scoped to
    // the initiating project/revision, so navigation cannot cancel the save.
    this.documentStore
      .restoreRevision(project, view.type.agentKey, view.documentId, revision.id)
      .pipe(finalize(() => this.restoringId.update((id) => (id === revision.id ? null : id))))
      .subscribe({
        next: (restored) => {
          this.dependencyService.notifyDocumentsChanged(project);
          if (epoch !== this.restoreEpoch || this.userService.user()?.sub !== subject || !this.sameView(project, view, selection)) return;
          const approval = restored.revisions.find((entry) => entry.id === view.revision.id)?.approval ?? null;
          this.view.set({
            ...view,
            revisions: restored.revisions,
            current: restored.current ?? null,
            approvedCurrent: restored.approvedCurrent,
            approval,
            revision: { ...view.revision, latest: view.revision.id === restored.revision.id, approval },
          });
          this.notice.set(`Revision ${revision.number} is now current. No revision was added.`);
        },
        error: (error: HttpErrorResponse) => {
          if (epoch !== this.restoreEpoch || this.userService.user()?.sub !== subject || !this.sameView(project, view, selection)) return;
          this.errorText.set(this.writeErrorText(error));
        },
      });
  }

  // === Private initializers ===
  private initApprovedView(): Signal<MktgApprovedRevisionState> {
    return toSignal(
      toObservable(this.view).pipe(
        distinctUntilChanged(
          (previous, current) =>
            previous?.project === current?.project &&
            previous?.type.agentKey === current?.type.agentKey &&
            previous?.documentId === current?.documentId &&
            previous?.revision.id === current?.revision.id &&
            previous?.approvedCurrent?.revisionId === current?.approvedCurrent?.revisionId
        ),
        switchMap((view) => {
          if (!isPlatformBrowser(this.platformId) || !view || !isMktgSlidesExportAgentKey(view.type.agentKey)) {
            return of({ loading: false, revision: null, error: '' });
          }
          return this.documentStore.getApprovedRevision(view, view).pipe(
            map((revision): MktgApprovedRevisionState => {
              if (
                revision &&
                ((revision.type.agentKey === 'foundation-message' && !foundationMessageAssetOfRevision(revision.markdown, revision.sidecar)) ||
                  (revision.type.agentKey === 'brand-kit' && !readBrandKitRevision(revision.sidecar)))
              ) {
                throw new Error('The approved current could not be displayed.');
              }
              return { loading: false, revision, error: '' };
            }),
            startWith({ loading: Boolean(view.approvedCurrent), revision: null, error: '' }),
            catchError((error: unknown) =>
              of({ loading: false, revision: null, error: extractErrorMessage(error, 'The approved current could not be loaded. Reload and try again.') })
            )
          );
        })
      ),
      { initialValue: { loading: false, revision: null, error: '' } }
    );
  }

  private initSelectedRun(): Signal<MktgDocumentRunProgress | null> {
    return computed(() => {
      const runs = this.runDetail()?.runs ?? [];
      const selector = this.runParam();
      const selected = (MKTG_STARTED_RUN_ID_REGEX.test(selector) ? selector : '') || this.handoffRunId();
      if (selected) return runs.find((run) => run.runId === selected) ?? null;
      return this.localProgress() ? null : (runs[0] ?? null);
    });
  }

  private initRunState(): Signal<MktgDocumentRunProgress['state'] | null> {
    return computed(() => {
      const states = [this.localProgress(), this.selectedRun()?.state].filter((state) => state != null);
      return states.sort((a, b) => MKTG_STARTED_RUN_STATE_ORDER[b] - MKTG_STARTED_RUN_STATE_ORDER[a])[0] ?? null;
    });
  }

  private initLiveState(): Signal<string> {
    return computed(() => {
      if (this.runState() === 'failed') return this.selectedRun() || !this.unconfirmed() ? 'The run did not finish.' : 'The run could not be confirmed.';
      if (this.runState() === 'questions') return 'Waiting for your answers.';
      if (this.runState()) return 'Generating the asset.';
      return this.view() ? 'The asset is ready.' : '';
    });
  }

  /**
   * The project's Brand Kit, read only while a framework revision is on
   * screen (a kit or a Markdown document prints nothing of this) and only in
   * the browser. Any failed read is the LF look, not an error.
   */
  private initPrintKit(): Signal<BrandKitRevision | null> {
    const projectUid = computed(() => (isPlatformBrowser(this.platformId) && this.asset() !== null ? this.projectContext.activeContextUid() : ''));
    return toSignal(
      toObservable(projectUid).pipe(
        distinctUntilChanged(),
        // A project switch drops the previous project's kit at once: until the new
        // project's kit resolves, the print takes the LF look, never another project's brand.
        switchMap((uid) => (uid ? this.dependencyService.resolveBrandKit(uid).pipe(startWith(null)) : of(null)))
      ),
      { initialValue: null }
    );
  }

  private initViewedAuthorLabel(): Signal<string> {
    return computed(() => describeMktgRevisionAuthor(this.view()?.revision.author));
  }

  private initCurrentRevision(): Signal<MktgRevisionSummary | null> {
    return computed(() => this.view()?.revisions.find((revision) => revision.latest) ?? null);
  }

  private initVisibleRevisionRows(): Signal<MktgRevisionRow[]> {
    return computed(() => {
      const rows = this.revisionRows();
      if (this.showAllRevisions()) return rows;
      const openId = this.view()?.revision.id;
      return rows.filter((row, index) => index < MKTG_DOCUMENT_REVISION_PREVIEW_COUNT || row.revision.latest || row.revision.id === openId);
    });
  }

  private initLinkedinContent() {
    return computed(() => {
      const view = this.view();
      return view?.type.agentKey === LINKEDIN_POST_INTAKE.agentId ? readLinkedinDocumentContent(view.linkedinPost, true) : null;
    });
  }

  private initTitle(): Signal<string> {
    return computed(() => {
      const view = this.view();
      if (!view) {
        const type = this.runDetail()?.type ?? MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === this.params().agentKey);
        return type ? `${this.projectContext.activeContext()?.name ?? ''} ${type.itemLabel}`.trim() : '';
      }
      if (view.member360) return `Member 360 · ${view.member360.period.label}`;
      if (view.type.kind === 'living') {
        return `${this.projectContext.activeContext()?.name ?? ''} ${view.type.label}`.trim();
      }
      const source = this.linkedinContent()?.source;
      return source ? `${view.type.itemLabel} · ${source.label}` : view.type.itemLabel;
    });
  }

  // === Private helpers ===
  private sameView(project: string, view: MktgRevisionResponse, selection: string): boolean {
    return (
      !this.destroyRef.destroyed &&
      this.projectContext.activeContextUid() === project &&
      this.params().agentKey === view.type.agentKey &&
      this.params().documentId === view.documentId &&
      this.view()?.revision.id === view.revision.id &&
      this.revisionParam() === selection
    );
  }

  private writeErrorText(error: HttpErrorResponse): string {
    if (error.status === 403 || error.status === 404) return this.loadErrorText(error.status, error.error?.code);
    if (error.status === 412) return 'The document changed. Reload before making a revision current.';
    return 'The revision could not be made current. Reload to check its state, then try again.';
  }

  private loadErrorText(status: number, code?: string): string {
    if (status === 401 || status === 403) {
      return 'You need write access to this project to see its Marketing OS documents.';
    }
    if (status === 404) {
      return code === 'MKTG_DOCUMENT_NOT_FOUND' ? 'This document could not be found.' : 'This document has no such revision.';
    }
    return 'This revision could not be loaded. Try again in a moment.';
  }

  // === Private helpers ===
  private onProgress(progress: MktgGenerateProgress, pending: MktgPendingGeneration): void {
    if (progress.type === 'submitted' || progress.type === 'restored' || progress.type === 'failed' || progress.type === 'refused') {
      this.submittingGeneration.set(false);
    }
    if (progress.type === 'restored') {
      this.localProgress.set(null);
      this.restoreNotice.set(progress.message);
      return;
    }
    if (progress.type === 'submitted') {
      const runId = this.attempts.load(pending.request.projectUid, pending.request.agentId)?.attempt?.runId ?? '';
      this.handoffRunId.set(runId);
      if (runId) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { run: runId, generation: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    }
    if (progress.type === 'activity' && this.localProgress() !== 'storing') {
      this.localProgress.set('writing');
    }
    if (progress.type === 'document' || progress.type === 'persisted') {
      const location = progress.run?.versions.at(-1)?.documentLocation;
      this.dependencyService.notifyDocumentsChanged(pending.request.projectUid);
      if (location) {
        this.localProgress.set(null);
        void this.router.navigate([mktgKitRootPath(this.router.url), 'documents', location.agentKey, location.documentId], {
          queryParams: { ...this.runAgainParams(), revision: location.revisionId },
        });
      } else {
        this.localProgress.set('storing');
      }
    }
    if (progress.type === 'failed' || progress.type === 'refused') {
      this.localProgress.set('failed');
      this.unconfirmed.set(false);
      this.failureText.set(
        progress.type === 'failed' ? progress.failureText || 'The agent could not complete this run. Your intake is kept — try again.' : progress.reply
      );
    }
    if (progress.type === 'questions') {
      const token = this.attempts.prepare(pending.request, true);
      void this.router.navigate([mktgKitRootPath(this.router.url), pending.request.agentId], {
        queryParams: { ...this.runAgainParams(), questions: token },
      });
    }
  }
}

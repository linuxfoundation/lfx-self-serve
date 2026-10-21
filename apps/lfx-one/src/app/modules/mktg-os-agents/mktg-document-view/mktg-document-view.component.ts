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
  MKTG_KIT_FAMILIES,
  MKTG_KIT_FRAMEWORK_KEY,
} from '@lfx-one/shared/constants';
import {
  BrandKitRevision,
  MktgBoilerplatesAsset,
  MktgFaqAsset,
  MktgFrameworkAsset,
  MktgKitAsset,
  MktgKitFamily,
  MktgRevisionResponse,
  MktgRevisionRow,
  MktgRevisionSummary,
  MktgSlidesExportTarget,
  MktgApprovedRevisionState,
} from '@lfx-one/shared/interfaces';
import {
  boilerplatesAssetOfRevision,
  describeMktgRevision,
  describeMktgRevisionAuthor,
  faqAssetOfRevision,
  foundationMessageAssetOfRevision,
  isMktgSlidesExportAgentKey,
  mktgAssetHeaderMetadata,
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
import { catchError, combineLatest, defer, distinctUntilChanged, EMPTY, filter, finalize, map, Observable, of, startWith, switchMap, tap } from 'rxjs';

import { MktgAssetMetaComponent } from '../components/mktg-asset-meta/mktg-asset-meta.component';
import { BrandKitWebViewComponent } from '../brand-kit-web-view/brand-kit-web-view.component';
import { LinkedinPostOptionsComponent } from '../components/linkedin-post-options/linkedin-post-options.component';
import { MktgBoilerplatesViewComponent } from '../mktg-boilerplates-view/mktg-boilerplates-view.component';
import { MktgFaqViewComponent } from '../mktg-faq-view/mktg-faq-view.component';
import { MktgFrameworkViewComponent } from '../mktg-framework-view/mktg-framework-view.component';
import { MEMBER_360_FAILURE_MESSAGES, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { Member360Result, MktgDocumentListItem, MktgRunActivity } from '@lfx-one/shared/interfaces';
import { bindLfxDocumentTitle } from '@shared/utils/document-title.util';
import { Member360Service } from '@services/member-360.service';
import { Member360ResultComponent } from '../components/member-360-result/member-360-result.component';
import { MktgRunActivityComponent } from '../mktg-run-activity/mktg-run-activity.component';
import { MktgDownstreamComponent } from '../components/mktg-downstream/mktg-downstream.component';

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
    NgClass,
    NgTemplateOutlet,
    MktgAssetMetaComponent,
    MktgDownstreamComponent,
    ButtonComponent,
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

  // Explicit parent target works for both project and foundation route hosts.
  protected readonly documentsRoute = this.route.parent;
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

  private readonly params = toSignal(
    this.route.paramMap.pipe(map((params) => ({ agentKey: params.get('agentKey') ?? '', documentId: params.get('documentId') ?? '' }))),
    { initialValue: { agentKey: '', documentId: '' } }
  );
  private readonly revisionParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('revision') ?? '')), { initialValue: '' });

  // === Computed ===
  protected readonly writePending = computed(() => this.approvingId() !== null || this.restoringId() !== null);
  protected readonly proseView = computed(() => (this.view()?.member360 ? null : this.view()));
  protected readonly isLinkedinDocument = computed(() => this.view()?.type.agentKey === LINKEDIN_POST_INTAKE.agentId);
  protected readonly linkedinContent = this.initLinkedinContent();
  protected readonly kitBreadcrumb: Signal<{ family: MktgKitFamily; asset: MktgKitAsset; living: boolean } | null> = this.initKitBreadcrumb();
  protected readonly generatingLabel = computed(
    () => `Working on ${MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === this.params().agentKey)?.label ?? 'the document'}`
  );
  protected readonly title: Signal<string> = this.initTitle();
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
   * which shows a plain display error, never its stored text.
   */
  protected readonly asset: Signal<MktgFrameworkAsset | null> = computed(() => {
    const view = this.view();
    if (!view || view.revision.format !== 'json' || view.type.agentKey !== 'foundation-message') {
      return null;
    }
    return foundationMessageAssetOfRevision(view.markdown, view.sidecar);
  });
  /**
   * The revision as the Boilerplates, when it is one: a JSON revision of the
   * boilerplates document whose text parses as the four lengths, with the
   * report and checks from its sidecar. Null otherwise — a JSON revision
   * that does not parse shows a plain display error.
   */
  protected readonly boilerplates: Signal<MktgBoilerplatesAsset | null> = computed(() => {
    const view = this.view();
    if (!view || view.revision.format !== 'json' || view.type.agentKey !== 'boilerplates') {
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
    return view?.type.agentKey === 'brand-kit' ? readBrandKitRevision(view.sidecar) : null;
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
    const id = this.view()?.type.catalogAgentId;
    return this.hasAssetView() && id ? ['../../../', id] : undefined;
  });
  protected readonly runAgainParams = computed(() => ({ project: this.projectContext.activeContext()?.slug ?? '' }));
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

  private readonly request$ = toObservable(
    computed(() => ({
      project: this.projectContext.activeContextUid(),
      slug: this.projectContext.activeContext()?.slug ?? '',
      user: this.params().agentKey === 'member-360' ? this.userService.user()?.sub : undefined,
      ...this.params(),
      revisionId: this.revisionParam(),
      reload: this.reload(),
    }))
  );

  public constructor() {
    bindLfxDocumentTitle(computed(() => (this.view()?.member360 ? this.title() : '')));
    if (isPlatformBrowser(this.platformId)) {
      let shownDocument = '';
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
          distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
          tap((request) => {
            const documentKey = JSON.stringify([request.project, request.agentKey, request.documentId]);
            if (documentKey !== shownDocument) {
              this.showAllRevisions.set(false);
              shownDocument = documentKey;
            }
            this.loading.set(true);
            this.view.set(null);
            this.errorText.set('');
            this.notice.set('');
            this.approvalError.set('');
            this.approvalAnnouncement.set('');
            this.editingLink.set(false);
            this.savingLink.set(false);
            this.linkError.set('');
            this.linkForm.enable({ emitEvent: false });
            this.runHistory.set([]);
            this.historyError.set('');
            this.runActivity.set([]);
            this.needsInput.set(false);
            this.runFailed.set(false);
            this.failureDetails.set('');
          }),
          switchMap((request) => {
            if (!request.project || !request.agentKey || !request.documentId) {
              this.generating.set(false);
              return EMPTY;
            }
            const typedPending = request.agentKey === 'member-360' && !!request.user && this.member360.isPending(request.project, request.documentId);
            this.generating.set(typedPending);
            this.runStartedAt.set(typedPending ? (this.member360.pendingStartedAt(request.project, request.documentId) ?? Date.now()) : 0);
            const ready$: Observable<Member360Result | null> = typedPending
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
            // Without `?revision=`, open current, which may not be newest.
            const revision$ = defer(() =>
              request.revisionId
                ? this.documentStore.getRevision(request.project, request.agentKey, request.documentId, request.revisionId)
                : this.documentStore
                    .getDocument(request.project, request.agentKey, request.documentId)
                    .pipe(
                      switchMap((detail) =>
                        this.documentStore.getRevision(
                          request.project,
                          request.agentKey,
                          request.documentId,
                          detail.current?.revisionId ?? (detail.revisions.find((revision) => revision.latest) ?? detail.revisions[0]).id
                        )
                      )
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
                  typedPending
                    ? 'This run could not be loaded yet. Retry to check the same run; nothing is overwritten.'
                    : this.loadErrorText(error.status, error.error?.code)
                );
                return of(null);
              })
            );
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
    // The one-shot write outlives navigation; only its presentation is view-scoped.
    this.documentStore
      .approveRevision(project, view.type.agentKey, view.documentId, view.revision.id)
      .pipe(finalize(() => this.approvingId.update((id) => (id === view.revision.id ? null : id))))
      .subscribe({
        next: (approved) => {
          this.dependencyService.notifyDocumentsChanged(project);
          if (this.sameView(project, view, selection)) {
            this.view.set(approved);
            this.approvalAnnouncement.set(`Revision ${view.revision.number} is approved and current.`);
          }
        },
        error: (error: unknown) => {
          if (this.sameView(project, view, selection)) {
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
    // This one-shot write outlives the page. Only its presentation is scoped to
    // the initiating project/revision, so navigation cannot cancel the save.
    this.documentStore
      .restoreRevision(project, view.type.agentKey, view.documentId, revision.id)
      .pipe(finalize(() => this.restoringId.update((id) => (id === revision.id ? null : id))))
      .subscribe({
        next: (restored) => {
          this.dependencyService.notifyDocumentsChanged(project);
          if (!this.sameView(project, view, selection)) return;
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
          if (!this.sameView(project, view, selection)) return;
          this.errorText.set(this.writeErrorText(error));
        },
      });
  }

  // === Private initializers ===
  private initApprovedView(): Signal<MktgApprovedRevisionState> {
    return toSignal(
      toObservable(this.view).pipe(
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

  private initKitBreadcrumb(): Signal<{ family: MktgKitFamily; asset: MktgKitAsset; living: boolean } | null> {
    return computed(() => {
      const type = this.view()?.type;
      const family = MKTG_KIT_FAMILIES.find((candidate) => candidate.assets.some((asset) => asset.agentKey === type?.agentKey));
      const asset = family?.assets.find((candidate) => candidate.agentKey === type?.agentKey);
      return type && family && asset ? { family, asset, living: type.kind === 'living' } : null;
    });
  }

  private initTitle(): Signal<string> {
    return computed(() => {
      const view = this.view();
      if (!view) {
        return '';
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
    if (status === 403) {
      return 'You need write access to this project to see its Marketing OS documents.';
    }
    if (status === 404) {
      return code === 'MKTG_DOCUMENT_NOT_FOUND' ? 'This document could not be found.' : 'This document has no such revision.';
    }
    return 'This revision could not be loaded. Try again in a moment.';
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import {
  MKTG_FAMILY_APPROVAL_REQUIRED_MESSAGE,
  MKTG_FAMILY_EXPORT_ACTIVE,
  MKTG_FAMILY_EXPORT_ACTIVE_TTL_MS,
  MKTG_FAMILY_EXPORT_FOLLOWED_MESSAGES,
  MKTG_FAMILY_EXPORT_HIGHLIGHT_MS,
  MKTG_FAMILY_EXPORT_FORMAT_HINT,
  MKTG_DOCUMENT_TYPES,
  MKTG_FAMILY_PDF_NOTE,
  MKTG_FAMILY_PRINT_BODY_CLASS,
  MKTG_FAMILY_PRINT_ONLY_CLASS,
  MKTG_FAMILY_SLIDES_NOTE,
  MKTG_KIT_FAMILIES,
  MKTG_POLL_MAX_BACKOFF_MS,
  MKTG_POLL_RETRYING_TEXT,
  MKTG_RUN_POLL,
  MKTG_SLIDES_EXPORT_FAILURE_MESSAGES,
  MKTG_SLIDES_EXPORT_POLL,
  MKTG_SLIDES_EXPORT_START_MESSAGES,
} from '@lfx-one/shared/constants';
import {
  MktgFamilyExportFollowState,
  MktgFamilyExportLastResponse,
  MktgFamilyExportRecord,
  MktgFamilyExportRunUpdate,
  MktgFamilyExportTarget,
  MktgFamilyPrintView,
  MktgSlidesExportMode,
  MktgSlidesExportPhase,
} from '@lfx-one/shared/interfaces';
import {
  describeMktgFamilyExportRunning,
  mktgFamilyExportAgentKeys,
  mktgFamilyExportIdentity,
  mktgPrintDocumentTitle,
  readMktgFamilyExportActiveConflict,
} from '@lfx-one/shared/utils';
import { MktgFamilyExportService } from '@services/mktg-family-export.service';
import { MktgPrintService } from '@services/mktg-print.service';
import { ProjectContextService } from '@services/project-context.service';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  filter,
  from,
  map,
  of,
  Subject,
  Subscription,
  startWith,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { isTransientHttpError } from '@shared/utils/http-error.utils';
import { createVisibilityPoll } from '@shared/utils/visibility-poll.util';
import { MktgFamilyPrintComponent } from '../mktg-family-print/mktg-family-print/mktg-family-print.component';

/** The Family page's named slot; document export controls are independent. */
@Component({
  selector: 'lfx-mktg-family-export-actions',
  imports: [DatePipe, ButtonComponent, MessageComponent, MktgFamilyPrintComponent],
  templateUrl: './mktg-family-export-actions.component.html',
  styleUrl: './mktg-family-export-actions.component.scss',
  host: { class: 'block', '[attr.data-family-id]': 'familyId()' },
})
export class MktgFamilyExportActionsComponent {
  private readonly context = inject(ProjectContextService);
  private readonly api = inject(MktgFamilyExportService);
  private readonly print = inject(MktgPrintService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  public readonly familyId = input.required<string>();
  protected readonly slidesNote = MKTG_FAMILY_SLIDES_NOTE;
  protected readonly pdfNote = MKTG_FAMILY_PDF_NOTE;
  protected readonly approvalNote = MKTG_FAMILY_APPROVAL_REQUIRED_MESSAGE;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly focusRequested = signal(false);
  protected readonly highlighted = signal(false);
  protected readonly formatHint = signal('');
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;
  protected readonly printOnlyClass = MKTG_FAMILY_PRINT_ONLY_CLASS;
  protected readonly familyName = computed(() => MKTG_KIT_FAMILIES.find((family) => family.id === this.familyId())?.name ?? 'Family');

  protected readonly lookup = signal<MktgFamilyExportLastResponse | null>(null);
  protected readonly checking = signal(true);
  protected readonly lookupError = signal('');
  /** True while the last-export lookup is failing transiently and the shared poller retries it; one quiet line, no button. */
  protected readonly lookupRetrying = signal(false);
  protected readonly retryingText = MKTG_POLL_RETRYING_TEXT;
  protected readonly phase = signal<MktgSlidesExportPhase>('idle');
  protected readonly message = signal('');
  protected readonly partialLink = signal<string | null>(null);
  protected readonly completed = signal<MktgFamilyExportRecord | null>(null);
  protected readonly printing = signal(false);
  protected readonly printView = signal<MktgFamilyPrintView | null>(null);
  private readonly retry = new Subject<boolean>();
  private run: Subscription | null = null;
  private readonly pdfRetry = new Subject<void>();
  protected readonly pdfReady = signal(false);
  protected readonly pdfPreparedScope = signal('');
  /** True from the lookup's end until the PDF is prepared and mounted (or failed): the card's checking line stays and Download PDF stays disabled meanwhile. */
  protected readonly pdfPending = signal(false);
  private pdfScope = '';
  /** What the card says once an export it followed is over; '' otherwise. */
  protected readonly followedNote = signal('');
  /** The export this card follows (one it did not start here), or null. */
  private followed: MktgFamilyExportFollowState | null = null;

  protected readonly writer = computed(() => this.context.canWrite());
  protected readonly target = this.initTarget();
  protected readonly busy = computed(() => this.phase() === 'running' || this.printing());
  protected readonly canExport = this.initCanExport();
  protected readonly canPrint = this.initCanPrint();
  /** The export in flight that this card did not start, as the server last said; this card's own run reports itself. */
  protected readonly following = computed(() => (this.phase() === 'running' ? null : (this.lookup()?.running ?? null)));
  protected readonly followingLead = this.initFollowingLead();
  /** One export of a family at a time: while another holds it, a start would only be refused. The PDF is unaffected. */
  protected readonly canExportSlides = computed(() => this.canExport() && !this.following());
  protected readonly last = computed(() => this.lookup()?.last ?? this.completed());
  protected readonly memberVersions = this.initMemberVersions();
  protected readonly skipped = this.initSkipped();

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      combineLatest([toObservable(this.focusRequested), toObservable(this.checking), toObservable(this.canPrint), toObservable(this.canExport)])
        .pipe(takeUntilDestroyed())
        .subscribe(([requested]) => {
          if (!requested || !this.focusRequested()) return;
          if (this.canPrint()) {
            afterNextRender(
              () => {
                if (this.canPrint())
                  this.host.nativeElement.querySelector<HTMLButtonElement>('[data-testid="family-export-pdf"] button')?.focus({ preventScroll: true });
              },
              { injector: this.injector }
            );
            this.focusRequested.set(false);
          } else if (!this.checking() && !this.canExport()) this.focusRequested.set(false);
        });
      this.initLookup();
      this.initPdf();
    }
    this.destroyRef.onDestroy(() => {
      this.run?.unsubscribe();
      clearTimeout(this.highlightTimer);
      this.print.clear();
    });
  }

  /** Browser-only visibility check for the Family's fallback and aside slots. */
  public isRendered(): boolean {
    return isPlatformBrowser(this.platformId) && this.host.nativeElement.getClientRects().length > 0;
  }

  /** Reveal format choices only; never choose a format or start an export. */
  public focusDownload(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const reduced = this.host.nativeElement.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.host.nativeElement.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    this.highlighted.set(true);
    this.formatHint.set(MKTG_FAMILY_EXPORT_FORMAT_HINT);
    clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => {
      this.highlighted.set(false);
      this.formatHint.set('');
    }, MKTG_FAMILY_EXPORT_HIGHLIGHT_MS);
    this.focusRequested.set(true);
  }

  protected export(): void {
    if (!this.canExportSlides()) return;
    this.endFollow();
    if (this.last()) this.phase.set('choosing');
    else this.choose('create');
  }

  protected choose(mode: MktgSlidesExportMode): void {
    const target = this.target();
    if (!target || !this.canExportSlides()) return;
    this.endFollow();
    this.message.set('');
    this.partialLink.set(null);
    this.watch(this.api.run(target, mode));
  }

  protected cancel(): void {
    this.phase.set('idle');
  }
  protected downloadPdf(): void {
    const target = this.target();
    const members = this.lookup()?.currentMembers;
    if (!target || !members || !this.canPrint()) return;
    // A completed preparation may precede its render callback; keep this print in the click task.
    if (this.markPdfReady() && this.pdfScope === JSON.stringify([target, members])) {
      this.print.printNow(MKTG_FAMILY_PRINT_BODY_CLASS, this.pdfTitle());
      return;
    }
    this.printing.set(true);
    this.message.set('');
    this.pdfRetry.next();
  }

  /** Prepare independently of busy(): finishing a fetch must never trigger another fetch or print. */
  private initPdf(): void {
    // Who is exporting to Slides is not part of the PDF's scope: another writer's export never re-prepares this card's PDF.
    const scope = computed(() => {
      const lookup = this.lookup();
      return { target: this.target(), writer: this.writer(), lookup: lookup && { ...lookup, running: null }, checking: this.checking() };
    });
    toObservable(scope)
      .pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap(({ target, writer, lookup, checking }) => {
          this.printView.set(null);
          this.pdfReady.set(false);
          this.pdfPending.set(false);
          this.pdfScope = '';
          this.pdfPreparedScope.set('');
          this.printing.set(false);
          if (!target || !writer || checking || !lookup?.currentMembers.length) return of(null);
          const key = JSON.stringify([target, lookup.currentMembers]);
          return this.pdfRetry.pipe(
            startWith(undefined),
            switchMap(() => {
              this.pdfPending.set(true);
              this.pdfReady.set(false);
              this.pdfPreparedScope.set('');
              return this.api.printView(target, lookup.currentMembers, this.context.activeContext()?.name ?? 'Project').pipe(
                switchMap((view) => {
                  this.printView.set(view);
                  const url = view.brand.fontUrl;
                  if (url) this.print.ensureFontStylesheet(url);
                  return from(this.print.prepare(view.fontFamily, view.weights)).pipe(map(() => ({ view, key })));
                }),
                catchError((error: unknown) => {
                  console.error('[mktg-family-export] PDF could not be prepared', error);
                  this.message.set('The approved family could not be prepared for PDF. Check the current approvals and try again.');
                  return of(null);
                })
              );
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((prepared) => {
        if (!prepared) {
          this.pdfPending.set(false);
          this.printing.set(false);
          return;
        }
        if (this.printView() !== prepared.view) return;
        // This template-bound signal schedules the mount in a zoneless app if it has not rendered yet.
        this.pdfPreparedScope.set(prepared.key);
        if (this.markPdfReady()) return;
        afterNextRender(
          () => {
            if (this.printView() === prepared.view && this.pdfPreparedScope() === prepared.key) this.markPdfReady();
          },
          { injector: this.injector }
        );
      });
  }

  private initTarget(): Signal<MktgFamilyExportTarget | null> {
    return computed(() => {
      const project = this.context.activeContext()?.uid;
      return project && mktgFamilyExportAgentKeys(this.familyId()).length ? { project, familyId: this.familyId() } : null;
    });
  }

  private initCanExport(): Signal<boolean> {
    return computed(
      () =>
        !!this.target() &&
        this.writer() &&
        !this.checking() &&
        !this.lookupError() &&
        // A failed first read leaves no lookup, so Export is held; a transient re-read of a loaded lookup keeps it (law 5:
        // the last loaded content stays and stays usable), as the Slides panel does.
        !!this.lookup()?.currentMembers.length &&
        !this.busy()
    );
  }

  private initCanPrint(): Signal<boolean> {
    return computed(() => this.canExport() && !this.pdfPending() && (this.pdfReady() || !!this.message()));
  }

  private initFollowingLead(): Signal<string> {
    return computed(() => {
      const running = this.following();
      return running ? describeMktgFamilyExportRunning(running) : '';
    });
  }

  private initMemberVersions(): Signal<string> {
    return computed(
      () =>
        this.last()
          ?.members.map(
            (member) => `${MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === member.agentKey)?.label ?? member.agentKey} v${member.revisionNumber}`
          )
          .join(', ') ?? ''
    );
  }

  private initSkipped(): Signal<string> {
    return computed(
      () =>
        this.lookup()
          ?.skippedMembers.map((key) => MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === key)?.label ?? key)
          .join(', ') ?? ''
    );
  }

  private initLookup(): void {
    const scope = computed(() => ({ target: this.target(), writer: this.writer() }));
    toObservable(scope)
      .pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap(({ target, writer }) => {
          this.run?.unsubscribe();
          this.print.clear();
          this.printView.set(null);
          this.printing.set(false);
          this.lookup.set(null);
          this.completed.set(null);
          this.phase.set('idle');
          this.partialLink.set(null);
          this.message.set('');
          this.lookupError.set('');
          this.lookupRetrying.set(false);
          this.endFollow();
          if (!target || !writer) {
            this.checking.set(false);
            return of(null);
          }
          const running = this.api.running(target);
          if (running) this.watch(running);
          return this.retry.pipe(
            startWith(true),
            switchMap((refresh) => {
              // A transient failure is read again by the shared poller (capped backoff; at once on tab return, focus or
              // reconnect) behind one plain line; a final failure keeps its message. No button re-reads.
              let first = true;
              let denied = false;
              const read = () => {
                // A refused lookup is latched for this target (RFC 9110 §15.5.2 (401) and §15.5.4 (403); latching a 401
                // too is the operator's choice, since a session-expiry 401 needs a sign-in, not a poll): no wake re-reads it.
                if (denied) return EMPTY;
                // Only a first read with nothing loaded shows the checking line: a retry keeps the plain line until it
                // succeeds (no flicker), and a re-read after an export keeps the loaded lookup usable (law 5) instead of
                // entering a checking state that a filtered transient failure could never leave.
                if (first) {
                  if (!this.lookup()) this.checking.set(true);
                  this.lookupError.set('');
                }
                const fresh = refresh || !first;
                first = false;
                return this.api.last(target, fresh).pipe(
                  tap((value) => {
                    this.lookupError.set('');
                    this.lookupRetrying.set(false);
                    this.trackFollow(value);
                  }),
                  catchError((error: unknown) => {
                    if (isTransientHttpError(error)) return throwError(() => error);
                    denied = error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403);
                    this.lookupRetrying.set(false);
                    this.lookupError.set('Could not check for an earlier deck. Export is unavailable here, so no second deck is made by mistake.');
                    this.trackFollow(null);
                    return of(null);
                  })
                );
              };
              return createVisibilityPoll(this.document, read, {
                intervalMs: MKTG_SLIDES_EXPORT_POLL.intervalMs,
                backoffBaseMs: MKTG_RUN_POLL.intervalMs,
                backoffMaxMs: MKTG_POLL_MAX_BACKOFF_MS,
                // One read, unless it reports an export this card did not start: that one is read again on the export's
                // own cadence until the server says it is over, and never past the longest a marker can hold the family.
                shouldContinue: (value) => !!value?.running && this.phase() !== 'running' && !!this.followed && Date.now() < this.followed.until,
              }).pipe(
                tap((event) => {
                  if (event.kind === 'error') this.lookupRetrying.set(true);
                }),
                // A transient wake re-read never clears a loaded lookup (the last loaded content stays): only a result replaces it.
                filter((event) => event.kind === 'ok' || !this.lookup()),
                map((event) => (event.kind === 'ok' ? event.value : null))
              );
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((lookup) => {
        this.lookup.set(lookup);
        this.checking.set(false);
      });
  }

  /**
   * The saved PDF's name, like the deck's title: the project, the family and the newest member revision's
   * date, so the same set of members always gives the same name. The family binds several revisions, so
   * it carries no version.
   */
  private pdfTitle(): string {
    const view = this.printView();
    return mktgPrintDocumentTitle(
      view?.projectName ?? this.context.activeContext()?.name ?? 'Project',
      this.familyName(),
      null,
      view?.newestRevisionAt ?? null
    );
  }

  /** Readiness requires both completed font preparation and the current mounted document. Never prints asynchronously. */
  private markPdfReady(): boolean {
    const key = this.pdfPreparedScope();
    if (
      !isPlatformBrowser(this.platformId) ||
      this.destroyRef.destroyed ||
      !this.writer() ||
      this.checking() ||
      !key ||
      !this.printView() ||
      JSON.stringify([this.target(), this.lookup()?.currentMembers]) !== key ||
      !this.host.nativeElement.querySelector('[data-testid="family-export-print-document"] > *')
    )
      return false;
    this.pdfScope = key;
    this.pdfReady.set(true);
    this.pdfPending.set(false);
    this.printing.set(false);
    return true;
  }

  /**
   * Follow an export this card did not start (another writer's, or this writer's from another tab or before a
   * reload), by the server's answer alone. While the answer names one the card shows who and since when instead of
   * its own controls' states, and the lookup is read again until it names none. Then the card says how it ended: its
   * deck is the family's last export (a different export than when following began, or one made after that start),
   * or nothing was kept. This card's own run is never followed: it reports itself.
   */
  private trackFollow(next: MktgFamilyExportLastResponse | null): void {
    const running = this.phase() === 'running' ? null : (next?.running ?? null);
    if (running) {
      if (this.followed?.startedAt !== running.startedAt) {
        this.followed = {
          startedAt: running.startedAt,
          baseline: mktgFamilyExportIdentity(next?.last ?? null),
          until: Date.now() + MKTG_FAMILY_EXPORT_ACTIVE_TTL_MS,
        };
      }
      // The chooser, an earlier failure and an earlier outcome give way to the export that holds the family.
      this.phase.set('idle');
      this.message.set('');
      this.partialLink.set(null);
      this.followedNote.set('');
      return;
    }
    const followed = this.followed;
    this.followed = null;
    if (!followed || !next) return;
    const last = next.last;
    const finished = !!last && (mktgFamilyExportIdentity(last) !== followed.baseline || Date.parse(last.exportedAt) >= Date.parse(followed.startedAt));
    this.followedNote.set(MKTG_FAMILY_EXPORT_FOLLOWED_MESSAGES[finished ? 'done' : 'ended']);
  }

  /** This card moves on (its own export, another project or family): nothing is followed and no outcome is shown. */
  private endFollow(): void {
    this.followed = null;
    this.followedNote.set('');
  }

  private watch(run: ReturnType<MktgFamilyExportService['run']>): void {
    this.run?.unsubscribe();
    this.run = run.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (update: MktgFamilyExportRunUpdate) => {
        this.phase.set('running');
        const result = update.result;
        if (!result) return;
        if (result.status === 'ready') {
          this.completed.set(result.record);
          this.phase.set('done');
          // The server released the family before it answered: this card's own export is over.
          this.lookup.update((value) => (value ? { ...value, last: result.record, stale: false, running: null } : value));
          this.retry.next(true);
        } else if (result.status === 'failed') {
          this.phase.set('failed');
          this.message.set(result.message);
          this.partialLink.set(result.deckLink);
          this.lookup.update((value) => (value ? { ...value, running: null } : value));
        }
      },
      error: (error: unknown) => {
        const body: unknown = error instanceof HttpErrorResponse ? error.error : null;
        const code = error instanceof HttpErrorResponse ? error.error?.code : '';
        if (code === MKTG_FAMILY_EXPORT_ACTIVE) {
          // An answer, not a failure: another start won and nothing was sent. The card follows that export.
          this.phase.set('idle');
          const conflict = readMktgFamilyExportActiveConflict(body);
          if (conflict) {
            const running = { startedBy: conflict.startedBy, startedByViewer: conflict.startedByViewer, startedAt: conflict.startedAt };
            this.lookup.update((value) => (value ? { ...value, running } : value));
            this.trackFollow(this.lookup());
          } else {
            // A body that does not validate names nobody: one plain line, and the read below says who holds the
            // family, or how that export ended if it is already over.
            this.followed = { startedAt: '', baseline: mktgFamilyExportIdentity(this.last()), until: Date.now() + MKTG_FAMILY_EXPORT_ACTIVE_TTL_MS };
            this.followedNote.set(MKTG_SLIDES_EXPORT_START_MESSAGES[MKTG_FAMILY_EXPORT_ACTIVE]);
          }
          this.retry.next(true);
          return;
        }
        console.error('[mktg-family-export] Export could not be completed', error);
        this.message.set(MKTG_SLIDES_EXPORT_START_MESSAGES[code] ?? MKTG_SLIDES_EXPORT_FAILURE_MESSAGES.start);
        this.phase.set('failed');
        // The server is the only truth about what holds the family now: an export this card lost track of may still be running.
        this.retry.next(true);
      },
    });
  }
}

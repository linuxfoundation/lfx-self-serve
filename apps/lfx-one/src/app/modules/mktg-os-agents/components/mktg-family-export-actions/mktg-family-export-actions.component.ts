// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import {
  MKTG_FAMILY_APPROVAL_REQUIRED_MESSAGE,
  MKTG_FAMILY_EXPORT_HIGHLIGHT_MS,
  MKTG_FAMILY_EXPORT_FORMAT_HINT,
  MKTG_DOCUMENT_TYPES,
  MKTG_FAMILY_PDF_NOTE,
  MKTG_FAMILY_PRINT_BODY_CLASS,
  MKTG_FAMILY_PRINT_ONLY_CLASS,
  MKTG_FAMILY_SLIDES_NOTE,
  MKTG_KIT_FAMILIES,
  MKTG_SLIDES_EXPORT_FAILURE_MESSAGES,
  MKTG_SLIDES_EXPORT_START_MESSAGES,
} from '@lfx-one/shared/constants';
import {
  MktgFamilyExportLastResponse,
  MktgFamilyExportRecord,
  MktgFamilyExportRunUpdate,
  MktgFamilyExportTarget,
  MktgFamilyPrintView,
  MktgSlidesExportMode,
  MktgSlidesExportPhase,
} from '@lfx-one/shared/interfaces';
import { mktgFamilyExportAgentKeys } from '@lfx-one/shared/utils';
import { MktgFamilyExportService } from '@services/mktg-family-export.service';
import { MktgPrintService } from '@services/mktg-print.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, combineLatest, distinctUntilChanged, from, map, of, Subject, Subscription, startWith, switchMap } from 'rxjs';
import { MktgBrandKitPrintComponent } from '../../mktg-brand-kit-print/mktg-brand-kit-print.component';
import { MktgBoilerplatesPrintComponent } from '../../mktg-boilerplates-print/mktg-boilerplates-print.component';
import { MktgFaqPrintComponent } from '../../mktg-faq-print/mktg-faq-print.component';
import { MktgFrameworkPrintComponent } from '../../mktg-framework-print/mktg-framework-print.component';

/** The Family page's named slot; document export controls are independent. */
@Component({
  selector: 'lfx-mktg-family-export-actions',
  imports: [
    DatePipe,
    ButtonComponent,
    MessageComponent,
    MktgBrandKitPrintComponent,
    MktgFrameworkPrintComponent,
    MktgBoilerplatesPrintComponent,
    MktgFaqPrintComponent,
  ],
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
  protected readonly previewRequested = signal(false);
  private pdfPending = false;
  private pdfScope = '';

  protected readonly writer = computed(() => this.context.canWrite());
  protected readonly target = this.initTarget();
  protected readonly busy = computed(() => this.phase() === 'running' || this.printing());
  protected readonly canExport = this.initCanExport();
  protected readonly canPrint = this.initCanPrint();
  protected readonly last = computed(() => this.lookup()?.last ?? this.completed());
  protected readonly memberVersions = this.initMemberVersions();
  protected readonly skipped = this.initSkipped();

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      combineLatest([toObservable(this.focusRequested), toObservable(this.checking), toObservable(this.canPrint)])
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
          } else if (!this.checking()) this.focusRequested.set(false);
        });
      this.initLookup();
      this.initPdf();
    }
    this.destroyRef.onDestroy(() => {
      this.run?.unsubscribe();
      clearTimeout(this.highlightTimer);
      this.print.clear(MKTG_FAMILY_PRINT_BODY_CLASS);
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
    if (!this.canExport()) return;
    if (this.last()) this.phase.set('choosing');
    else this.choose('create');
  }

  protected choose(mode: MktgSlidesExportMode): void {
    const target = this.target();
    if (!target || !this.canExport()) return;
    this.message.set('');
    this.partialLink.set(null);
    this.watch(this.api.run(target, mode));
  }

  protected cancel(): void {
    this.phase.set('idle');
  }
  protected checkAgain(): void {
    this.retry.next(true);
  }

  protected downloadPdf(): void {
    const target = this.target();
    const members = this.lookup()?.currentMembers;
    if (!target || !members || !this.canPrint()) return;
    // A completed preparation may precede its render callback; keep this print in the click task.
    if (this.markPdfReady() && this.pdfScope === JSON.stringify([target, members])) {
      this.print.printNow(MKTG_FAMILY_PRINT_BODY_CLASS);
      return;
    }
    this.previewRequested.set(true);
    this.printing.set(true);
    this.message.set('');
    if (!this.pdfPending) this.pdfRetry.next();
  }

  /** Prepare independently of busy(): finishing a fetch must never trigger another fetch or print. */
  private initPdf(): void {
    const scope = computed(() => ({ target: this.target(), writer: this.writer(), lookup: this.lookup(), checking: this.checking() }));
    toObservable(scope)
      .pipe(
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap(({ target, writer, lookup, checking }) => {
          this.printView.set(null);
          this.pdfReady.set(false);
          this.pdfPending = false;
          this.pdfScope = '';
          this.pdfPreparedScope.set('');
          this.printing.set(false);
          this.previewRequested.set(false);
          if (!target || !writer || checking || !lookup?.currentMembers.length) return of(null);
          const key = JSON.stringify([target, lookup.currentMembers]);
          return this.pdfRetry.pipe(
            startWith(undefined),
            switchMap(() => {
              this.pdfPending = true;
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
          this.pdfPending = false;
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
    this.pdfPending = false;
    this.printing.set(false);
    return true;
  }

  private initTarget(): Signal<MktgFamilyExportTarget | null> {
    return computed(() => {
      const project = this.context.activeContext()?.uid;
      return project && mktgFamilyExportAgentKeys(this.familyId()).length ? { project, familyId: this.familyId() } : null;
    });
  }

  private initCanExport(): Signal<boolean> {
    return computed(
      () => !!this.target() && this.writer() && !this.checking() && !this.lookupError() && !!this.lookup()?.currentMembers.length && !this.busy()
    );
  }

  private initCanPrint(): Signal<boolean> {
    return computed(() => this.canExport());
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
          this.print.clear(MKTG_FAMILY_PRINT_BODY_CLASS);
          this.printView.set(null);
          this.printing.set(false);
          this.lookup.set(null);
          this.completed.set(null);
          this.phase.set('idle');
          this.partialLink.set(null);
          this.message.set('');
          this.lookupError.set('');
          if (!target || !writer) {
            this.checking.set(false);
            return of(null);
          }
          const running = this.api.running(target);
          if (running) this.watch(running);
          return this.retry.pipe(
            startWith(true),
            switchMap((refresh) => {
              this.checking.set(true);
              this.lookupError.set('');
              return this.api.last(target, refresh).pipe(
                catchError(() => {
                  this.lookupError.set('Could not check for an earlier deck. Export waits until this check succeeds, so no second deck is made by mistake.');
                  return of(null);
                })
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
          this.lookup.update((value) => (value ? { ...value, last: result.record, stale: false } : value));
          this.retry.next(true);
        } else if (result.status === 'failed') {
          this.phase.set('failed');
          this.message.set(result.message);
          this.partialLink.set(result.deckLink);
        }
      },
      error: (error: unknown) => {
        console.error('[mktg-family-export] Export could not be completed', error);
        const code = error instanceof HttpErrorResponse ? error.error?.code : '';
        this.message.set(MKTG_SLIDES_EXPORT_START_MESSAGES[code] ?? MKTG_SLIDES_EXPORT_FAILURE_MESSAGES.start);
        this.phase.set('failed');
      },
    });
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { MktgSkeletonComponent } from '@components/mktg-skeleton/mktg-skeleton.component';
import {
  MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE,
  MKTG_SLIDES_EXPORT_ASSET_LABELS,
  MKTG_SLIDES_EXPORT_FAILURE_MESSAGES,
  MKTG_SLIDES_EXPORT_START_MESSAGES,
} from '@lfx-one/shared/constants';
import {
  MktgSlidesExportBrandSummary,
  MktgSlidesExportFailure,
  MktgSlidesExportLastResponse,
  MktgSlidesExportLogoNote,
  MktgSlidesExportMode,
  MktgSlidesExportPhase,
  MktgSlidesExportRecord,
  MktgSlidesExportResultResponse,
  MktgSlidesExportRevisionRef,
  MktgSlidesExportRunUpdate,
  MktgSlidesExportTarget,
} from '@lfx-one/shared/interfaces';
import { isMktgSlidesExportStale, mktgSlidesExportBrandSummary } from '@lfx-one/shared/utils';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgSlidesExportService } from '@services/mktg-slides-export.service';
import { catchError, distinctUntilChanged, filter, merge, Observable, of, startWith, Subject, Subscription, switchMap, tap } from 'rxjs';

// Export to Google Slides on a Marketing OS asset page (the Messaging
// Framework and the Brand Kit): the panel under the asset's header that the
// header's "Export to Google Slides" button drives. It shows the document's
// last export ("Open the last export", its date, and whether the asset has
// different approved-current content), asks Update or Create when a deck exists,
// shows progress while the exporter works, then the deck (opens in a new
// tab), its slide count and what was branded — or a plain message with a
// retry. When the last export cannot be read it says so and offers to check
// again rather than Create, and a panel that comes back to a document whose
// export is still under way in this tab shows that export instead of
// offering a second deck. Slides are only an export: the asset itself stays
// the app page.
@Component({
  selector: 'lfx-mktg-slides-export',
  imports: [DatePipe, ButtonComponent, MessageComponent, MktgSkeletonComponent],
  templateUrl: './mktg-slides-export.component.html',
  // Reserve the first lookup's line; hide an empty panel only once the server answers.
  host: { '[class.hidden]': '!visible()' },
})
export class MktgSlidesExportComponent {
  // === Injections ===
  private readonly dependencyService = inject(MktgDependencyService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly exportService = inject(MktgSlidesExportService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  /** The stored revision to export; null when there is none (no project, or nothing stored yet). */
  public readonly target = input<MktgSlidesExportTarget | null>(null);
  /** Read the viewed document's history before its approved export bytes resolve. */
  public readonly lookupTarget = input<MktgSlidesExportTarget | null>(null);
  /** The viewed revision is a Draft, independent of the approved export target. */
  public readonly viewingDraft = input(false);

  // === Signals ===
  public readonly phase = signal<MktgSlidesExportPhase>('idle');
  protected readonly last = signal<MktgSlidesExportRecord | null>(null);
  protected readonly latest = signal<MktgSlidesExportRevisionRef | null>(null);
  protected readonly record = signal<MktgSlidesExportRecord | null>(null);
  protected readonly logoNote = signal<MktgSlidesExportLogoNote | null>(null);
  protected readonly failure = signal<MktgSlidesExportFailure | null>(null);
  protected readonly failureMessage = signal('');
  protected readonly failureDeckLink = signal<string | null>(null);
  private readonly mode = signal<MktgSlidesExportMode>('create');
  /** True once the current target's last export has been read: until then Export cannot tell Update from Create. */
  private readonly lookupSettled = signal(false);
  /** True when a lookup failed: offer Check again, retaining any previously successful lookup. */
  protected readonly lookupFailed = signal(false);
  /** True while the last export is being read: after a failed read the line stays, its "Check again" shown as checking. */
  protected readonly lookupChecking = signal(false);

  // === Computed ===
  /** True while an export runs: the header's button shows it and takes no second click. */
  public readonly busy = computed(() => this.phase() === 'running');
  /**
   * The header's button takes a click only for a target whose last export is
   * known and with no export running: a click while the last export is still
   * being read, or before its first successful read, could see no deck and
   * create a second one instead of offering Update. A failed refresh keeps
   * the previous successful lookup available.
   */
  private readonly lastTarget = computed(() => this.lookupTarget() ?? this.target());
  public readonly canExport = computed(() => {
    const target = this.target();
    const lookup = this.lastTarget();
    return Boolean(
      target &&
      lookup &&
      target.project === lookup.project &&
      target.agentKey === lookup.agentKey &&
      target.documentId === lookup.documentId &&
      this.lookupSettled() &&
      !this.lookupChecking() &&
      !this.busy()
    );
  });
  /** Why the header's Slides button is greyed out, for its tooltip; empty while it takes a click. */
  public readonly disabledReason = computed(() => {
    if (this.canExport()) return '';
    if (!this.target()) return MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE;
    if (this.busy()) return 'An export is already running';
    if (this.lookupFailed()) return 'Could not check the last export. Use Check again below.';
    return 'Checking the last export…';
  });
  protected readonly assetLabel = computed(() => {
    const target = this.lastTarget();
    return target ? MKTG_SLIDES_EXPORT_ASSET_LABELS[target.agentKey] : 'asset';
  });
  protected readonly stale = computed(() => isMktgSlidesExportStale(this.last(), this.latest()));
  protected readonly brand: Signal<MktgSlidesExportBrandSummary | null> = computed(() => {
    const record = this.record();
    return record ? mktgSlidesExportBrandSummary(record.branded, this.logoNote()) : null;
  });
  protected readonly resultDetail = computed(() => {
    const record = this.record();
    if (!record) {
      return '';
    }
    const slides = record.slideCount === 1 ? '1 slide' : `${record.slideCount} slides`;
    return record.mode === 'update' ? `${slides} · the same deck, refreshed in place` : `${slides} · a new deck in Google Drive`;
  });
  /** The last export's line shows while nothing newer is on the panel. */
  protected readonly showLast = computed(() => this.last() !== null && this.phase() !== 'running' && this.phase() !== 'done');
  /** The failed check's line shows while nothing else is on the panel. */
  protected readonly showLookupFailed = computed(() => this.lookupFailed() && this.phase() === 'idle');
  protected readonly lookupPending = computed(() => Boolean(this.lastTarget()) && !this.lookupSettled() && !this.lookupFailed() && this.phase() === 'idle');
  public readonly visible = computed(() => this.lookupPending() || this.phase() !== 'idle' || this.last() !== null || this.lookupFailed());

  private run: Subscription | null = null;
  /** "Check again" after a failed read of the last export. */
  private readonly lookupRetry = new Subject<void>();

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // Follow the document lookup identity (the export target by default).
      // Approved bytes resolving later must not reset an independent lookup.
      // Changing documents detaches this tab's panel, not the server-side export.
      toObservable(this.lastTarget)
        .pipe(
          distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
          tap(() => this.reset()),
          tap((target) => this.attach(target)),
          switchMap((target) => (target ? this.readLast(target) : of<MktgSlidesExportLastResponse | null>({ last: null, latestRevision: null }))),
          takeUntilDestroyed()
        )
        .subscribe((response) => {
          if (!response) {
            this.lookupFailed.set(true);
            return;
          }
          this.lookupFailed.set(false);
          // Keep a local completion ahead of an older in-flight read, but accept
          // a later export made in another tab or by another writer.
          const local = this.record();
          const server = response.last;
          const newest = local && (!server || Date.parse(local.exportedAt) >= Date.parse(server.exportedAt)) ? local : server;
          this.last.set(newest);
          if (local && newest !== local) {
            this.record.set(newest);
          }
          this.latest.set(response.latestRevision);
          this.lookupSettled.set(true);
        });
    }
    this.destroyRef.onDestroy(() => this.run?.unsubscribe());
  }

  // === Public methods ===
  /** The header's "Export to Google Slides": with a deck already made, ask Update or Create; else create one. */
  public onExport(): void {
    if (!this.canExport()) {
      return;
    }
    if (this.last()) {
      this.phase.set('choosing');
      return;
    }
    this.startExport('create');
  }

  // === Protected methods ===
  protected onChoose(mode: MktgSlidesExportMode): void {
    this.startExport(mode);
  }

  protected onRetry(): void {
    this.startExport(this.mode());
  }

  protected onClose(): void {
    this.phase.set('idle');
  }

  protected onCheckAgain(): void {
    if (this.lookupChecking()) {
      return;
    }
    this.lookupRetry.next();
  }

  // === Private helpers ===
  private startExport(mode: MktgSlidesExportMode): void {
    const target = this.target();
    if (!target) {
      return;
    }
    this.mode.set(mode);
    this.watch(this.exportService.run(target, mode));
  }

  /** Show an export of the target's document still under way in this tab (started before the panel last left it). */
  private attach(target: MktgSlidesExportTarget | null): void {
    const running = target ? this.exportService.running(target) : null;
    if (running) {
      this.watch(running);
    }
  }

  /**
   * Follow an export on the panel: progress, then its deck or its failure.
   * The export's own mode is the one a retry uses, so an Update the panel
   * attached to is retried as an Update, never as a second deck.
   */
  private watch(run$: Observable<MktgSlidesExportRunUpdate>): void {
    this.phase.set('running');
    this.record.set(null);
    this.failure.set(null);
    this.failureMessage.set('');
    this.failureDeckLink.set(null);
    this.run?.unsubscribe();
    this.run = run$.subscribe({
      next: (update) => {
        this.mode.set(update.mode);
        this.logoNote.set(update.logoNote);
        if (update.result) {
          this.onResult(update.result);
        }
      },
      error: (error: unknown) => this.onFailed(null, this.requestErrorMessage(error), null),
    });
  }

  /**
   * The target's last export, read again on "Check again" or a project
   * document change (approval / Make current); null while the
   * read has failed. A failed read's line stays until a read succeeds, so a
   * slow or unanswered check never takes away the way to check again.
   */
  private readLast(target: MktgSlidesExportTarget): Observable<MktgSlidesExportLastResponse | null> {
    return merge(this.lookupRetry, this.dependencyService.documentsChanged$.pipe(filter((project) => project === target.project))).pipe(
      startWith(undefined),
      tap(() => this.lookupChecking.set(true)),
      // The service logs the failure; the panel offers to check again.
      switchMap(() => this.exportService.last(target).pipe(catchError(() => of(null)))),
      tap(() => this.lookupChecking.set(false))
    );
  }

  /** Back to an empty panel: the panel stops watching the export under way and nothing of the previous target stays on screen. */
  private reset(): void {
    this.run?.unsubscribe();
    this.run = null;
    this.lookupSettled.set(false);
    this.lookupFailed.set(false);
    this.lookupChecking.set(false);
    this.phase.set('idle');
    this.last.set(null);
    this.latest.set(null);
    this.record.set(null);
    this.logoNote.set(null);
    this.failure.set(null);
    this.failureMessage.set('');
    this.failureDeckLink.set(null);
  }

  private onResult(result: MktgSlidesExportResultResponse): void {
    if (result.status === 'ready') {
      this.record.set(result.record);
      this.last.set(result.record);
      this.phase.set('done');
      return;
    }
    if (result.status === 'failed') {
      this.onFailed(result.failure, result.message, result.deckLink);
    }
  }

  private onFailed(failure: MktgSlidesExportFailure | null, message: string, deckLink: string | null): void {
    this.failure.set(failure);
    this.failureMessage.set(message);
    this.failureDeckLink.set(deckLink);
    this.phase.set('failed');
  }

  /** A refused start or poll, in plain words: by the BFF's error code, else the generic message. */
  private requestErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const code = typeof error.error?.code === 'string' ? error.error.code : '';
      if (MKTG_SLIDES_EXPORT_START_MESSAGES[code]) {
        return MKTG_SLIDES_EXPORT_START_MESSAGES[code];
      }
      if (error.status === 403) {
        return MKTG_SLIDES_EXPORT_START_MESSAGES['FORBIDDEN'];
      }
    }
    return MKTG_SLIDES_EXPORT_FAILURE_MESSAGES.start;
  }
}

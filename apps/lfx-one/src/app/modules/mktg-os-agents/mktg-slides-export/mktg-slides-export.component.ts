// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { MKTG_SLIDES_EXPORT_ASSET_LABELS, MKTG_SLIDES_EXPORT_FAILURE_MESSAGES, MKTG_SLIDES_EXPORT_START_MESSAGES } from '@lfx-one/shared/constants';
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
  MktgSlidesExportTarget,
} from '@lfx-one/shared/interfaces';
import { isMktgSlidesExportStale, mktgSlidesExportBrandSummary } from '@lfx-one/shared/utils';
import { MktgSlidesExportService } from '@services/mktg-slides-export.service';
import { distinctUntilChanged, of, Subscription, switchMap, tap } from 'rxjs';

// Export to Google Slides on a Marketing OS asset page (the Messaging
// Framework and the Brand Kit): the panel under the asset's header that the
// header's "Export to Google Slides" button drives. It shows the document's
// last export ("Open the last export", its date, and whether the asset has
// a newer revision since), asks Update or Create when a deck already exists,
// shows progress while the exporter works, then the deck (opens in a new
// tab), its slide count and what was branded — or a plain message with a
// retry. Slides are only an export: the asset itself stays the app page.
@Component({
  selector: 'lfx-mktg-slides-export',
  imports: [DatePipe, ButtonComponent, MessageComponent],
  templateUrl: './mktg-slides-export.component.html',
  // Hidden while there is nothing to show, so an empty panel takes no gap in the page's column.
  host: { '[class.hidden]': '!visible()' },
})
export class MktgSlidesExportComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly exportService = inject(MktgSlidesExportService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  /** The stored revision to export; null when there is none (no project, or nothing stored yet). */
  public readonly target = input<MktgSlidesExportTarget | null>(null);

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
  /** True once the current target's last export has been read (or its read failed): until then Export cannot tell Update from Create. */
  private readonly lookupSettled = signal(false);

  // === Computed ===
  /** True while an export runs: the header's button shows it and takes no second click. */
  public readonly busy = computed(() => this.phase() === 'running');
  /**
   * The header's button takes a click only for a target whose last export is
   * known and with no export running: a click while the last export is still
   * being read would see no deck and create a second one instead of offering
   * Update.
   */
  public readonly canExport = computed(() => this.target() !== null && this.lookupSettled() && !this.busy());
  protected readonly assetLabel = computed(() => {
    const target = this.target();
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
    return record.mode === 'update' ? `${slides} · the same deck, refreshed in place` : `${slides} · a new deck in the Marketing OS folder`;
  });
  /** The last export's line shows while nothing newer is on the panel. */
  protected readonly showLast = computed(() => this.last() !== null && this.phase() !== 'running' && this.phase() !== 'done');
  public readonly visible = computed(() => this.phase() !== 'idle' || this.last() !== null);

  private run: Subscription | null = null;

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // The panel belongs to one target (project, document and revision). When
      // the page names another, the export under way and its outcome go with
      // the old one (the server keeps its record either way), and the last
      // export is read again for the new one.
      toObservable(this.target)
        .pipe(
          distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
          tap(() => this.reset()),
          // The service logs a failed read and answers no last export: Export still works and creates a new deck.
          switchMap((target) => (target ? this.exportService.last(target) : of<MktgSlidesExportLastResponse>({ last: null, latestRevision: null }))),
          takeUntilDestroyed()
        )
        .subscribe((response) => {
          this.last.set(response.last);
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

  // === Private helpers ===
  private startExport(mode: MktgSlidesExportMode): void {
    const target = this.target();
    if (!target) {
      return;
    }
    this.mode.set(mode);
    this.phase.set('running');
    this.record.set(null);
    this.failure.set(null);
    this.failureMessage.set('');
    this.failureDeckLink.set(null);
    this.run?.unsubscribe();
    this.run = this.exportService
      .start({ ...target, mode })
      .pipe(
        tap((started) => this.logoNote.set(started.logoNote)),
        switchMap((started) => this.exportService.poll(target, started))
      )
      .subscribe({
        next: (result) => this.onResult(result),
        error: (error: unknown) => this.onFailed(null, this.requestErrorMessage(error), null),
      });
  }

  /** Back to an empty panel: the export under way is cancelled and nothing of the previous target stays on screen. */
  private reset(): void {
    this.run?.unsubscribe();
    this.run = null;
    this.lookupSettled.set(false);
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

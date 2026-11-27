// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, output, Signal, signal } from '@angular/core';
import { outputFromObservable, takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CREATIVE_ASSET_MIME_TYPES, CREATIVE_ASSET_QUEUE_STATUS_VIEW, CREATIVE_ASSET_QUEUE_SUMMARY_ORDER } from '@lfx-one/shared/constants';
import type {
  CreativeAssetLibraryQuotaRead,
  CreativeAssetLibraryQuotaState,
  CreativeAssetQueueItem,
  CreativeAssetQueueRow,
  LinkedInStoredDocumentRow,
  LinkedInStoredVideoRow,
} from '@lfx-one/shared/interfaces';
import {
  creativeAssetQueueRetryable,
  creativeAssetUploadAllowed,
  formatFileSize,
  linkedInStoredDocumentRows,
  linkedInStoredVideoRows,
} from '@lfx-one/shared/utils';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { CampaignService } from '@services/campaign.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { catchError, filter, map, of, pairwise, scan, startWith, switchMap } from 'rxjs';

/**
 * Upload many images to a brief's creative library at once — picked as files or as a folder.
 *
 * The library is the one pool every platform's image slots draw from, so this is where an operator
 * puts a designer's export once rather than re-picking the same images into each ad manager. The
 * queue itself lives in `CampaignService` (serial, and it survives this tab being destroyed); this
 * component starts it, reports every file's outcome and shows the quota headroom the library
 * publishes, before the run and as it changes during it.
 */
@Component({
  selector: 'lfx-creative-library-upload',
  imports: [ButtonComponent, FileSizePipe],
  templateUrl: './creative-library-upload.component.html',
  styleUrl: './creative-library-upload.component.scss',
})
export class CreativeLibraryUploadComponent {
  // === Injections ===
  private readonly campaignService = inject(CampaignService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly projectSlug = input('');
  /** The saved brief the images are stored against. */
  public readonly briefId = input('');
  /**
   * Whether this deployment admits creative-asset uploads (any platform's asset capability):
   * `null` while the capability read is unanswered or failed, which is NOT a no. Only the pickers
   * and Retry depend on it; a run already going stays listed and cancellable either way.
   */
  public readonly available = input<boolean | null>(null);
  /** The host's library revision, bumped by any upload (a platform picker's too), to re-read the quota. */
  public readonly reloadToken = input(0);
  /** The stored videos an ad on the tab uses (#5764 row 18): not deletable, since the create would name them. */
  public readonly videoIdsInUse = input<readonly string[]>([]);
  /** Whether a LinkedIn upload is running, which holds every video Delete (an identical upload answers with a stored id). */
  public readonly videoUploadRunning = input(false);
  /** The stored PDF the LinkedIn document ad on the tab uses (campaign-service#665): not deletable, since the create would name it. */
  public readonly documentIdsInUse = input<readonly string[]>([]);

  // === Writable Signals ===
  /** Why the last delete failed, of which kind and on which brief; shown only under that kind, on that brief. */
  private readonly deleteFailure = signal<{ briefId: string; kind: 'video' | 'document'; message: string } | null>(null);
  /** Videos and PDFs deleted on this page, kept off the list while the library is read again (ids are unique across briefs). */
  private readonly deletedAssetIds = signal<readonly string[]>([]);
  /** Bumped by a finished delete, so the library and quota are read again. */
  private readonly deleteRevision = signal(0);

  // === Computed Signals ===
  protected readonly accept = CREATIVE_ASSET_MIME_TYPES.join(',');
  /** The queue's items for the brief on screen; other briefs' runs stay listed under their own brief. */
  protected readonly items: Signal<CreativeAssetQueueItem[]> = computed(() =>
    this.campaignService.creativeAssetUploadQueue().filter((item) => item.briefId !== '' && item.briefId === this.briefId())
  );
  protected readonly rows: Signal<CreativeAssetQueueRow[]> = computed(() =>
    this.items().map((item) => ({
      ...item,
      statusLabel: CREATIVE_ASSET_QUEUE_STATUS_VIEW[item.status].label,
      statusBadge: CREATIVE_ASSET_QUEUE_STATUS_VIEW[item.status].badge,
      retryable: creativeAssetQueueRetryable(item.status, this.available(), this.deletingAssetId() !== ''),
    }))
  );
  /** Whether the pickers may start an upload: never while a stored asset's delete runs (`creativeAssetUploadAllowed`). */
  protected readonly uploadAllowed = computed(() => creativeAssetUploadAllowed(this.available(), this.deletingAssetId() !== ''));
  protected readonly running = computed(() => this.items().some((item) => item.status === 'waiting' || item.status === 'uploading'));
  /**
   * Files the library now holds. `present` counts too: a first attempt can store the image and lose
   * its answer, and the idempotent re-send then answers "already there" for an image that is new.
   */
  private readonly storedCount = computed(() => this.items().filter((item) => item.status === 'uploaded' || item.status === 'present').length);
  /**
   * The stored count each time it RISES within one brief. Clear list drops the count without
   * changing the library, and a switch between briefs (either way) only swaps whose items are
   * counted, so none of these re-reads the quota or tells the host.
   */
  private readonly libraryGrowth$ = toObservable(
    computed(() => ({ briefId: this.briefId(), stored: this.storedCount() }), { equal: (a, b) => a.briefId === b.briefId && a.stored === b.stored })
  ).pipe(
    pairwise(),
    filter(([before, after]) => before.briefId === after.briefId && after.stored > before.stored),
    map(([, after]) => after.stored)
  );
  private readonly libraryRevision = toSignal(this.libraryGrowth$.pipe(scan((count) => count + 1, 0)), { initialValue: 0 });
  protected readonly quota: Signal<CreativeAssetLibraryQuotaState> = this.initQuota();
  protected readonly quotaText: Signal<string> = this.initQuotaText();
  protected readonly overHeadroom: Signal<string> = this.initOverHeadroom();
  protected readonly summary: Signal<string> = this.initSummary();
  protected readonly liveMessage: Signal<string> = this.initLiveMessage();
  protected readonly canClear = computed(() => this.items().length > 0 && !this.running());
  /** The stored video or PDF being deleted, `''` for none. Any running delete holds every Delete: one runs at a time. */
  private readonly deletingAssetId = computed(() => this.campaignService.creativeVideoDeleting()?.id ?? '');
  /** Why the last video delete on the brief on screen failed, `''` for none. */
  protected readonly videoDeleteError = computed(() => this.deleteErrorFor('video'));
  /** Why the last PDF delete on the brief on screen failed, `''` for none. */
  protected readonly documentDeleteError = computed(() => this.deleteErrorFor('document'));
  /** The stored videos, listed apart from the images so their space can be freed (#5764 row 18). */
  protected readonly videoRows: Signal<LinkedInStoredVideoRow[]> = computed(() => {
    const videos = (this.quota().library?.videos ?? []).filter((video) => !this.deletedAssetIds().includes(video.id));
    return linkedInStoredVideoRows(videos, this.videoIdsInUse(), this.videoUploadRunning(), this.deletingAssetId());
  });
  /**
   * The stored PDFs, listed apart from the images so their space can be freed (campaign-service#665). PDFs are uploaded
   * through this queue, so a run here holds their Delete as the LinkedIn upload holds the videos'.
   */
  protected readonly documentRows: Signal<LinkedInStoredDocumentRow[]> = computed(() => {
    const documents = (this.quota().library?.documents ?? []).filter((document) => !this.deletedAssetIds().includes(document.id));
    return linkedInStoredDocumentRows(documents, this.documentIdsInUse(), this.running(), this.deletingAssetId());
  });

  // === Outputs ===
  /** Emitted each time a file adds an asset to the library, so the host can re-read what depends on it. */
  public readonly libraryChanged = outputFromObservable(this.libraryGrowth$);
  /** A stored video was deleted (#5764 row 18), so the host clears it from any ad that still names it. */
  public readonly videoDeleted = output<string>();
  /**
   * The operator asked to take a stored video off the ads on the tab (#5764 row 18), so it can be deleted. Offered for a
   * video in use even when the ads' own video controls are hidden (another ad format chosen, or video withdrawn).
   */
  public readonly videoRelease = output<string>();
  /** A stored PDF was deleted (campaign-service#665), so the host clears it from the document ad if it names it. */
  public readonly documentDeleted = output<string>();
  /** The operator asked to take a stored PDF off the document ad on the tab (campaign-service#665), so it can be deleted. */
  public readonly documentRelease = output<string>();

  // === Protected Methods ===
  protected onFilesPicked(event: Event, folder: boolean): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Cleared so picking the same files again (after a refusal is fixed) still fires `change`.
    input.value = '';
    // The pickers are disabled while a delete runs; this also refuses a change that lands after it started.
    if (!this.uploadAllowed() || files.length === 0 || this.briefId() === '' || this.projectSlug() === '') {
      return;
    }
    this.campaignService.enqueueCreativeAssetUploads(files, this.projectSlug(), this.briefId(), { folder });
  }

  protected retry(item: CreativeAssetQueueItem): void {
    // Retry is hidden while a delete runs (`creativeAssetQueueRetryable`); this also refuses a click that lands after it started.
    if (!creativeAssetQueueRetryable(item.status, this.available(), this.deletingAssetId() !== '')) return;
    this.campaignService.retryCreativeAssetUpload(item.id);
  }

  protected cancel(): void {
    this.campaignService.cancelCreativeAssetUploads(this.briefId());
  }

  protected clear(): void {
    this.campaignService.clearCreativeAssetUploadQueue(this.briefId());
  }

  /** Take a stored video off the ads on the tab (#5764 row 18), which then lets it be deleted. */
  protected releaseVideo(row: LinkedInStoredVideoRow): void {
    if (row.inUse) this.videoRelease.emit(row.id);
  }

  /** Take a stored PDF off the document ad on the tab (campaign-service#665), which then lets it be deleted. */
  protected releaseDocument(row: LinkedInStoredDocumentRow): void {
    if (row.inUse) this.documentRelease.emit(row.id);
  }

  /**
   * Delete one stored video the operator chose (#5764 row 18), then read the library again. campaign-service keeps a video
   * a live campaign may still need (409) and says so; that message is shown as it came.
   */
  protected deleteVideo(row: LinkedInStoredVideoRow): void {
    this.deleteStored(row, 'video');
  }

  /** Delete one stored PDF the operator chose (campaign-service#665), as `deleteVideo` deletes a video. */
  protected deleteDocument(row: LinkedInStoredDocumentRow): void {
    this.deleteStored(row, 'document');
  }

  // === Private Initializers ===
  /**
   * The library's quota, re-read whenever a file adds to it, so the headroom shown during a run is
   * campaign-service's own count rather than an estimate — an identical re-upload stores nothing
   * and costs nothing, which only the service can tell.
   */
  private initQuota(): Signal<CreativeAssetLibraryQuotaState> {
    const request = computed(
      () => ({ projectSlug: this.projectSlug(), briefId: this.briefId(), stored: this.libraryRevision(), reload: this.reloadToken() + this.deleteRevision() }),
      { equal: (a, b) => a.projectSlug === b.projectSlug && a.briefId === b.briefId && a.stored === b.stored && a.reload === b.reload }
    );
    return toSignal(
      toObservable(request).pipe(
        switchMap((target) => {
          const tag = (quota: CreativeAssetLibraryQuotaState): CreativeAssetLibraryQuotaRead => ({ briefId: target.briefId, quota });
          if (target.projectSlug === '' || target.briefId === '') {
            return of(tag({ status: 'error', library: null }));
          }
          return this.campaignService.listCreativeAssets(target.projectSlug, target.briefId).pipe(
            map((library) => tag({ status: 'ready', library })),
            catchError(() => of(tag({ status: 'error', library: null }))),
            startWith(tag({ status: 'loading', library: null }))
          );
        }),
        // A re-read after each stored file keeps the last answer on screen while it loads, so the
        // quota line and the headroom warning do not blink out between files. A change of brief
        // starts from nothing: another brief's numbers are not this one's.
        scan(
          (previous: CreativeAssetLibraryQuotaRead, next: CreativeAssetLibraryQuotaRead): CreativeAssetLibraryQuotaRead =>
            next.quota.status === 'loading' && next.briefId === previous.briefId
              ? { briefId: next.briefId, quota: { status: 'loading', library: previous.quota.library } }
              : next,
          { briefId: '', quota: { status: 'loading', library: null } }
        ),
        map((tagged) => tagged.quota)
      ),
      { initialValue: { status: 'loading', library: null } }
    );
  }

  private initQuotaText(): Signal<string> {
    return computed(() => {
      const { status, library } = this.quota();
      if (!library) {
        if (status === 'loading') {
          return 'Checking how much room this library has…';
        }
        return "Couldn't read this library's quota. Uploads still work; any that would exceed it are refused and listed below.";
      }
      return `${library.count} of ${library.countLimit} files · ${formatFileSize(library.bytesUsed)} of ${formatFileSize(library.bytesLimit)} used`;
    });
  }

  /**
   * A warning when more files are still to send than the library has room for. Not a refusal: a
   * file the library already holds is stored for free, so only the service can say which are over.
   */
  private initOverHeadroom(): Signal<string> {
    return computed(() => {
      const library = this.quota().library;
      if (!library) {
        return '';
      }
      const pending = this.items().filter((item) => item.status === 'waiting' || item.status === 'uploading');
      const room = Math.max(0, library.countLimit - library.count);
      const bytesLeft = Math.max(0, library.bytesLimit - library.bytesUsed);
      const bytesToSend = pending.reduce((total, item) => total + item.byteSize, 0);
      const caveat = 'Any already in the library cost nothing; the rest will be refused once the quota is spent.';
      if (pending.length > room) {
        return `${pending.length} images are still to send and this library has room for ${room} more. ${caveat}`;
      }
      if (bytesToSend > bytesLeft) {
        return `The images still to send total ${formatFileSize(bytesToSend)} and this library has ${formatFileSize(bytesLeft)} left. ${caveat}`;
      }
      return '';
    });
  }

  /** Every outcome counted, so no file is unaccounted for in the one sentence a screen reader hears. */
  private initSummary(): Signal<string> {
    return computed(() => {
      const items = this.items();
      if (items.length === 0) {
        return '';
      }
      const parts = CREATIVE_ASSET_QUEUE_SUMMARY_ORDER.map((status) => ({ status, count: items.filter((item) => item.status === status).length }))
        .filter((part) => part.count > 0)
        .map((part) => `${part.count} ${CREATIVE_ASSET_QUEUE_STATUS_VIEW[part.status].label.toLowerCase()}`);
      return `${items.length} file${items.length === 1 ? '' : 's'}: ${parts.join(', ')}.`;
    });
  }

  /**
   * What a screen reader hears: the run starting and the run settling, not every file's step. A
   * folder of 50 changes `summary` about 100 times, and announcing each would bury the outcome.
   */
  private initLiveMessage(): Signal<string> {
    return computed(() => {
      if (this.running()) {
        // The file COUNT, not what is left: a countdown would be one more announcement per file.
        const total = this.items().length;
        return `Uploading to this brief's library: ${total} file${total === 1 ? '' : 's'} listed.`;
      }
      return this.summary();
    });
  }

  // === Private Helpers ===
  private deleteErrorFor(kind: 'video' | 'document'): string {
    const failure = this.deleteFailure();
    return failure && failure.kind === kind && failure.briefId === this.briefId() ? failure.message : '';
  }

  /** The shared delete of `deleteVideo` and `deleteDocument`: the outcome is told to the host through the kind's output. */
  private deleteStored(row: LinkedInStoredVideoRow | LinkedInStoredDocumentRow, kind: 'video' | 'document'): void {
    const briefId = this.briefId();
    if (row.deleteDisabled || briefId === '' || this.projectSlug() === '') return;
    this.deleteFailure.set(null);
    const gone = (): void => {
      this.deletedAssetIds.update((ids) => [...ids, row.id]);
      if (kind === 'video') this.videoDeleted.emit(row.id);
      else this.documentDeleted.emit(row.id);
      this.deleteRevision.update((revision) => revision + 1);
    };
    this.campaignService
      .deleteCreativeAsset(this.projectSlug(), briefId, row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: gone,
        error: (err: unknown) => {
          // Already gone (deleted elsewhere): read the library again rather than offer a Delete that can only 404.
          if (err instanceof HttpErrorResponse && err.status === 404) {
            gone();
            return;
          }
          this.deleteFailure.set({ briefId, kind, message: serverAuthoredMessage(err, `${row.label} could not be deleted. Try again.`) });
        },
      });
  }
}

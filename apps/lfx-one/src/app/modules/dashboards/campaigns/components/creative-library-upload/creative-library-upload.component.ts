// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { outputFromObservable, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CREATIVE_ASSET_MIME_TYPES, CREATIVE_ASSET_QUEUE_STATUS_VIEW, CREATIVE_ASSET_QUEUE_SUMMARY_ORDER } from '@lfx-one/shared/constants';
import type { CreativeAssetLibraryQuotaRead, CreativeAssetLibraryQuotaState, CreativeAssetQueueItem, CreativeAssetQueueRow } from '@lfx-one/shared/interfaces';
import { formatFileSize } from '@lfx-one/shared/utils';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { CampaignService } from '@services/campaign.service';
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
      retryable: this.available() === true && (item.status === 'failed' || item.status === 'cancelled'),
    }))
  );
  protected readonly running = computed(() => this.items().some((item) => item.status === 'waiting' || item.status === 'uploading'));
  /**
   * Files the library now holds. `present` counts too: a first attempt can store the image and lose
   * its answer, and the idempotent re-send then answers "already there" for an image that is new.
   */
  private readonly storedCount = computed(() => this.items().filter((item) => item.status === 'uploaded' || item.status === 'present').length);
  /**
   * The stored count each time it RISES. Clear list, or a switch to another brief, drops the count
   * without changing the library, so neither re-reads the quota nor tells the host.
   */
  private readonly libraryGrowth$ = toObservable(this.storedCount).pipe(
    pairwise(),
    filter(([before, after]) => after > before),
    map(([, after]) => after)
  );
  private readonly libraryRevision = toSignal(this.libraryGrowth$.pipe(scan((count) => count + 1, 0)), { initialValue: 0 });
  protected readonly quota: Signal<CreativeAssetLibraryQuotaState> = this.initQuota();
  protected readonly quotaText: Signal<string> = this.initQuotaText();
  protected readonly overHeadroom: Signal<string> = this.initOverHeadroom();
  protected readonly summary: Signal<string> = this.initSummary();
  protected readonly liveMessage: Signal<string> = this.initLiveMessage();
  protected readonly canClear = computed(() => this.items().length > 0 && !this.running());

  // === Outputs ===
  /** Emitted each time a file adds an asset to the library, so the host can re-read what depends on it. */
  public readonly libraryChanged = outputFromObservable(this.libraryGrowth$);

  // === Protected Methods ===
  protected onFilesPicked(event: Event, folder: boolean): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Cleared so picking the same files again (after a refusal is fixed) still fires `change`.
    input.value = '';
    if (files.length === 0 || this.briefId() === '' || this.projectSlug() === '') {
      return;
    }
    this.campaignService.enqueueCreativeAssetUploads(files, this.projectSlug(), this.briefId(), { folder });
  }

  protected retry(item: CreativeAssetQueueItem): void {
    this.campaignService.retryCreativeAssetUpload(item.id);
  }

  protected cancel(): void {
    this.campaignService.cancelCreativeAssetUploads(this.briefId());
  }

  protected clear(): void {
    this.campaignService.clearCreativeAssetUploadQueue(this.briefId());
  }

  // === Private Initializers ===
  /**
   * The library's quota, re-read whenever a file adds to it, so the headroom shown during a run is
   * campaign-service's own count rather than an estimate — an identical re-upload stores nothing
   * and costs nothing, which only the service can tell.
   */
  private initQuota(): Signal<CreativeAssetLibraryQuotaState> {
    const request = computed(() => ({ projectSlug: this.projectSlug(), briefId: this.briefId(), stored: this.libraryRevision(), reload: this.reloadToken() }), {
      equal: (a, b) => a.projectSlug === b.projectSlug && a.briefId === b.briefId && a.stored === b.stored && a.reload === b.reload,
    });
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
      return `${library.count} of ${library.countLimit} images · ${formatFileSize(library.bytesUsed)} of ${formatFileSize(library.bytesLimit)} used`;
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
}

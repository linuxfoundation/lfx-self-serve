// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { outputFromObservable, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CREATIVE_ASSET_MIME_TYPES } from '@lfx-one/shared/constants';
import type { CreativeAssetLibraryQuotaState, CreativeAssetQueueItem, CreativeAssetQueueItemStatus } from '@lfx-one/shared/interfaces';
import { formatFileSize } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { catchError, map, of, skip, startWith, switchMap } from 'rxjs';

/** How each outcome reads, and its badge colours. One table, so the label and the colour cannot disagree. */
const STATUS_VIEW: Readonly<Record<CreativeAssetQueueItemStatus, { label: string; badge: string }>> = {
  waiting: { label: 'Waiting', badge: 'bg-gray-100 text-gray-700' },
  uploading: { label: 'Uploading', badge: 'bg-blue-100 text-blue-800' },
  uploaded: { label: 'Uploaded', badge: 'bg-emerald-100 text-emerald-800' },
  present: { label: 'Already in library', badge: 'bg-emerald-50 text-emerald-700' },
  refused: { label: 'Refused', badge: 'bg-red-100 text-red-700' },
  failed: { label: 'Failed', badge: 'bg-amber-100 text-amber-800' },
  cancelled: { label: 'Cancelled', badge: 'bg-gray-100 text-gray-700' },
};

/** The order outcomes are counted in on the summary line. */
const SUMMARY_ORDER: readonly CreativeAssetQueueItemStatus[] = ['uploaded', 'present', 'refused', 'failed', 'cancelled', 'uploading', 'waiting'];

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
  imports: [ButtonComponent],
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
  /** Whether this deployment admits creative-asset uploads at all (any platform's asset capability). */
  public readonly available = input(false);

  // === Computed Signals ===
  protected readonly accept = CREATIVE_ASSET_MIME_TYPES.join(',');
  /** The queue's items, only when they belong to the brief on screen. */
  protected readonly items: Signal<CreativeAssetQueueItem[]> = computed(() => {
    const queue = this.campaignService.creativeAssetUploadQueue();
    return queue.briefId !== '' && queue.briefId === this.briefId() ? queue.items : [];
  });
  protected readonly running = computed(() => this.items().some((item) => item.status === 'waiting' || item.status === 'uploading'));
  /** Files that added an asset to the library: what moves the quota and the slot coverage. */
  private readonly storedCount = computed(() => this.items().filter((item) => item.status === 'uploaded').length);
  protected readonly quota: Signal<CreativeAssetLibraryQuotaState> = this.initQuota();
  protected readonly quotaText: Signal<string> = this.initQuotaText();
  protected readonly overHeadroom: Signal<string> = this.initOverHeadroom();
  protected readonly summary: Signal<string> = this.initSummary();
  protected readonly canClear = computed(() => this.items().length > 0 && !this.running());

  // === Outputs ===
  /** Emitted each time a file adds an asset to the library, so the host can re-read what depends on it. */
  public readonly libraryChanged = outputFromObservable(toObservable(this.storedCount).pipe(skip(1)));

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
    this.campaignService.cancelCreativeAssetUploads();
  }

  protected clear(): void {
    this.campaignService.clearCreativeAssetUploadQueue();
  }

  protected statusLabel(status: CreativeAssetQueueItemStatus): string {
    return STATUS_VIEW[status].label;
  }

  protected statusBadge(status: CreativeAssetQueueItemStatus): string {
    return STATUS_VIEW[status].badge;
  }

  protected size(bytes: number): string {
    return formatFileSize(bytes);
  }

  // === Private Initializers ===
  /**
   * The library's quota, re-read whenever a file adds to it, so the headroom shown during a run is
   * campaign-service's own count rather than an estimate — an identical re-upload stores nothing
   * and costs nothing, which only the service can tell.
   */
  private initQuota(): Signal<CreativeAssetLibraryQuotaState> {
    const request = computed(() => ({ projectSlug: this.projectSlug(), briefId: this.briefId(), stored: this.storedCount() }), {
      equal: (a, b) => a.projectSlug === b.projectSlug && a.briefId === b.briefId && a.stored === b.stored,
    });
    return toSignal(
      toObservable(request).pipe(
        switchMap((target) => {
          if (target.projectSlug === '' || target.briefId === '') {
            return of<CreativeAssetLibraryQuotaState>({ status: 'error', library: null });
          }
          return this.campaignService.listCreativeAssets(target.projectSlug, target.briefId).pipe(
            map((library): CreativeAssetLibraryQuotaState => ({ status: 'ready', library })),
            catchError(() => of<CreativeAssetLibraryQuotaState>({ status: 'error', library: null })),
            startWith<CreativeAssetLibraryQuotaState>({ status: 'loading', library: null })
          );
        })
      ),
      { initialValue: { status: 'loading', library: null } }
    );
  }

  private initQuotaText(): Signal<string> {
    return computed(() => {
      const { status, library } = this.quota();
      if (status === 'loading' && !library) {
        return 'Checking how much room this library has…';
      }
      if (!library) {
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
      const room = Math.max(0, library.countLimit - library.count);
      const toSend = this.items().filter((item) => item.status === 'waiting' || item.status === 'uploading').length;
      if (toSend <= room) {
        return '';
      }
      return `${toSend} images are still to send and this library has room for ${room} more. Any already in the library cost nothing; the rest will be refused.`;
    });
  }

  /** Every outcome counted, so no file is unaccounted for in the one sentence a screen reader hears. */
  private initSummary(): Signal<string> {
    return computed(() => {
      const items = this.items();
      if (items.length === 0) {
        return '';
      }
      const parts = SUMMARY_ORDER.map((status) => ({ status, count: items.filter((item) => item.status === status).length }))
        .filter((part) => part.count > 0)
        .map((part) => `${part.count} ${STATUS_VIEW[part.status].label.toLowerCase()}`);
      return `${items.length} file${items.length === 1 ? '' : 's'}: ${parts.join(', ')}.`;
    });
  }
}

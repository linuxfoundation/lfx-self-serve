// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CreativeAssetLibrary, CreativeAssetQueueItem } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreativeLibraryUploadComponent } from './creative-library-upload.component';

const BRIEF_ID = 'b-1';
const LIBRARY: CreativeAssetLibrary = { assets: [], videos: [], count: 98, countLimit: 100, bytesUsed: 100 * 1024 * 1024, bytesLimit: 512 * 1024 * 1024 };

const item = (id: string, status: CreativeAssetQueueItem['status'], message = '', briefId = BRIEF_ID): CreativeAssetQueueItem => ({
  id,
  briefId,
  projectSlug: 'tlf',
  name: `${id}.png`,
  byteSize: 2048,
  status,
  refusal: status === 'refused' ? 'type' : null,
  message,
  assetId: '',
});

describe('CreativeLibraryUploadComponent', () => {
  let fixture: ComponentFixture<CreativeLibraryUploadComponent>;
  let queue: ReturnType<typeof signal<CreativeAssetQueueItem[]>>;
  let service: Record<string, ReturnType<typeof vi.fn> | unknown>;

  const build = async (listCreativeAssets: ReturnType<typeof vi.fn> = vi.fn(() => of(LIBRARY))): Promise<void> => {
    TestBed.resetTestingModule();
    queue = signal<CreativeAssetQueueItem[]>([]);
    service = {
      creativeAssetUploadQueue: queue.asReadonly(),
      listCreativeAssets,
      enqueueCreativeAssetUploads: vi.fn(),
      retryCreativeAssetUpload: vi.fn(),
      cancelCreativeAssetUploads: vi.fn(),
      clearCreativeAssetUploadQueue: vi.fn(),
      deleteCreativeAsset: vi.fn(() => of(undefined)),
    };
    await TestBed.configureTestingModule({
      imports: [CreativeLibraryUploadComponent],
      providers: [{ provide: CampaignService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(CreativeLibraryUploadComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('briefId', BRIEF_ID);
    fixture.componentRef.setInput('available', true);
    fixture.detectChanges();
  };

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => q(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const setQueue = (items: CreativeAssetQueueItem[]): void => {
    queue.set(items);
    fixture.detectChanges();
  };
  const pick = (testId: string, files: File[]): void => {
    const input = q(testId) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  beforeEach(async () => {
    await build();
  });

  it('shows the quota headroom before anything is picked', () => {
    expect(service['listCreativeAssets']).toHaveBeenCalledWith('tlf', BRIEF_ID);
    expect(text('creative-library-upload-quota')).toBe('98 of 100 files · 100 MB of 512 MB used');
  });

  it('says so, rather than guessing, when the quota cannot be read', async () => {
    await build(vi.fn(() => throwError(() => new Error('down'))));
    expect(text('creative-library-upload-quota')).toContain("Couldn't read this library's quota");
    expect(q('creative-library-upload-headroom')).toBeNull();
  });

  it('queues picked files, and a folder pick as a folder', () => {
    const files = [new File([new Uint8Array(4)], 'a.png', { type: 'image/png' })];
    pick('creative-library-upload-files', files);
    pick('creative-library-upload-folder', files);

    expect(service['enqueueCreativeAssetUploads']).toHaveBeenNthCalledWith(1, files, 'tlf', BRIEF_ID, { folder: false });
    expect(service['enqueueCreativeAssetUploads']).toHaveBeenNthCalledWith(2, files, 'tlf', BRIEF_ID, { folder: true });
  });

  it('offers multi-select on the files input and a folder pick on the other', () => {
    expect((q('creative-library-upload-files') as HTMLInputElement).multiple).toBe(true);
    expect(q('creative-library-upload-folder')?.hasAttribute('webkitdirectory')).toBe(true);
  });

  it('lists every file with its outcome, and counts each outcome', () => {
    setQueue([item('a', 'uploaded'), item('b', 'present'), item('c', 'refused', 'Only PNG and JPEG images can be uploaded.'), item('d', 'failed')]);

    expect(text('creative-library-upload-summary')).toBe('4 files: 1 uploaded, 1 already in library, 1 refused, 1 failed.');
    // Settled, the live region says how the run ended.
    expect(text('creative-library-upload-live')).toBe(text('creative-library-upload-summary'));
    expect(text('creative-library-upload-item-c')).toContain('Only PNG and JPEG images can be uploaded.');
    expect(q('creative-library-upload-retry-d')).not.toBeNull();
    expect(q('creative-library-upload-retry-c')).toBeNull();
  });

  it('retries a failed file through the service', () => {
    setQueue([item('d', 'failed')]);
    (q('creative-library-upload-retry-d')?.querySelector('button') as HTMLButtonElement).click();
    expect(service['retryCreativeAssetUpload']).toHaveBeenCalledWith('d');
  });

  it('announces a run once as it starts, not each file it sends', () => {
    setQueue([item('a', 'uploading'), item('b', 'waiting')]);
    const started = text('creative-library-upload-live');
    setQueue([item('a', 'uploaded'), item('b', 'uploading')]);

    expect(started).toBe("Uploading to this brief's library: 2 files listed.");
    expect(text('creative-library-upload-live')).toBe(started);
  });

  it('offers Cancel while running and Clear once settled, each for this brief', () => {
    setQueue([item('a', 'uploading'), item('b', 'waiting')]);
    (q('creative-library-upload-cancel')?.querySelector('button') as HTMLButtonElement).click();
    expect(service['cancelCreativeAssetUploads']).toHaveBeenCalledWith(BRIEF_ID);
    expect(q('creative-library-upload-clear')).toBeNull();

    setQueue([item('a', 'uploaded'), item('b', 'cancelled')]);
    expect(q('creative-library-upload-cancel')).toBeNull();
    (q('creative-library-upload-clear')?.querySelector('button') as HTMLButtonElement).click();
    expect(service['clearCreativeAssetUploadQueue']).toHaveBeenCalledWith(BRIEF_ID);
  });

  it('warns when more files are still to send than the library has room for', () => {
    setQueue([item('a', 'uploading'), item('b', 'waiting'), item('c', 'waiting')]);
    expect(text('creative-library-upload-headroom')).toContain('3 images are still to send and this library has room for 2 more');
  });

  it("does not show another brief's queue", () => {
    setQueue([item('a', 'uploading', '', 'b-other')]);
    expect(q('creative-library-upload-items')).toBeNull();
  });

  it('re-reads the quota and tells the host each time a file adds to the library', () => {
    const changed = vi.fn();
    fixture.componentInstance.libraryChanged.subscribe(changed);

    setQueue([item('a', 'uploaded'), item('b', 'uploading')]);
    setQueue([item('a', 'uploaded'), item('b', 'failed')]);
    // Clear list drops the count without changing the library.
    setQueue([]);

    expect(changed).toHaveBeenCalledTimes(1);
    expect(service['listCreativeAssets']).toHaveBeenCalledTimes(2);
  });

  it('neither re-reads the quota nor tells the host when switching between briefs, back included', () => {
    const changed = vi.fn();
    fixture.componentInstance.libraryChanged.subscribe(changed);
    setQueue([item('a', 'uploaded'), item('b', 'uploaded'), item('c', 'failed', '', 'b-2')]);
    expect(changed).toHaveBeenCalledTimes(1);
    const reads = (service['listCreativeAssets'] as ReturnType<typeof vi.fn>).mock.calls.length;

    // To a brief with nothing stored (2 -> 0), then back (0 -> 2): the library never changed.
    fixture.componentRef.setInput('briefId', 'b-2');
    fixture.detectChanges();
    fixture.componentRef.setInput('briefId', BRIEF_ID);
    fixture.detectChanges();

    expect(changed).toHaveBeenCalledTimes(1);
    // Only the two brief changes themselves re-read; no growth-driven read on the way back.
    expect(service['listCreativeAssets']).toHaveBeenCalledTimes(reads + 2);
  });

  it('keeps the last quota and headroom warning on screen while a re-read is pending', async () => {
    const reads = new Subject<CreativeAssetLibrary>();
    let first = true;
    await build(
      vi.fn(() => {
        if (first) {
          first = false;
          return of(LIBRARY);
        }
        return reads;
      })
    );
    setQueue([item('a', 'uploading'), item('b', 'waiting'), item('c', 'waiting')]);
    setQueue([item('a', 'uploaded'), item('b', 'uploading'), item('c', 'waiting'), item('d', 'waiting')]);

    expect(text('creative-library-upload-quota')).toBe('98 of 100 files · 100 MB of 512 MB used');
    expect(q('creative-library-upload-headroom')).not.toBeNull();

    reads.next({ ...LIBRARY, count: 99 });
    fixture.detectChanges();
    expect(text('creative-library-upload-quota')).toBe('99 of 100 files · 100 MB of 512 MB used');
  });

  it('keeps a running queue listed and cancellable while the capability is unknown, offering no pick or Retry', () => {
    fixture.componentRef.setInput('available', null);
    setQueue([item('a', 'uploading'), item('d', 'failed')]);

    expect(q('creative-library-upload-checking')).not.toBeNull();
    expect(q('creative-library-upload-files')).toBeNull();
    expect(q('creative-library-upload-items')).not.toBeNull();
    expect(q('creative-library-upload-cancel')).not.toBeNull();
    expect(q('creative-library-upload-retry-d')).toBeNull();
  });

  it('treats an idempotent answer as a library change, since a lost first answer may have stored it', () => {
    const changed = vi.fn();
    fixture.componentInstance.libraryChanged.subscribe(changed);

    setQueue([item('a', 'uploading')]);
    setQueue([item('a', 'present')]);

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("re-reads the quota when the host's library revision moves", () => {
    fixture.componentRef.setInput('reloadToken', 1);
    fixture.detectChanges();
    expect(service['listCreativeAssets']).toHaveBeenCalledTimes(2);
  });

  it('warns when the files still to send exceed the bytes the library has left', async () => {
    await build(vi.fn(() => of({ ...LIBRARY, count: 1, bytesUsed: 512 * 1024 * 1024 - 1024 })));
    setQueue([item('a', 'waiting')]);
    expect(text('creative-library-upload-headroom')).toContain('total 2 KB and this library has 1 KB left');
  });

  it('offers no upload when the deployment admits none', () => {
    fixture.componentRef.setInput('available', false);
    fixture.detectChanges();
    expect(q('creative-library-upload-unavailable')).not.toBeNull();
    expect(q('creative-library-upload-files')).toBeNull();
  });

  // Stored LinkedIn videos (#5764 row 18): listed apart from the images, deleted only by the operator. The Delete rules are
  // rows in `campaign-linkedin-video-form.utils.spec.ts`; these keep the wiring.
  describe('stored videos', () => {
    const VIDEO = { id: 'v-1', byteSize: 20 * 1024 * 1024, checksum: 'ab'.repeat(32) };
    const withVideo = (): ReturnType<typeof vi.fn> => vi.fn(() => of({ ...LIBRARY, videos: [VIDEO] }));
    const deleteButton = (): HTMLButtonElement => q('creative-library-video-delete-v-1')?.querySelector('button') as HTMLButtonElement;

    it('lists a stored video and deletes it on Delete, then reads the library again', async () => {
      await build(withVideo());
      expect(text('creative-library-video-v-1')).toContain('Video 1');

      deleteButton().click();
      fixture.detectChanges();

      expect(service['deleteCreativeAsset']).toHaveBeenCalledWith('tlf', BRIEF_ID, 'v-1');
      expect(service['listCreativeAssets']).toHaveBeenCalledTimes(2);
    });

    it("takes a deleted video off the list at once, and holds the host's video pickers while the delete runs", async () => {
      await build(withVideo());
      const pending = new Subject<void>();
      (service['deleteCreativeAsset'] as ReturnType<typeof vi.fn>).mockReturnValueOnce(pending);
      const running: boolean[] = [];
      const deleted: string[] = [];
      fixture.componentInstance.videoDeleteRunning.subscribe((value) => running.push(value));
      fixture.componentInstance.videoDeleted.subscribe((id) => deleted.push(id));

      deleteButton().click();
      expect(running).toEqual([true]);
      pending.next();
      fixture.detectChanges();

      expect(running).toEqual([true, false]);
      expect(deleted).toEqual(['v-1']);
      expect(q('creative-library-video-v-1')).toBeNull();
    });

    it('treats a video already deleted elsewhere (404) as gone, with no error', async () => {
      await build(withVideo());
      (service['deleteCreativeAsset'] as ReturnType<typeof vi.fn>).mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));

      deleteButton().click();
      fixture.detectChanges();

      expect(q('creative-library-video-delete-error')).toBeNull();
      expect(q('creative-library-video-v-1')).toBeNull();
    });

    it('offers no Delete for a video an ad on the tab uses', async () => {
      await build(withVideo());
      fixture.componentRef.setInput('videoIdsInUse', ['v-1']);
      fixture.detectChanges();

      expect(deleteButton().disabled).toBe(true);
      expect(text('creative-library-video-v-1')).toContain('Used by an ad on this tab');
    });

    it("shows campaign-service's reason when it keeps a video a campaign may need", async () => {
      await build(withVideo());
      (service['deleteCreativeAsset'] as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'A live campaign on this brief still uses this asset.' } }))
      );

      deleteButton().click();
      fixture.detectChanges();

      expect(text('creative-library-video-delete-error')).toContain('A live campaign on this brief still uses this asset.');
      expect(service['listCreativeAssets']).toHaveBeenCalledTimes(1);
    });
  });
});

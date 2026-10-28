// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CreativeAssetLibrary, CreativeAssetQueueItem } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreativeLibraryUploadComponent } from './creative-library-upload.component';

const BRIEF_ID = 'b-1';
const LIBRARY: CreativeAssetLibrary = { assets: [], count: 98, countLimit: 100, bytesUsed: 100 * 1024 * 1024, bytesLimit: 512 * 1024 * 1024 };

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
    expect(text('creative-library-upload-quota')).toBe('98 of 100 images · 100 MB of 512 MB used');
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
    setQueue([item('a', 'uploaded'), item('b', 'present')]);
    // Clear list drops the count without changing the library.
    setQueue([]);

    expect(changed).toHaveBeenCalledTimes(1);
    expect(service['listCreativeAssets']).toHaveBeenCalledTimes(2);
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

    expect(text('creative-library-upload-quota')).toBe('98 of 100 images · 100 MB of 512 MB used');
    expect(q('creative-library-upload-headroom')).not.toBeNull();

    reads.next({ ...LIBRARY, count: 99 });
    fixture.detectChanges();
    expect(text('creative-library-upload-quota')).toBe('99 of 100 images · 100 MB of 512 MB used');
  });

  it('offers no upload when the deployment admits none', () => {
    fixture.componentRef.setInput('available', false);
    fixture.detectChanges();
    expect(q('creative-library-upload-unavailable')).not.toBeNull();
    expect(q('creative-library-upload-files')).toBeNull();
  });
});

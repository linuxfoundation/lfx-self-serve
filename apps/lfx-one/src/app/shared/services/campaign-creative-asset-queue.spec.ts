// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CREATIVE_ASSET_MAX_BYTES, CREATIVE_ASSET_QUOTA_MESSAGE, CREATIVE_ASSET_SUBFOLDER_MESSAGE } from '@lfx-one/shared/constants';
import { CreativeAssetQueueItem, CreativeAssetUploadResult } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignService } from './campaign.service';

const UPLOAD_URL = '/api/campaigns/brief/creative-assets';

// campaign-service's upload admission sheds concurrent uploads with a 503, so the library upload
// must never have two requests open, and every file must end with an outcome the operator can read.
describe('CampaignService library upload queue', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  const OTHER_BRIEF_ID = '7f9619ff-8b86-d011-b42d-00c04fc964ff';

  let service: CampaignService;
  let http: HttpTestingController;

  const png = (name: string, bytes = 16, relativePath = ''): File => {
    const file = new File([new Uint8Array(bytes)], name, { type: 'image/png' });
    if (relativePath) {
      Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
    }
    return file;
  };
  const asset = (id: string, created = true): CreativeAssetUploadResult => ({ id, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created });
  const items = (): CreativeAssetQueueItem[] => service.creativeAssetUploadQueue();
  const statuses = (): string[] => items().map((item) => item.status);
  // `match` takes what it returns off the pending list, so each call sees only requests opened since.
  const open = (): TestRequest[] => http.match((r) => r.url === UPLOAD_URL);

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CampaignService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('sends one file at a time, in pick order, and starts the next only once the first settles', () => {
    service.enqueueCreativeAssetUploads([png('a.png'), png('b.png'), png('c.png')], 'tlf', BRIEF_ID);

    let pending = open();
    expect(pending.length).toBe(1);
    expect(pending[0].request.params.get('brief_id')).toBe(BRIEF_ID);
    expect(pending[0].request.params.get('project')).toBe('tlf');
    expect(statuses()).toEqual(['uploading', 'waiting', 'waiting']);
    pending[0].flush(asset('a-1'));

    pending = open();
    expect(pending.length).toBe(1);
    pending[0].flush(asset('a-2', false));

    pending = open();
    expect(pending.length).toBe(1);
    pending[0].flush(asset('a-3'));

    expect(statuses()).toEqual(['uploaded', 'present', 'uploaded']);
    expect(items().map((item) => item.assetId)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(items().every((item) => item.briefId === BRIEF_ID && item.projectSlug === 'tlf')).toBe(true);
  });

  it('refuses a wrong type, an oversized file and a subfolder file before sending, and lists each one', () => {
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const huge = png('huge.png', CREATIVE_ASSET_MAX_BYTES + 1, 'export/huge.png');
    const nested = png('nested.png', 16, 'export/old/nested.png');
    const top = png('top.png', 16, 'export/top.png');

    service.enqueueCreativeAssetUploads([text, huge, nested, top], 'tlf', BRIEF_ID, { folder: true });

    expect(items().map((item) => [item.name, item.status, item.refusal])).toEqual([
      ['notes.txt', 'refused', 'type'],
      ['export/huge.png', 'refused', 'size'],
      ['export/old/nested.png', 'refused', 'subfolder'],
      ['export/top.png', 'uploading', null],
    ]);
    expect(items()[2].message).toBe(CREATIVE_ASSET_SUBFOLDER_MESSAGE);
    // Only the one top-level image ever reaches the wire.
    open()[0].flush(asset('a-1'));
    expect(open().length).toBe(0);
  });

  it('reports a 409 as refused over quota and carries on with the next file', () => {
    service.enqueueCreativeAssetUploads([png('a.png'), png('b.png')], 'tlf', BRIEF_ID);

    open()[0].flush({ message: 'creative_asset_quota_exceeded' }, { status: 409, statusText: 'Conflict' });
    expect(items()[0]).toMatchObject({ status: 'refused', refusal: 'quota', message: CREATIVE_ASSET_QUOTA_MESSAGE });

    open()[0].flush(asset('a-2', false));
    expect(statuses()).toEqual(['refused', 'present']);
  });

  it('re-sends a file the upload admission shed, backing off, then reports it failed and retryable once the re-sends run out', () => {
    vi.useFakeTimers();
    service.enqueueCreativeAssetUploads([png('a.png')], 'tlf', BRIEF_ID);

    // Three re-sends after 1 s, 2 s and 4 s: a picker's upload can hold the admission for seconds.
    for (const delay of [1000, 2000, 4000]) {
      open()[0].flush({ message: 'busy' }, { status: 503, statusText: 'Service Unavailable' });
      vi.advanceTimersByTime(delay - 1);
      expect(open().length).toBe(0);
      vi.advanceTimersByTime(1);
    }
    open()[0].flush({ message: 'busy' }, { status: 503, statusText: 'Service Unavailable' });
    expect(open().length).toBe(0);
    expect(items()[0].status).toBe('failed');

    service.retryCreativeAssetUpload(items()[0].id);
    expect(items()[0].status).toBe('uploading');
    open()[0].flush(asset('a-1'));
    expect(items()[0].status).toBe('uploaded');
  });

  it('cancels the file in flight and every waiting one, each still retryable', () => {
    service.enqueueCreativeAssetUploads([png('a.png'), png('b.png')], 'tlf', BRIEF_ID);
    const inFlight = open()[0];

    service.cancelCreativeAssetUploads(BRIEF_ID);

    expect(inFlight.cancelled).toBe(true);
    expect(statuses()).toEqual(['cancelled', 'cancelled']);
    expect(open().length).toBe(0);

    service.retryCreativeAssetUpload(items()[1].id);
    open()[0].flush(asset('a-2'));
    expect(statuses()).toEqual(['cancelled', 'uploaded']);
  });

  it('never runs alongside itself when more files are added mid-run', () => {
    service.enqueueCreativeAssetUploads([png('a.png')], 'tlf', BRIEF_ID);
    service.enqueueCreativeAssetUploads([png('b.png')], 'tlf', BRIEF_ID);

    const first = open();
    expect(first.length).toBe(1);
    first[0].flush(asset('a-1'));
    open()[0].flush(asset('a-2'));
    expect(statuses()).toEqual(['uploaded', 'uploaded']);
  });

  it("queues another brief's files behind the first brief's run, keeping every outcome of both", () => {
    service.enqueueCreativeAssetUploads([png('a.png')], 'tlf', BRIEF_ID);
    const first = open();

    service.enqueueCreativeAssetUploads([png('c.png')], 'tlf', OTHER_BRIEF_ID);

    expect(first[0].cancelled).toBe(false);
    expect(open().length).toBe(0);
    first[0].flush(asset('a-1'));
    const next = open();
    expect(next[0].request.params.get('brief_id')).toBe(OTHER_BRIEF_ID);
    next[0].flush(asset('a-3'));
    expect(items().map((item) => [item.briefId, item.status])).toEqual([
      [BRIEF_ID, 'uploaded'],
      [OTHER_BRIEF_ID, 'uploaded'],
    ]);
  });

  it("cancels and clears only the brief asked about, leaving another brief's run going", () => {
    service.enqueueCreativeAssetUploads([png('a.png')], 'tlf', BRIEF_ID);
    service.enqueueCreativeAssetUploads([png('c.png')], 'tlf', OTHER_BRIEF_ID);
    const inFlight = open()[0];

    service.clearCreativeAssetUploadQueue(OTHER_BRIEF_ID);

    expect(inFlight.cancelled).toBe(false);
    expect(items().map((item) => item.briefId)).toEqual([BRIEF_ID]);
    inFlight.flush(asset('a-1'));
    // The cleared brief's file is never sent.
    expect(open().length).toBe(0);
  });

  it("cancelling one brief leaves another brief's waiting files waiting", () => {
    service.enqueueCreativeAssetUploads([png('a1.png'), png('a2.png')], 'tlf', BRIEF_ID);
    service.enqueueCreativeAssetUploads([png('b1.png')], 'tlf', OTHER_BRIEF_ID);

    service.cancelCreativeAssetUploads(OTHER_BRIEF_ID);

    expect(statuses()).toEqual(['uploading', 'waiting', 'cancelled']);
    open()[0].flush(asset('a-1'));
    open()[0].flush(asset('a-2'));
    expect(open().length).toBe(0);
  });

  // A Retry re-queues at the BACK. The file's original attempt is still buffered behind the run in
  // flight, and reviving it would let the retried file take the last quota place ahead of B2.
  it('sends a retried file after files queued since, not from its old place', () => {
    service.enqueueCreativeAssetUploads([png('a.png')], 'tlf', BRIEF_ID);
    service.enqueueCreativeAssetUploads([png('b1.png')], 'tlf', OTHER_BRIEF_ID);
    const inFlight = open();
    service.cancelCreativeAssetUploads(OTHER_BRIEF_ID);
    service.enqueueCreativeAssetUploads([png('b2.png')], 'tlf', OTHER_BRIEF_ID);
    service.retryCreativeAssetUpload(items()[1].id);

    inFlight[0].flush(asset('a-1'));
    const second = open();
    expect(items().find((item) => item.status === 'uploading')?.name).toBe('b2.png');
    second[0].flush(asset('a-2'));
    expect(items().find((item) => item.status === 'uploading')?.name).toBe('b1.png');
    open()[0].flush(asset('a-3'));
    expect(open().length).toBe(0);
  });

  it('cancels a file waiting out a re-send delay without sending it again', () => {
    vi.useFakeTimers();
    service.enqueueCreativeAssetUploads([png('a.png')], 'tlf', BRIEF_ID);
    open()[0].flush({ message: 'busy' }, { status: 503, statusText: 'Service Unavailable' });
    vi.advanceTimersByTime(500);

    service.cancelCreativeAssetUploads(BRIEF_ID);
    vi.advanceTimersByTime(10_000);

    expect(open().length).toBe(0);
    expect(items()[0].status).toBe('cancelled');
  });

  it.each([
    [400, 'refused', false],
    [413, 'refused', false],
    [415, 'refused', false],
    [401, 'failed', true],
  ])('reports a %s as %s, retryable: %s', (status, outcome, retryable) => {
    service.enqueueCreativeAssetUploads([png('a.png')], 'tlf', BRIEF_ID);
    open()[0].flush({ message: 'no' }, { status, statusText: 'Error' });

    expect(items()[0].status).toBe(outcome);
    service.retryCreativeAssetUpload(items()[0].id);
    const resent = open();
    expect(resent.length).toBe(retryable ? 1 : 0);
    resent.forEach((req) => req.flush(asset('a-1')));
  });

  it('waits its turn when a cancelled file is retried while another is in flight', () => {
    service.enqueueCreativeAssetUploads([png('a.png')], 'tlf', BRIEF_ID);
    service.cancelCreativeAssetUploads(BRIEF_ID);
    expect(open()[0].cancelled).toBe(true);
    service.enqueueCreativeAssetUploads([png('b.png')], 'tlf', BRIEF_ID);
    const inFlight = open();

    service.retryCreativeAssetUpload(items()[0].id);

    expect(inFlight.length).toBe(1);
    expect(open().length).toBe(0);
    inFlight[0].flush(asset('a-2'));
    open()[0].flush(asset('a-1'));
    expect(statuses()).toEqual(['uploaded', 'uploaded']);
  });

  it('leaves a single-slot picker upload running while the library uploads', () => {
    service.uploadCreativeAsset(png('meta.png'), 'tlf', BRIEF_ID, 'meta').subscribe();
    service.enqueueCreativeAssetUploads([png('a.png')], 'tlf', BRIEF_ID);
    service.clearCreativeAssetUploadQueue(BRIEF_ID);

    const pending = open();
    expect(pending.length).toBe(2);
    expect(pending.filter((req) => req.cancelled).length).toBe(1);
    pending.filter((req) => !req.cancelled).forEach((req) => req.flush(asset('m-1')));
    expect(service.resumeCreativeAssetUpload('meta', BRIEF_ID)).not.toBeNull();
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CreativeAssetUploadResult } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CampaignService } from './campaign.service';

// The Implementation tab is destroyed on a tab switch. Its upload subscription goes with it, so
// the request must not: an aborted upload left the draft with no image and nothing to say why.
describe('CampaignService creative-asset upload across a tab switch', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  const ASSET: CreativeAssetUploadResult = {
    id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    mimeType: 'image/png',
    byteSize: 16,
    checksum: 'ab'.repeat(32),
    created: true,
  };

  let service: CampaignService;
  let http: HttpTestingController;
  const png = (): File => new File([new Uint8Array(16)], 'promo.png', { type: 'image/png' });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CampaignService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('keeps the request running after its only subscriber leaves, and hands the answer to a resume', () => {
    service.uploadCreativeAsset(png(), 'tlf', BRIEF_ID).subscribe().unsubscribe();
    const req = http.expectOne((r) => r.url === '/api/campaigns/brief/creative-assets');
    expect(req.cancelled).toBe(false);

    req.flush(ASSET);

    let resumed: CreativeAssetUploadResult | null = null;
    service.resumeCreativeAssetUpload(BRIEF_ID)?.subscribe((a) => (resumed = a));
    expect(resumed).toEqual(ASSET);
  });

  it('replays a refusal to a resume instead of uploading again', () => {
    service
      .uploadCreativeAsset(png(), 'tlf', BRIEF_ID)
      .subscribe({ error: () => undefined })
      .unsubscribe();
    http.expectOne((r) => r.url === '/api/campaigns/brief/creative-assets').flush({ message: 'not an image' }, { status: 400, statusText: 'Bad Request' });

    let status = 0;
    service.resumeCreativeAssetUpload(BRIEF_ID)?.subscribe({ error: (e: { status: number }) => (status = e.status) });
    expect(status).toBe(400);
    http.expectNone((r) => r.url === '/api/campaigns/brief/creative-assets');
  });

  it('keeps only the latest upload, so an abandoned brief does not hold its image for the session', () => {
    const OTHER_BRIEF = '0f8fad5b-d9cb-469f-a165-70867728950e';
    service.uploadCreativeAsset(png(), 'tlf', BRIEF_ID);
    const latest = service.uploadCreativeAsset(png(), 'tlf', OTHER_BRIEF);

    expect(service.resumeCreativeAssetUpload(BRIEF_ID)).toBeNull();
    expect(service.resumeCreativeAssetUpload(OTHER_BRIEF)).toBe(latest);
  });

  it('forgets only the upload it is told to, so a stale answer cannot drop a newer pick', () => {
    const first = service.uploadCreativeAsset(png(), 'tlf', BRIEF_ID);
    const second = service.uploadCreativeAsset(png(), 'tlf', BRIEF_ID);

    service.forgetCreativeAssetUpload(BRIEF_ID, first);
    expect(service.resumeCreativeAssetUpload(BRIEF_ID)).toBe(second);
    service.forgetCreativeAssetUpload(BRIEF_ID);
    expect(service.resumeCreativeAssetUpload(BRIEF_ID)).toBeNull();
  });
});

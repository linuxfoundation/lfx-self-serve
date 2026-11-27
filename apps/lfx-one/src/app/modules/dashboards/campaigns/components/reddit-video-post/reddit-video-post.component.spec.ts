// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';

import { RedditVideoPostComponent } from './reddit-video-post.component';

/** Wiring only: the video post rules are `campaign-reddit-video.utils.ts`'s, tested there. */
describe('RedditVideoPostComponent', () => {
  let f: ComponentFixture<RedditVideoPostComponent>;
  const c = (): Record<string, any> => f.componentInstance as unknown as Record<string, any>;
  const query = (testId: string): HTMLElement | null => f.nativeElement.querySelector(`[data-testid="${testId}"]`);

  beforeEach(async () => {
    // The upload chooser wraps PrimeNG's FileUpload, which injects HttpClient.
    await TestBed.configureTestingModule({ imports: [RedditVideoPostComponent], providers: [provideHttpClient()] }).compileComponents();
    f = TestBed.createComponent(RedditVideoPostComponent);
    f.componentRef.setInput('videoPost', { videoAssetId: '', videoBriefId: '', thumbnailAssetId: '', thumbnailBriefId: '' });
    f.componentRef.setInput('briefId', 'b-1');
  });

  it('records the brief each pick is made for, names the variants left out, and clears the video with the "No video" option', () => {
    c()['onVideoPick']('v-1');
    c()['onThumbnailPick']('i-1');
    expect(f.componentInstance.videoPost()).toEqual({ videoAssetId: 'v-1', videoBriefId: 'b-1', thumbnailAssetId: 'i-1', thumbnailBriefId: 'b-1' });
    f.componentRef.setInput('variantCount', 2);
    f.detectChanges();
    expect(query('reddit-video-post-variants-note')?.textContent).toContain('Variant 2 is not sent.');
    c()['onVideoPick']('');
    expect(f.componentInstance.videoPost()).toMatchObject({ videoAssetId: '', videoBriefId: '' });
  });

  it('offers the upload only while given, and holds it while a delete runs', () => {
    f.detectChanges();
    expect(query('reddit-video-post-upload')).toBeNull();
    f.componentRef.setInput('uploadAvailable', true);
    f.detectChanges();
    const uploads: File[][] = [];
    f.componentInstance.upload.subscribe((files) => uploads.push(files));
    const clip = new File([new Uint8Array(4)], 'clip.mp4', { type: 'video/mp4' });
    f.debugElement.query(By.css('lfx-file-upload')).triggerEventHandler('onSelect', { files: [clip] });
    expect(uploads).toEqual([[clip]]);

    f.componentRef.setInput('deletingAssetId', 'v-1');
    f.detectChanges();
    expect(query('reddit-video-post-upload')).toBeNull();
    expect(query('reddit-video-post-upload-held')).not.toBeNull();
  });
});

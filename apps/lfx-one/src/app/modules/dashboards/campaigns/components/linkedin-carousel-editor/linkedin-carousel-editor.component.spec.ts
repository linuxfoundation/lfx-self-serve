// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { LinkedInCarouselCardDraft } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';
import { LinkedInCarouselEditorComponent } from './linkedin-carousel-editor.component';

/** Wiring only: the card rules are `campaign-linkedin-carousel-form.utils.ts`'s, tested there. */
describe('LinkedInCarouselEditorComponent', () => {
  const card = (key: string): LinkedInCarouselCardDraft => ({ key, imageAssetId: '', imageAssetBriefId: '', headline: '', destinationUrl: '' });
  let f: ComponentFixture<LinkedInCarouselEditorComponent>;
  const c = (): Record<string, any> => f.componentInstance as unknown as Record<string, any>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LinkedInCarouselEditorComponent] }).compileComponents();
    f = TestBed.createComponent(LinkedInCarouselEditorComponent);
    f.componentRef.setInput('cards', [card('card-1'), card('card-2')]);
    f.componentRef.setInput('introText', '');
    f.componentRef.setInput('briefId', 'b-1');
  });

  it('keeps 2 to 10 cards, and records the brief an image is picked for', () => {
    c()['remove']('card-1');
    expect(f.componentInstance.cards()).toHaveLength(2);
    for (let i = 0; i < 9; i++) c()['add']();
    expect(f.componentInstance.cards()).toHaveLength(10);

    c()['onImagePick']('card-2', 'img-1');
    expect(f.componentInstance.cards()[1]).toMatchObject({ imageAssetId: 'img-1', imageAssetBriefId: 'b-1' });
    // The "No image" option clears the pick, so a held image is never stuck.
    c()['onImagePick']('card-2', '');
    expect(f.componentInstance.cards()[1]).toMatchObject({ imageAssetId: '', imageAssetBriefId: '' });
  });

  it('renders a card per draft with its image picker, and the upload only while offered', () => {
    f.detectChanges();
    const query = (testId: string): HTMLElement | null => f.nativeElement.querySelector(`[data-testid="${testId}"]`);
    expect(query('linkedin-carousel-editor-image-1')).not.toBeNull();
    expect(query('linkedin-carousel-editor-upload')).toBeNull();
    f.componentRef.setInput('uploadAvailable', true);
    f.detectChanges();
    expect(query('linkedin-carousel-editor-upload')).not.toBeNull();
  });
});

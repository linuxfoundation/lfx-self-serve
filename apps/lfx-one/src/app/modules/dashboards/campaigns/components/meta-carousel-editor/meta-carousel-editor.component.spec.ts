// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MetaCarouselCardDraft } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';
import { MetaCarouselEditorComponent } from './meta-carousel-editor.component';

/** Wiring only: the card rules are `campaign-meta-carousel.utils.ts`'s, tested there. */
describe('MetaCarouselEditorComponent', () => {
  const card = (key: string): MetaCarouselCardDraft => ({ key, imageAssetId: '', imageAssetBriefId: '', imageUrl: '', headline: '', description: '' });
  let f: ComponentFixture<MetaCarouselEditorComponent>;
  const c = (): Record<string, any> => f.componentInstance as unknown as Record<string, any>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MetaCarouselEditorComponent] }).compileComponents();
    f = TestBed.createComponent(MetaCarouselEditorComponent);
    f.componentRef.setInput('cards', [card('card-1'), card('card-2')]);
    f.componentRef.setInput('message', '');
    f.componentRef.setInput('briefId', 'b-1');
  });

  it('keeps 2 to 10 cards, moves them, and records the brief an image is picked for', () => {
    c()['remove']('card-1');
    expect(f.componentInstance.cards()).toHaveLength(2);
    for (let i = 0; i < 9; i++) c()['add']();
    expect(f.componentInstance.cards()).toHaveLength(10);
    c()['move']('card-2', -1);
    expect(f.componentInstance.cards()[0].key).toBe('card-2');

    c()['onImagePick']('card-1', 'img-1');
    expect(f.componentInstance.cards()[1]).toMatchObject({ imageAssetId: 'img-1', imageAssetBriefId: 'b-1' });
    c()['onImagePick']('card-1', '');
    expect(f.componentInstance.cards()[1]).toMatchObject({ imageAssetId: '', imageAssetBriefId: '' });
  });

  it('renders one message and a card per draft, with the stored image picker and URL only while offered', () => {
    f.detectChanges();
    const all = (testId: string): number => f.nativeElement.querySelectorAll(`[data-testid^="${testId}"]`).length;
    expect(all('meta-carousel-editor-message')).toBe(1);
    expect(all('meta-carousel-editor-headline-')).toBe(2);
    expect(all('meta-carousel-editor-image-')).toBe(0);
    f.componentRef.setInput('uploadAvailable', true);
    f.componentRef.setInput('urlAvailable', true);
    f.detectChanges();
    expect(all('meta-carousel-editor-image-url-')).toBe(2);
    expect(all('meta-carousel-editor-upload')).toBeGreaterThan(0);
  });
});

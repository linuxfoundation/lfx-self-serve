// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { LinkedInTextAdDraft } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { LinkedInTextAdsEditorComponent } from './linkedin-text-ads-editor.component';

// The rules (counters, errors, keys) are table rows in campaign-linkedin-text-ads-form.utils.spec.ts; this spec only
// checks the wiring: a view's error reaches the template, and edits, adds and removes reach the model.
describe('LinkedInTextAdsEditorComponent', () => {
  let fixture: ComponentFixture<LinkedInTextAdsEditorComponent>;
  let model: LinkedInTextAdDraft[];

  const el = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  // The inputs and buttons are uikit wrappers, so their handlers are called directly.
  const call = (name: string, ...args: unknown[]): void => {
    (fixture.componentInstance as unknown as Record<string, (...a: unknown[]) => void>)[name](...args);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LinkedInTextAdsEditorComponent] }).compileComponents();
    fixture = TestBed.createComponent(LinkedInTextAdsEditorComponent);
    fixture.componentRef.setInput('textAds', [{ key: 'text-ad-1', headline: '', description: 'Join us' }]);
    fixture.componentInstance.textAds.subscribe((value) => (model = value));
    fixture.detectChanges();
  });

  it('shows each ad with the error under its field', () => {
    expect(el('linkedin-text-ads-editor-ad-0')).not.toBeNull();
    expect(el('linkedin-text-ads-editor-headline-0')?.textContent).toContain('Enter the headline.');
  });

  it('edits, adds and removes ads in the model, never below one', () => {
    call('onTextChange', 'text-ad-1', 'headline', 'KubeCon');
    expect(model).toEqual([{ key: 'text-ad-1', headline: 'KubeCon', description: 'Join us' }]);

    call('add');
    expect(model.map((ad) => ad.key)).toEqual(['text-ad-1', 'text-ad-2']);

    call('remove', 'text-ad-1');
    call('remove', 'text-ad-2');
    expect(model.map((ad) => ad.key)).toEqual(['text-ad-2']);
  });
});

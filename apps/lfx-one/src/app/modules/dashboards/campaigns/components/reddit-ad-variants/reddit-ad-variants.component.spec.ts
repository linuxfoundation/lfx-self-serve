// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { RedditAdVariant } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { RedditAdVariantsComponent } from './reddit-ad-variants.component';

// The rules (headline marks, the 5-variant cap, draft entries) are tested in `campaign-reddit-ad-variants.utils.spec.ts`; these test the wiring.
describe('RedditAdVariantsComponent', () => {
  let fixture: ComponentFixture<RedditAdVariantsComponent>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const variants = (): RedditAdVariant[] => fixture.componentInstance.variants();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RedditAdVariantsComponent] }).compileComponents();
    fixture = TestBed.createComponent(RedditAdVariantsComponent);
    fixture.componentRef.setInput('variants', [{ headline: 'Brief headline', body: 'Brief body' }]);
    fixture.componentRef.setInput('check', 'every');
    fixture.detectChanges();
  });

  it('edits a headline, keeping the body as preview text, then adds and removes a variant', () => {
    expect(query('reddit-ad-variants-body-0')?.textContent).toContain('Brief body');
    fixture.debugElement.query(By.css('[data-testid="reddit-ad-variants-headline-0"]')).triggerEventHandler('valueChange', 'Edited');
    query('reddit-ad-variants-add')?.querySelector('button')?.click();
    fixture.detectChanges();
    expect(variants()).toEqual([{ headline: 'Edited', body: 'Brief body' }, { headline: '' }]);
    expect(query('reddit-ad-variants-variant-1')?.textContent).toContain('Enter a headline.');

    query('reddit-ad-variants-remove-0')?.querySelector('button')?.click();
    fixture.detectChanges();
    expect(variants()).toEqual([{ headline: '' }]);
  });
});

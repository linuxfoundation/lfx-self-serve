// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DEFAULT_REDDIT_DELIVERY } from '@lfx-one/shared/constants';
import type { RedditDeliveryDraft } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { RedditDeliveryComponent } from './reddit-delivery.component';

// The rules (what is sent, the last box staying ticked, the budget copy) are tested in
// campaign-reddit-delivery.utils.spec.ts; this spec only checks the wiring: each control's edit reaches the model, and
// each capability shows only its own controls.
describe('RedditDeliveryComponent', () => {
  let fixture: ComponentFixture<RedditDeliveryComponent>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const emit = (testId: string, event: string, value: unknown): void => {
    fixture.debugElement.query(By.css(`[data-testid="${testId}"]`)).triggerEventHandler(event, value);
    fixture.detectChanges();
  };
  const delivery = (): RedditDeliveryDraft => fixture.componentInstance.delivery();

  function render(placementsEnabled: boolean, budgetTypeEnabled: boolean): void {
    fixture.componentRef.setInput('placementsEnabled', placementsEnabled);
    fixture.componentRef.setInput('budgetTypeEnabled', budgetTypeEnabled);
    fixture.componentRef.setInput('delivery', { ...DEFAULT_REDDIT_DELIVERY, placements: ['FEED', 'COMMENTS_PAGE'], platforms: ['DESKTOP', 'MOBILE_NATIVE'] });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RedditDeliveryComponent] }).compileComponents();
    fixture = TestBed.createComponent(RedditDeliveryComponent);
  });

  it('carries each control to the model, keeping the last ticked placement locked', () => {
    render(true, true);

    emit('reddit-delivery-budget-type', 'valueChange', 'daily');
    emit('reddit-delivery-placement-COMMENTS_PAGE', 'checkedChange', false);
    emit('reddit-delivery-platform-MOBILE_WEB', 'checkedChange', true);
    emit('reddit-delivery-expand-targeting', 'checkedChange', false);

    expect(delivery()).toEqual({ budgetType: 'daily', placements: ['FEED'], platforms: ['DESKTOP', 'MOBILE_NATIVE', 'MOBILE_WEB'], expandTargeting: false });
    const feed = fixture.debugElement.query(By.css('[data-testid="reddit-delivery-placement-FEED"]'));
    expect(feed.componentInstance.disabled()).toBe(true);
  });

  it('shows only the budget type on that capability alone', () => {
    render(false, true);

    expect(query('reddit-delivery-budget-type')).not.toBeNull();
    expect(query('reddit-delivery-placements')).toBeNull();
    expect(query('reddit-delivery-expand-targeting')).toBeNull();
  });

  it('shows nothing without either capability', () => {
    render(false, false);

    expect(query('reddit-delivery')).toBeNull();
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_META_AD_SCHEDULE, DEFAULT_META_FREQUENCY_CAP } from '@lfx-one/shared/constants';
import type { MetaDeliveryDraft } from '@lfx-one/shared/interfaces';
import { emptyMetaDeliveryDraft } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { MetaDeliveryOptionsComponent } from './meta-delivery-options.component';

// The rules (which days and hours, the cap's bounds, what each control starts from) are tested in
// campaign-meta-delivery.utils.spec.ts; this spec only checks the wiring: each control's edit reaches the model, and
// a cap the rules refuse shows why.
describe('MetaDeliveryOptionsComponent', () => {
  let fixture: ComponentFixture<MetaDeliveryOptionsComponent>;
  let model: MetaDeliveryDraft;

  const el = <T extends HTMLElement>(testId: string): T => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as T;
  const change = (testId: string, set: (e: HTMLInputElement & HTMLSelectElement) => void, event = 'change'): void => {
    const target = el<HTMLInputElement & HTMLSelectElement>(testId);
    set(target);
    target.dispatchEvent(new Event(event));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MetaDeliveryOptionsComponent] }).compileComponents();
    fixture = TestBed.createComponent(MetaDeliveryOptionsComponent);
    fixture.componentRef.setInput('scheduleShown', true);
    fixture.componentRef.setInput('capShown', true);
    fixture.componentRef.setInput('delivery', emptyMetaDeliveryDraft());
    fixture.componentInstance.delivery.subscribe((value) => (model = value));
    fixture.detectChanges();
  });

  it('turns the schedule on at weekdays 9–17, then takes a day and an end hour', () => {
    change('meta-delivery-schedule-toggle', (e) => (e.checked = true));
    expect(model.adSchedule).toEqual(DEFAULT_META_AD_SCHEDULE);

    change('meta-delivery-day-6', (e) => (e.checked = true));
    change('meta-delivery-end', (e) => (e.value = '1200'));
    expect(model.adSchedule).toEqual({ days: [1, 2, 3, 4, 5, 6], startMinute: 540, endMinute: 1200 });
  });

  it('turns the cap on at 2 every 7 days, takes a typed value, and says why one is refused', () => {
    change('meta-delivery-cap-toggle', (e) => (e.checked = true));
    expect(model.frequencyCap).toEqual(DEFAULT_META_FREQUENCY_CAP);

    change('meta-delivery-impressions', (e) => (e.value = '120'), 'input');
    expect(model.frequencyCap).toEqual({ maxImpressions: 120, intervalDays: 7 });
    expect(el('meta-delivery-cap-error')?.textContent).toContain('from 1 to 90');
  });
});

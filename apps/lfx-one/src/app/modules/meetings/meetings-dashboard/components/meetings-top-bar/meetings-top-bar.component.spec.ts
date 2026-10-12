// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsTopBarComponent } from './meetings-top-bar.component';

describe('MeetingsTopBarComponent — Accepted filter chip', () => {
  let fixture: ComponentFixture<MeetingsTopBarComponent>;

  const chip = (): HTMLButtonElement | null => fixture.nativeElement.querySelector('[data-testid="filter-pill-accepted"]');

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(MeetingsTopBarComponent);
    fixture.componentRef.setInput('meetingTypeOptions', []);
  });

  it('is hidden unless the dashboard asks for it', () => {
    fixture.detectChanges();

    expect(chip()).toBeNull();
  });

  it('shows its count and pressed state', () => {
    fixture.componentRef.setInput('showAcceptedFilter', true);
    fixture.componentRef.setInput('acceptedCount', 3);
    fixture.componentRef.setInput('acceptedOnly', true);
    fixture.detectChanges();

    expect(chip()?.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('[data-testid="filter-pill-count-accepted"]')?.textContent?.trim()).toBe('3');
  });

  it('emits the inverted state when the chip is clicked', () => {
    const emitted = vi.fn();
    fixture.componentInstance.acceptedOnlyChange.subscribe(emitted);
    fixture.componentRef.setInput('showAcceptedFilter', true);
    fixture.detectChanges();

    chip()?.click();
    expect(emitted).toHaveBeenLastCalledWith(true);

    fixture.componentRef.setInput('acceptedOnly', true);
    fixture.detectChanges();
    chip()?.click();
    expect(emitted).toHaveBeenLastCalledWith(false);
  });
});

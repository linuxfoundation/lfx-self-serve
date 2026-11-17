// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgTrainingStatsErrorComponent } from './org-training-stats-error.component';

describe('OrgTrainingStatsErrorComponent', () => {
  let fixture: ComponentFixture<OrgTrainingStatsErrorComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [OrgTrainingStatsErrorComponent] });
    fixture = TestBed.createComponent(OrgTrainingStatsErrorComponent);
    fixture.componentRef.setInput('testIdPrefix', 'some-stats');
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('renders an alert with the heading and the default message under the prefixed test id', () => {
    const alert = el.querySelector('[data-testid="some-stats-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain("Couldn't load training stats");
    expect(alert?.textContent).toContain("fetching this company's training numbers");
  });

  it('shows a custom message', () => {
    fixture.componentRef.setInput('message', 'Custom text.');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="some-stats-error"]')?.textContent).toContain('Custom text.');
  });

  it('emits retry when the Retry button is clicked', () => {
    let retries = 0;
    fixture.componentInstance.retry.subscribe(() => retries++);
    (el.querySelector('[data-testid="some-stats-retry"] button') as HTMLButtonElement).click();
    expect(retries).toBe(1);
  });
});

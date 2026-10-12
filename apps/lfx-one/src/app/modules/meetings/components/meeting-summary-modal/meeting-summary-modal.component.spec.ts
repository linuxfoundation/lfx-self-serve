// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';
import { describe, expect, it } from 'vitest';

import { MeetingSummaryModalComponent } from './meeting-summary-modal.component';

const summary = (approved: boolean, requiresApproval: boolean): PastMeetingSummary =>
  ({
    uid: 'sum-1',
    approved,
    requires_approval: requiresApproval,
    summary_data: { title: 'Summary', content: '- A point', edited_content: '', doc_url: '', start_time: '', end_time: '' },
  }) as unknown as PastMeetingSummary;

/** E4-03: the modal shares the page's approval model, on V1 and V2 alike. */
describe('MeetingSummaryModalComponent approval status', () => {
  const render = (value: PastMeetingSummary): HTMLElement => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MeetingSummaryModalComponent],
      providers: [{ provide: DynamicDialogConfig, useValue: { data: { summary: value } } }],
    });
    const fixture = TestBed.createComponent(MeetingSummaryModalComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it.each([
    [true, true, 'approved', 'Approved'],
    [false, true, 'pending', 'Pending review'],
  ])('shows %s/%s as %s', (approved, requiresApproval, state, label) => {
    const status = render(summary(approved, requiresApproval)).querySelector('[data-testid="summary-status"]');
    expect(status?.getAttribute('data-approval')).toBe(state);
    expect(status?.textContent?.trim()).toBe(label);
  });

  // A summary that never required approval used to read "Pending Review".
  it('shows no status for a summary that never required approval', () => {
    expect(render(summary(false, false)).querySelector('[data-testid="summary-status"]')).toBeNull();
  });
});

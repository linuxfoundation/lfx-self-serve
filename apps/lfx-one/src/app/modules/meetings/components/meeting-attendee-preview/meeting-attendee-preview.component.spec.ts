// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MEETING_ATTENDEE_PREVIEW_LIMIT } from '@lfx-one/shared/constants';
import { MeetingAttendeePreviewPerson } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingAttendeePreviewComponent } from './meeting-attendee-preview.component';

describe('MeetingAttendeePreviewComponent', () => {
  let fixture: ComponentFixture<MeetingAttendeePreviewComponent>;

  const people = (count: number): MeetingAttendeePreviewPerson[] =>
    Array.from({ length: count }, (_, i) => ({ key: `p${i}`, name: `Person ${i}`, avatarUrl: null }));

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MeetingAttendeePreviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(MeetingAttendeePreviewComponent);
  });

  it('caps the faces at the preview limit and shows the rest as +N of the total', async () => {
    fixture.componentRef.setInput('people', people(12));
    fixture.componentRef.setInput('total', 30);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelectorAll('lfx-avatar')).toHaveLength(MEETING_ATTENDEE_PREVIEW_LIMIT);
    expect(query('attendee-preview-overflow')?.textContent?.trim()).toBe(`+${30 - MEETING_ATTENDEE_PREVIEW_LIMIT}`);
  });

  it('omits the overflow when everyone fits', async () => {
    fixture.componentRef.setInput('people', people(2));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelectorAll('lfx-avatar')).toHaveLength(2);
    expect(query('attendee-preview-overflow')).toBeNull();
  });

  it('renders nothing when there is nobody to show', async () => {
    fixture.componentRef.setInput('people', []);
    await fixture.whenStable();

    expect(query('attendee-preview')).toBeNull();
  });

  it('emits viewAll from the View all link', async () => {
    fixture.componentRef.setInput('people', people(3));
    await fixture.whenStable();
    let clicks = 0;
    fixture.componentInstance.viewAll.subscribe(() => clicks++);

    query('attendee-preview-view-all')?.click();

    expect(clicks).toBe(1);
  });
});

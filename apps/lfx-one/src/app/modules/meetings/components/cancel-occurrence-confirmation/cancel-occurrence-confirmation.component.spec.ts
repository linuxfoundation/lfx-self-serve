// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MEETING_OCCURRENCE_CANCEL_NOTE_MAX_LENGTH } from '@lfx-one/shared/constants';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CancelOccurrenceConfirmationComponent } from './cancel-occurrence-confirmation.component';

const MEETING = { id: 'meeting-1', title: 'Weekly sync' } as Meeting;
const OCCURRENCE = { occurrence_id: '1893492000', start_time: '2030-01-01T10:00:00.000Z', duration: 30 } as MeetingOccurrence;

/**
 * Covers the single-occurrence cancel confirmation.
 * @description The optional reason rides along to upstream, which puts it in the cancellation email
 * to guests; a blank one must send nothing rather than an empty note.
 */
describe('CancelOccurrenceConfirmationComponent', () => {
  let cancelOccurrence: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let config: { data: { meeting: Meeting; occurrence: MeetingOccurrence }; closable?: boolean };

  async function mount(): Promise<CancelOccurrenceConfirmationComponent> {
    config = { data: { meeting: MEETING, occurrence: OCCURRENCE }, closable: true };
    TestBed.configureTestingModule({
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: config },
        { provide: MeetingService, useValue: { cancelOccurrence } },
      ],
    });
    TestBed.overrideComponent(CancelOccurrenceConfirmationComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(CancelOccurrenceConfirmationComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    cancelOccurrence = vi.fn().mockReturnValue(of(undefined));
    close = vi.fn();
  });

  it('cancels without a note when the reason is left blank', async () => {
    const component = await mount();

    component.form.controls.note.setValue('   ');
    component.onConfirm();

    expect(cancelOccurrence).toHaveBeenCalledWith('meeting-1', '1893492000', undefined);
    expect(close).toHaveBeenCalledWith({ confirmed: true });
  });

  it('sends the trimmed reason', async () => {
    const component = await mount();

    component.form.controls.note.setValue('  Holiday week  ');
    component.onConfirm();

    expect(cancelOccurrence).toHaveBeenCalledWith('meeting-1', '1893492000', 'Holiday week');
  });

  it('refuses a reason over the upstream limit', async () => {
    const component = await mount();

    component.form.controls.note.setValue('x'.repeat(MEETING_OCCURRENCE_CANCEL_NOTE_MAX_LENGTH + 1));
    component.onConfirm();

    expect(cancelOccurrence).not.toHaveBeenCalled();
  });

  it('accepts a reason at the limit once its surrounding whitespace is trimmed', async () => {
    const component = await mount();
    const reason = 'x'.repeat(MEETING_OCCURRENCE_CANCEL_NOTE_MAX_LENGTH);

    component.form.controls.note.setValue(`  ${reason}\n`);
    component.onConfirm();

    expect(cancelOccurrence).toHaveBeenCalledWith('meeting-1', '1893492000', reason);
  });

  it('counts the reason limit in code points, as upstream does', async () => {
    const component = await mount();

    component.form.controls.note.setValue('😀'.repeat(MEETING_OCCURRENCE_CANCEL_NOTE_MAX_LENGTH));

    expect(component.form.valid).toBe(true);
  });

  it('swallows Escape only while the request is in flight', async () => {
    const response = new Subject<void>();
    cancelOccurrence.mockReturnValue(response);
    const component = await mount();
    const pressEscape = (): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event;
    };

    expect(pressEscape().defaultPrevented).toBe(false);
    component.onConfirm();
    expect(pressEscape().defaultPrevented).toBe(true);
    response.next();
    expect(pressEscape().defaultPrevented).toBe(false);
  });

  it('locks the header close button while the request is in flight', async () => {
    const response = new Subject<void>();
    cancelOccurrence.mockReturnValue(response);
    const component = await mount();

    component.onConfirm();
    TestBed.tick();
    expect(config.closable).toBe(false);

    response.error(new HttpErrorResponse({ status: 500 }));
    TestBed.tick();
    expect(config.closable).toBe(true);
    expect(close).toHaveBeenCalledWith({ confirmed: false, error: 'Server error occurred while canceling occurrence.' });
  });
});

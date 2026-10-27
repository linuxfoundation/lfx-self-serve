// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { SURVEY_REMINDER_MAX_RECIPIENTS } from '@lfx-one/shared/constants';
import { Survey, SurveyResponseItem } from '@lfx-one/shared/interfaces';
import { SurveyService } from '@services/survey.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SurveyReminderDialogComponent } from './survey-reminder-dialog.component';

const RECIPIENTS = [
  { id: 'r-1', first_name: 'Ana', email: 'ana@example.com' },
  { id: 'r-2', first_name: 'Ben', email: 'ben@example.com' },
] as SurveyResponseItem[];

async function mount(send: Observable<{ recipient_count: number }> = of({ recipient_count: 2 })) {
  TestBed.resetTestingModule();
  const sendSurveyReminders = vi.fn().mockReturnValue(send);
  const add = vi.fn();
  const close = vi.fn();
  TestBed.configureTestingModule({
    imports: [SurveyReminderDialogComponent],
    providers: [
      { provide: DynamicDialogRef, useValue: { close } },
      { provide: DynamicDialogConfig, useValue: { data: { survey: { uid: 's-1' } as Survey, recipients: RECIPIENTS }, closable: true } },
      { provide: SurveyService, useValue: { sendSurveyReminders } },
      { provide: MessageService, useValue: { add } },
    ],
  });
  const fixture = TestBed.createComponent(SurveyReminderDialogComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, component: fixture.componentInstance, sendSurveyReminders, add, close };
}

describe('SurveyReminderDialogComponent', () => {
  it('starts with every recipient selected and sends to the selection', async () => {
    const { component, sendSurveyReminders, add, close } = await mount();

    component['toggleRecipient']('r-2');
    component['send']();

    expect(sendSurveyReminders).toHaveBeenCalledWith('s-1', ['r-1']);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    expect(close).toHaveBeenCalledWith(true);
  });

  it('keeps the dialog open and explains a rate limit', async () => {
    const { component, add, close } = await mount(throwError(() => new HttpErrorResponse({ status: 429 })));

    component['send']();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: expect.stringContaining('try again in a minute') }));
    expect(close).not.toHaveBeenCalled();
  });

  it('flags an unconfirmed outcome on a server error', async () => {
    const { component, add } = await mount(throwError(() => new HttpErrorResponse({ status: 502 })));

    component['send']();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Outcome unconfirmed' }));
  });

  it('refuses to send more recipients than the per-request cap', async () => {
    const { component, sendSurveyReminders } = await mount();
    component['selectedIds'].set(new Set(Array.from({ length: SURVEY_REMINDER_MAX_RECIPIENTS + 1 }, (_, i) => `r-${i}`)));

    component['send']();

    expect(component['overCap']()).toBe(true);
    expect(sendSurveyReminders).not.toHaveBeenCalled();
  });
});

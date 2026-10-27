// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuComponent } from '@components/menu/menu.component';
import { Survey, SurveyResponseItem } from '@lfx-one/shared/interfaces';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SurveyReminderDialogComponent } from '../survey-reminder-dialog/survey-reminder-dialog.component';
import { SurveySentEmailDialogComponent } from '../survey-sent-email-dialog/survey-sent-email-dialog.component';
import { SurveyResponsesListComponent } from './survey-responses-list.component';

const SURVEY = {
  uid: 's-1',
  survey_title: 'Board NPS',
  survey_status: 'sent',
  survey_cutoff_date: '2099-01-01T00:00:00Z',
  committees: [{ committee_uid: 'c-1', committee_name: 'Governing Board', project_name: 'CNCF' }],
  email_body: '<p>Hi {{.FirstName}}</p>',
} as unknown as Survey;

// 250 rows: more than one upstream page, so a filter that only saw the first page would miss row 249.
const ROWS: SurveyResponseItem[] = Array.from(
  { length: 250 },
  (_, i) =>
    ({
      id: `r-${i}`,
      committee_uid: 'c-1',
      first_name: `Person${i}`,
      email: `p${i}@example.com`,
      response_status: i === 249 ? 'Failed' : 'Delivered',
      survey_link: i === 0 ? 'https://www.surveymonkey.com/r/abc' : undefined,
    }) as SurveyResponseItem
);

async function mount(survey: Survey = SURVEY, rows: SurveyResponseItem[] = ROWS) {
  TestBed.resetTestingModule();
  const copyLink = vi.fn();
  const open = vi.fn();
  TestBed.configureTestingModule({
    imports: [SurveyResponsesListComponent],
    providers: [{ provide: ClipboardShareService, useValue: { copyLink } }],
  });
  TestBed.overrideComponent(SurveyResponsesListComponent, { set: { providers: [{ provide: DialogService, useValue: { open } }] } });
  const fixture = TestBed.createComponent(SurveyResponsesListComponent);
  fixture.componentRef.setInput('survey', survey);
  fixture.componentRef.setInput('responses', rows);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, component: fixture.componentInstance, copyLink, open };
}

function openMenu(component: SurveyResponsesListComponent, row: SurveyResponseItem) {
  const menu = { toggle: vi.fn() } as unknown as MenuComponent;
  component['toggleRowActionMenu'](new MouseEvent('click'), row, menu);
  return component['rowActionMenuItems']();
}

describe('SurveyResponsesListComponent', () => {
  let current: ComponentFixture<SurveyResponsesListComponent> | undefined;
  afterEach(() => current?.destroy());

  it('filters across every row passed in, not just the first page', async () => {
    const { fixture, component } = await mount();
    current = fixture;

    component.filterForm.controls.delivery.setValue('failed');
    fixture.detectChanges();

    expect(component['filteredResponses']().map((r) => r.id)).toEqual(['r-249']);
  });

  it('offers copy link, prefilled email and the sent email for a recipient with a personal link', async () => {
    const { fixture, component, copyLink, open } = await mount();
    current = fixture;

    const items = openMenu(component, ROWS[0]);

    expect(items.map((i) => i.label)).toEqual(['Send reminder', 'Copy personal link', 'Email recipient', 'View sent email']);
    expect(items[2].url).toMatch(/^mailto:p0%40example\.com\?subject=Reminder%3A%20Board%20NPS&body=/);
    items[1].command!({});
    expect(copyLink).toHaveBeenCalledWith('https://www.surveymonkey.com/r/abc', 'Personal survey link copied.');
    items[3].command!({});
    expect(open).toHaveBeenCalledWith(SurveySentEmailDialogComponent, expect.objectContaining({ data: { survey: SURVEY, response: ROWS[0] } }));
  });

  it('hides copy link without a link and the sent email without a stored body', async () => {
    const { fixture, component } = await mount({ ...SURVEY, email_body: undefined });
    current = fixture;

    expect(openMenu(component, ROWS[1]).map((i) => i.label)).toEqual(['Send reminder', 'Email recipient']);
  });

  it('offers no reminders once the survey is closed or for recipients who responded', async () => {
    const { fixture, component } = await mount({ ...SURVEY, response_status: 'closed' } as Survey);
    current = fixture;
    expect(openMenu(component, ROWS[1]).map((i) => i.label)).not.toContain('Send reminder');
    expect(fixture.nativeElement.querySelector('[data-testid="survey-responses-send-reminders"]')).toBeNull();

    const responded = { ...ROWS[1], response_datetime: '2026-11-03T10:00:00Z' };
    const open = await mount(SURVEY, [responded]);
    current = open.fixture;
    expect(openMenu(open.component, responded).map((i) => i.label)).not.toContain('Send reminder');
  });

  it('opens the reminder dialog with every non-respondent and reports a send', async () => {
    const { fixture, component, open } = await mount();
    current = fixture;
    open.mockReturnValue({ onClose: of(true) });
    const sent = vi.fn();
    component.remindersSent.subscribe(sent);

    fixture.nativeElement.querySelector('[data-testid="survey-responses-send-reminders"] button').click();

    expect(open).toHaveBeenCalledWith(SurveyReminderDialogComponent, expect.objectContaining({ data: { survey: SURVEY, recipients: ROWS } }));
    expect(sent).toHaveBeenCalledOnce();
  });
});

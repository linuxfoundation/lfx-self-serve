// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Survey, SurveyResponseItem } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SurveySentEmailDialogComponent } from './survey-sent-email-dialog.component';

const SURVEY = {
  uid: 's-1',
  survey_title: 'Board NPS',
  committees: [],
  email_subject: 'Feedback for {{.ProjectName}}',
  email_body: '<p>Hi {{.FirstName}}, from {{.ExecutiveDirectorName}}. Visit https://lfx.dev</p>',
} as unknown as Survey;
const RESPONSE = { id: 'r-1', first_name: 'Ana', last_name: 'Lee', committee_uid: 'c-1' } as SurveyResponseItem;

async function mount(survey: Survey, settings$ = of({ executive_director: { name: 'Jane Doe', email: 'jane@example.com' } })) {
  TestBed.resetTestingModule();
  const getProjectSettings = vi.fn().mockReturnValue(settings$);
  TestBed.configureTestingModule({
    imports: [SurveySentEmailDialogComponent],
    providers: [
      { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      { provide: DynamicDialogConfig, useValue: { data: { survey, response: RESPONSE } } },
      { provide: PermissionsService, useValue: { getProjectSettings } },
      { provide: ProjectContextService, useValue: { activeContext: signal({ uid: 'p-1' }), activeProject: signal({ name: 'CNCF', logo_url: '' }) } },
    ],
  });
  const fixture = TestBed.createComponent(SurveySentEmailDialogComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, component: fixture.componentInstance, getProjectSettings };
}

describe('SurveySentEmailDialogComponent', () => {
  it('renders the email with the recipient and project settings values filled in', async () => {
    const { fixture, component, getProjectSettings } = await mount(SURVEY);

    expect(getProjectSettings).toHaveBeenCalledWith('p-1');
    expect(fixture.nativeElement.querySelector('[data-testid="survey-sent-email-subject"]').textContent).toContain('Feedback for CNCF');
    const html = component['email']()!.html;
    expect(html).toContain('Hi Ana, from Jane Doe.');
    expect(html).toContain('<a href="https://lfx.dev" target="_blank" rel="noopener">https://lfx.dev</a>');
  });

  it('still renders when project settings cannot be read', async () => {
    const { component } = await mount(
      SURVEY,
      throwError(() => new Error('403'))
    );

    expect(component['email']()!.html).toContain('Hi Ana, from .');
  });

  it('shows an empty state when the survey has no stored email', async () => {
    const { fixture } = await mount({ ...SURVEY, email_body: undefined });

    expect(fixture.nativeElement.querySelector('[data-testid="survey-sent-email-empty"]')).not.toBeNull();
  });
});

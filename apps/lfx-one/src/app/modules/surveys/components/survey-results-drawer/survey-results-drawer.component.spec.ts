// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Survey, SurveyResponseItem } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { SurveyService } from '@services/survey.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SurveyResultsDrawerComponent } from './survey-results-drawer.component';

const SURVEY = { uid: 's-1', survey_title: 'Board NPS', committees: [], total_recipients: 3, total_responses: 2 } as unknown as Survey;
const answer = (text: string) => ({ survey_monkey_question_answers: [{ answers: [{ text }] }] }) as Partial<SurveyResponseItem>;
const ROWS = [
  { id: 'r-1', response_status: 'Responded', response_datetime: '2026-11-03T10:00:00Z', ...answer('Older') },
  { id: 'r-2', response_status: 'Responded', response_datetime: '2026-11-05T10:00:00Z', ...answer('Newer') },
  { id: 'r-3', response_status: 'Opened' },
] as SurveyResponseItem[];

async function mount(hasPMOAccess: boolean, responses$ = of(ROWS)) {
  const activeContext = signal<{ uid: string } | null>({ uid: 'p-1' });
  TestBed.resetTestingModule();
  const getAllSurveyResponses = vi.fn().mockReturnValue(responses$);
  const getSurvey = vi.fn().mockReturnValue(of(SURVEY));
  TestBed.configureTestingModule({
    imports: [SurveyResultsDrawerComponent],
    providers: [
      { provide: SurveyService, useValue: { getSurvey, getAllSurveyResponses } },
      provideNoopAnimations(),
      { provide: ProjectContextService, useValue: { activeContext } },
    ],
  });
  const fixture = TestBed.createComponent(SurveyResultsDrawerComponent);
  fixture.componentRef.setInput('surveyId', 's-1');
  fixture.componentRef.setInput('hasPMOAccess', hasPMOAccess);
  fixture.componentRef.setInput('visible', true);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, component: fixture.componentInstance, getAllSurveyResponses, getSurvey, activeContext };
}

describe('SurveyResultsDrawerComponent', () => {
  let current: ComponentFixture<SurveyResultsDrawerComponent> | undefined;
  afterEach(() => current?.destroy());

  it('never loads per-recipient rows for users without Manage access', async () => {
    const { fixture, component, getAllSurveyResponses } = await mount(false);
    current = fixture;

    expect(getAllSurveyResponses).not.toHaveBeenCalled();
    expect(component['comments']()).toEqual([]);
    expect(component['engagementRates']()).toBeNull();
  });

  it('builds comments (newest first) and engagement rates from every response row for Manage users', async () => {
    const { fixture, component, getAllSurveyResponses } = await mount(true);
    current = fixture;

    expect(getAllSurveyResponses).toHaveBeenCalledWith('s-1', 'p-1');
    expect(component['comments']().map((c) => c.comment)).toEqual(['Newer', 'Older']);
    expect(component['engagementRates']()).toMatchObject({ recipients: 3, delivered: 3, opened: 3, responded: 2, commentRate: 100 });
  });

  it('retries a failed load when the drawer is closed and reopened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fixture, component, getAllSurveyResponses } = await mount(
      true,
      throwError(() => new Error('boom'))
    );
    current = fixture;
    expect(component['responsesLoadError']()).toBe(true);

    getAllSurveyResponses.mockReturnValue(of(ROWS));
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getAllSurveyResponses).toHaveBeenCalledTimes(2);
    expect(component['responsesLoadError']()).toBe(false);
    expect(component['responses']()).toEqual(ROWS);
  });

  it("clears the previous survey's rows while the next survey loads", async () => {
    const { fixture, component, getAllSurveyResponses } = await mount(true);
    current = fixture;
    expect(component['responses']()).toEqual(ROWS);

    getAllSurveyResponses.mockReturnValue(new Subject<SurveyResponseItem[]>());
    fixture.componentRef.setInput('surveyId', 's-2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['responses']()).toEqual([]);
    expect(component['engagementRates']()).toBeNull();
  });

  it('flags an incomplete list when the rows fail to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fixture, component } = await mount(
      true,
      throwError(() => new Error('boom'))
    );
    current = fixture;

    expect(component['responsesLoadError']()).toBe(true);
    expect(component['responses']()).toEqual([]);
  });

  it('refetches the survey detail with the new project scope when the project changes', async () => {
    const { fixture, getSurvey, getAllSurveyResponses, activeContext } = await mount(true);
    current = fixture;
    expect(getSurvey).toHaveBeenLastCalledWith('s-1', 'p-1');

    activeContext.set({ uid: 'p-2' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getSurvey).toHaveBeenLastCalledWith('s-1', 'p-2');
    expect(getAllSurveyResponses).toHaveBeenLastCalledWith('s-1', 'p-2');
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { SurveyStatus } from '@lfx-one/shared';
import { Survey, SurveyCommittee } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveysTableComponent } from './surveys-table.component';

const committee = (uid: string): SurveyCommittee => ({
  committee_id: uid,
  committee_uid: uid,
  committee_name: `Synthetic ${uid}`,
  project_id: 'synthetic-project',
  project_uid: 'synthetic-project',
  project_name: 'Synthetic Project',
  total_recipients: 0,
  total_responses: 0,
  nps_value: 0,
  num_detractors: 0,
  num_passives: 0,
  num_promoters: 0,
});
const survey = (uid: string, committeeUids: string[], overrides: Partial<Survey> = {}): Survey => ({
  uid,
  survey_title: `Synthetic ${uid}`,
  survey_status: SurveyStatus.DRAFT,
  survey_cutoff_date: null,
  is_nps_survey: false,
  is_project_survey: false,
  committees: committeeUids.map(committee),
  project_uid: 'synthetic-project',
  project_slug: 'synthetic-project',
  is_foundation: false,
  committee_category: 'technical',
  total_responses: 0,
  total_recipients: 0,
  created_at: '2026-01-01T00:00:00Z',
  last_modified_at: '2026-01-01T00:00:00Z',
  creator_name: 'Synthetic Writer',
  ...overrides,
});

describe('SurveysTableComponent — draft edit access', () => {
  let fixture: ComponentFixture<SurveysTableComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    // Only the search debounce uses fake timers; Angular's zoneless scheduler stays real.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await TestBed.configureTestingModule({
      imports: [SurveysTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SurveysTableComponent);
  });

  afterEach(() => {
    fixture?.destroy();
    http.verify();
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(300);
    TestBed.tick();
    fixture.detectChanges();
  }

  async function render(surveys: Survey[], options: { hasPMOAccess?: boolean; isMeLens?: boolean; committeeUid?: string } = {}): Promise<void> {
    fixture.componentRef.setInput('surveys', surveys);
    for (const [name, value] of Object.entries(options)) {
      fixture.componentRef.setInput(name, value);
    }
    await settle();
  }

  function action(kind: string, uid: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="surveys-${kind}-${uid}"]`);
  }

  function resolveCommittee(uid: string, writer: boolean): void {
    http.expectOne(`/api/committees/${uid}`).flush({ uid, writer });
  }

  it('shows a secondary committee writer the draft Edit link but not Delete', async () => {
    await render([survey('draft', ['primary', 'secondary', 'third'])]);
    expect(action('edit', 'draft')).toBeNull();
    resolveCommittee('primary', false);
    expect(action('edit', 'draft')).toBeNull();
    resolveCommittee('secondary', true);
    await settle();

    const link = action('edit', 'draft')?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/project/surveys/draft/edit?project=synthetic-project&committee_uid=primary');
    expect(action('delete', 'draft')).toBeNull();
    http.expectNone('/api/committees/third');
  });

  it('does not use an unrelated viewed committee to grant a survey action', async () => {
    await render([survey('draft', ['primary', 'secondary'])], { committeeUid: 'unrelated-writer' });
    resolveCommittee('primary', false);
    resolveCommittee('secondary', false);
    await settle();

    http.expectNone('/api/committees/unrelated-writer');
    expect(action('edit', 'draft')).toBeNull();
    expect(action('delete', 'draft')).toBeNull();
  });

  it('prioritizes a matching viewed committee without probing unrelated associations', async () => {
    await render([survey('draft', ['primary', 'secondary'])], { committeeUid: 'secondary' });
    resolveCommittee('secondary', true);
    await settle();

    expect(action('edit', 'draft')?.querySelector('a')?.getAttribute('href')).toContain('committee_uid=secondary');
    expect(action('delete', 'draft')).toBeNull();
    http.expectNone('/api/committees/primary');
  });

  it('denies empty and blank committee candidates without making detail requests', async () => {
    await render([survey('empty', []), survey('blank', ['', '   '])], { committeeUid: '   ' });

    http.expectNone((request) => request.url.startsWith('/api/committees/'));
    expect(action('edit', 'empty')).toBeNull();
    expect(action('edit', 'blank')).toBeNull();
    expect(action('delete', 'empty')).toBeNull();
    expect(action('delete', 'blank')).toBeNull();
  });

  it('keeps project-granted Edit and Delete without committee requests', async () => {
    await render([survey('draft', ['primary', 'secondary'])], { hasPMOAccess: true });

    expect(action('edit', 'draft')?.querySelector('a')).not.toBeNull();
    expect(action('delete', 'draft')?.querySelector('button')).not.toBeNull();
    http.expectNone((request) => request.url.startsWith('/api/committees/'));
  });

  it('adds no draft actions in Me and preserves the respondent action', async () => {
    await render(
      [survey('draft', ['writer']), survey('open', ['writer'], { survey_status: SurveyStatus.OPEN, survey_link: 'https://example.test/synthetic-response' })],
      { isMeLens: true }
    );

    expect(action('edit', 'draft')).toBeNull();
    expect(action('delete', 'draft')).toBeNull();
    expect(action('take', 'open')?.querySelector('a')?.getAttribute('href')).toBe('https://example.test/synthetic-response');
    http.expectNone((request) => request.url.startsWith('/api/committees/'));
  });

  it('does not probe non-draft rows and preserves their Results actions', async () => {
    await render([
      survey('open', ['writer'], { survey_status: SurveyStatus.OPEN }),
      survey('closed', ['writer'], { survey_status: SurveyStatus.CLOSED }),
      survey('scheduled', ['writer'], { survey_status: SurveyStatus.SCHEDULED }),
      survey('response-closed', ['writer'], { response_status: 'CLOSED' }),
    ]);

    expect(action('results', 'open')).not.toBeNull();
    expect(action('results', 'closed')).not.toBeNull();
    expect(action('results', 'response-closed')).not.toBeNull();
    for (const uid of ['open', 'closed', 'scheduled', 'response-closed']) {
      expect(action('edit', uid)).toBeNull();
      expect(action('delete', uid)).toBeNull();
    }
    http.expectNone((request) => request.url.startsWith('/api/committees/'));
  });

  it('shares committee detail requests across draft rows in the same list snapshot', async () => {
    await render([survey('first', ['primary', 'secondary']), survey('second', ['primary', 'secondary'])]);
    resolveCommittee('primary', false);
    resolveCommittee('secondary', true);
    await settle();

    for (const uid of ['first', 'second']) {
      expect(action('edit', uid)?.querySelector('a')).not.toBeNull();
      expect(action('delete', uid)).toBeNull();
    }
  });

  it('invalidates an existing grant immediately when the same survey UID gets new associations', async () => {
    await render([survey('draft', ['previous-writer'])]);
    resolveCommittee('previous-writer', true);
    await settle();
    expect(action('edit', 'draft')).not.toBeNull();

    fixture.componentRef.setInput('surveys', [survey('draft', ['new-denied'])]);
    fixture.detectChanges();
    expect(action('edit', 'draft')).toBeNull();
    await settle();
    resolveCommittee('new-denied', false);
    await settle();

    expect(action('edit', 'draft')).toBeNull();
    expect(action('delete', 'draft')).toBeNull();
  });

  it.each([false, true])('ignores a stale pending committee result (writer=%s) after the list changes', async (writer) => {
    await render([survey('draft', ['previous-primary', 'previous-secondary'])]);
    const previous = http.expectOne('/api/committees/previous-primary');

    fixture.componentRef.setInput('surveys', [survey('draft', ['current-denied'])]);
    await settle();
    previous.flush({ uid: 'previous-primary', writer });
    await settle();

    expect(action('edit', 'draft')).toBeNull();
    http.expectNone('/api/committees/previous-secondary');
    resolveCommittee('current-denied', false);
    await settle();
    expect(action('edit', 'draft')).toBeNull();
    expect(action('delete', 'draft')).toBeNull();
  });

  it('removes a committee-only Edit grant when switching to Me', async () => {
    await render([survey('draft', ['writer'])]);
    resolveCommittee('writer', true);
    await settle();
    expect(action('edit', 'draft')).not.toBeNull();

    fixture.componentRef.setInput('isMeLens', true);
    fixture.detectChanges();
    expect(action('edit', 'draft')).toBeNull();
    await settle();
    expect(action('delete', 'draft')).toBeNull();
    http.expectNone((request) => request.url.startsWith('/api/committees/'));
  });

  it('keeps Delete project-gated when the project grant is removed', async () => {
    await render([survey('draft', ['writer'])], { hasPMOAccess: true });
    expect(action('delete', 'draft')).not.toBeNull();

    fixture.componentRef.setInput('hasPMOAccess', false);
    fixture.detectChanges();
    expect(action('edit', 'draft')).toBeNull();
    expect(action('delete', 'draft')).toBeNull();
    await settle();
    resolveCommittee('writer', true);
    await settle();

    expect(action('edit', 'draft')).not.toBeNull();
    expect(action('delete', 'draft')).toBeNull();
  });
});

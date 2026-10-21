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

describe('SurveysTableComponent — row-scoped draft edit access', () => {
  let fixture: ComponentFixture<SurveysTableComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    // Leave the search debounce pending so action grants must render without waiting for it.
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

  function render(surveys: Survey[], options: { hasPMOAccess?: boolean; isMeLens?: boolean; committeeUid?: string; loading?: boolean } = {}): void {
    fixture.componentRef.setInput('surveys', surveys);
    for (const [name, value] of Object.entries(options)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  function action(kind: string, uid: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="surveys-${kind}-${uid}"]`);
  }

  it('renders a supplied draft grant immediately without waiting for unrelated rows or client I/O', () => {
    render([survey('ready', ['primary', 'secondary'], { committee_writer: true }), survey('ungranted', ['unrelated'])]);

    expect(action('edit', 'ready')?.querySelector('a')?.getAttribute('href')).toBe(
      '/project/surveys/ready/edit?project=synthetic-project&committee_uid=primary'
    );
    expect(action('delete', 'ready')).toBeNull();
    expect(action('edit', 'ungranted')).toBeNull();
    expect(action('delete', 'ungranted')).toBeNull();
    http.expectNone(() => true);
  });

  it.each([
    { is_foundation: true, path: '/foundation/surveys/draft/edit' },
    { is_foundation: false, path: '/project/surveys/draft/edit' },
    { is_foundation: undefined, path: '/surveys/draft/edit' },
  ])('uses the survey owning tier for the edit link ($is_foundation)', ({ is_foundation: isFoundation, path }) => {
    render([survey('draft', ['primary', 'secondary'], { committee_writer: true, is_foundation: isFoundation })], { committeeUid: 'secondary' });

    expect(action('edit', 'draft')?.querySelector('a')?.getAttribute('href')).toBe(`${path}?project=synthetic-project&committee_uid=secondary`);
    expect(action('delete', 'draft')).toBeNull();
  });

  it('ignores an unrelated viewed committee in the granted row edit destination', () => {
    render([survey('draft', ['primary', 'secondary'], { committee_writer: true })], { committeeUid: 'unrelated' });

    expect(action('edit', 'draft')?.querySelector('a')?.getAttribute('href')).toBe(
      '/project/surveys/draft/edit?project=synthetic-project&committee_uid=primary'
    );
  });

  it.each([false, undefined])('denies draft Edit and Delete when the supplied grant is %s', (committeeWriter) => {
    render([survey('draft', ['primary'], { committee_writer: committeeWriter })]);

    expect(action('edit', 'draft')).toBeNull();
    expect(action('delete', 'draft')).toBeNull();
  });

  it.each([{ hasPMOAccess: true }, { hasPMOAccess: true, isMeLens: true }])(
    'preserves existing Edit and Delete precedence for the legacy grant %j',
    (options) => {
      render([survey('draft', ['primary', 'secondary'], { committee_writer: false })], options);

      expect(action('edit', 'draft')?.querySelector('a')).not.toBeNull();
      expect(action('delete', 'draft')?.querySelector('button')).not.toBeNull();
    }
  );

  it('blocks committee-only draft grants in Me while preserving Take, Update and View actions', () => {
    render(
      [
        survey('draft', ['writer'], { committee_writer: true }),
        survey('open', ['writer'], { survey_status: SurveyStatus.OPEN, committee_writer: true, survey_link: 'https://example.test/take' }),
        survey('responded', ['writer'], {
          survey_status: SurveyStatus.OPEN,
          committee_writer: true,
          response_status: 'RESPONDED',
          survey_link: 'https://example.test/update',
        }),
        survey('closed', ['writer'], { survey_status: SurveyStatus.CLOSED, committee_writer: true }),
      ],
      { isMeLens: true }
    );

    expect(action('edit', 'draft')).toBeNull();
    expect(action('delete', 'draft')).toBeNull();
    expect(action('take', 'open')?.querySelector('a')?.getAttribute('href')).toBe('https://example.test/take');
    expect(action('update', 'responded')?.querySelector('a')?.getAttribute('href')).toBe('https://example.test/update');
    expect(action('take', 'responded')).toBeNull();
    expect(action('view', 'closed')?.querySelector('button')).not.toBeNull();
    expect(action('results', 'closed')).toBeNull();
  });

  it.each([false, true])('never adds draft actions to nondraft rows (legacy grant=%s)', (hasPMOAccess) => {
    render(
      [
        survey('open', ['writer'], { survey_status: SurveyStatus.OPEN, committee_writer: true }),
        survey('closed', ['writer'], { survey_status: SurveyStatus.CLOSED, committee_writer: true }),
        survey('scheduled', ['writer'], { survey_status: SurveyStatus.SCHEDULED, committee_writer: true }),
        survey('response-closed', ['writer'], { response_status: 'CLOSED', committee_writer: true }),
      ],
      { hasPMOAccess }
    );

    for (const uid of ['open', 'closed', 'response-closed']) {
      expect(action('results', uid)?.querySelector('button')).not.toBeNull();
    }
    for (const uid of ['open', 'closed', 'scheduled', 'response-closed']) {
      expect(action('edit', uid)).toBeNull();
      expect(action('delete', uid)).toBeNull();
    }
    expect(action('results', 'scheduled')).toBeNull();
  });

  it.each([false, undefined])('removes an old grant immediately when a same-UID replacement row has flag %s', (committeeWriter) => {
    render([survey('draft', ['writer'], { committee_writer: true })]);
    expect(action('edit', 'draft')?.querySelector('a')).not.toBeNull();

    render([survey('draft', ['writer'], { committee_writer: committeeWriter })]);
    expect(action('edit', 'draft')).toBeNull();
    expect(action('delete', 'draft')).toBeNull();

    render([survey('draft', ['writer'], { committee_writer: true })]);
    expect(action('edit', 'draft')?.querySelector('a')).not.toBeNull();
    expect(action('delete', 'draft')).toBeNull();
  });

  it('removes committee-only Edit immediately when switching to Me', () => {
    render([survey('draft', ['writer'], { committee_writer: true })]);
    expect(action('edit', 'draft')?.querySelector('a')).not.toBeNull();

    fixture.componentRef.setInput('isMeLens', true);
    fixture.detectChanges();
    expect(action('edit', 'draft')).toBeNull();
    expect(action('delete', 'draft')).toBeNull();
  });

  it('keeps committee-only Edit but removes Delete immediately when the legacy grant is removed', () => {
    render([survey('draft', ['writer'], { committee_writer: true })], { hasPMOAccess: true });
    expect(action('delete', 'draft')?.querySelector('button')).not.toBeNull();

    fixture.componentRef.setInput('hasPMOAccess', false);
    fixture.detectChanges();
    expect(action('edit', 'draft')?.querySelector('a')).not.toBeNull();
    expect(action('delete', 'draft')).toBeNull();
  });
  describe('status tab counts', () => {
    const tabLabels = (): string[] =>
      Array.from(fixture.nativeElement.querySelectorAll('[data-testid="surveys-status-tabs"] [data-testid^="filter-pill-"]') as NodeListOf<HTMLElement>).map(
        (el) => (el.textContent ?? '').trim()
      );

    const mixed = (): Survey[] => [
      survey('open-1', ['a'], { survey_status: SurveyStatus.OPEN, survey_cutoff_date: '2999-01-01T00:00:00Z' }),
      survey('open-2', ['b'], { survey_status: SurveyStatus.OPEN, survey_cutoff_date: '2999-01-01T00:00:00Z' }),
      survey('closed-1', ['a'], { survey_status: SurveyStatus.CLOSED }),
      survey('draft-1', ['a']),
    ];

    it('shows per-tab counts and omits zero counts', () => {
      render(mixed());
      expect(tabLabels()).toEqual(['All (4)', 'Open (2)', 'Closed (1)']);

      render([survey('draft-only', ['a'])]);
      expect(tabLabels()).toEqual(['All (1)', 'Open', 'Closed']);
    });

    it('hides counts while loading', () => {
      render(mixed(), { loading: true });
      expect(tabLabels()).toEqual(['All', 'Open', 'Closed']);
    });
  });
});

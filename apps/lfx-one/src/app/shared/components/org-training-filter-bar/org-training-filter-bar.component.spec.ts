// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ORG_LENS_TIME_RANGE_QUERY_PARAM, ORG_TRAINING_VIEW_QUERY_PARAMS } from '@lfx-one/shared/constants';
import type { OrgLensTimeRange, OrgTrainingFilterOptions, OrgTrainingViewState } from '@lfx-one/shared/interfaces';
import { orgTrainingStatsQuery, parseOrgTrainingViewState, serializeOrgTrainingViewState } from '@lfx-one/shared/utils';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { Observable, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { OrgTrainingFilterBarComponent } from './org-training-filter-bar.component';

const ORG = 'org-uid-1';

const ALL_TIME_OPTIONS: OrgTrainingFilterOptions = {
  foundations: [
    { label: 'Foundation A', value: 'fa' },
    { label: 'Foundation B', value: 'fb' },
  ],
  projects: [
    { label: 'Project K', value: 'pk' },
    { label: 'Project L', value: 'pl' },
  ],
  courses: [
    { label: 'Kubernetes Basics', value: 'Kubernetes Basics' },
    { label: 'Linux Intro', value: 'Linux Intro' },
  ],
  levels: [{ label: 'Beginner', value: 'Beginner' }],
  formats: [
    { label: 'E-Learning', value: 'E-Learning' },
    { label: 'Instructor Led', value: 'Instructor Led' },
  ],
};

/** Past 30 days: only Foundation A / Project L / Linux Intro have rows. */
const RECENT_OPTIONS: OrgTrainingFilterOptions = {
  foundations: [{ label: 'Foundation A', value: 'fa' }],
  projects: [{ label: 'Project L', value: 'pl' }],
  courses: [{ label: 'Linux Intro', value: 'Linux Intro' }],
  levels: [],
  formats: [{ label: 'E-Learning', value: 'E-Learning' }],
};

describe('OrgTrainingFilterBarComponent', () => {
  let fixture: ComponentFixture<OrgTrainingFilterBarComponent>;
  let account: ReturnType<typeof signal<{ uid: string; accountName: string }>>;
  let getFilterOptions: Mock<(orgUid: string, range: OrgLensTimeRange) => Observable<OrgTrainingFilterOptions>>;

  const el = (): HTMLElement => fixture.nativeElement;
  const router = (): Router => TestBed.inject(Router);
  const select = (name: string): Element | null => el().querySelector(`[data-test="org-training-filter-${name}"]`);
  const urlState = () => parseOrgTrainingViewState((key) => new URLSearchParams(router().url.split('?')[1] ?? '').get(key));

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(url: string, showGroupBy = false): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OrgTrainingFilterBarComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: account } },
        { provide: OrgLensTrainingService, useValue: { getFilterOptions } },
      ],
    }).compileComponents();
    await router().navigateByUrl(url);
    fixture = TestBed.createComponent(OrgTrainingFilterBarComponent);
    fixture.componentRef.setInput('showGroupBy', showGroupBy);
    await settle();
  }

  async function pick(values: Record<string, string>): Promise<void> {
    fixture.componentInstance.form.patchValue(values);
    await settle();
  }

  beforeEach(() => {
    account = signal({ uid: ORG, accountName: 'Synthetic Org' });
    getFilterOptions = vi.fn((_orgUid: string, range: OrgLensTimeRange) => of(range === '30d' ? RECENT_OPTIONS : ALL_TIME_OPTIONS));
  });

  it('renders the range and the five filter dropdowns, and no group-by by default', async () => {
    await mount('/?tab=trainees');

    for (const name of ['range', 'foundation', 'project', 'course', 'level', 'format']) expect(select(name), name).not.toBeNull();
    expect(select('group-by')).toBeNull();
    expect(el().querySelectorAll('lfx-select')).toHaveLength(6);
  });

  it('renders the group-by dropdown only when showGroupBy is set', async () => {
    await mount('/', true);

    expect(select('group-by')).not.toBeNull();
    expect(el().querySelectorAll('lfx-select')).toHaveLength(7);
  });

  it('reads the view state from the URL and loads the options of its range for the current org', async () => {
    await mount('/?range=90d&foundation=fa&course=Linux%20Intro');

    expect(getFilterOptions).toHaveBeenCalledWith(ORG, '90d');
    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({
      range: '90d',
      foundation: 'fa',
      course: 'Linux Intro',
      project: '',
      level: '',
      format: '',
    });
  });

  it('writes a pick through the shared serializer, keeps the page-local params and drops defaults', async () => {
    await mount('/?tab=training&foundation=fa');

    await pick({ project: 'pk', level: 'Beginner' });

    const expected = serializeOrgTrainingViewState({ ...parseOrgTrainingViewState(() => null), foundation: 'fa', project: 'pk', level: 'Beginner' });
    expect(urlState()).toMatchObject({ range: '730d', foundation: 'fa', project: 'pk', level: 'Beginner', course: null, format: null });
    expect(expected['range']).toBeNull();
    expect(router().url).toContain('tab=training');
    expect(router().url).not.toContain('range=');
  });

  it('writes a range pick and refetches the options for it', async () => {
    await mount('/?tab=trainees');

    await pick({ range: '90d' });

    expect(router().url).toContain('range=90d');
    expect(router().url).toContain('tab=trainees');
    expect(getFilterOptions).toHaveBeenLastCalledWith(ORG, '90d');
  });

  it('leaves groupBy out of the URL without showGroupBy and writes it with showGroupBy', async () => {
    await mount('/?groupBy=level');
    await pick({ project: 'pk' });
    expect(router().url).toContain('groupBy=level');

    TestBed.resetTestingModule();
    await mount('/', true);
    await pick({ groupBy: 'format' });
    expect(router().url).toContain('groupBy=format');
    await pick({ groupBy: 'course' });
    expect(router().url).not.toContain('groupBy');
  });

  it('clears every filter at once, keeping the range and other params', async () => {
    await mount('/?tab=training&range=all&foundation=fa&trainingProject=pk&course=Linux%20Intro&level=Beginner&format=E-Learning');

    el().querySelector<HTMLElement>('[data-testid="org-training-filter-clear-all"] button')!.click();
    await settle();

    expect(router().url).toContain('range=all');
    expect(router().url).toContain('tab=training');
    for (const key of ['foundation', 'trainingProject', 'course', 'level', 'format']) expect(router().url).not.toContain(`${key}=`);
    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({ foundation: '', project: '', course: '', level: '', format: '' });
  });

  it('disables Clear all while no filter is set', async () => {
    await mount('/?range=all');

    expect(el().querySelector('[data-testid="org-training-filter-clear-all"] button')?.hasAttribute('disabled')).toBe(true);
  });

  it('keeps a selection the loaded options do not list: still in the URL, applied and shown in its dropdown', async () => {
    await mount('/?range=30d&foundation=fb&trainingProject=pl&course=Kubernetes%20Basics&format=E-Learning');

    expect(router().url).toContain('foundation=fb');
    expect(router().url).toContain('course=Kubernetes');
    expect(router().url).toContain('trainingProject=pl');
    expect(router().url).toContain('format=E-Learning');
    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({ foundation: 'fb', course: 'Kubernetes Basics', project: 'pl', format: 'E-Learning' });
  });

  it('keeps a URL selection while the options have not loaded or fail to load', async () => {
    getFilterOptions.mockReturnValue(new Observable((subscriber) => subscriber.error(new Error('down'))));
    await mount('/?foundation=fa');

    expect(router().url).toContain('foundation=fa');
    expect(fixture.componentInstance.form.getRawValue().foundation).toBe('fa');
  });

  it('drops the previous org options before the new org options load, and logs a failed load', async () => {
    await mount('/');
    expect(select('foundation')).not.toBeNull();
    const pending = new Subject<OrgTrainingFilterOptions>();
    getFilterOptions.mockReturnValue(pending);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    account.set({ uid: 'org-uid-2', accountName: 'Other Org' });
    await settle();

    expect(getFilterOptions).toHaveBeenLastCalledWith('org-uid-2', expect.any(String));
    expect(fixture.componentInstance['foundationOptions']().map((option) => option.value)).toEqual(['']);

    pending.error(new Error('down'));
    await settle();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('drops the previous range options while the new range loads, and labels a kept pick plainly until they arrive', async () => {
    await mount('/?foundation=fb&course=Kubernetes%20Basics');
    const foundations = () => fixture.componentInstance['foundationOptions']().map((option) => option.label);
    expect(foundations()).toEqual(['All Foundations', 'Foundation A', 'Foundation B']);
    const pending = new Subject<OrgTrainingFilterOptions>();
    getFilterOptions.mockReturnValue(pending);

    await pick({ range: '30d' });

    expect(getFilterOptions).toHaveBeenLastCalledWith(ORG, '30d');
    expect(foundations()).toEqual(['All Foundations', 'Selected']);
    expect(fixture.componentInstance['courseOptions']().map((option) => option.label)).toEqual(['All Courses', 'Kubernetes Basics']);
    expect(el().querySelector('[data-testid="org-training-filter-options-error"]')).toBeNull();

    pending.next(RECENT_OPTIONS);
    pending.complete();
    await settle();
    expect(foundations()).toEqual(['All Foundations', 'Selected (no rows in range)', 'Foundation A']);
  });

  describe('options failure', () => {
    const errorBox = (): Element | null => el().querySelector('[data-testid="org-training-filter-options-error"]');
    const retry = (): HTMLButtonElement | null => el().querySelector<HTMLButtonElement>('[data-testid="org-training-filter-options-retry"] button');

    it('shows an inline alert with Retry, keeps the selections applied, and logs the error', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getFilterOptions.mockReturnValue(new Observable((subscriber) => subscriber.error(new Error('down'))));
      await mount('/?foundation=fa');

      expect(errorBox()?.getAttribute('role')).toBe('alert');
      expect(retry()).not.toBeNull();
      expect(error).toHaveBeenCalled();
      expect(router().url).toContain('foundation=fa');
      expect(fixture.componentInstance.form.getRawValue().foundation).toBe('fa');
      expect(fixture.componentInstance['foundationOptions']().map((option) => option.label)).toEqual(['All Foundations', 'Selected']);
      error.mockRestore();
    });

    it('reloads the current org and range on Retry, and a success clears the error and fills the options', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getFilterOptions.mockReturnValueOnce(new Observable((subscriber) => subscriber.error(new Error('down'))));
      await mount('/?range=30d');
      expect(errorBox()).not.toBeNull();
      expect(getFilterOptions).toHaveBeenCalledTimes(1);

      retry()?.click();
      await settle();

      expect(getFilterOptions).toHaveBeenCalledTimes(2);
      expect(getFilterOptions).toHaveBeenLastCalledWith(ORG, '30d');
      expect(errorBox()).toBeNull();
      expect(fixture.componentInstance['foundationOptions']().map((option) => option.value)).toEqual(['', 'fa']);
      error.mockRestore();
    });

    it('hides the error while Retry is pending and shows it again if Retry fails', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getFilterOptions.mockReturnValueOnce(new Observable((subscriber) => subscriber.error(new Error('down'))));
      await mount('/');
      const pending = new Subject<OrgTrainingFilterOptions>();
      getFilterOptions.mockReturnValueOnce(pending);

      retry()?.click();
      await settle();
      expect(errorBox()).toBeNull();

      pending.error(new Error('still down'));
      await settle();
      expect(errorBox()).not.toBeNull();
      error.mockRestore();
    });

    it('clears the error when the range changes to one that loads', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getFilterOptions.mockReturnValueOnce(new Observable((subscriber) => subscriber.error(new Error('down'))));
      await mount('/');
      expect(errorBox()).not.toBeNull();

      await pick({ range: '30d' });

      expect(errorBox()).toBeNull();
      expect(fixture.componentInstance['foundationOptions']().map((option) => option.value)).toEqual(['', 'fa']);
      error.mockRestore();
    });
  });

  describe('unlisted selections', () => {
    const labelsOf = (name: 'foundationOptions' | 'projectOptions' | 'courseOptions' | 'levelOptions' | 'formatOptions') =>
      fixture.componentInstance[name]().map((option) => option.label);

    it('labels a kept foundation or project as having no rows in range, never by its raw id, and keeps it selected', async () => {
      await mount('/?range=30d&foundation=fb&trainingProject=pk');

      expect(labelsOf('foundationOptions')).toContain('Selected (no rows in range)');
      expect(labelsOf('projectOptions')).toContain('Selected (no rows in range)');
      for (const name of ['foundationOptions', 'projectOptions'] as const) expect(labelsOf(name)).not.toContain('fb');
      expect(labelsOf('projectOptions')).not.toContain('pk');
      expect(fixture.componentInstance.form.getRawValue()).toMatchObject({ foundation: 'fb', project: 'pk' });
    });

    it('labels a kept course, level or format with its value and the same suffix', async () => {
      await mount('/?range=30d&course=Kubernetes%20Basics&format=Instructor%20Led&level=Intermediate');

      expect(labelsOf('courseOptions')).toContain('Kubernetes Basics (no rows in range)');
      expect(labelsOf('formatOptions')).toContain('Instructor Led (no rows in range)');
      expect(labelsOf('levelOptions')).toContain('Intermediate (no rows in range)');
    });

    it('does not call a selection unlisted while the options have not loaded or failed to load', async () => {
      getFilterOptions.mockReturnValue(new Observable((subscriber) => subscriber.error(new Error('down'))));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await mount('/?foundation=fa&course=Linux%20Intro');

      expect(labelsOf('foundationOptions')).toEqual(['All Foundations', 'Selected']);
      expect(labelsOf('courseOptions')).toEqual(['All Courses', 'Linux Intro']);
    });

    it('shows a listed selection under its own label', async () => {
      await mount('/?range=30d&foundation=fa');

      expect(labelsOf('foundationOptions')).toEqual(['All Foundations', 'Foundation A']);
    });
  });

  describe('organization switch', () => {
    const ALL_FILTERS = '/?tab=training&range=90d&groupBy=project&foundation=fa&trainingProject=pk&course=Linux%20Intro&level=Beginner&format=E-Learning';

    it('clears the five filters from the URL and the form, keeping range, group-by and the page params', async () => {
      await mount(ALL_FILTERS, true);

      account.set({ uid: 'org-uid-2', accountName: 'Other Org' });
      await settle();

      expect(urlState()).toMatchObject({ range: '90d', groupBy: 'project', foundation: null, project: null, course: null, level: null, format: null });
      expect(router().url).toContain('tab=training');
      expect(fixture.componentInstance.form.getRawValue()).toMatchObject({
        range: '90d',
        groupBy: 'project',
        foundation: '',
        project: '',
        course: '',
        level: '',
        format: '',
      });
      expect(getFilterOptions).toHaveBeenLastCalledWith('org-uid-2', '90d');
    });

    it('does not touch the URL on a switch while no filter is set', async () => {
      await mount('/?tab=training&range=90d');
      const navigate = vi.spyOn(router(), 'navigate');

      account.set({ uid: 'org-uid-2', accountName: 'Other Org' });
      await settle();

      expect(navigate).not.toHaveBeenCalled();
    });

    it('keeps the filters while the first organization resolves from the placeholder', async () => {
      account.set({ uid: '', accountName: '' });
      await mount('/?foundation=fa&format=E-Learning');

      account.set({ uid: ORG, accountName: 'Synthetic Org' });
      await settle();

      expect(urlState()).toMatchObject({ foundation: 'fa', format: 'E-Learning' });
    });
  });

  it('stops writing to the URL once destroyed', async () => {
    await mount('/');
    const navigate = vi.spyOn(router(), 'navigate');
    const form = fixture.componentInstance.form;

    fixture.destroy();
    form.patchValue({ foundation: 'fa' });

    expect(navigate).not.toHaveBeenCalled();
  });

  describe('More filters toggle', () => {
    const toggle = (): HTMLButtonElement | null => el().querySelector('[data-testid="org-training-more-filters-toggle"]');
    const secondary = (): HTMLElement | null => el().querySelector('[data-testid="org-training-more-filters"]');

    it('keeps range and group-by visible and the five filters collapsed by default', async () => {
      await mount('/', true);

      expect(secondary()?.classList.contains('hidden')).toBe(true);
      expect(
        el()
          .querySelector('[data-testid="org-training-filter-primary"]')
          ?.contains(select('range') as Node)
      ).toBe(true);
      expect(
        el()
          .querySelector('[data-testid="org-training-filter-primary"]')
          ?.contains(select('group-by') as Node)
      ).toBe(true);
      for (const name of ['foundation', 'project', 'course', 'level', 'format']) expect(secondary()?.contains(select(name) as Node), name).toBe(true);
      expect(toggle()?.textContent?.trim()).toBe('More filters');
    });

    it('expands and collapses on click, and leaves the picks alone', async () => {
      await mount('/?format=E-Learning');

      toggle()?.click();
      await settle();
      expect(secondary()?.classList.contains('hidden')).toBe(false);
      expect(toggle()?.textContent?.trim()).toBe('Fewer filters');

      toggle()?.click();
      await settle();
      expect(secondary()?.classList.contains('hidden')).toBe(true);
      expect(router().url).toContain('format=E-Learning');
    });

    it('counts the filters set behind it, and Clear all resets the count', async () => {
      await mount('/?foundation=fa&format=E-Learning&range=all');

      expect(toggle()?.textContent?.trim()).toBe('More filters (2)');

      (el().querySelector('[data-testid="org-training-filter-clear-all"] button') as HTMLButtonElement).click();
      await settle();
      expect(toggle()?.textContent?.trim()).toBe('More filters');
    });

    it('does not count range or group-by, which stay visible', async () => {
      await mount('/?range=30d&groupBy=format', true);

      expect(toggle()?.textContent?.trim()).toBe('More filters');
    });
  });
});

/**
 * Every key of the view state, with the form control that edits it, the URL param it lives in and the HTTP param the
 * real service sends. Literal names on purpose: renaming a param in the constants must fail here, not follow silently.
 * `Record<keyof OrgTrainingViewState, …>` makes a key added to the view state without a row here a compile error.
 */
interface KeyMapping {
  /** Form control name (`project` is the form's name for the `trainingProject` param). */
  control: string;
  urlParam: string;
  apiParam: string;
  /** A non-default value to pick; the ones with reserved characters pin the HTTP encoding. */
  value: string;
  /** The value whose pick clears the param (a filter's "All", the default range, the default group-by). */
  cleared: string;
  /** What the API call carries once cleared (the default range is always sent); null = the param is absent. */
  apiAfterClear: string | null;
  /** Whether the stats call carries the key (the group-by only goes to the groups call). */
  inStats: boolean;
}

const KEY_MAP: Record<keyof OrgTrainingViewState, KeyMapping> = {
  range: { control: 'range', urlParam: 'range', apiParam: 'range', value: '90d', cleared: '730d', apiAfterClear: '730d', inStats: true },
  foundation: { control: 'foundation', urlParam: 'foundation', apiParam: 'foundation', value: 'fa', cleared: '', apiAfterClear: null, inStats: true },
  project: { control: 'project', urlParam: 'trainingProject', apiParam: 'trainingProject', value: 'pk', cleared: '', apiAfterClear: null, inStats: true },
  course: { control: 'course', urlParam: 'course', apiParam: 'course', value: 'C++ & Linux/Intro', cleared: '', apiAfterClear: null, inStats: true },
  level: { control: 'level', urlParam: 'level', apiParam: 'level', value: 'Beginner', cleared: '', apiAfterClear: null, inStats: true },
  format: { control: 'format', urlParam: 'format', apiParam: 'format', value: 'E-Learning', cleared: '', apiAfterClear: null, inStats: true },
  groupBy: { control: 'groupBy', urlParam: 'groupBy', apiParam: 'groupBy', value: 'format', cleared: 'course', apiAfterClear: 'course', inStats: false },
};
const KEYS = Object.keys(KEY_MAP) as (keyof OrgTrainingViewState)[];

/** A value for every key but different from the one under test, so a pick that touches another param shows. */
const BASELINE_URL_PARAMS: Record<keyof OrgTrainingViewState, string> = {
  range: '365d',
  foundation: 'fb',
  project: 'pl',
  course: 'Linux Intro',
  level: 'Intermediate',
  format: 'Instructor Led',
  groupBy: 'level',
};

describe('OrgTrainingFilterBarComponent — every key from form to URL to API call', () => {
  const ORG_UID = 'org-uid-1';
  let fixture: ComponentFixture<OrgTrainingFilterBarComponent>;
  let http: HttpTestingController;

  const router = (): Router => TestBed.inject(Router);
  const urlParams = (): Record<string, string> => router().parseUrl(router().url).queryParams;

  /** The filter-options reads the bar makes on its own; answered so they never mask a request under test. */
  function answerOptions(): void {
    for (const req of http.match((r) => r.url.endsWith('/filter-options'))) req.flush(ALL_TIME_OPTIONS);
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    answerOptions();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function mount(params: Record<string, string>): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OrgTrainingFilterBarComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG_UID, accountName: 'Synthetic Org' }) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    await router().navigateByUrl(`/?${new URLSearchParams(params).toString()}`);
    fixture = TestBed.createComponent(OrgTrainingFilterBarComponent);
    fixture.componentRef.setInput('showGroupBy', true);
    await settle();
  }

  async function pick(control: string, value: string): Promise<void> {
    fixture.componentInstance.form.get(control)!.setValue(value);
    await settle();
  }

  /** What the Training page does: parse the URL, build the query, call the real service; returns the stats and groups requests it made. */
  function pageCalls(): { stats: TestRequest; groups: TestRequest } {
    const state = parseOrgTrainingViewState((key) => new URLSearchParams(router().url.split('?')[1] ?? '').get(key));
    const service = TestBed.inject(OrgLensTrainingService);
    service.getTrainingStats(ORG_UID, orgTrainingStatsQuery(state)).subscribe();
    service.getGroups(ORG_UID, orgTrainingStatsQuery(state), { groupBy: state.groupBy, tab: 'certifications' }).subscribe();
    return {
      stats: http.expectOne((r) => r.url.endsWith('/lens/training/stats')),
      groups: http.expectOne((r) => r.url.endsWith('/lens/training/groups')),
    };
  }

  /** The HTTP params the stats call must carry for the URL params in effect: the range always, each filter that is set. */
  function expectedStatsParams(inUrl: Record<string, string>): Record<string, string> {
    const expected: Record<string, string> = { range: inUrl['range'] ?? '730d' };
    for (const key of KEYS) {
      const mapping = KEY_MAP[key];
      if (mapping.inStats && key !== 'range' && inUrl[mapping.urlParam] !== undefined) expected[mapping.apiParam] = inUrl[mapping.urlParam];
    }
    return expected;
  }

  const paramsOf = (req: TestRequest, names: string[]): Record<string, string | null> =>
    Object.fromEntries(names.map((name) => [name, req.request.params.get(name)]));

  it('has a mapping row for every key of the view state, and every param name is the one the constants and the serializer use', () => {
    const state = parseOrgTrainingViewState(() => null);
    expect([...KEYS].sort()).toEqual(Object.keys(state).sort());
    expect(Object.fromEntries(KEYS.map((key) => [key, KEY_MAP[key].urlParam]))).toEqual({
      range: ORG_LENS_TIME_RANGE_QUERY_PARAM,
      foundation: ORG_TRAINING_VIEW_QUERY_PARAMS.foundation,
      project: ORG_TRAINING_VIEW_QUERY_PARAMS.project,
      course: ORG_TRAINING_VIEW_QUERY_PARAMS.course,
      level: ORG_TRAINING_VIEW_QUERY_PARAMS.level,
      format: ORG_TRAINING_VIEW_QUERY_PARAMS.format,
      groupBy: ORG_TRAINING_VIEW_QUERY_PARAMS.groupBy,
    });
    // The serializer writes exactly the mapped URL params, and nothing else.
    expect(Object.keys(serializeOrgTrainingViewState(state)).sort()).toEqual(KEYS.map((key) => KEY_MAP[key].urlParam).sort());
  });

  it('has a form control for every key of the view state', async () => {
    await mount({});

    expect(Object.keys(fixture.componentInstance.form.controls).sort()).toEqual(KEYS.map((key) => KEY_MAP[key].control).sort());
  });

  it.each(KEYS)('%s: round-trips through serializeOrgTrainingViewState and parseOrgTrainingViewState under its own URL param only', (key) => {
    const mapping = KEY_MAP[key];
    const state: OrgTrainingViewState = { ...parseOrgTrainingViewState(() => null), [key]: mapping.value };

    const serialized = serializeOrgTrainingViewState(state);

    const written = Object.entries(serialized).filter(([, value]) => value !== null);
    expect(written).toEqual([[mapping.urlParam, mapping.value]]);
    expect(parseOrgTrainingViewState((param) => serialized[param])).toEqual(state);
    // The default of the key is dropped from the URL.
    expect(serializeOrgTrainingViewState(parseOrgTrainingViewState(() => null))[mapping.urlParam]).toBeNull();
  });

  describe.each(KEYS)('%s', (key) => {
    const mapping = KEY_MAP[key];
    const others = KEYS.filter((other) => other !== key);
    const baseline = Object.fromEntries(others.map((other) => [KEY_MAP[other].urlParam, BASELINE_URL_PARAMS[other]]));
    const mountBaseline = () => mount({ tab: 'training', ...baseline });

    it('writes exactly its URL param when picked, and no other', async () => {
      await mountBaseline();

      await pick(mapping.control, mapping.value);

      expect(urlParams()).toEqual({ tab: 'training', ...baseline, [mapping.urlParam]: mapping.value });
    });

    it('sends exactly its HTTP param to the API with the picked value, percent-encoded', async () => {
      await mountBaseline();
      await pick(mapping.control, mapping.value);

      const { stats, groups } = pageCalls();

      const inUrl = { ...baseline, [mapping.urlParam]: mapping.value };
      const expectedStats = expectedStatsParams(inUrl);
      expect(Object.fromEntries(stats.request.params.keys().map((name) => [name, stats.request.params.get(name)]))).toEqual(expectedStats);
      if (mapping.inStats) {
        expect(stats.request.params.get(mapping.apiParam)).toBe(mapping.value);
        expect(stats.request.urlWithParams).toContain(`${mapping.apiParam}=${encodeURIComponent(mapping.value)}`);
      } else {
        expect(stats.request.params.has(mapping.apiParam)).toBe(false);
      }
      // The groups call carries the same range and filters, plus the group-by and tab.
      expect(paramsOf(groups, [...Object.keys(expectedStats), 'groupBy', 'tab'])).toEqual({
        ...expectedStats,
        groupBy: key === 'groupBy' ? mapping.value : BASELINE_URL_PARAMS.groupBy,
        tab: 'certifications',
      });
      expect(groups.request.urlWithParams).toContain(`${mapping.apiParam}=${encodeURIComponent(mapping.value)}`);
      stats.flush({});
      groups.flush({});
      http.verify();
    });

    it('removes its param from the URL and the API call when cleared, leaving the others', async () => {
      await mount({ tab: 'training', ...baseline, [mapping.urlParam]: mapping.value });
      expect(urlParams()[mapping.urlParam]).toBe(mapping.value);

      await pick(mapping.control, mapping.cleared);

      expect(urlParams()).toEqual({ tab: 'training', ...baseline });
      const { stats, groups } = pageCalls();
      expect(stats.request.params.get(mapping.apiParam)).toBe(mapping.inStats ? mapping.apiAfterClear : null);
      expect(groups.request.params.get(mapping.apiParam)).toBe(mapping.apiAfterClear);
      expect(stats.request.params.keys().sort()).toEqual(Object.keys(expectedStatsParams(baseline)).sort());
      stats.flush({});
      groups.flush({});
      http.verify();
    });
  });

  it('never puts the name search in the URL or the serialized state: it is table-local, not URL-bound', async () => {
    await mount({});
    for (const key of KEYS) await pick(KEY_MAP[key].control, KEY_MAP[key].value);

    const allowed = new Set(KEYS.map((key) => KEY_MAP[key].urlParam));
    expect(Object.keys(urlParams()).filter((name) => !allowed.has(name))).toEqual([]);
    for (const name of ['search', 'q', 'query', 'searchQuery']) {
      expect(urlParams()[name]).toBeUndefined();
      expect(Object.keys(serializeOrgTrainingViewState(parseOrgTrainingViewState(() => null)))).not.toContain(name);
    }
  });
});

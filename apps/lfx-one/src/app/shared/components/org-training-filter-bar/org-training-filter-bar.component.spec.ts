// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { OrgLensTimeRange, OrgTrainingFilterOptions } from '@lfx-one/shared/interfaces';
import { parseOrgTrainingViewState, serializeOrgTrainingViewState } from '@lfx-one/shared/utils';
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

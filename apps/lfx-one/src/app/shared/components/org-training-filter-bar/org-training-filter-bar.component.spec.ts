// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { OrgLensTimeRange, OrgTrainingFilterOptions } from '@lfx-one/shared/interfaces';
import { parseOrgTrainingViewState, serializeOrgTrainingViewState } from '@lfx-one/shared/utils';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { Observable, of } from 'rxjs';
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
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: 'Synthetic Org' }) } },
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
    await mount('/?tab=training&range=all&foundation=fa&project=pk&course=Linux%20Intro&level=Beginner&format=E-Learning');

    el().querySelector<HTMLElement>('[data-testid="org-training-filter-clear-all"] button')!.click();
    await settle();

    expect(router().url).toContain('range=all');
    expect(router().url).toContain('tab=training');
    for (const key of ['foundation', 'project', 'course', 'level', 'format']) expect(router().url).not.toContain(`${key}=`);
    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({ foundation: '', project: '', course: '', level: '', format: '' });
  });

  it('disables Clear all while no filter is set', async () => {
    await mount('/?range=all');

    expect(el().querySelector('[data-testid="org-training-filter-clear-all"] button')?.hasAttribute('disabled')).toBe(true);
  });

  it('drops selections the loaded options no longer list, keeping the ones they do', async () => {
    await mount('/?range=30d&foundation=fb&project=pl&course=Kubernetes%20Basics&format=E-Learning');

    expect(router().url).toContain('project=pl');
    expect(router().url).toContain('format=E-Learning');
    expect(router().url).not.toContain('foundation=');
    expect(router().url).not.toContain('course=');
    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({ foundation: '', course: '', project: 'pl', format: 'E-Learning' });
  });

  it('does not prune when the options fail to load', async () => {
    getFilterOptions.mockReturnValue(new Observable((subscriber) => subscriber.error(new Error('down'))));
    await mount('/?foundation=fa');

    expect(router().url).toContain('foundation=fa');
  });
});

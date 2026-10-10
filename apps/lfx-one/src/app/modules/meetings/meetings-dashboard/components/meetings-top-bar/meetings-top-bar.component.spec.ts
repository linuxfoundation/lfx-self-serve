// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingsTopBarComponent } from './meetings-top-bar.component';

describe('MeetingsTopBarComponent', () => {
  let fixture: ComponentFixture<MeetingsTopBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MeetingsTopBarComponent] }).compileComponents();
    fixture = TestBed.createComponent(MeetingsTopBarComponent);
    fixture.componentRef.setInput('meetingTypeOptions', []);
    fixture.componentRef.setInput('showPersonalFilters', true);
    await fixture.whenStable();
  });

  function element<T extends HTMLElement>(testId: string): T {
    const selector = `[data-testid="${testId}"]${testId.endsWith('-checkbox') ? ' input[type="checkbox"]' : ''}`;
    const result = fixture.nativeElement.querySelector(selector);
    if (!result) throw new Error(`Missing control: ${testId}`);
    return result as T;
  }

  it('emits time and response selections independently', async () => {
    const views: string[] = [];
    const responses: string[] = [];
    fixture.componentInstance.meetingViewChange.subscribe((value) => views.push(value));
    fixture.componentInstance.responseFilterChange.subscribe((value) => responses.push(value));

    element<HTMLButtonElement>('filter-pill-maybe').click();
    element<HTMLButtonElement>('filter-pill-past').click();
    await fixture.whenStable();

    expect(responses).toEqual(['maybe']);
    expect(views).toEqual(['past']);
  });

  it('combines organizer selection with a response and reflects parent resets', async () => {
    fixture.componentRef.setInput('responseFilter', 'accepted');
    await fixture.whenStable();
    const organizers: boolean[] = [];
    const responses: string[] = [];
    fixture.componentInstance.organizedByMeChange.subscribe((value) => organizers.push(value));
    fixture.componentInstance.responseFilterChange.subscribe((value) => responses.push(value));

    element<HTMLInputElement>('organized-by-me-checkbox').click();
    await fixture.whenStable();
    expect(organizers).toEqual([true]);
    expect(responses).toEqual([]);
    expect(element<HTMLButtonElement>('filter-pill-accepted').getAttribute('aria-pressed')).toBe('true');

    fixture.componentRef.setInput('organizedByMe', true);
    fixture.componentRef.setInput('hideDeclined', true);
    await fixture.whenStable();
    expect(element<HTMLInputElement>('organized-by-me-checkbox').checked).toBe(true);
    expect(element<HTMLInputElement>('hide-declined-checkbox').checked).toBe(true);

    fixture.componentRef.setInput('organizedByMe', false);
    fixture.componentRef.setInput('hideDeclined', false);
    fixture.componentRef.setInput('responseFilter', 'all');
    await fixture.whenStable();
    expect(element<HTMLInputElement>('organized-by-me-checkbox').checked).toBe(false);
    expect(element<HTMLInputElement>('hide-declined-checkbox').checked).toBe(false);
    expect(element<HTMLButtonElement>('filter-pill-all').getAttribute('aria-pressed')).toBe('true');
    expect(organizers).toEqual([true]);
    expect(responses).toEqual([]);
  });

  it('emits hide-declined changes and hides the control for the declined response', async () => {
    const hidden: boolean[] = [];
    fixture.componentInstance.hideDeclinedChange.subscribe((value) => hidden.push(value));
    element<HTMLInputElement>('hide-declined-checkbox').click();
    await fixture.whenStable();
    expect(hidden).toEqual([true]);

    fixture.componentRef.setInput('hideDeclined', true);
    fixture.componentRef.setInput('responseFilter', 'declined');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="hide-declined-checkbox"]')).toBeNull();
    expect(element<HTMLInputElement>('organized-by-me-checkbox')).toBeTruthy();

    fixture.componentRef.setInput('responseFilter', 'all');
    await fixture.whenStable();
    expect(element<HTMLInputElement>('hide-declined-checkbox').checked).toBe(true);
  });

  it('removes personal controls when the parent switches context', async () => {
    fixture.componentRef.setInput('showPersonalFilters', false);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="personal-meeting-filters"]')).toBeNull();
    expect(element<HTMLButtonElement>('filter-pill-upcoming')).toBeTruthy();
    expect(element<HTMLButtonElement>('filter-pill-past')).toBeTruthy();
  });

  it('synchronizes parent search and filter resets without emitting search changes', async () => {
    const searches: string[] = [];
    fixture.componentInstance.searchQueryChange.subscribe((value) => searches.push(value));
    fixture.componentRef.setInput('searchQuery', 'architecture');
    fixture.componentRef.setInput('meetingTypeFilter', 'public');
    fixture.componentRef.setInput('foundationFilter', 'foundation');
    fixture.componentRef.setInput('projectFilter', 'project');
    await fixture.whenStable();
    expect(fixture.componentInstance.searchForm.value).toEqual({
      search: 'architecture',
      meetingType: 'public',
      foundationFilter: 'foundation',
      projectFilter: 'project',
    });

    fixture.componentRef.setInput('searchQuery', '');
    fixture.componentRef.setInput('meetingTypeFilter', null);
    fixture.componentRef.setInput('foundationFilter', null);
    fixture.componentRef.setInput('projectFilter', null);
    await fixture.whenStable();
    expect(fixture.componentInstance.searchForm.value).toEqual({
      search: '',
      meetingType: null,
      foundationFilter: null,
      projectFilter: null,
    });
    expect(searches).toEqual([]);
  });
});

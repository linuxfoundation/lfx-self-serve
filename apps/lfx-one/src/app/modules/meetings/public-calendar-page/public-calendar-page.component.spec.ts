// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { PublicCalendarMeeting, PublicGroupDirectoryResponse, PublicGroupSummary, PublicProjectMeetingsResponse } from '@lfx-one/shared/interfaces';
import { GroupService } from '@services/group.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectValueDirective } from '@shared/uikit/select/select-value.directive';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsCalendarGridComponent } from '../meetings-redesign/components/meetings-calendar-grid/meetings-calendar-grid.component';
import { PublicCalendarPageComponent } from './public-calendar-page.component';

const BOARD = '11111111-1111-4111-8111-111111111111';
const TSC = '22222222-2222-4222-8222-222222222222';
const QUIET = '33333333-3333-4333-8333-333333333333';

const soon = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

const meeting = (id: string, committee: string, over: Partial<PublicCalendarMeeting> = {}): PublicCalendarMeeting => ({
  id,
  title: `Meeting ${id}`,
  start_time: soon(1),
  duration: 60,
  timezone: 'UTC',
  meeting_type: 'Board',
  restricted: false,
  recurrence: null,
  committee_uids: [committee],
  ...over,
});

/** State without the template, for the group list and URL writes. */
@Component({ selector: 'lfx-public-calendar-page-state', template: '' })
class PublicCalendarPageStateComponent extends PublicCalendarPageComponent {
  public groupNames(): string[] {
    return this.groups().map((item) => item.name);
  }

  public pickGroup(uid: string | null): void {
    this.setGroup(uid);
  }
}

const group = (uid: string, name: string): PublicGroupSummary => ({
  uid,
  name,
  category: 'Board',
  behavioral_class: 'governing',
  context: { scope: 'project', foundation_uid: 'f', foundation_name: 'Synthetic Foundation', foundation_slug: 'synthetic-foundation' },
});

describe('PublicCalendarPageComponent', () => {
  let query: BehaviorSubject<ParamMap>;
  let feed: () => Observable<PublicProjectMeetingsResponse>;
  let navigate: ReturnType<typeof vi.fn>;
  let openModal: ReturnType<typeof vi.fn>;
  let modalClosed: Subject<void>;
  let phone: boolean;
  let directoryFails: boolean;

  beforeEach(() => {
    query = new BehaviorSubject(convertToParamMap({}));
    phone = false;
    directoryFails = false;
    feed = () =>
      of({
        meetings: [meeting('a', BOARD), meeting('b', TSC, { meeting_type: 'Technical' })],
        total: 2,
        project: { uid: 'p', name: 'Synthetic Project', logo_url: null },
      });
    navigate = vi.fn().mockResolvedValue(true);
    modalClosed = new Subject();
    openModal = vi.fn(() => ({ closed: modalClosed, close: vi.fn() }));
    vi.stubGlobal('matchMedia', () => ({ matches: phone, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });

  afterEach(() => vi.unstubAllGlobals());

  const configure = (): void => {
    const directory: PublicGroupDirectoryResponse = { groups: [group(BOARD, 'Board'), group(TSC, 'TSC'), group(QUIET, 'Quiet Group')], total: 3 };
    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ projectSlug: 'synthetic' })), queryParamMap: query } },
        { provide: Router, useValue: { navigate } },
        { provide: MeetingService, useValue: { getPublicProjectMeetings: vi.fn(() => feed()) } },
        { provide: GroupService, useValue: { getPublicProjectGroups: () => (directoryFails ? throwError(() => new Error('down')) : of(directory)) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: UiModalService, useValue: { open: openModal } },
      ],
    });
  };

  const render = async (): Promise<ComponentFixture<PublicCalendarPageComponent>> => {
    configure();
    TestBed.overrideComponent(PublicCalendarPageComponent, {
      set: {
        imports: [
          MeetingsCalendarGridComponent,
          UiButtonComponent,
          UiEmptyStateComponent,
          UiOptionComponent,
          UiSelectComponent,
          UiSelectValueDirective,
          UiSkeletonComponent,
        ],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
      },
    });
    const fixture = TestBed.createComponent(PublicCalendarPageComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  };
  const byTestId = (fixture: ComponentFixture<PublicCalendarPageComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const chips = (fixture: ComponentFixture<PublicCalendarPageComponent>): string[] =>
    Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid="public-calendar-grid-chip"]')).map(
      (chip) => chip.getAttribute('aria-label') ?? ''
    );

  it('names the project and shows its public meetings coloured by type, with the time zone', async () => {
    const fixture = await render();

    expect(byTestId(fixture, 'public-calendar-title')?.textContent?.trim()).toBe('Synthetic Project');
    expect(chips(fixture).map((label) => label.split(',')[0])).toEqual(expect.arrayContaining(['Meeting a', 'Meeting b']));
    expect(byTestId(fixture, 'public-calendar-zone')?.textContent).toMatch(/^Times in \S+/);
    expect(byTestId(fixture, 'public-calendar-grid-view')).toBeTruthy();
  });

  it('lists only groups with public meetings and filters the calendar by ?committee=', async () => {
    query.next(convertToParamMap({ committee: TSC }));
    const fixture = await render();

    expect(byTestId(fixture, 'public-calendar-group')).toBeTruthy();
    expect(chips(fixture).map((label) => label.split(',')[0])).toEqual(['Meeting b']);
  });

  it('lists groups with public meetings plus the selected one, and writes the group to the URL', async () => {
    query.next(convertToParamMap({ committee: QUIET }));
    configure();
    const fixture = TestBed.createComponent(PublicCalendarPageStateComponent);
    await fixture.whenStable();
    const state = fixture.componentInstance;

    expect(state.groupNames()).toEqual(['Board', 'Quiet Group', 'TSC']);
    state.pickGroup(BOARD);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { committee: BOARD }, queryParamsHandling: 'merge' }));
  });

  it('offers the month view only on phones', async () => {
    phone = true;
    query.next(convertToParamMap({ view: 'week' }));
    const fixture = await render();

    expect(byTestId(fixture, 'public-calendar-grid-view')).toBeNull();
    expect(byTestId(fixture, 'public-calendar-grid-month')).toBeTruthy();
  });

  it('says when the feed fails and retries it', async () => {
    let calls = 0;
    feed = () =>
      ++calls === 1 ? throwError(() => new Error('down')) : of({ meetings: [], total: 0, project: { uid: 'p', name: 'Synthetic Project', logo_url: null } });
    const fixture = await render();
    expect(byTestId(fixture, 'public-calendar-error')?.textContent).toContain('Unable to load calendar');
    expect(byTestId(fixture, 'public-calendar-heading')).toBeNull();

    byTestId(fixture, 'public-calendar-retry')?.querySelector('button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(byTestId(fixture, 'public-calendar-error')).toBeNull();
    expect(byTestId(fixture, 'public-calendar-empty')?.textContent).toContain('This project has no public meetings on the calendar yet.');
  });

  it('offers all meetings when the selected group has none, and flags a group outside the directory', async () => {
    query.next(convertToParamMap({ committee: QUIET }));
    const fixture = await render();
    expect(byTestId(fixture, 'public-calendar-empty')?.textContent).toContain('No public meetings on the calendar for the selected group yet.');
    expect(byTestId(fixture, 'public-calendar-empty-all')).toBeTruthy();

    query.next(convertToParamMap({ committee: '44444444-4444-4444-8444-444444444444' }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(byTestId(fixture, 'public-calendar-unknown-group')?.textContent).toContain('Group not found');
  });

  it('opens a clicked meeting through ?meeting=, and drops it from the URL on close', async () => {
    const fixture = await render();
    (fixture.nativeElement.querySelector('[data-testid="public-calendar-grid-chip"]') as HTMLElement).click();
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { meeting: expect.stringMatching(/^[ab]$/) } }));

    query.next(convertToParamMap({ meeting: 'a' }));
    await fixture.whenStable();
    expect(openModal).toHaveBeenCalledWith(expect.anything(), {
      data: expect.objectContaining({ entry: expect.objectContaining({ key: 'a' }), groups: ['Board'], meeting: expect.objectContaining({ id: 'a' }) }),
    });

    modalClosed.next();
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { meeting: null } }));
  });

  it('offers all meetings when the group directory fails while a group is selected', async () => {
    directoryFails = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    query.next(convertToParamMap({ committee: TSC }));
    const fixture = await render();

    expect(byTestId(fixture, 'public-calendar-group')).toBeNull();
    byTestId(fixture, 'public-calendar-group-clear')?.querySelector('button')?.click();
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { committee: null } }));
  });
});

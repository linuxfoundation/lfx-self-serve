// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { PollStatus, VoteResponseStatus } from '@lfx-one/shared';
import { Lens, Vote } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteCastDrawerComponent } from '../components/vote-cast-drawer/vote-cast-drawer.component';
import { VoteResultsDrawerComponent } from '../components/vote-results-drawer/vote-results-drawer.component';
import { VotesTableComponent } from '../components/votes-table/votes-table.component';
import { VotesDashboardComponent } from './votes-dashboard.component';

const NOW = Date.parse('2026-01-10T12:00:00Z');
const vote = (uid: string, days: number, overrides: Partial<Vote> = {}): Vote => ({
  uid,
  name: `Ballot ${uid}`,
  status: PollStatus.ACTIVE,
  end_time: new Date(NOW + days * 86400000).toISOString(),
  project_uid: 'project-a',
  parent_project_uid: 'foundation-a',
  committee_name: 'Audi Group',
  response_status: VoteResponseStatus.AWAITING_RESPONSE,
  ...overrides,
});
const feed = [
  vote('responded', 2, { response_status: VoteResponseStatus.RESPONDED }),
  vote('soon', 4),
  vote('later', 12),
  vote('beta', 1, { project_uid: 'project-b', committee_name: 'Beta Group' }),
  vote('blank', 3, { committee_name: '   ' }),
  vote('ended', 1, { status: PollStatus.ENDED }),
  vote('outside', 1, { project_uid: 'project-outside', parent_project_uid: 'foundation-b', committee_name: 'Outside Group' }),
];

describe('VotesDashboardComponent personal summary', () => {
  let fixture: ComponentFixture<VotesDashboardComponent>;
  let dashboard: VotesDashboardComponent;
  let table: VotesTableComponent;
  let activeLens: WritableSignal<Lens>;
  let getMyVotes: ReturnType<typeof vi.fn>;
  const cards = () => dashboard['myVoteStatCards']();
  const rows = () => table['displayedVotes']().map((row) => row.uid);
  const element = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const settle = async () => {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
  };
  const selectSummary = async (action: string) => {
    element(`stat-card-${action}`)!.click();
    await settle();
  };

  beforeEach(async () => {
    // Leave Angular's change-detection scheduling real; only RxJS debounce and the viewer clock are controlled.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    activeLens = signal<Lens>('me');
    getMyVotes = vi.fn(() => of(feed));
    TestBed.configureTestingModule({
      imports: [VotesDashboardComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: VoteService, useValue: { getMyVotes, mergeRecentlyOpenedVotes: (votes: Vote[]) => votes } },
        { provide: CommitteeService, useValue: { getCommitteesByProject: vi.fn(() => of([])) } },
        { provide: LensService, useValue: { activeLens } },
        { provide: PersonaService, useValue: { personaLoaded: signal(true), hasBoardRole: signal(true), hasProjectRole: signal(true) } },
        { provide: ProjectContextService, useValue: { activeContext: signal(null), canWrite: signal(false) } },
      ],
    });
    // Keep the real dashboard, summary and table; unrelated drawers never participate in these scenarios.
    TestBed.overrideComponent(VotesDashboardComponent, {
      remove: { imports: [VoteCastDrawerComponent, VoteResultsDrawerComponent] },
      add: { schemas: [NO_ERRORS_SCHEMA] },
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(VotesDashboardComponent);
    dashboard = fixture.componentInstance;
    await settle();
    table = fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance;
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it('returns to the complete personal list after leaving Me with a summary selected', async () => {
    await selectSummary('needs-vote');
    expect(rows()).toEqual(['soon', 'later', 'beta', 'blank', 'outside']);
    activeLens.set('project');
    await settle();
    expect(element('votes-me-stats')).toBeNull();
    activeLens.set('me');
    await settle();
    table = fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance;
    expect(element('stat-card-needs-vote')?.getAttribute('aria-pressed')).toBe('false');
    expect(table.statusTab()).toBe('all');
    expect(rows()).toEqual(feed.map((item) => item.uid));
  });

  it('aggregates returned foundation/project/group scope, excluding search, status and page from totals', async () => {
    expect(cards().map((card) => card.value)).toEqual([5, 5]);
    dashboard['onFoundationFilterChange']('foundation-a');
    await settle();
    expect(cards().map((card) => card.value)).toEqual([4, 4]);
    dashboard['onProjectFilterChange']('project-a');
    await settle();
    expect(table.groupOptions().map((option) => option.value)).toEqual([null, 'Audi Group']);
    table.searchForm.patchValue({ group: 'Audi Group', search: 'not a ballot' });
    table['onStatusTabChange'](PollStatus.ENDED);
    dashboard['onPageChange']({ first: 25, rows: 25 });
    await settle();
    expect(rows()).toEqual([]);
    expect(cards().map((card) => [card.value, card.subLine])).toEqual([
      [2, 'Next: Jan 12, 2026'],
      [2, 'Earliest deadline: Jan 14, 2026'],
    ]);
    await selectSummary('needs-vote');
    expect(cards().map((card) => card.value)).toEqual([2, 2]);
    expect(element('votes-search-input')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No results found');
  });

  it('coordinates Ended, summary toggles, explicit Active and Reset without losing pending controls', async () => {
    table.searchForm.patchValue({ group: 'Audi Group', foundationFilter: 'foundation-a', projectFilter: 'project-a' });
    dashboard['onFoundationFilterChange']('foundation-a');
    dashboard['onProjectFilterChange']('project-a');
    table['onStatusTabChange'](PollStatus.ENDED);
    await settle();
    expect(rows()).toEqual(['ended']);
    dashboard['onPageChange']({ first: 0, rows: 25 });
    dashboard['onPageChange']({ first: 25, rows: 25 });
    table.searchForm.controls.search.setValue('Ballot'); // Still pending when the summary changes the tab.
    await selectSummary('closing-soon');
    expect(table.statusTab()).toBe(PollStatus.ACTIVE);
    expect(rows()).toEqual(['responded', 'soon']);
    expect(table.first()).toBe(0);
    expect(table.rowsPerPage()).toBe(25);
    expect(table.searchForm.getRawValue()).toEqual({ search: 'Ballot', group: 'Audi Group', foundationFilter: 'foundation-a', projectFilter: 'project-a' });
    expect([dashboard['foundationFilter'](), dashboard['projectFilter']()]).toEqual(['foundation-a', 'project-a']);
    await selectSummary('closing-soon');
    expect(rows()).toEqual(['responded', 'soon', 'later']);
    expect(table.statusTab()).toBe(PollStatus.ACTIVE);
    await selectSummary('needs-vote');
    expect(rows()).toEqual(['soon', 'later']);
    await selectSummary('closing-soon');
    expect(rows()).toEqual(['responded', 'soon']);
    table['onStatusTabChange'](PollStatus.ACTIVE);
    await settle();
    expect(dashboard['myVotesQuickFilter']()).toBeNull();
    expect(rows()).toEqual(['responded', 'soon', 'later']);
    await selectSummary('needs-vote');
    getMyVotes.mockReturnValueOnce(of(feed.map((item) => (item.uid === 'soon' ? { ...item, response_status: VoteResponseStatus.RESPONDED } : item))));
    dashboard['onVoteSubmitted']();
    await settle();
    expect(cards()[1].value).toBe(1);
    expect(rows()).toEqual(['later']);
    table['resetFilters']();
    await settle();
    expect(dashboard['myVotesQuickFilter']()).toBeNull();
    expect(table.statusTab()).toBe('all');
    expect(table.searchForm.controls.search.value).toBe('');
    expect([dashboard['foundationFilter'](), dashboard['projectFilter']()]).toEqual([null, null]);
    expect(rows()).toEqual(feed.map((item) => item.uid));
    expect(table.rowsPerPage()).toBe(25);
  });

  it.each([false, true])('keeps controls through loading/failure and retries to confirmed %s-empty success', async (empty) => {
    table.searchForm.patchValue({ search: 'Ballot', group: 'Audi Group' });
    await settle();
    const request = new Subject<Vote[]>();
    getMyVotes.mockReturnValueOnce(request);
    dashboard['refreshVotes']();
    await settle();
    const button = element('stat-card-needs-vote') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('—');
    request.error(new HttpErrorResponse({ status: 503 }));
    await settle();
    expect(element('votes-load-error')?.textContent).toContain('Unable to load your votes');
    expect(cards().map((card) => card.value)).toEqual(['—', '—']);
    expect(button.disabled).toBe(true);
    expect(fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance).toBe(table);
    expect(table.searchForm.controls.group.value).toBe('Audi Group');
    expect(table.searchForm.controls.search.value).toBe('Ballot');
    expect(fixture.nativeElement.textContent).not.toContain("Votes you've been invited to participate in will appear here.");
    getMyVotes.mockReturnValueOnce(of(empty ? [] : feed));
    element('votes-retry')!.querySelector('button')!.click();
    await settle();
    expect(element('votes-load-error')).toBeNull();
    expect(cards().map((card) => card.value)).toEqual(empty ? [0, 0] : [2, 2]);
    expect(button.disabled).toBe(false);
    expect(table.searchForm.controls.search.value).toBe('Ballot');
    expect(rows()).toEqual(empty ? [] : ['responded', 'soon', 'later', 'ended']);
    expect(table.searchForm.controls.group.value).toBe(empty ? null : 'Audi Group');
    if (empty) expect(fixture.nativeElement.textContent).toContain('No results found');
  });
});

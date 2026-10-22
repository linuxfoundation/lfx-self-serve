// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { GroupsIOMailingList, MyVotesQuickFilter, PollStatus, Vote, VoteResponseStatus, VoteStatusCounts } from '@lfx-one/shared';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { MailingListService } from '@services/mailing-list.service';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteMailingListReminderDialogComponent } from '../vote-mailing-list-reminder-dialog/vote-mailing-list-reminder-dialog.component';
import { VoteReminderDialogComponent } from '../vote-reminder-dialog/vote-reminder-dialog.component';
import { VotesTableComponent } from './votes-table.component';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const vote = (uid: string, overrides: Partial<Vote> = {}): Vote => ({
  uid,
  name: `Board ${uid}`,
  project_uid: 'synthetic-project',
  committee_name: 'Alpha Group',
  status: PollStatus.ACTIVE,
  response_status: VoteResponseStatus.AWAITING_RESPONSE,
  end_time: '2026-10-12T12:00:00Z',
  ...overrides,
});
const VOTES = [
  vote('z', { end_time: '2026-10-15T12:00:00Z' }),
  vote('a'),
  vote('responded', { response_status: VoteResponseStatus.RESPONDED }),
  vote('distant', { end_time: '2026-11-01T12:00:00Z' }),
  vote('other', { committee_name: 'Other Group' }),
  vote('unrelated', { name: 'Budget' }),
  vote('ended', { status: PollStatus.ENDED }),
];
const GROUPS = [
  { label: 'All Groups', value: null },
  { label: 'Alpha Group', value: 'Alpha Group' },
  { label: 'Other Group', value: 'Other Group' },
];

@Component({
  selector: 'lfx-summary-test-host',
  template: '',
})
class SummaryHostComponent {
  public readonly votes = VOTES;
  public readonly now = NOW;
  public readonly status = signal<string>(PollStatus.ACTIVE);
  public readonly quick = signal<MyVotesQuickFilter | null>('needs-vote');
  public readonly scoped = signal(false);
  public reset(): void {
    this.quick.set(null);
    this.scoped.set(false);
  }
}

@Component({
  selector: 'lfx-status-counts-test-host',
  template: '',
})
class StatusCountsHostComponent {
  public readonly votes = VOTES;
  public readonly showCounts = signal(true);
  public readonly counts = signal<VoteStatusCounts | null>({ all: 5, active: 3, disabled: 0, ended: 2 });
  public readonly showDraft = signal(true);
  public readonly status = signal<string>('all');
  public readonly selected: string[] = [];
}

@Component({
  selector: 'lfx-status-counts-loading-host',
  imports: [VotesTableComponent],
  template: `<lfx-votes-table [votes]="[]" [showStatusCounts]="true" [statusCounts]="counts()" />`,
})
class LoadingCountsHostComponent {
  public readonly counts = signal<VoteStatusCounts | null>(null);
}

describe('VotesTableComponent — status tab counts', () => {
  let fixture: ComponentFixture<StatusCountsHostComponent>;
  let host: StatusCountsHostComponent;

  beforeEach(async () => {
    TestBed.overrideComponent(StatusCountsHostComponent, {
      set: {
        imports: [VotesTableComponent],
        template: `<lfx-votes-table [votes]="votes" [showStatusCounts]="showCounts()" [statusCounts]="counts()"
          [showDraftTab]="showDraft()" [(statusTab)]="status" (statusTabSelected)="selected.push($event)" />`,
      },
    });
    await TestBed.configureTestingModule({
      imports: [VotesTableComponent, StatusCountsHostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: { isAwaitingInvitationCount: () => false } },
        { provide: MessageService, useValue: {} },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MailingListService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(StatusCountsHostComponent);
    host = fixture.componentInstance;
    await settle();
  });
  afterEach(() => fixture?.destroy());

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  function pills(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid="votes-status-tabs"] [data-testid^="filter-pill-"]'));
  }
  const labels = (): string[] => pills().map((pill) => pill.textContent!.trim());
  const accessibleNames = (): (string | null)[] => pills().map((pill) => pill.getAttribute('aria-label'));

  it('appends positive counts and leaves a confirmed zero as the plain label', () => {
    expect(labels()).toEqual(['All (5)', 'Active (3)', 'Draft', 'Ended (2)']);
    expect(accessibleNames()).toEqual(labels());
  });

  it('keeps a count of exactly 1 visible beside zero totals', async () => {
    host.counts.set({ all: 1, active: 0, disabled: 1, ended: 0 });
    await settle();
    expect(labels()).toEqual(['All (1)', 'Active', 'Draft (1)', 'Ended']);
    expect(accessibleNames()).toEqual(labels());
  });

  it('omits the Draft tab when the view does not expose drafts', async () => {
    host.showDraft.set(false);
    await settle();
    expect(labels()).toEqual(['All (5)', 'Active (3)', 'Ended (2)']);
  });

  it('renders unavailable counts as plain labels without a placeholder', async () => {
    host.counts.set(null);
    await settle();
    expect(labels()).toEqual(['All', 'Active', 'Draft', 'Ended']);
    expect(accessibleNames()).toEqual(labels());
    expect(fixture.nativeElement.querySelector('[data-testid="votes-status-tabs"]').textContent).not.toMatch(/[–(]/);
  });

  it('follows count updates from loading to positive to zero and back to loading', async () => {
    host.counts.set(null);
    await settle();
    expect(labels()).toEqual(['All', 'Active', 'Draft', 'Ended']);

    host.counts.set({ all: 4, active: 1, disabled: 2, ended: 1 });
    await settle();
    expect(labels()).toEqual(['All (4)', 'Active (1)', 'Draft (2)', 'Ended (1)']);
    expect(accessibleNames()).toEqual(labels());

    host.counts.set({ all: 0, active: 0, disabled: 0, ended: 0 });
    await settle();
    expect(labels()).toEqual(['All', 'Active', 'Draft', 'Ended']);
    expect(accessibleNames()).toEqual(labels());

    host.counts.set(null);
    await settle();
    expect(labels()).toEqual(['All', 'Active', 'Draft', 'Ended']);
    expect(accessibleNames()).toEqual(labels());
  });

  it('renders plain labels for consumers that do not opt in', async () => {
    host.showCounts.set(false);
    await settle();
    expect(labels()).toEqual(['All', 'Active', 'Draft', 'Ended']);
  });

  it('keeps zero-count tabs selectable by their bare status id', async () => {
    expect(labels()[2]).toBe('Draft');
    (fixture.nativeElement.querySelector('[data-testid="filter-pill-disabled"]') as HTMLButtonElement).click();
    await settle();
    expect(host.selected).toEqual([PollStatus.DISABLED]);
    expect(host.status()).toBe(PollStatus.DISABLED);
  });

  it('still selects counted tabs by their bare status id', async () => {
    (fixture.nativeElement.querySelector(`[data-testid="filter-pill-${PollStatus.ENDED}"]`) as HTMLButtonElement).click();
    await settle();
    expect(host.selected).toEqual([PollStatus.ENDED]);
    expect(host.status()).toBe(PollStatus.ENDED);
    expect(fixture.nativeElement.querySelector(`[data-testid="filter-pill-${PollStatus.ENDED}"]`).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('VotesTableComponent — status tab counts on initial load', () => {
  let fixture: ComponentFixture<LoadingCountsHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoadingCountsHostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: { isAwaitingInvitationCount: () => false } },
        { provide: MessageService, useValue: {} },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MailingListService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LoadingCountsHostComponent);
  });
  afterEach(() => fixture?.destroy());

  it('renders plain labels on the first render while counts are still pending, then shows positive counts', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const pills = (): HTMLButtonElement[] =>
      Array.from(fixture.nativeElement.querySelectorAll('[data-testid="votes-status-tabs"] [data-testid^="filter-pill-"]'));
    expect(pills().map((pill) => pill.textContent!.trim())).toEqual(['All', 'Active', 'Draft', 'Ended']);
    expect(pills().map((pill) => pill.getAttribute('aria-label'))).toEqual(['All', 'Active', 'Draft', 'Ended']);

    fixture.componentInstance.counts.set({ all: 2, active: 2, disabled: 0, ended: 0 });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(pills().map((pill) => pill.textContent!.trim())).toEqual(['All (2)', 'Active (2)', 'Draft', 'Ended']);
  });
});

describe('VotesTableComponent — personal summary filters', () => {
  let fixture: ComponentFixture<unknown>;
  let table: VotesTableComponent;
  beforeEach(async () => {
    // RxJS debounceTime uses intervals; leave Angular's timeout/rAF scheduler real.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    TestBed.overrideComponent(SummaryHostComponent, {
      set: {
        imports: [VotesTableComponent],
        template: `<lfx-votes-table [votes]="scoped() ? [] : votes" [(statusTab)]="status"
          [quickFilter]="quick()" [quickFilterNowMs]="now" [scopeActive]="scoped()"
          (statusTabSelected)="quick.set(null)" (filtersReset)="reset()" />`,
      },
    });
    await TestBed.configureTestingModule({
      imports: [VotesTableComponent, SummaryHostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: { isAwaitingInvitationCount: () => false } },
        { provide: MessageService, useValue: {} },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MailingListService, useValue: {} },
      ],
    }).compileComponents();
  });
  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  async function settle(debounce = false): Promise<void> {
    if (debounce) await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
    await fixture.whenStable();
  }
  async function render(): Promise<void> {
    const rendered = TestBed.createComponent(VotesTableComponent);
    fixture = rendered;
    table = rendered.componentInstance;
    rendered.componentRef.setInput('votes', VOTES);
    rendered.componentRef.setInput('groupOptions', GROUPS);
    rendered.componentRef.setInput('quickFilterNowMs', NOW);
    await settle(true);
  }
  async function renderHost(): Promise<SummaryHostComponent> {
    const rendered = TestBed.createComponent(SummaryHostComponent);
    fixture = rendered;
    await settle(true);
    table = rendered.debugElement.query(By.directive(VotesTableComponent)).componentInstance;
    return rendered.componentInstance;
  }
  function rows(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('tr[data-testid^="votes-row-"]') as NodeListOf<HTMLElement>).map((row) =>
      row.getAttribute('data-testid')!.replace('votes-row-', '')
    );
  }
  async function tab(status: string): Promise<void> {
    (fixture.nativeElement.querySelector(`[data-testid="filter-pill-${status}"]`) as HTMLButtonElement).click();
    await settle();
  }
  function emptyState(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="votes-table-empty-state"]');
  }
  async function clickReset(): Promise<void> {
    const reset = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (button) => button.textContent?.trim() === 'Reset filters'
    )!;
    reset.click();
    await settle(true);
  }

  it.each([
    ['closing-soon', ['z', 'a', 'responded']],
    ['needs-vote', ['z', 'a', 'distant']],
  ] as const)('intersects %s with search and group without sorting', async (filter, expected) => {
    await render();
    fixture.componentRef.setInput('quickFilter', filter);
    table.searchForm.patchValue({ search: 'bOaRd', group: 'Alpha Group' });
    await settle(true);
    expect(rows()).toEqual(expected);
  });

  it('retains autonomous tab filtering when the model is unbound', async () => {
    await render();
    // Committee Votes embeds the table unbound — its default stays All; only the voting pages bind Active.
    expect(table.statusTab()).toBe('all');
    expect(rows()).toEqual(VOTES.map((v) => v.uid));
    await tab(PollStatus.ENDED);
    expect(rows()).toEqual(['ended']);
    await tab(PollStatus.ACTIVE);
    expect(rows()).toEqual(['z', 'a', 'responded', 'distant', 'other', 'unrelated']);
    await tab('all');
    expect(rows()).toEqual(VOTES.map((v) => v.uid));
  });

  it('leaves server-returned lazy rows untouched by all client filters', async () => {
    await render();
    fixture.componentRef.setInput('lazy', true);
    fixture.componentRef.setInput('totalRecords', VOTES.length);
    fixture.componentRef.setInput('quickFilter', 'needs-vote');
    table.searchForm.patchValue({ search: 'absent', group: 'Alpha Group' });
    await tab(PollStatus.ENDED);
    await settle(true);
    expect(rows()).toEqual(VOTES.map((v) => v.uid));
  });

  it('preserves a pending search when an external model update switches Ended to Active', async () => {
    await render();
    await tab(PollStatus.ENDED);
    const search = fixture.nativeElement.querySelector('[data-testid="votes-search-input"] input') as HTMLInputElement;
    search.value = 'Board a';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.componentRef.setInput('statusTab', PollStatus.ACTIVE);
    fixture.componentRef.setInput('quickFilter', 'needs-vote');
    await settle();
    expect(table.searchForm.controls.search.value).toBe('Board a');
    await settle(true);
    expect(rows()).toEqual(['a']);
  });

  it('clears a summary on repeated explicit Active selection and restores responded rows', async () => {
    const host = await renderHost();
    expect(rows()).toEqual(['z', 'a', 'distant', 'other', 'unrelated']);
    await tab(PollStatus.ACTIVE);
    expect(host.status()).toBe(PollStatus.ACTIVE);
    expect(rows()).toEqual(['z', 'a', 'responded', 'distant', 'other', 'unrelated']);
  });

  it('retains controls for scoped empty results and recovers rows through Reset filters', async () => {
    const host = await renderHost();
    host.scoped.set(true);
    host.quick.set(null);
    host.status.set('all');
    await settle(true);
    expect(emptyState()?.textContent).toContain('No votes match your filters');
    table.searchForm.controls.search.setValue('absent');
    await settle(true);
    expect(emptyState()?.textContent).toContain('No votes match your filters');
    expect(fixture.nativeElement.querySelector('[data-testid="votes-search-input"] input')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="votes-group-filter"]')).toBeTruthy();
    await clickReset();
    expect(table.searchForm.controls.search.value).toBe('');
    expect(rows()).toEqual(VOTES.map((v) => v.uid));
  });

  it('opts into recoverable empty lazy results without changing default consumers', async () => {
    await render();
    fixture.componentRef.setInput('lazy', true);
    fixture.componentRef.setInput('votes', []);
    await settle(true);
    expect(table['isFiltered']()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="votes-search-input"]')).toBeNull();
    fixture.componentRef.setInput('serverFiltersActive', true);
    await settle();
    expect(emptyState()?.textContent).toContain('No votes match your filters');
    expect(fixture.nativeElement.querySelector('[data-testid="votes-search-input"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="votes-group-filter"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Reset filters');
    table['resetFilters']();
    fixture.componentRef.setInput('serverFiltersActive', false);
    fixture.componentRef.setInput('votes', VOTES);
    await settle(true);
    expect(rows()).toEqual(VOTES.map((v) => v.uid));
  });

  it('hides pending pagination without hiding filters or loaded rows', async () => {
    await render();
    fixture.componentRef.setInput('lazy', true);
    fixture.componentRef.setInput('totalRecords', 20);
    await settle();
    expect(fixture.nativeElement.querySelector('.p-paginator')).toBeTruthy();
    fixture.componentRef.setInput('paginationLoading', true);
    await settle();
    expect(fixture.nativeElement.querySelector('.p-paginator')).toBeNull();
    expect(rows()).toEqual(VOTES.map((v) => v.uid));
    expect(fixture.nativeElement.querySelector('[data-testid="votes-search-input"]')).toBeTruthy();
    fixture.componentRef.setInput('paginationLoading', false);
    await settle();
    expect(fixture.nativeElement.querySelector('.p-paginator')).toBeTruthy();
  });

  it('clears an unavailable group only after loading, preserving search and summary', async () => {
    await render();
    fixture.componentRef.setInput('quickFilter', 'needs-vote');
    table.searchForm.patchValue({ search: 'Board', group: 'Alpha Group' });
    await settle(true);
    expect(rows()).toEqual(['z', 'a', 'distant']);
    fixture.componentRef.setInput('loading', true);
    fixture.componentRef.setInput('votes', [
      VOTES[4],
      vote('other-responded', { committee_name: 'Other Group', response_status: VoteResponseStatus.RESPONDED }),
      vote('other-budget', { committee_name: 'Other Group', name: 'Budget' }),
    ]);
    fixture.componentRef.setInput(
      'groupOptions',
      GROUPS.filter((g) => g.value !== 'Alpha Group')
    );
    await settle();
    expect(table.searchForm.controls.group.value).toBe('Alpha Group');
    fixture.componentRef.setInput('loading', false);
    await settle();
    expect(table.searchForm.controls.group.value).toBeNull();
    expect(table.searchForm.controls.search.value).toBe('Board');
    await settle(true);
    expect(rows()).toEqual(['other']);
  });
});

describe('VotesTableComponent — empty-state copy', () => {
  let fixture: ComponentFixture<VotesTableComponent>;
  let table: VotesTableComponent;
  const STATUS_COPY = [
    [PollStatus.ACTIVE, 'No active votes', 'There are no votes open for voting in this view. Select All to see votes with other statuses.'],
    [PollStatus.DISABLED, 'No draft votes', 'Votes saved as drafts will appear here before they are opened for voting.'],
    [PollStatus.ENDED, 'No ended votes yet', 'Votes will appear here after voting ends.'],
  ] as const;
  const NO_MATCH = ['No votes match your filters', 'Try changing your search or filters, or reset filters to see all votes.'];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    await TestBed.configureTestingModule({
      imports: [VotesTableComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: { isAwaitingInvitationCount: () => false } },
        { provide: MessageService, useValue: {} },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MailingListService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VotesTableComponent);
    table = fixture.componentInstance;
    fixture.componentRef.setInput('groupOptions', GROUPS);
    fixture.componentRef.setInput('quickFilterNowMs', NOW);
  });
  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  async function settle(debounce = true): Promise<void> {
    if (debounce) await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
    await fixture.whenStable();
  }
  function rows(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('tr[data-testid^="votes-row-"]') as NodeListOf<HTMLElement>).map((row) =>
      row.getAttribute('data-testid')!.replace('votes-row-', '')
    );
  }
  function copy(): [string, string] | null {
    const empty = fixture.nativeElement.querySelector('[data-testid="votes-table-empty-state"]') as HTMLElement | null;
    if (!empty) return null;
    return [empty.querySelector('h3')!.textContent!.trim(), empty.querySelector('p')!.textContent!.trim()];
  }
  /** Renders an empty result for `status`: client mode filters out that status locally; lazy mode receives no server rows. */
  async function renderEmpty(status: string, lazy: boolean): Promise<void> {
    fixture.componentRef.setInput('lazy', lazy);
    fixture.componentRef.setInput('serverFiltersActive', lazy);
    fixture.componentRef.setInput('votes', lazy ? [] : VOTES.filter((v) => v.status !== status));
    fixture.componentRef.setInput('statusTab', status);
    await settle();
  }

  for (const lazy of [false, true]) {
    it.each(STATUS_COPY)(`names the empty %s status (lazy: ${lazy})`, async (status, title, subtitle) => {
      await renderEmpty(status, lazy);
      expect(copy()).toEqual([title, subtitle]);
      expect(fixture.nativeElement.querySelector('[data-testid="votes-search-input"]')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('[data-testid="votes-status-tabs"]')).toBeTruthy();
    });

    it.each(['search', 'group', 'quick filter', 'scope'])(`prefers no-match copy over status copy for %s (lazy: ${lazy})`, async (kind) => {
      await renderEmpty(PollStatus.ACTIVE, lazy);
      if (kind === 'search') table.searchForm.controls.search.setValue('absent');
      if (kind === 'group') table.searchForm.controls.group.setValue('Alpha Group');
      if (kind === 'quick filter') fixture.componentRef.setInput('quickFilter', 'closing-soon');
      if (kind === 'scope') fixture.componentRef.setInput('scopeActive', true);
      await settle();
      expect(copy()).toEqual(NO_MATCH);
    });
  }

  it.each(['all', PollStatus.ACTIVE, PollStatus.ENDED])('offers Retry instead of definitive empty copy for an incomplete %s feed', async (status) => {
    fixture.componentRef.setInput('votes', []);
    fixture.componentRef.setInput('statusTab', status);
    fixture.componentRef.setInput('resultsComplete', false);
    const refresh = vi.fn();
    const reset = vi.fn();
    table.refresh.subscribe(refresh);
    table.filtersReset.subscribe(reset);
    await settle();

    expect(copy()).toEqual(['Some votes could not be loaded', 'Your vote list is incomplete. Retry to check for votes in this view.']);
    expect(fixture.nativeElement.querySelector('[data-testid="votes-search-input"]')).toBeTruthy();
    const retry = fixture.nativeElement.querySelector('[data-testid="votes-table-empty-state"] button') as HTMLButtonElement;
    expect(retry.textContent?.trim()).toBe('Retry');
    retry.click();
    expect(refresh).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
    expect(table.statusTab()).toBe(status);
  });

  it.each(['search', 'group', 'quick filter', 'scope'])('prefers incomplete copy over no-match advice with %s', async (kind) => {
    fixture.componentRef.setInput('resultsComplete', false);
    await renderEmpty(PollStatus.ACTIVE, false);
    if (kind === 'search') table.searchForm.controls.search.setValue('absent');
    if (kind === 'group') table.searchForm.controls.group.setValue('Alpha Group');
    if (kind === 'quick filter') fixture.componentRef.setInput('quickFilter', 'closing-soon');
    if (kind === 'scope') fixture.componentRef.setInput('scopeActive', true);
    await settle();
    expect(copy()?.[0]).toBe('Some votes could not be loaded');
  });

  it('keeps usable partial rows and suppresses incomplete copy while loading, then restores confirmed empty copy', async () => {
    fixture.componentRef.setInput('votes', [vote('active')]);
    fixture.componentRef.setInput('statusTab', PollStatus.ACTIVE);
    fixture.componentRef.setInput('resultsComplete', false);
    await settle();
    expect(rows()).toEqual(['active']);
    expect(copy()).toBeNull();

    fixture.componentRef.setInput('votes', []);
    fixture.componentRef.setInput('loading', true);
    await settle(false);
    expect(copy()).toBeNull();
    fixture.componentRef.setInput('loading', false);
    await settle(false);
    expect(copy()?.[0]).toBe('Some votes could not be loaded');
    fixture.componentRef.setInput('resultsComplete', true);
    await settle(false);
    expect(copy()?.[0]).toBe('No active votes');
    expect(fixture.nativeElement.querySelector('[data-testid="votes-table-empty-state"] button').textContent.trim()).toBe('Reset filters');
  });

  it('keeps invitation copy on unfiltered client All', async () => {
    fixture.componentRef.setInput('votes', []);
    await settle();
    expect(copy()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("Votes you've been invited to participate in will appear here.");
  });

  it('keeps status wording neutral for writers', async () => {
    fixture.componentRef.setInput('hasPMOAccess', true);
    await renderEmpty(PollStatus.DISABLED, true);
    expect(copy()).toEqual(['No draft votes', 'Votes saved as drafts will appear here before they are opened for voting.']);
  });

  it('treats whitespace-only search as no search, keeping populated Active rows and the typed text', async () => {
    const emitted: string[] = [];
    table.filtersChange.subscribe((state) => emitted.push(state.search));
    fixture.componentRef.setInput('votes', VOTES);
    fixture.componentRef.setInput('statusTab', PollStatus.ACTIVE);
    await settle();
    emitted.length = 0;
    table.searchForm.controls.search.setValue('   ');
    await settle();
    expect(rows()).toEqual(['z', 'a', 'responded', 'distant', 'other', 'unrelated']);
    expect(copy()).toBeNull();
    expect(table.searchForm.controls.search.value).toBe('   ');
    expect(emitted).toEqual([]);
    table.searchForm.controls.search.setValue('  budget  ');
    await settle();
    expect(rows()).toEqual(['unrelated']);
    expect(emitted).toEqual(['budget']);
  });

  it('suppresses the empty state while loading', async () => {
    fixture.componentRef.setInput('loading', true);
    await renderEmpty(PollStatus.ACTIVE, true);
    expect(copy()).toBeNull();
    fixture.componentRef.setInput('loading', false);
    await settle(false);
    expect(copy()?.[0]).toBe('No active votes');
  });

  it('hides Draft when the Draft tab is disabled and falls back to All', async () => {
    fixture.componentRef.setInput('showDraftTab', false);
    fixture.componentRef.setInput('votes', VOTES);
    fixture.componentRef.setInput('statusTab', PollStatus.DISABLED);
    await settle();
    expect(fixture.nativeElement.querySelector(`[data-testid="filter-pill-${PollStatus.DISABLED}"]`)).toBeNull();
    expect(table.statusTab()).toBe('all');
  });

  it('recovers from an empty Active view through Reset filters to All', async () => {
    await renderEmpty(PollStatus.ACTIVE, false);
    expect(copy()?.[0]).toBe('No active votes');
    table.searchForm.controls.search.setValue('Board');
    await settle();
    expect(copy()).toEqual(NO_MATCH);
    const reset = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (button) => button.textContent?.trim() === 'Reset filters'
    )!;
    reset.click();
    await settle();
    expect(table.statusTab()).toBe('all');
    expect(table.searchForm.controls.search.value).toBe('');
    expect(rows()).toEqual(['ended']);
  });
});

describe('VotesTableComponent — row More menu', () => {
  let fixture: ComponentFixture<VotesTableComponent>;
  let table: VotesTableComponent;
  let copyLink: ReturnType<typeof vi.fn>;
  let openDialog: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  let getMailingListsByCommittee: ReturnType<typeof vi.fn>;
  let location: { href: string };
  const ROWS = [vote('active'), vote('ended', { status: PollStatus.ENDED }), vote('draft', { status: PollStatus.DISABLED })];
  const moreButton = (uid: string): HTMLButtonElement | null => fixture.nativeElement.querySelector(`[data-testid="votes-more-${uid}"] button`);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    copyLink = vi.fn();
    openDialog = vi.fn();
    messageAdd = vi.fn();
    getMailingListsByCommittee = vi.fn().mockReturnValue(NEVER);
    location = { href: '' };
    await TestBed.configureTestingModule({
      imports: [VotesTableComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: { isAwaitingInvitationCount: () => false } },
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: ClipboardShareService, useValue: { copyLink } },
        { provide: DialogService, useValue: { open: openDialog } },
        { provide: MailingListService, useValue: { getMailingListsByCommittee } },
        // Only `location` is swapped: TestBed renders through DOCUMENT, and jsdom refuses a direct `document.location` assignment.
        {
          provide: DOCUMENT,
          useFactory: () =>
            new Proxy(globalThis.document, {
              get: (target, prop) => {
                if (prop === 'location') return location;
                const value = Reflect.get(target, prop);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
        },
      ],
    })
      // DialogService is a component-level provider (see the "deliberately not here" comment on
      // VotesTableComponent) — it must be overridden on the component itself, not the TestBed root.
      .overrideComponent(VotesTableComponent, {
        set: { providers: [ConfirmationService, { provide: DialogService, useValue: { open: openDialog } }] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(VotesTableComponent);
    table = fixture.componentInstance;
    fixture.componentRef.setInput('votes', ROWS);
  });
  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
    await fixture.whenStable();
    // Noop animation callbacks (including the menu's onShow/onHide) arrive on the real clock.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it.each([false, true])('shows ⋮ on active and ended rows but not drafts (manager view: %s)', async (hasPMOAccess) => {
    fixture.componentRef.setInput('hasPMOAccess', hasPMOAccess);
    await settle();

    expect(moreButton('active')).not.toBeNull();
    expect(moreButton('ended')).not.toBeNull();
    expect(moreButton('draft')).toBeNull();
  });

  it('adds a Clone item gated by hasPMOAccess, which navigates to the create form with ?clone=<uid>', async () => {
    fixture.componentRef.setInput('hasPMOAccess', true);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await settle();

    moreButton('active')!.click();
    await settle();

    const items = table['rowActionMenuItems']();
    expect(items.map((item) => item.label)).toEqual(['Copy link', 'Clone']);

    items[1].command!({});

    expect(navigate).toHaveBeenCalledWith(['/votes', 'create'], { queryParams: { clone: 'active' } });
  });

  it("carries the row's own project/committee context when cloning (dashboard rows can span projects)", async () => {
    fixture.componentRef.setInput('hasPMOAccess', true);
    fixture.componentRef.setInput('votes', [...ROWS, vote('foreign', { project_slug: 'other-project', committee_uid: 'other-committee-uid' })]);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await settle();

    moreButton('foreign')!.click();
    await settle();

    const items = table['rowActionMenuItems']();
    items[1].command!({});

    expect(navigate).toHaveBeenCalledWith(['/votes', 'create'], {
      queryParams: { project: 'other-project', committee_uid: 'other-committee-uid', clone: 'foreign' },
    });
  });

  it("tier-prefixes the clone create route from the source vote's own is_foundation", async () => {
    fixture.componentRef.setInput('hasPMOAccess', true);
    fixture.componentRef.setInput('votes', [...ROWS, vote('foundation-vote', { is_foundation: true }), vote('project-vote', { is_foundation: false })]);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await settle();

    moreButton('foundation-vote')!.click();
    await settle();
    table['rowActionMenuItems']()[1].command!({});
    expect(navigate).toHaveBeenCalledWith(['/', 'foundation', 'votes', 'create'], { queryParams: { clone: 'foundation-vote' } });

    moreButton('project-vote')!.click();
    await settle();
    table['rowActionMenuItems']()[1].command!({});
    expect(navigate).toHaveBeenCalledWith(['/', 'project', 'votes', 'create'], { queryParams: { clone: 'project-vote' } });
  });

  it('omits Clone from the menu without hasPMOAccess', async () => {
    fixture.componentRef.setInput('hasPMOAccess', false);
    await settle();

    moreButton('active')!.click();
    await settle();

    expect(table['rowActionMenuItems']().map((item) => item.label)).toEqual(['Copy link']);
  });

  it('opens the menu without selecting the row, and Copy link copies the absolute permalink', async () => {
    await settle();
    const viewed = vi.fn();
    table.viewVote.subscribe(viewed);
    table.viewResults.subscribe(viewed);

    moreButton('active')!.click();
    await settle();

    expect(viewed).not.toHaveBeenCalled();
    const items = table['rowActionMenuItems']();
    expect(items.map((item) => item.label)).toEqual(['Copy link']);

    items[0].command!({});

    expect(copyLink).toHaveBeenCalledTimes(1);
    const [url, detail] = copyLink.mock.calls[0];
    expect(url).toBe(`${window.location.origin}/votes/active`);
    expect(detail).toBe('Vote link copied to clipboard.');
  });

  it.each([false, true])('uses per-vote writer access and opens reminders even without project write access (%s) (#3769)', async (hasPMOAccess) => {
    fixture.componentRef.setInput('hasPMOAccess', hasPMOAccess);
    fixture.componentRef.setInput(
      'votes',
      ROWS.map((row) => ({ ...row, writer: true }))
    );
    await settle();

    moreButton('active')!.click();
    await settle();

    // Clone rides on project access, reminders (and Extend) on per-vote writer access — the gates
    // are independent, which is the whole point of this case. Clone is appended last (#3781), so
    // the reminder stays at index 2 (after Extend) whether or not Clone is there.
    const items = table['rowActionMenuItems']();
    expect(items.map((item) => item.label)).toEqual(
      hasPMOAccess
        ? ['Copy link', 'Extend', 'Send reminder', 'Send reminder to mailing list', 'Clone']
        : ['Copy link', 'Extend', 'Send reminder', 'Send reminder to mailing list']
    );

    const reminderItem = document.querySelector<HTMLElement>('[role="menuitem"][aria-label="Send reminder"]')!;
    reminderItem.dispatchEvent(new Event('mouseenter'));
    await fixture.whenStable();
    expect(document.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe('Opens a dialog to send reminders to eligible voters who have not voted yet');
    expect(items[2].tooltipOptions?.tooltipPosition).toBe('left');
    reminderItem.dispatchEvent(new Event('mouseleave'));

    items[2].command!({});

    expect(openDialog).toHaveBeenCalledWith(
      VoteReminderDialogComponent,
      expect.objectContaining({
        header: 'Send vote reminder',
        width: 'min(960px, 96vw)',
        modal: true,
        data: { vote: expect.objectContaining({ uid: 'active' }) },
      })
    );
  });

  describe('Send reminder to mailing list (#3658)', () => {
    const TSC = { uid: 'ml-1', group_name: 'tsc', domain: 'lists.example.org' } as GroupsIOMailingList;
    const MAIN = { uid: 'ml-2', group_name: 'main', domain: 'lists.example.org' } as GroupsIOMailingList;
    const UNSAFE = { uid: 'ml-3', group_name: 'tsc,other@evil.example', domain: 'lists.example.org' } as GroupsIOMailingList;

    /** Opens the active row's menu as a manager and returns the mailing list reminder item. */
    async function reminderItem(overrides: Partial<Vote> = { committee_uid: 'committee-1' }) {
      fixture.componentRef.setInput(
        'votes',
        ROWS.map((row) => ({ ...row, writer: true, ...overrides }))
      );
      await settle();
      moreButton('active')!.click();
      await settle();
      return table['rowActionMenuItems']().find((item) => item.label === 'Send reminder to mailing list')!;
    }

    it('shows on manager rows with a tooltip saying it opens the mail app', async () => {
      const item = await reminderItem();

      expect(Array.from(document.querySelectorAll('[role="menuitem"]'), (element) => element.textContent?.trim())).toContain('Send reminder to mailing list');
      expect(item.icon).toBe('fa-light fa-envelopes-bulk');
      expect(item.tooltipOptions?.tooltipLabel).toBe('Opens your mail app to send a reminder email to the mailing list');
    });

    it('opens the mailto: draft straight away when the committee has one usable list', async () => {
      getMailingListsByCommittee.mockReturnValue(of([TSC, UNSAFE]));
      const item = await reminderItem();

      item.command!({});

      expect(getMailingListsByCommittee).toHaveBeenCalledWith('committee-1');
      expect(openDialog).not.toHaveBeenCalled();
      expect(location.href.startsWith('mailto:tsc@lists.example.org?subject=')).toBe(true);
      const body = decodeURIComponent(location.href.split('&body=')[1]);
      expect(body).toContain('Voting is open for "Board active"');
      expect(body).toContain(`${window.location.origin}/votes/active`);
    });

    it.each([
      { overrides: {}, expectedCommitteeUid: 'committee-fallback' },
      { overrides: { committee_uid: 'committee-1' }, expectedCommitteeUid: 'committee-1' },
    ])('resolves the mailing-list committee to $expectedCommitteeUid with a committee-tab fallback', async ({ overrides, expectedCommitteeUid }) => {
      fixture.componentRef.setInput('editQueryParamsFallback', { committee_uid: 'committee-fallback' });
      getMailingListsByCommittee.mockReturnValue(of([TSC]));
      const item = await reminderItem(overrides);

      item.command!({});

      expect(getMailingListsByCommittee).toHaveBeenCalledWith(expectedCommitteeUid);
      expect(location.href.startsWith('mailto:tsc@lists.example.org?subject=')).toBe(true);
      expect(messageAdd).not.toHaveBeenCalled();
    });

    it('asks which list when there are several, then drafts to the picked one', async () => {
      const closed = new Subject<GroupsIOMailingList | undefined>();
      openDialog.mockReturnValue({ onClose: closed });
      getMailingListsByCommittee.mockReturnValue(of([TSC, MAIN]));
      const item = await reminderItem();

      item.command!({});

      expect(openDialog).toHaveBeenCalledWith(
        VoteMailingListReminderDialogComponent,
        expect.objectContaining({
          header: 'Reminder mailing list',
          modal: true,
          data: { vote: expect.objectContaining({ uid: 'active' }), lists: [TSC, MAIN] },
        })
      );
      expect(location.href).toBe('');

      closed.next(MAIN);

      expect(location.href.startsWith('mailto:main@lists.example.org?subject=')).toBe(true);
    });

    it('ignores picker selections after the table is destroyed', async () => {
      const closed = new Subject<GroupsIOMailingList | undefined>();
      openDialog.mockReturnValue({ onClose: closed });
      getMailingListsByCommittee.mockReturnValue(of([TSC, MAIN]));
      const item = await reminderItem();

      item.command!({});
      expect(closed.observed).toBe(true);
      fixture.destroy();
      expect(closed.observed).toBe(false);
      closed.next(MAIN);

      expect(location.href).toBe('');
      expect(messageAdd).not.toHaveBeenCalled();
    });

    it('ignores duplicate clicks during a lookup and allows another reminder after success', async () => {
      const pending = new Subject<GroupsIOMailingList[]>();
      getMailingListsByCommittee.mockReturnValue(of([TSC])).mockReturnValueOnce(pending);
      const item = await reminderItem();

      item.command!({});
      item.command!({});
      expect(getMailingListsByCommittee).toHaveBeenCalledTimes(1);

      pending.next([TSC, MAIN]);
      expect(openDialog).toHaveBeenCalledTimes(1);
      item.command!({});

      expect(getMailingListsByCommittee).toHaveBeenCalledTimes(2);
      expect(location.href.startsWith('mailto:tsc@lists.example.org?subject=')).toBe(true);
    });

    it.each(['error', 'empty completion'])('allows a retry after lookup %s', async (outcome) => {
      const pending = new Subject<GroupsIOMailingList[]>();
      getMailingListsByCommittee.mockReturnValue(of([TSC])).mockReturnValueOnce(pending);
      const item = await reminderItem();

      item.command!({});
      if (outcome === 'error') {
        pending.error(new Error('boom'));
      } else {
        pending.complete();
      }
      item.command!({});

      expect(getMailingListsByCommittee).toHaveBeenCalledTimes(2);
      expect(location.href.startsWith('mailto:tsc@lists.example.org?subject=')).toBe(true);
    });

    it('cancels a pending lookup and clears its guard when the table is destroyed', async () => {
      const pending = new Subject<GroupsIOMailingList[]>();
      getMailingListsByCommittee.mockReturnValue(pending);
      const item = await reminderItem();

      item.command!({});
      expect(pending.observed).toBe(true);
      fixture.destroy();
      expect(pending.observed).toBe(false);
      pending.next([TSC, MAIN]);

      expect(openDialog).not.toHaveBeenCalled();
      expect(location.href).toBe('');
      expect(messageAdd).not.toHaveBeenCalled();
    });

    it('does nothing when the picker is cancelled', async () => {
      const closed = new Subject<GroupsIOMailingList | undefined>();
      openDialog.mockReturnValue({ onClose: closed });
      getMailingListsByCommittee.mockReturnValue(of([TSC, MAIN]));
      const item = await reminderItem();

      item.command!({});
      closed.next(undefined);

      expect(location.href).toBe('');
    });

    it.each([
      { label: 'no usable list', lists: [UNSAFE], overrides: { committee_uid: 'committee-1' } },
      { label: 'no committee', lists: [TSC], overrides: {} },
    ])('shows the no-mailing-list toast for $label', async ({ lists, overrides }) => {
      getMailingListsByCommittee.mockReturnValue(of(lists));
      const item = await reminderItem(overrides);

      item.command!({});

      expect(location.href).toBe('');
      expect(messageAdd).toHaveBeenCalledWith({
        severity: 'info',
        summary: 'No mailing list',
        detail: 'This group has no mailing list. Use Copy link or Send reminder instead.',
      });
    });

    it('shows an error toast when the lists fail to load', async () => {
      getMailingListsByCommittee.mockReturnValue(throwError(() => new Error('boom')));
      const item = await reminderItem();

      item.command!({});

      expect(location.href).toBe('');
      expect(messageAdd).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: "Couldn't load this group's mailing lists. Please try again." })
      );
    });
  });

  it.each([
    { hasPMOAccess: true, writer: false, uid: 'active', expectedLabels: ['Copy link', 'Clone'] },
    { hasPMOAccess: true, writer: undefined, uid: 'active', expectedLabels: ['Copy link', 'Clone'] },
    { hasPMOAccess: false, writer: false, uid: 'active', expectedLabels: ['Copy link'] },
    { hasPMOAccess: true, writer: true, uid: 'ended', expectedLabels: ['Copy link', 'Clone'] },
  ])('omits reminders for $uid with project access $hasPMOAccess and vote writer $writer (#3769)', async ({ hasPMOAccess, writer, uid, expectedLabels }) => {
    fixture.componentRef.setInput('hasPMOAccess', hasPMOAccess);
    fixture.componentRef.setInput(
      'votes',
      ROWS.map((row) => ({ ...row, writer }))
    );
    await settle();

    moreButton(uid)!.click();
    await settle();

    // Asserting the absence of the reminder, not of Clone: Clone follows project access (#3781) and
    // is expected in every case here that has it, including the ended vote — a vote that has closed
    // can still be cloned into a new one.
    expect(table['rowActionMenuItems']().map((item) => item.label)).toEqual(expectedLabels);
  });

  it('exposes menu semantics and expands only the row whose menu is open', async () => {
    await settle();
    expect(moreButton('active')!.getAttribute('aria-haspopup')).toBe('menu');
    expect(moreButton('ended')!.getAttribute('aria-haspopup')).toBe('menu');
    expect(moreButton('active')!.getAttribute('aria-expanded')).toBe('false');
    expect(moreButton('ended')!.getAttribute('aria-expanded')).toBe('false');

    moreButton('ended')!.click();
    await settle();

    expect(moreButton('ended')!.getAttribute('aria-expanded')).toBe('true');
    expect(moreButton('active')!.getAttribute('aria-expanded')).toBe('false');
  });

  it.each(['escape', 'outside click', 'trigger toggle', 'selection'])('clears expanded state after %s dismissal', async (dismissal) => {
    await settle();
    moreButton('active')!.click();
    await settle();
    expect(moreButton('active')!.getAttribute('aria-expanded')).toBe('true');

    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    switch (dismissal) {
      case 'escape':
        menu.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
        break;
      case 'outside click':
        document.body.click();
        break;
      case 'trigger toggle':
        moreButton('active')!.click();
        break;
      case 'selection':
        (menu.querySelector('[role="menuitem"] a') as HTMLElement).click();
        break;
    }
    await settle();

    expect(moreButton('active')!.getAttribute('aria-expanded')).toBe('false');
    expect(moreButton('ended')!.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('rebuilds the menu for the clicked row', async () => {
    await settle();

    moreButton('active')!.click();
    moreButton('ended')!.click();
    await settle();
    table['rowActionMenuItems']()[0].command!({});

    expect(copyLink.mock.calls[0][0]).toMatch(/\/votes\/ended$/);
  });
});

describe('VotesTableComponent — participation progress', () => {
  let fixture: ComponentFixture<VotesTableComponent>;
  const ROWS = [
    vote('active', { num_response_received: 8, total_voting_request_invitations: 12 }),
    vote('ended', { status: PollStatus.ENDED, num_response_received: 8, total_voting_request_invitations: 12 }),
    vote('draft', { status: PollStatus.DISABLED, num_response_received: 0, total_voting_request_invitations: 0 }),
    vote('empty', { num_response_received: 0, total_voting_request_invitations: 0 }),
    vote('no-total', { num_response_received: 8 }),
    vote('no-responses', { total_voting_request_invitations: 12 }),
    vote('zero', { num_response_received: 0, total_voting_request_invitations: 12 }),
    vote('counting', { num_response_received: 0, total_voting_request_invitations: 0 }),
    vote('counted', { num_response_received: 0, total_voting_request_invitations: 4 }),
  ];
  // Rows still inside the just-opened carrier window (GH-4078).
  const AWAITING = new Set(['counting', 'counted']);
  const el = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => el(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    await TestBed.configureTestingModule({
      imports: [VotesTableComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: { isAwaitingInvitationCount: (uid: string) => AWAITING.has(uid) } },
        { provide: MessageService, useValue: {} },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MailingListService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VotesTableComponent);
    fixture.componentRef.setInput('votes', ROWS);
  });
  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  async function render(showParticipationProgress = true): Promise<void> {
    if (showParticipationProgress) fixture.componentRef.setInput('showParticipationProgress', true);
    await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('summarises an active vote with an accessible progress bar', async () => {
    await render();

    expect(text('votes-participation-label-active')).toBe('8 of 12 responded · 67%');
    const bar = el('votes-participation-bar-active')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('67');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-label')).toBe('Participation: 8 of 12 responded, 67%');
  });

  it('uses visible participation summaries without prohibited names on generic spans', async () => {
    await render();

    const summaries = fixture.nativeElement.querySelectorAll('[data-testid^="votes-participation-"] span[aria-label]');
    expect(summaries.length).toBe(0);
  });

  it('keeps the participation summary for an ended vote without a progress bar', async () => {
    await render();

    expect(text('votes-participation-label-ended')).toBe('8 of 12 responded · 67%');
    expect(el('votes-participation-bar-ended')).toBeNull();
  });

  it('shows a draft as not open, without counts or a bar', async () => {
    await render();

    expect(text('votes-participation-draft')).toBe('Not open yet');
    expect(el('votes-participation-bar-draft')).toBeNull();
  });

  it('shows a zero-person electorate without a percent or a bar', async () => {
    await render();

    expect(text('votes-participation-empty')).toBe('No one invited');
    expect(text('votes-participation-empty')).not.toMatch(/%/);
    expect(el('votes-participation-bar-empty')).toBeNull();
  });

  it('shows a just-opened vote as counting invitations instead of "No one invited"', async () => {
    await render();

    expect(text('votes-participation-counting')).toBe('Counting invitations…');
    expect(text('votes-participation-counting')).not.toMatch(/No one invited/);
    expect(el('votes-participation-bar-counting')).toBeNull();
  });

  it('shows the real participation of a just-opened vote once its invitation count arrives', async () => {
    await render();

    expect(text('votes-participation-label-counted')).toBe('0 of 4 responded · 0%');
  });

  it('shows the response count alone when the invited total is missing', async () => {
    await render();

    expect(text('votes-participation-label-no-total')).toBe('8 responded');
    expect(text('votes-participation-secondary-no-total')).toBe('Total unavailable');
    expect(el('votes-participation-bar-no-total')).toBeNull();
  });

  it('shows missing responses as unavailable, without a bar', async () => {
    await render();

    expect(text('votes-participation-no-responses')).toBe('Unavailable');
    expect(el('votes-participation-bar-no-responses')).toBeNull();
  });

  it('shows a confirmed zero as 0% with a bar, distinct from unavailable', async () => {
    await render();

    expect(text('votes-participation-label-zero')).toBe('0 of 12 responded · 0%');
    expect(el('votes-participation-bar-zero')?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('labels the personal column Your vote without showing response counts', async () => {
    await render(false);

    const headers = Array.from(fixture.nativeElement.querySelectorAll('th') as NodeListOf<HTMLElement>).map((header) => header.textContent?.trim());
    expect(headers).toContain('Your vote');
    expect(headers).not.toContain('Responses');
    expect(el('votes-responses-active')).toBeNull();
    expect(el('votes-participation-active')).toBeNull();
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('shows personal voting status for %s votes independently of response totals', async (status) => {
    fixture.componentRef.setInput('votes', [
      vote('voted', { status, response_status: VoteResponseStatus.RESPONDED, num_response_received: 0 }),
      vote('not-voted', { status, response_status: VoteResponseStatus.AWAITING_RESPONSE, num_response_received: 1 }),
    ]);
    await render(false);

    const voted = el('votes-your-vote-voted')!;
    expect(voted.getAttribute('role')).toBe('img');
    expect(voted.getAttribute('aria-label')).toBe('Voted');
    expect(voted.getAttribute('tabindex')).toBe('0');
    const icon = voted.querySelector('i')!;
    expect(icon.classList.contains('fa-solid')).toBe(true);
    expect(icon.classList.contains('fa-circle-check')).toBe(true);
    expect(icon.classList.contains('text-emerald-600')).toBe(true);
    expect(icon.getAttribute('aria-hidden')).toBe('true');

    const notVoted = el('votes-your-vote-not-voted')!;
    expect(notVoted.getAttribute('role')).toBe('img');
    expect(notVoted.getAttribute('aria-label')).toBe('Not voted');
    expect(notVoted.textContent?.trim()).toBe('—');
    expect(notVoted.classList.contains('text-gray-500')).toBe(true);
    expect(notVoted.querySelector('i')).toBeNull();
  });

  it.each(['mouseenter', 'focus'])('shows the Voted tooltip on %s', async (event) => {
    fixture.componentRef.setInput('votes', [vote('voted', { response_status: VoteResponseStatus.RESPONDED })]);
    await render(false);

    el('votes-your-vote-voted')!.dispatchEvent(new Event(event));
    await fixture.whenStable();

    expect(document.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe('Voted');
  });

  it('retains the Responses heading and participation summary in management views', async () => {
    await render();

    const headers = Array.from(fixture.nativeElement.querySelectorAll('th') as NodeListOf<HTMLElement>).map((header) => header.textContent?.trim());
    expect(headers).toContain('Responses');
    expect(headers).not.toContain('Your vote');
    expect(fixture.nativeElement.querySelector('[data-testid^="votes-your-vote-"]')).toBeNull();
    expect(text('votes-participation-label-active')).toBe('8 of 12 responded · 67%');
  });

  it('never words participation as quorum, approval, or an outcome', async () => {
    await render();

    const cells = Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="votes-participation-"]') as NodeListOf<HTMLElement>);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(`${cell.textContent} ${cell.getAttribute('aria-label') ?? ''}`).not.toMatch(/quorum|approv|winn|passed/i);
    }
  });
});

describe('VotesTableComponent — Extend deadline', () => {
  let fixture: ComponentFixture<VotesTableComponent>;
  let table: VotesTableComponent;
  let extendVote: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let onClose: Subject<{ end_time: string; end_time_timezone: string } | undefined>;
  const ROWS = [
    vote('active', { writer: true }),
    vote('ended', { status: PollStatus.ENDED, writer: true }),
    vote('draft', { status: PollStatus.DISABLED, writer: true }),
  ];
  const moreButton = (uid: string): HTMLButtonElement | null => fixture.nativeElement.querySelector(`[data-testid="votes-more-${uid}"] button`);
  /** Opens the row's "..." menu and returns its 'Extend' item, if present. */
  async function extendItem(uid: string) {
    const button = moreButton(uid);
    if (!button) return undefined;
    button.click();
    await settle();
    return table['rowActionMenuItems']().find((item) => item.label === 'Extend');
  }

  beforeEach(async () => {
    extendVote = vi.fn().mockReturnValue(of(vote('active')));
    onClose = new Subject();
    dialogOpen = vi.fn().mockReturnValue({ onClose });
    await TestBed.configureTestingModule({
      imports: [VotesTableComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: { extendVote, isAwaitingInvitationCount: () => false } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: MailingListService, useValue: {} },
      ],
    })
      // DialogService is a component-level provider (see the "deliberately not here" comment on
      // VotesTableComponent) — it must be overridden on the component itself, not the TestBed root.
      .overrideComponent(VotesTableComponent, {
        set: { providers: [ConfirmationService, { provide: DialogService, useValue: { open: dialogOpen } }] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(VotesTableComponent);
    table = fixture.componentInstance;
    fixture.componentRef.setInput('votes', ROWS);
    fixture.componentRef.setInput('hasPMOAccess', true);
  });
  afterEach(() => fixture?.destroy());

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('shows the Extend item only for a manager on an active vote', async () => {
    await settle();
    expect(await extendItem('active')).toBeDefined();
    expect(await extendItem('ended')).toBeUndefined();
    expect(moreButton('draft')).toBeNull();
  });

  it('hides the Extend item for a non-manager viewer', async () => {
    fixture.componentRef.setInput(
      'votes',
      ROWS.map((row) => (row.uid === 'active' ? { ...row, writer: false } : row))
    );
    await settle();
    expect(await extendItem('active')).toBeUndefined();
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uO-ES @copilot-pull-request-reviewer): the item was previously
  // gated on project-level hasPMOAccess() rather than the vote's own writer flag — a committee-only
  // writer without project access couldn't extend their own vote's deadline, even though they could
  // already "Send reminder" on the same row (toggleRowActionMenu() already used vote.writer there).
  it('shows the Extend item for a writable vote even without project access', async () => {
    fixture.componentRef.setInput('hasPMOAccess', false);
    fixture.componentRef.setInput(
      'votes',
      ROWS.map((row) => (row.uid === 'active' ? { ...row, writer: true } : row))
    );
    await settle();
    expect(await extendItem('active')).toBeDefined();
  });

  it('hides the Extend item for a non-writable vote even with project access', async () => {
    fixture.componentRef.setInput('hasPMOAccess', true);
    fixture.componentRef.setInput(
      'votes',
      ROWS.map((row) => (row.uid === 'active' ? { ...row, writer: false } : row))
    );
    await settle();
    expect(await extendItem('active')).toBeUndefined();
  });

  it('opens the dialog seeded with the vote name/current deadline and extends on confirm', async () => {
    await settle();

    const item = await extendItem('active');
    item!.command!({});
    await settle();

    expect(dialogOpen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({ voteName: 'Board active', currentEndTime: '2026-10-12T12:00:00Z' }),
      })
    );

    const result = { end_time: '2026-11-01T23:59:00.000Z', end_time_timezone: 'UTC' };
    onClose.next(result);
    await settle();

    expect(extendVote).toHaveBeenCalledWith('active', result);
  });

  it('does nothing when the dialog is dismissed without a result', async () => {
    await settle();

    const item = await extendItem('active');
    item!.command!({});
    onClose.next(undefined);
    await settle();

    expect(extendVote).not.toHaveBeenCalled();
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uAB0b @greptile-apps, PRRT_kwDOPMiRQ86uAElJ @copilot-pull-request-reviewer):
  // the eviction effect only cleared a saved override on an exact end_time match, so a second extension
  // (e.g. by another manager) landing in a refresh before the first eviction never matched and the
  // table kept showing — and reseeding the dialog from — the stale, older deadline. Pins the fix:
  // eviction now compares timestamps (>=) so a later deadline evicts the override too.
  it('evicts a stale override once a refresh shows a later deadline, not just an exact match', async () => {
    extendVote.mockReturnValue(of(vote('active', { end_time: '2026-11-01T23:59:00.000Z', end_time_timezone: 'UTC' })));
    await settle();

    let item = await extendItem('active');
    item!.command!({});
    await settle();
    onClose.next({ end_time: '2026-11-01T23:59:00.000Z', end_time_timezone: 'UTC' });
    await settle();

    // A second, later extension lands in the row before this client's own refresh ever matches exactly.
    fixture.componentRef.setInput('votes', [vote('active', { end_time: '2026-12-01T23:59:00.000Z', end_time_timezone: 'UTC', writer: true })]);
    await settle();

    item = await extendItem('active');
    item!.command!({});
    await settle();

    expect(dialogOpen).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ currentEndTime: '2026-12-01T23:59:00.000Z' }) })
    );
  });
});

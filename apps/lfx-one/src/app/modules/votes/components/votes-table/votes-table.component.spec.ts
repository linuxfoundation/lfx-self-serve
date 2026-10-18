// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MyVotesQuickFilter, PollStatus, Vote, VoteResponseStatus, VoteStatusCounts } from '@lfx-one/shared';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VotesTableComponent } from './votes-table.component';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const vote = (uid: string, overrides: Partial<Vote> = {}): Vote => ({
  uid,
  name: `Board ${uid}`,
  project_uid: 'synthetic-project',
  committee_name: 'Audi Group',
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
  { label: 'Audi Group', value: 'Audi Group' },
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
      providers: [provideRouter([]), provideNoopAnimations(), { provide: VoteService, useValue: {} }, { provide: MessageService, useValue: {} }],
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

  it('appends each tab count to its label and keeps a confirmed zero visible', () => {
    expect(labels()).toEqual(['All (5)', 'Active (3)', 'Draft (0)', 'Ended (2)']);
    expect(accessibleNames()).toEqual(labels());
  });

  it('omits the Draft tab when the view does not expose drafts', async () => {
    host.showDraft.set(false);
    await settle();
    expect(labels()).toEqual(['All (5)', 'Active (3)', 'Ended (2)']);
  });

  it('renders unavailable counts as a dash and announces them as unavailable', async () => {
    host.counts.set(null);
    await settle();
    expect(labels()).toEqual(['All (–)', 'Active (–)', 'Draft (–)', 'Ended (–)']);
    expect(accessibleNames()).toEqual(['All, count unavailable', 'Active, count unavailable', 'Draft, count unavailable', 'Ended, count unavailable']);
  });

  it('renders plain labels for consumers that do not opt in', async () => {
    host.showCounts.set(false);
    await settle();
    expect(labels()).toEqual(['All', 'Active', 'Draft', 'Ended']);
  });

  it('still selects counted tabs by their bare status id', async () => {
    (fixture.nativeElement.querySelector('[data-testid="filter-pill-disabled"]') as HTMLButtonElement).click();
    await settle();
    expect(host.selected).toEqual([PollStatus.DISABLED]);
    expect(host.status()).toBe(PollStatus.DISABLED);
    expect(fixture.nativeElement.querySelector('[data-testid="filter-pill-disabled"]').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('VotesTableComponent — personal summary filters', () => {
  let fixture: ComponentFixture<unknown>;
  let table: VotesTableComponent;
  beforeEach(async () => {
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
      providers: [provideRouter([]), provideNoopAnimations(), { provide: VoteService, useValue: {} }, { provide: MessageService, useValue: {} }],
    }).compileComponents();
  });
  afterEach(() => fixture?.destroy());

  async function settle(debounce = false): Promise<void> {
    if (debounce) await new Promise((resolve) => setTimeout(resolve, 350));
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
    table.searchForm.patchValue({ search: 'bOaRd', group: 'Audi Group' });
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
    table.searchForm.patchValue({ search: 'absent', group: 'Audi Group' });
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
    expect(emptyState()?.textContent).toContain('No votes yet');
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
    table.searchForm.patchValue({ search: 'Board', group: 'Audi Group' });
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
      GROUPS.filter((g) => g.value !== 'Audi Group')
    );
    await settle();
    expect(table.searchForm.controls.group.value).toBe('Audi Group');
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
    await TestBed.configureTestingModule({
      imports: [VotesTableComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: VoteService, useValue: {} }, { provide: MessageService, useValue: {} }],
    }).compileComponents();
    fixture = TestBed.createComponent(VotesTableComponent);
    table = fixture.componentInstance;
    fixture.componentRef.setInput('groupOptions', GROUPS);
    fixture.componentRef.setInput('quickFilterNowMs', NOW);
  });
  afterEach(() => fixture?.destroy());

  async function settle(debounce = true): Promise<void> {
    if (debounce) await new Promise((resolve) => setTimeout(resolve, 350));
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
      if (kind === 'group') table.searchForm.controls.group.setValue('Audi Group');
      if (kind === 'quick filter') fixture.componentRef.setInput('quickFilter', 'closing-soon');
      if (kind === 'scope') fixture.componentRef.setInput('scopeActive', true);
      await settle();
      expect(copy()).toEqual(NO_MATCH);
    });
  }

  it.each([
    [false, "Votes you've been invited to participate in will appear here."],
    [true, 'Votes for this project or foundation will appear here.'],
  ])('uses All copy for the table context (lazy: %s, read-only)', async (lazy, subtitle) => {
    fixture.componentRef.setInput('lazy', lazy);
    fixture.componentRef.setInput('serverFiltersActive', true);
    fixture.componentRef.setInput('scopeActive', false);
    fixture.componentRef.setInput('votes', []);
    await settle();
    if (!lazy) {
      // Unfiltered client All never reaches the filtered branch; it keeps the invitation message.
      expect(copy()).toBeNull();
      expect(fixture.nativeElement.textContent).toContain(subtitle);
      return;
    }
    expect(copy()).toEqual(['No votes yet', subtitle]);
  });

  it('offers creation wording on the lazy All copy only to writers', async () => {
    fixture.componentRef.setInput('lazy', true);
    fixture.componentRef.setInput('serverFiltersActive', true);
    fixture.componentRef.setInput('hasPMOAccess', true);
    fixture.componentRef.setInput('votes', []);
    await settle();
    expect(copy()).toEqual(['No votes yet', 'Create a vote to gather decisions from project groups.']);
    fixture.componentRef.setInput('statusTab', PollStatus.DISABLED);
    await settle();
    // Status copy stays neutral even for writers.
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
  const ROWS = [vote('active'), vote('ended', { status: PollStatus.ENDED }), vote('draft', { status: PollStatus.DISABLED })];
  const moreButton = (uid: string): HTMLButtonElement | null => fixture.nativeElement.querySelector(`[data-testid="votes-more-${uid}"] button`);

  beforeEach(async () => {
    copyLink = vi.fn();
    await TestBed.configureTestingModule({
      imports: [VotesTableComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: VoteService, useValue: {} },
        { provide: MessageService, useValue: {} },
        { provide: ClipboardShareService, useValue: { copyLink } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VotesTableComponent);
    table = fixture.componentInstance;
    fixture.componentRef.setInput('votes', ROWS);
  });
  afterEach(() => fixture?.destroy());

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 350));
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
  ];
  const el = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => el(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VotesTableComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: VoteService, useValue: {} }, { provide: MessageService, useValue: {} }],
    }).compileComponents();
    fixture = TestBed.createComponent(VotesTableComponent);
    fixture.componentRef.setInput('votes', ROWS);
  });
  afterEach(() => fixture?.destroy());

  async function render(showParticipationProgress = true): Promise<void> {
    if (showParticipationProgress) fixture.componentRef.setInput('showParticipationProgress', true);
    await new Promise((resolve) => setTimeout(resolve, 350));
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

  it('keeps the raw response count when progress is not enabled', async () => {
    await render(false);

    expect(text('votes-responses-active')).toBe('8');
    expect(el('votes-participation-active')).toBeNull();
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

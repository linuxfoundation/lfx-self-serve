// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MyVotesQuickFilter, PollStatus, Vote, VoteResponseStatus } from '@lfx-one/shared';
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
    expect(fixture.nativeElement.textContent).toContain('No results found');
    table.searchForm.controls.search.setValue('absent');
    await settle(true);
    expect(fixture.nativeElement.textContent).toContain('No results found');
    expect(fixture.nativeElement.querySelector('[data-testid="votes-search-input"] input')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="votes-group-filter"]')).toBeTruthy();
    const reset = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (button) => button.textContent?.trim() === 'Reset filters'
    )!;
    reset.click();
    await settle(true);
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
    expect(fixture.nativeElement.textContent).toContain('No results found');
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

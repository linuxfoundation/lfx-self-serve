// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MyVotesQuickFilter, PollStatus, Vote, VoteResponseStatus } from '@lfx-one/shared';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

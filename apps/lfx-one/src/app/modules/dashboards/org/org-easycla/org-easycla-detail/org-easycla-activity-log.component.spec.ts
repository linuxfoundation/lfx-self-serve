// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgClaActivityLogEntry, OrgClaActivityLogPage, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaActivityLogComponent } from './org-easycla-activity-log.component';

describe('OrgEasyclaActivityLogComponent', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000AcmeOrgAAA', accountName: 'Acme' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(null);
  const getActivityLog = vi.fn();
  const addMessage = vi.fn();

  function claGroup(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupName: 'Nimbus Foundation CLA',
      projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD3AAI' }],
      signed: true,
      status: 'signed',
      needsClaManager: false,
      claManagersCount: 2,
      ...overrides,
    };
  }

  function entry(overrides: Partial<OrgClaActivityLogEntry> = {}): OrgClaActivityLogEntry {
    return {
      id: `event-${Math.random().toString(36).slice(2, 8)}`,
      when: '2026-01-15T09:20:00Z',
      actor: 'Ada Porter',
      summary: 'aporter signed a corporate CLA',
      ...overrides,
    };
  }

  function page(rows: OrgClaActivityLogEntry[], overrides: Partial<OrgClaActivityLogPage> = {}): OrgClaActivityLogPage {
    return {
      signatureId: 'signature-uuid-1',
      list: rows,
      resultCount: rows.length,
      nextKey: null,
      ...overrides,
    };
  }

  async function render(row: OrgClaGroup = claGroup()): Promise<ComponentFixture<OrgEasyclaActivityLogComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaActivityLogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount } },
        { provide: OrgLensClaService, useValue: { getActivityLog } },
        { provide: MessageService, useValue: { add: addMessage } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaActivityLogComponent);
    fixture.componentRef.setInput('claGroup', row);
    fixture.detectChanges();
    // `combineLatest` sources include `toObservable` streams whose emissions land on the
    // microtask queue. Two stable/detect cycles: the first drains those microtasks so the fetch
    // subscribes; the second flushes the resulting signal update into the DOM.
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function byTestId(fixture: ComponentFixture<unknown>, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  function allByTestId(fixture: ComponentFixture<unknown>, id: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`));
  }

  function textIn(el: HTMLElement | null): string {
    return (el?.textContent ?? '').trim();
  }

  function click(fixture: ComponentFixture<unknown>, id: string): void {
    (fixture.nativeElement.querySelector(`[data-testid="${id}"] button`) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    // `resetAllMocks` clears the `mockReturnValueOnce` queue too — `clearAllMocks` only clears
    // call history, so a leftover `mockReturnValueOnce` from an earlier test would otherwise
    // bleed into the next test's first fetch.
    vi.resetAllMocks();
    selectedAccount.set(SELECTED_ACCOUNT);
    getActivityLog.mockReturnValue(of(page([])));
  });

  it('renders one row per event with the producer-provided summary as PLAIN TEXT', async () => {
    getActivityLog.mockReturnValueOnce(
      of(
        page([
          entry({ id: 'e1', summary: 'aporter signed a corporate CLA', actor: 'Ada Porter' }),
          entry({ id: 'e2', summary: 'kmensah added an approval domain', actor: 'Kwame Mensah' }),
        ])
      )
    );
    const fixture = await render();

    expect(allByTestId(fixture, 'org-easycla-activity-log-summary').map(textIn)).toEqual([
      'aporter signed a corporate CLA',
      'kmensah added an approval domain',
    ]);
    expect(allByTestId(fixture, 'org-easycla-activity-log-actor').map(textIn)).toEqual(['Ada Porter', 'Kwame Mensah']);
  });

  // The historical bug (easycla#5199) rendered a project name behind the literal label "with
  // project SFID". The tab must render the summary as opaque text and never parse it — so a
  // legacy summary survives unchanged, with no attempt to rewrite it into a link.
  it('renders a historical "with project SFID <name>" summary verbatim, without parsing or re-linking', async () => {
    const legacy = 'aporter signed a CCLA with project SFID Cascade';
    getActivityLog.mockReturnValueOnce(of(page([entry({ id: 'e1', summary: legacy })])));
    const fixture = await render();

    const cell = byTestId(fixture, 'org-easycla-activity-log-summary');
    expect(textIn(cell)).toBe(legacy);
    // The summary cell contains no anchor children — no substring was auto-linked.
    expect(cell?.querySelector('a')).toBeNull();
  });

  it('substitutes an em-dash when the actor is null (the producer sent no name)', async () => {
    getActivityLog.mockReturnValueOnce(of(page([entry({ id: 'e1', actor: null })])));
    const fixture = await render();

    expect(textIn(byTestId(fixture, 'org-easycla-activity-log-actor'))).toBe('—');
  });

  it('renders every event the producer sent — nothing filters the tab', async () => {
    getActivityLog.mockReturnValueOnce(
      of(
        page([
          entry({ id: 'e1', summary: 'aporter signed a corporate CLA' }),
          entry({ id: 'e2', summary: 'aporter added a CLA Manager' }),
          entry({ id: 'e3', summary: 'aporter added an approval domain' }),
          entry({ id: 'e4', summary: 'a contributor acknowledged the CCLA' }),
          entry({ id: 'e5', summary: 'an event type the tab has never seen' }),
        ])
      )
    );
    const fixture = await render();

    expect(allByTestId(fixture, 'org-easycla-activity-log-summary')).toHaveLength(5);
  });

  it('has no tab badge and no per-row action button', async () => {
    getActivityLog.mockReturnValueOnce(of(page([entry({ id: 'e1' })])));
    const fixture = await render();

    // The tab is not a filter and does not count — no total-count badge in the header.
    const count = byTestId(fixture, 'org-easycla-activity-log-count');
    expect(count?.textContent ?? '').not.toContain(' of ');
    // No invalidate / manage / approve / delete / edit action lives on this tab.
    for (const label of ['Invalidate', 'Remove', 'Delete', 'Edit', 'Approve']) {
      expect(fixture.nativeElement.textContent).not.toContain(label);
    }
  });

  /**
   * Load-more merges the fetched next page onto the current view rather than replacing it.
   *
   * The `page() ?? listSignal()` order pins a regression the sibling acknowledgments tab
   * uncovered — reversing it makes the merged page invisible because the initial `listSignal`
   * shadows it.
   */
  it('renders the merged rows after Load-more, not just the first page', async () => {
    getActivityLog.mockReturnValueOnce(of(page([entry({ id: 'e1', summary: 'first' })], { nextKey: 'cursor-2' })));
    const fixture = await render();

    expect(allByTestId(fixture, 'org-easycla-activity-log-summary').map(textIn)).toEqual(['first']);
    expect(byTestId(fixture, 'org-easycla-activity-log-load-more')).toBeTruthy();

    // Second page arrives via nextKey; the component appends and renders BOTH rows.
    getActivityLog.mockReturnValueOnce(of(page([entry({ id: 'e2', summary: 'second' })], { nextKey: null })));

    click(fixture, 'org-easycla-activity-log-load-more');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(allByTestId(fixture, 'org-easycla-activity-log-summary').map(textIn)).toEqual(['first', 'second']);
    // The producer's nextKey came back null on page 2, so Load-more retires.
    expect(byTestId(fixture, 'org-easycla-activity-log-load-more')).toBeNull();
  });

  // Search stays on the loaded rows. The producer's searchTerm matches EventData, not the
  // EventSummary and actor this tab shows.
  it('filters the rendered rows client-side by actor and summary; a keystroke does not fire a fetch', async () => {
    getActivityLog.mockReturnValueOnce(
      of(
        page([
          entry({ id: 'e1', summary: 'aporter signed a corporate CLA', actor: 'Ada Porter' }),
          entry({ id: 'e2', summary: 'kmensah added an approval domain', actor: 'Kwame Mensah' }),
        ])
      )
    );
    const fixture = await render();
    const initialFetchCount = getActivityLog.mock.calls.length;

    const search = fixture.componentInstance as unknown as { filterForm: { controls: { search: { setValue: (value: string) => void } } } };
    search.filterForm.controls.search.setValue('kmensah');
    // Debounce is `CLA_GROUP_SEARCH_DEBOUNCE_MS = 250ms`; run timers past it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Only one row survives the filter — no new fetch was made against the producer.
    expect(allByTestId(fixture, 'org-easycla-activity-log-summary').map(textIn)).toEqual(['kmensah added an approval domain']);
    expect(getActivityLog.mock.calls.length).toBe(initialFetchCount);
  });

  it('matches an accented actor when the query is unaccented', async () => {
    getActivityLog.mockReturnValueOnce(of(page([entry({ id: 'e1', summary: 'signed a corporate CLA', actor: 'José Mensah' })])));
    const fixture = await render();

    const search = fixture.componentInstance as unknown as { filterForm: { controls: { search: { setValue: (value: string) => void } } } };
    search.filterForm.controls.search.setValue('Jose');
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(allByTestId(fixture, 'org-easycla-activity-log-actor').map(textIn)).toEqual(['José Mensah']);
  });

  it('shows the filter-empty state (not the tab-empty state) when the fetched set is non-empty but the term matches nothing', async () => {
    getActivityLog.mockReturnValueOnce(of(page([entry({ id: 'e1', summary: 'aporter signed', actor: 'Ada' })])));
    const fixture = await render();

    const search = fixture.componentInstance as unknown as { filterForm: { controls: { search: { setValue: (value: string) => void } } } };
    search.filterForm.controls.search.setValue('nomatch');
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(byTestId(fixture, 'org-easycla-activity-log-filter-empty')).toBeTruthy();
    // The tab-level empty state is deliberately different copy — a term that matches nothing is
    // not the same as "no activity yet".
    expect(byTestId(fixture, 'org-easycla-activity-log-empty')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-activity-log-load-more')).toBeNull();
  });

  it('keeps Load more when the term matches nothing on this page but a later page exists', async () => {
    getActivityLog.mockReturnValueOnce(of(page([entry({ id: 'e1', summary: 'aporter signed', actor: 'Ada' })], { nextKey: 'cursor-2' })));
    const fixture = await render();

    const search = fixture.componentInstance as unknown as { filterForm: { controls: { search: { setValue: (value: string) => void } } } };
    search.filterForm.controls.search.setValue('nomatch');
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(byTestId(fixture, 'org-easycla-activity-log-filter-empty')).toBeTruthy();
    expect(byTestId(fixture, 'org-easycla-activity-log-load-more')).toBeTruthy();
  });

  it('keeps Load more when this page mapped to zero rows but a later page exists', async () => {
    getActivityLog.mockReturnValueOnce(of(page([], { nextKey: 'cursor-2' })));
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-activity-log-empty')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-activity-log-load-more')).toBeTruthy();
  });

  it('shows the tab-empty state when the fetched set is empty AND no search term is entered', async () => {
    getActivityLog.mockReturnValueOnce(of(page([])));
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-activity-log-empty')).toBeTruthy();
    expect(byTestId(fixture, 'org-easycla-activity-log-filter-empty')).toBeNull();
  });

  it('renders the error state with a subtitle-driven retry prompt when the read fails', async () => {
    getActivityLog.mockReturnValueOnce(throwError(() => new Error('read failed')));
    const fixture = await render();

    expect(byTestId(fixture, 'org-easycla-activity-log-error-state')).toBeTruthy();
    // Table and Load-more are both suppressed on the error path.
    expect(byTestId(fixture, 'org-easycla-activity-log-table')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-activity-log-load-more')).toBeNull();
  });
});

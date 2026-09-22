// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgClaContributorAcknowledgment, OrgClaContributorAcknowledgmentList, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaContributorAcknowledgmentsComponent } from './org-easycla-contributor-acknowledgments.component';

describe('OrgEasyclaContributorAcknowledgmentsComponent', () => {
  const SELECTED_ACCOUNT = { uid: '0014100000AcmeOrgAAA', accountName: 'Acme' };

  const selectedAccount = signal<{ uid?: string; accountName: string } | null>(null);
  const getContributorAcknowledgments = vi.fn();
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

  function ack(overrides: Partial<OrgClaContributorAcknowledgment> = {}): OrgClaContributorAcknowledgment {
    return {
      signatureId: `ecla-${Math.random().toString(36).slice(2, 8)}`,
      cclaVersion: 'v1',
      approved: true,
      ...overrides,
    };
  }

  function page(rows: OrgClaContributorAcknowledgment[], overrides: Partial<OrgClaContributorAcknowledgmentList> = {}): OrgClaContributorAcknowledgmentList {
    return {
      signatureId: 'signature-uuid-1',
      list: rows,
      canEdit: true,
      resultCount: rows.length,
      totalCount: rows.length,
      nextKey: null,
      ...overrides,
    };
  }

  async function render(row: OrgClaGroup = claGroup()): Promise<ComponentFixture<OrgEasyclaContributorAcknowledgmentsComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaContributorAcknowledgmentsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount } },
        { provide: OrgLensClaService, useValue: { getContributorAcknowledgments } },
        { provide: MessageService, useValue: { add: addMessage } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaContributorAcknowledgmentsComponent);
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
    getContributorAcknowledgments.mockReturnValue(of(page([])));
  });

  /**
   * Load-more merges the fetched next page onto the current view rather than replacing it.
   *
   * This pins a regression: an earlier version of the component read `listSignal() ?? page()`,
   * which returned the first page (still cached in the `toSignal` handle) instead of the merged
   * `page()` set by Load-more. The user pressed Load-more, no new rows appeared, and the tab
   * looked stuck on page one. The `page() ?? listSignal()` order is the fix.
   */
  it('renders the merged rows after Load-more, not just the first page', async () => {
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1', name: 'Ada Lovelace' })], { totalCount: 2, nextKey: 'cursor-2' })));
    const fixture = await render();

    expect(allByTestId(fixture, 'org-easycla-acknowledgment-name').map(textIn)).toEqual(['Ada Lovelace']);
    expect(byTestId(fixture, 'org-easycla-acknowledgments-load-more')).toBeTruthy();

    // Second page arrives via nextKey; the component appends and renders BOTH rows.
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-2', name: 'Grace Hopper' })], { totalCount: 2, nextKey: null })));

    click(fixture, 'org-easycla-acknowledgments-load-more');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(allByTestId(fixture, 'org-easycla-acknowledgment-name').map(textIn)).toEqual(['Ada Lovelace', 'Grace Hopper']);
    // The producer's nextKey came back null on page 2, so Load-more retires.
    expect(byTestId(fixture, 'org-easycla-acknowledgments-load-more')).toBeNull();
  });

  it('shows the no-match row when a search returns nothing, not the empty-agreement copy', async () => {
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1', name: 'Ada Lovelace' })])));
    const fixture = await render();

    getContributorAcknowledgments.mockReturnValueOnce(of(page([])));
    const search = fixture.componentInstance as unknown as { filterForm: { controls: { search: { setValue: (value: string) => void } } } };
    search.filterForm.controls.search.setValue('nobody');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('lfx-empty-state')).toBeNull();
    expect(byTestId(fixture, 'org-easycla-acknowledgments-search-empty')?.textContent).toContain('No acknowledgments match your search.');
  });

  // The placeholder disappears as soon as anything is typed, so the label is the only thing
  // naming this field. `[id]` is bound rather than a static attribute precisely so it reaches
  // the native input and not the wrapper's host — and a label that names nothing looks
  // identical in the markup to one that works.
  it('names the search box with a label that resolves to its input', async () => {
    const fixture = await render();
    const label = fixture.nativeElement.querySelector('label[for="org-easycla-acknowledgments-search-input"]') as HTMLLabelElement | null;

    expect(label?.textContent).toContain('Search contributors');
    expect(fixture.nativeElement.querySelectorAll('#org-easycla-acknowledgments-search-input')).toHaveLength(1);
    expect((fixture.nativeElement.querySelector('#org-easycla-acknowledgments-search-input') as HTMLElement).tagName).toBe('INPUT');
  });

  /**
   * The identity column falls through: LF Login → GitHub username → GitLab username → email →
   * em-dash. A row with no LF Login but any downstream identifier must render, or an
   * unaffiliated contributor disappears from the list.
   */
  describe('the identity fallback', () => {
    it('renders the LF Login when present', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ lfLogin: 'jsmith', githubUsername: 'jsmith-gh' })])));
      const fixture = await render();

      expect(textIn(byTestId(fixture, 'org-easycla-acknowledgment-identity'))).toBe('jsmith');
    });

    it('falls through to GitHub when LF Login is absent, so a GitHub-only contributor still renders', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ githubUsername: 'gh-only' })])));
      const fixture = await render();

      const identity = byTestId(fixture, 'org-easycla-acknowledgment-identity');
      expect(textIn(identity)).toBe('@gh-only');
      // Rendered as a link to github.com, matching the mutable-login display posture (never as
      // a stable identifier).
      expect(identity?.getAttribute('href')).toBe('https://github.com/gh-only');
    });

    it('falls through to GitLab when LF Login and GitHub are both absent', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ gitlabUsername: 'gl-only' })])));
      const fixture = await render();

      const identity = byTestId(fixture, 'org-easycla-acknowledgment-identity');
      expect(textIn(identity)).toBe('@gl-only');
      expect(identity?.getAttribute('href')).toBe('https://gitlab.com/gl-only');
    });

    it('falls through to email when no username identifier exists', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ email: 'contributor@example.org' })])));
      const fixture = await render();

      const identity = byTestId(fixture, 'org-easycla-acknowledgment-identity');
      expect(textIn(identity)).toBe('contributor@example.org');
      expect(identity?.getAttribute('href')).toBe('mailto:contributor@example.org');
    });

    it('renders an em-dash for the ID column when the producer sent nothing usable, rather than dropping the row', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ name: 'DocuSign Only' })])));
      const fixture = await render();

      // The row is still rendered — a contributor with only a DocuSign name is a real signature.
      expect(allByTestId(fixture, 'org-easycla-acknowledgment-name').map(textIn)).toEqual(['DocuSign Only']);
      // The identity column carries the em-dash rather than dropping the row.
      expect(textIn(byTestId(fixture, 'org-easycla-acknowledgment-identity'))).toBe('—');
    });
  });

  /**
   * The CCLA version column renders the producer's `signature_version` verbatim (already
   * normalized to a `v`-prefixed string by the mapper). An empty version renders as an em-dash.
   */
  describe('the CCLA version column', () => {
    it('renders a populated version verbatim', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ cclaVersion: 'v2.1' })])));
      const fixture = await render();

      expect(textIn(byTestId(fixture, 'org-easycla-acknowledgment-version'))).toBe('v2.1');
    });

    it('renders an em-dash for an empty version rather than an empty cell', async () => {
      getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ cclaVersion: '' })])));
      const fixture = await render();

      expect(textIn(byTestId(fixture, 'org-easycla-acknowledgment-version'))).toBe('—');
    });
  });

  /**
   * Search is wired to the server: the debounced term is forwarded to the BFF, and a new term
   * resets pagination so the producer's per-term `nextKey` is not reused across terms.
   *
   * The debounce is short (`CLA_GROUP_SEARCH_DEBOUNCE_MS = 250ms`) but real; the test drives it
   * through `vi.useFakeTimers` on the timer clock rather than trusting a wall-clock delay.
   */
  it('forwards the debounced search term to the server, not filtering only in-memory', async () => {
    // The initial fetch resolves the first page. Rendering runs under real timers so the
    // `whenStable` cycle in the `render` helper is honoured. The debounce alone runs under
    // fake timers, matching how the sibling picker's spec drives search: only the debounce
    // itself needs a clock. `useFakeTimers()` (with no options) fakes microtasks alongside
    // `setTimeout`, which the RxJS `asyncScheduler` and Zone.js both require to advance.
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-1' })], { nextKey: 'cursor-2' })));
    const fixture = await render();
    expect(getContributorAcknowledgments.mock.calls.length).toBeGreaterThan(0);

    // Queue the response the search re-fetch should consume, then drive the debounce.
    getContributorAcknowledgments.mockReturnValueOnce(of(page([ack({ signatureId: 'ecla-3' })])));

    vi.useFakeTimers();
    try {
      (fixture.componentInstance as unknown as { filterForm: { controls: { search: { setValue: (v: string) => void } } } }).filterForm.controls.search.setValue(
        'ada'
      );
      await vi.advanceTimersByTimeAsync(600);
      fixture.detectChanges();
    } finally {
      vi.useRealTimers();
    }

    // A search request was issued with the term. The nextKey from the first response is NOT
    // reused, because the producer's cursor is scoped to a term.
    const searchCalls = getContributorAcknowledgments.mock.calls.filter((call) => (call[2]?.search ?? '') === 'ada');
    expect(searchCalls.length).toBeGreaterThan(0);
    for (const call of searchCalls) {
      expect(call[2]?.nextKey).toBeFalsy();
    }
  });

  /**
   * A signed agreement with no acknowledgments yet renders the M3 prototype's empty state, not a
   * table with a header row and an empty body. Parent story #1973 AC4 forbids the smiley icon
   * the prototype used; this pins the title and the subtitle from the aligned copy constant.
   */
  it('shows the empty state on a signed agreement that holds no acknowledgments', async () => {
    getContributorAcknowledgments.mockReturnValueOnce(of(page([])));
    const fixture = await render();

    // The `data-testid` on `<lfx-empty-state>` is dropped by Angular when the host is a custom
    // component whose inputs are signal-based, so match by the title text the constant carries.
    const empty = fixture.nativeElement.querySelector('lfx-empty-state');
    expect(empty).toBeTruthy();
    expect(empty?.textContent).toContain('No contributor acknowledgments yet');
    // The table itself is not rendered when the panel is in the empty state.
    expect(byTestId(fixture, 'org-easycla-acknowledgments-table')).toBeNull();
  });
});

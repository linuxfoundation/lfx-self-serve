// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { Tooltip } from 'primeng/tooltip';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { ProjectContextService } from '@services/project-context.service';
import { ENGAGEMENT_TIERS, MEMBER_360_RENEWAL_RED_DAYS, MEMBER_360_RENEWAL_AMBER_DAYS, MEMBER_360_TIER_TONES } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { member360Fixture } from '../../../../../../e2e/fixtures/mock-data/member-360.mock';
import { SYNTHETIC_ORG_NAME, SYNTHETIC_SECOND_ORG_LEGAL_NAME } from '../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { Member360ResultComponent } from './member-360-result.component';

describe('Member360ResultComponent', () => {
  const context = signal({ slug: 'sample-foundation', name: 'Sample Foundation', uid: 'sample-project' });
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideNoopAnimations(), { provide: ProjectContextService, useValue: { activeContext: context } }],
    })
  );
  afterEach(() => {
    TestBed.resetTestingModule();
    if (vi.isFakeTimers()) vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  function render(envelope = member360Fixture()) {
    const fixture = TestBed.createComponent(Member360ResultComponent);
    for (const [key, value] of Object.entries({ envelope, documentId: 'run-0123456789abcdef01234567' })) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    const query = (id: string): HTMLElement => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
    const names = () =>
      Array.from(fixture.nativeElement.querySelectorAll('[data-testid="member-360-ranking-row"] button') as NodeListOf<HTMLButtonElement>).map((button) =>
        button.textContent?.trim()
      );
    const sort = (key: string) => {
      query(`member-360-sort-${key}`).click();
      fixture.detectChanges();
    };
    return { fixture, component: fixture.componentInstance, query, names, sort };
  }
  it('renders the agent summary first as markdown, preserving its partial-report disclosure', () => {
    const envelope = member360Fixture();
    envelope.summary_markdown = 'Partial report.\n\n## Run findings\n\n**Synthetic evidence** remains incomplete for this project.';
    const view = render(envelope);
    expect(view.query('member-360-result').firstElementChild).toBe(view.query('member-360-run-summary'));
    expect(view.query('member-360-run-summary').textContent).toContain('Partial report.');
    expect(view.query('member-360-run-summary').querySelector('strong')?.textContent).toBe('Synthetic evidence');
  });
  it.each(['absent', '', ' \n '])('omits an %j summary without rendering an empty section', (value) => {
    const envelope = member360Fixture();
    if (value === 'absent') Reflect.deleteProperty(envelope, 'summary_markdown');
    else envelope.summary_markdown = value;
    expect(render(envelope).query('member-360-run-summary')).toBeNull();
  });
  it('presents the used sources in neutral grey rather than success green', () => {
    const view = render();
    const sources = view.query('member-360-sources-used');
    expect(sources.textContent).toBeTruthy();
    expect(sources.classList.contains('text-gray-700')).toBe(true);
    expect(sources.className).not.toContain('emerald');
  });
  it('exposes the shared form route for title-row actions without carrying asset state or stale project', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/documents/member-360/run-0123456789abcdef01234567?project=old&revision=old&tab=old');
    const view = render();
    await view.fixture.whenStable();
    expect(view.component.runRoute()).toEqual(['/project/mktg-os-agents', 'member-360']);
    expect(view.component.projectParams()).toEqual({ project: 'sample-foundation' });
    expect(view.query('member-360-new-run')).toBeNull();
    expect(view.query('member-360-download')).toBeNull();
    expect(view.component.workbookFilename()).toBe(`Member360_${view.component.envelope().project}_${view.component.envelope().period.label}.xlsx`);
  });
  it('loads ranking filters and sort from a shared URL, pushes changes and restores preceding query state', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    const path = '/project/mktg-os-agents/documents/member-360/run-0123456789abcdef01234567';
    await router.navigateByUrl(`${path}?project=sample-foundation&tier=At%20Risk&sort=engagement_score&direction=ascending`);
    const view = render();
    await view.fixture.whenStable();
    expect(view.names()).toEqual([SYNTHETIC_ORG_NAME]);
    expect(view.component.filters.controls.tier.value).toBe('At Risk');
    view.component.filters.controls.owner.setValue('Sales');
    await view.fixture.whenStable();
    expect(router.url).toContain('owner=Sales');
    expect(view.query('member-360-no-matches')).not.toBeNull();
    await router.navigateByUrl(`${path}?project=sample-foundation&tier=At%20Risk&sort=engagement_score&direction=ascending`);
    await view.fixture.whenStable();
    expect(view.component.filters.controls.owner.value).toBe('All');
    expect(view.names()).toEqual([SYNTHETIC_ORG_NAME]);
  });
  it('pushes once for a settled search burst and keeps the same focused input and term on its URL echo', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/documents/member-360/example?project=sample-foundation');
    const view = render();
    await view.fixture.whenStable();
    const input = view.query('member-360-search').querySelector('input');
    if (!input) throw new Error('Expected the ranking search input');
    const writes = vi.spyOn(router, 'navigate');
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    input.focus();
    for (const value of ['S', 'Sy', 'Synthetic']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      view.fixture.detectChanges();
    }
    expect(writes).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    vi.advanceTimersByTime(300);
    await view.fixture.whenStable();
    expect(writes).toHaveBeenCalledOnce();
    expect(writes).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { project: 'sample-foundation', search: 'Synthetic' } }));
    expect(input.value).toBe('Synthetic');
    expect(document.activeElement).toBe(input);
    expect(view.query('member-360-search').querySelector('input')).toBe(input);
  });
  it('keeps newer typing, focus and caret while a prior settled term finishes navigating', async () => {
    const router = TestBed.inject(Router);
    let held = false;
    let release: () => void = () => undefined;
    router.resetConfig([
      {
        path: '**',
        children: [],
        runGuardsAndResolvers: 'paramsOrQueryParamsChange',
        canActivate: [
          () => {
            if (router.getCurrentNavigation()?.extractedUrl.queryParams['search'] !== 'Sy') return true;
            held = true;
            return new Promise<boolean>((resolve) => {
              release = () => resolve(true);
            });
          },
        ],
      },
    ]);
    await router.navigateByUrl('/project/mktg-os-agents/documents/member-360/example?project=sample-foundation');
    const view = render();
    await view.fixture.whenStable();
    const input = view.query('member-360-search').querySelector('input');
    if (!input) throw new Error('Expected the ranking search input');
    const writes = vi.spyOn(router, 'navigate');
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    input.focus();
    input.value = 'Sy';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    await vi.waitFor(() => expect(held).toBe(true));
    expect(writes).toHaveBeenCalledOnce();
    input.value = 'Synthetic';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.setSelectionRange(3, 7);
    release();
    await view.fixture.whenStable();
    expect(new URL(router.url, 'https://app.example.test').searchParams.get('search')).toBe('Sy');
    expect(input.value).toBe('Synthetic');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7]);
    vi.advanceTimersByTime(300);
    await view.fixture.whenStable();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(new URL(router.url, 'https://app.example.test').searchParams.get('search')).toBe('Synthetic');
  });
  it('pushes a retyped term after Back within the debounce window and clears equal-term pending state', async () => {
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    const path = '/project/mktg-os-agents/documents/member-360/example?project=sample-foundation';
    await router.navigateByUrl(path);
    const view = render();
    await view.fixture.whenStable();
    const input = view.query('member-360-search').querySelector('input');
    if (!input) throw new Error('Expected the ranking search input');
    const writes = vi.spyOn(router, 'navigate');
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    input.value = 'Synthetic';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    await view.fixture.whenStable();
    expect(writes).toHaveBeenCalledOnce();
    const beforeBack = Date.now();
    location.back();
    await vi.waitFor(() => expect(router.url).toBe(path));
    await view.fixture.whenStable();
    expect(Date.now() - beforeBack).toBeLessThan(300);
    expect(input.value).toBe('');
    // Retype before the restored empty value can settle for 300 ms.
    input.value = 'Synthetic';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    await view.fixture.whenStable();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(new URL(router.url, 'https://app.example.test').searchParams.get('search')).toBe('Synthetic');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(300);
    await view.fixture.whenStable();
    expect(writes).toHaveBeenCalledTimes(2);
    await router.navigateByUrl(`${path}&search=Other`);
    await view.fixture.whenStable();
    expect(input.value).toBe('Other');
  });
  it('clears default sort/filter params and retains unrelated document state', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl(
      '/project/mktg-os-agents/documents/member-360/example?project=sample-foundation&revision=retained&profile=edit&tier=At%20Risk&sort=engagement_score&direction=ascending'
    );
    const view = render();
    await view.fixture.whenStable();
    view.sort('engagement_score');
    await view.fixture.whenStable();
    expect(router.url).not.toContain('sort=');
    expect(router.url).not.toContain('direction=');
    view.component.filters.controls.tier.setValue('All');
    await view.fixture.whenStable();
    expect(router.url).not.toContain('tier=');
    expect(router.url).toContain('revision=retained');
    expect(router.url).toContain('profile=edit');
  });
  it('shows an em dash for an empty score range', () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking = [];
    expect(render(envelope).query('member-360-summary-scores').querySelector('b')?.textContent?.trim()).toBe('—');
  });
  it('expands only one duplicate-name row and preserves its identity when sorting', () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[1].member_organization = envelope.tabs.member_ranking[0].member_organization;
    const view = render(envelope);
    const buttons = view.fixture.nativeElement.querySelectorAll('[data-testid="member-360-ranking-row"] button') as NodeListOf<HTMLButtonElement>;
    expect(buttons[0].getAttribute('aria-controls')).not.toBe(buttons[1].getAttribute('aria-controls'));
    buttons[0].click();
    view.fixture.detectChanges();
    expect(view.fixture.nativeElement.querySelectorAll('[data-testid="member-360-row-detail"]')).toHaveLength(1);
    const id = view.query('member-360-row-detail').id;
    view.sort('engagement_score');
    expect(view.query('member-360-row-detail').id).toBe(id);
  });
  it('formats date-only run and window fields in UTC', () => {
    const envelope = member360Fixture();
    envelope.run_date = envelope.period.window_start = envelope.period.window_end = '2026-10-01';
    expect(render(envelope).query('member-360-result-header').textContent).toContain('Run 1 Oct 2026 · window Oct 2026 to');
  });
  it('shows the written calendar day for evidence dates, the method window and due days in every time zone', () => {
    const envelope = member360Fixture();
    envelope.tabs.evidence[0].date = '2026-10-01';
    envelope.tabs.method.analysis_window = { start: '2025-10-01', end: '2026-10-01' };
    envelope.tabs.actions_by_team[0].suggested_deadline = '2026-11-01';
    const view = render(envelope);
    // Pinned through the same UTC branch as the header: 1 Oct never becomes 30 Sep west of UTC.
    expect(view.query('member-360-method-window').textContent?.replace(/\s+/g, ' ')).toContain('Window 1 Oct 2025 – 1 Oct 2026');
    expect(view.query('member-360-evidence').textContent).toContain('1 Oct 2026');
    expect(view.query('member-360-actions').textContent).toContain('1 Nov');
    expect(view.query('member-360-actions').textContent).not.toContain('31 Oct');
  });
  it('defaults to descending score and sorts by score, priority and tier', () => {
    const view = render();
    expect(view.names()).toEqual([SYNTHETIC_SECOND_ORG_LEGAL_NAME, SYNTHETIC_ORG_NAME]);
    view.sort('engagement_score');
    expect(view.names()[0]).toBe(SYNTHETIC_ORG_NAME);
    view.sort('priority');
    expect(view.names()[0]).toBe(SYNTHETIC_ORG_NAME);
    view.sort('engagement_tier');
    expect(view.names()[0]).toBe(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
  });
  it('combines reactive tier/owner/search filters and exposes no matches', () => {
    const view = render();
    view.component.filters.controls.tier.setValue('At Risk');
    view.fixture.detectChanges();
    expect(view.names()).toEqual([SYNTHETIC_ORG_NAME]);
    view.component.filters.controls.owner.setValue('Sales');
    view.fixture.detectChanges();
    expect(view.query('member-360-no-matches').textContent).toContain('No members match');
    view.component.filters.reset();
    view.component.filters.controls.search.setValue(SYNTHETIC_SECOND_ORG_LEGAL_NAME.toUpperCase());
    view.fixture.detectChanges();
    expect(view.names()).toEqual([SYNTHETIC_SECOND_ORG_LEGAL_NAME]);
  });
  it('selects All as a real value and keeps disclosures closed with singular counts', () => {
    const view = render();
    expect(view.component.filters.controls.tier.value).toBe('All');
    expect(view.component.filters.controls.owner.value).toBe('All');
    for (const id of ['member-360-tier', 'member-360-owner']) expect(view.query(id).textContent?.trim()).toBe('All');
    for (const section of ['evidence', 'method']) {
      expect(view.query(`member-360-${section}`).hasAttribute('open')).toBe(false);
      expect(view.query(`member-360-${section}-toggle`).textContent?.trim()).toBe(section === 'evidence' ? 'Evidence' : 'Method');
    }
    expect(view.query('member-360-actions').textContent).toContain('Member Success · 1 action');
    expect(view.query('member-360-actions').textContent).not.toContain('1 actions');
    expect(view.query('member-360-evidence').textContent).toContain('1 row this run.');
  });
  it('ignores stray trend glyphs when no prior run was provided', () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[1].trend = '▼';
    const view = render(envelope);
    expect(view.query('member-360-trend').textContent?.trim()).toBe('—');
    expect(view.query('member-360-trend').getAttribute('data-trend')).toBe('none');
    expect(view.query('member-360-trend').getAttribute('aria-label')).toBe('no trend');
  });
  it('uses only contract-provided mover deltas and never invents zero for other members', () => {
    const envelope = member360Fixture();
    envelope.inputs.prior_run_provided = true;
    envelope.tabs.member_ranking[0].trend = '▼';
    envelope.tabs.member_ranking[1].trend = '▲';
    envelope.tabs.summary.movers = { gainers: [], decliners: [{ member_organization: SYNTHETIC_ORG_NAME, delta: -11 }] };
    const view = render(envelope);
    expect(view.query('member-360-trend').textContent?.trim()).toBe('▲');
    view.sort('engagement_score');
    expect(view.query('member-360-trend').textContent?.trim()).toBe('▼ 11');
    envelope.tabs.member_ranking[0].trend = null;
    view.fixture.componentRef.setInput('envelope', { ...envelope });
    view.fixture.detectChanges();
    expect(view.query('member-360-trend').textContent?.trim()).toBe('—');
    expect(view.query('member-360-trend').getAttribute('aria-label')).toBe('no trend');
  });
  it('keeps unknown renewals last in either direction and includes the red-window boundary in the header', () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[0].days_to_renewal = null;
    envelope.tabs.member_ranking[1].days_to_renewal = MEMBER_360_RENEWAL_RED_DAYS;
    const view = render(envelope);
    view.sort('days_to_renewal');
    expect(view.names()[0]).toBe(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
    view.sort('days_to_renewal');
    expect(view.names()[0]).toBe(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
    expect(view.query('member-360-summary-renewals').querySelector('b')?.textContent?.trim()).toBe('1');
    expect(view.query('member-360-summary-renewals').textContent).toContain(`Renewals within ${MEMBER_360_RENEWAL_RED_DAYS} days`);
    expect(view.query('member-360-ranking').textContent).toContain('Unknown');
    expect(view.query('member-360-ranking').querySelector('[role="img"]')?.getAttribute('tabindex')).toBe('0');
  });
  it.each([
    { values: [null], note: 'No list-price value for this renewal' },
    { values: [null, null], note: 'No list-price value for these 2 renewals' },
    { values: [25000, null], note: '$25,000 known at list price · 1 without a value' },
    { values: [25000, null, null], note: '$25,000 known at list price · 2 without a value' },
    { values: [25000, 15000], note: '$40,000 at list price' },
    { values: [0], note: '$0 at list price' },
    { values: [0, null], note: '$0 known at list price · 1 without a value' },
    { values: [], note: `No renewals within ${MEMBER_360_RENEWAL_RED_DAYS} days` },
  ])('shows renewal value coverage for $values', ({ values, note }) => {
    const envelope = member360Fixture();
    const row = envelope.tabs.member_ranking[0];
    envelope.tabs.member_ranking = values.map((annualValue, index) => ({ ...row, annual_value: annualValue, days_to_renewal: index === 0 ? 0 : 120 }));
    const card = render(envelope).query('member-360-summary-renewals');
    expect(card.querySelector('b')?.textContent?.trim()).toBe(String(values.length));
    expect(card.querySelector('span:last-child')?.textContent?.trim()).toBe(note);
    if (values.length > 0 && values.every((value) => value === null)) expect(card.textContent).not.toContain('$0');
  });
  it('excludes unknown, overdue and later renewals from both the subtotal and missing-value count', () => {
    const envelope = member360Fixture();
    const row = envelope.tabs.member_ranking[0];
    envelope.tabs.member_ranking = [
      { ...row, annual_value: 25000, days_to_renewal: 120 },
      ...[null, -1, 121].flatMap((daysToRenewal) => [
        { ...row, annual_value: null, days_to_renewal: daysToRenewal },
        { ...row, annual_value: 90000, days_to_renewal: daysToRenewal },
      ]),
    ];
    const card = render(envelope).query('member-360-summary-renewals');
    expect(card.querySelector('b')?.textContent?.trim()).toBe('1');
    expect(card.querySelector('span:last-child')?.textContent?.trim()).toBe('$25,000 at list price');
  });
  it.each([
    { days: null, classes: 'text-gray-500' },
    { days: MEMBER_360_RENEWAL_RED_DAYS, classes: 'font-bold text-red-700' },
    { days: MEMBER_360_RENEWAL_RED_DAYS + 1, classes: 'font-semibold text-amber-700' },
    { days: MEMBER_360_RENEWAL_AMBER_DAYS, classes: 'font-semibold text-amber-700' },
    { days: MEMBER_360_RENEWAL_AMBER_DAYS + 1, classes: 'text-gray-700' },
  ])('uses the workbook renewal colours for $days days', ({ days, classes }) => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking = [{ ...envelope.tabs.member_ranking[0], days_to_renewal: days }];
    const view = render(envelope);
    const cell = Array.from(view.query('member-360-ranking-row').querySelectorAll('td')).find(
      (entry) => entry.textContent?.trim() === (days === null ? 'Unknown' : `${days} days`)
    );
    expect(cell).toBeDefined();
    for (const name of classes.split(' ')) expect(cell?.classList.contains(name)).toBe(true);
    expect(view.query('member-360-ranking').textContent).toContain(
      `red ≤${MEMBER_360_RENEWAL_RED_DAYS}, amber ${MEMBER_360_RENEWAL_RED_DAYS + 1}–${MEMBER_360_RENEWAL_AMBER_DAYS}.`
    );
  });
  it.each(ENGAGEMENT_TIERS)('keeps the exact badge classes for shared tier %s', (tier) => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking = [{ ...envelope.tabs.member_ranking[0], engagement_tier: tier }];
    const view = render(envelope);
    const badge = Array.from(view.query('member-360-ranking-row').querySelectorAll('span')).find((entry) => entry.textContent?.trim() === tier);
    const classes = {
      emerald: 'bg-emerald-50 text-emerald-800',
      amber: 'bg-amber-50 text-amber-800',
      red: 'bg-red-50 text-red-800',
    };
    for (const name of classes[MEMBER_360_TIER_TONES[tier]].split(' ')) expect(badge?.classList.contains(name)).toBe(true);
  });
  it('shows escaped heat tooltips on the body for focus and hover, and dismisses them with Escape', async () => {
    const view = render();
    const cell = view.fixture.debugElement.query(By.css('[role="img"][data-testid^="member-360-heat-"]'));
    const element: HTMLElement = cell.nativeElement;
    const tooltip = cell.injector.get(Tooltip);
    expect(tooltip.appendTo()).toBe('body');
    expect(tooltip.tooltipEvent).toBe('both');
    expect(tooltip.escape).toBe(true);
    expect(element.getAttribute('tabindex')).toBe('0');
    expect(element.querySelector('span')).toBeNull();
    element.focus();
    await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(element.getAttribute('aria-label')));
    expect(document.querySelector('[role="tooltip"]')?.parentElement).toBe(document.body);
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
    element.blur();
    element.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(element.getAttribute('aria-label')));
    element.dispatchEvent(new MouseEvent('mouseleave'));
    await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
  });
  it('presents legacy source labels and Method statuses in plain English without mutating the envelope', () => {
    const envelope = member360Fixture();
    envelope.tabs.summary.data_coverage.sources_used = ['LFX Platform'];
    envelope.tabs.summary.data_coverage.sources_unavailable = ['CRM (not wired)', 'Web research'];
    envelope.tabs.method.data_sources[0] = { source: 'lfx_platform', label: 'LFX Platform', status: 'used' };
    envelope.tabs.method.data_sources[1] = { source: 'uploaded_trackers', label: 'Trackers', status: 'unavailable' };
    envelope.tabs.method.data_sources[2] = { source: 'hubspot', label: 'CRM', status: 'not_wired' };
    const original = JSON.stringify(envelope);
    const view = render(envelope);
    expect(view.query('member-360-result').textContent).toContain('CRM (not connected yet), Web research');
    const sourceText = (source: string) =>
      Array.from(view.query(`member-360-source-${source}`).querySelectorAll('td'))
        .map((cell) => cell.textContent?.trim())
        .filter(Boolean)
        .join(' ');
    expect(sourceText('lfx_platform')).toBe('LFX Platform: used');
    expect(sourceText('uploaded_trackers')).toBe('Trackers: unavailable');
    expect(sourceText('hubspot')).toBe('CRM: not connected yet');
    expect(view.query('member-360-result').textContent).not.toMatch(/not wired|not_wired/);
    expect(JSON.stringify(envelope)).toBe(original);
  });
  it('copies team actions and reports clipboard denial', async () => {
    const view = render();
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      await view.component['copyTeam']('Member Success');
      view.fixture.detectChanges();
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining(SYNTHETIC_ORG_NAME));
      expect(view.query('member-360-notice').textContent).toContain('list copied');
      writeText.mockRejectedValueOnce(new Error('clipboard denied'));
      await view.component['copyTeam']('Member Success');
      view.fixture.detectChanges();
      expect(view.query('member-360-notice').textContent).toContain('Copy failed');
    } finally {
      if (previous) Object.defineProperty(navigator, 'clipboard', previous);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
  it('orders each team High first, folds it to three rows and drops the repeated team label', () => {
    const envelope = member360Fixture();
    const template = envelope.tabs.actions_by_team[0];
    envelope.tabs.actions_by_team = ['Low', 'Medium', 'High', 'High', 'Medium'].map((priority, index) => ({
      ...template,
      owner: 'Marketing',
      priority: priority as typeof template.priority,
      member_organization: `Org ${index}`,
      recommended_action: `Marketing: invite org ${index} to speak.`,
      suggested_deadline: `2026-11-2${index}`,
    }));
    const view = render(envelope);
    const team = view.query('member-360-team-marketing');
    const rows = () => Array.from(team.querySelectorAll('[data-testid="member-360-action-row"]')).map((row) => row.textContent?.replace(/\s+/g, ' ').trim());
    expect(team.textContent).toContain('Marketing · 5 actions');
    expect(
      Array.from(view.query('member-360-team-summary-marketing').querySelectorAll('span'))
        .map((span) => span.textContent?.trim())
        .join(' ')
    ).toBe('2 High 2 Medium 1 Low Next due 20 Nov');
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toContain('Org 2');
    expect(rows()[0]).toContain('Due 22 Nov');
    expect(rows()[0]).toContain('Invite org 2 to speak.');
    expect(team.textContent).not.toContain('Marketing: invite');
    const toggle = view.query('member-360-show-all-marketing');
    expect(toggle.textContent?.trim()).toBe('Show all 5 actions');
    toggle.click();
    view.fixture.detectChanges();
    expect(rows()).toHaveLength(5);
    expect(rows()[4]).toContain('Org 0');
    expect(toggle.textContent?.trim()).toBe('Show fewer');
    expect(view.query('member-360-team-sales').textContent).toContain('No actions for this team.');
  });
  it('groups evidence by category and shows method weights, peer medians and run times', () => {
    const view = render();
    const envelope = view.component.envelope();
    expect(view.query('member-360-evidence').querySelectorAll('[data-testid^="member-360-evidence-group-"]')).toHaveLength(
      new Set(envelope.tabs.evidence.map((row) => row.category)).size
    );
    expect(view.query('member-360-baselines').textContent).not.toContain('{');
    expect(view.query('member-360-method').textContent).not.toMatch(/merged: (true|false)/);
    view.fixture.componentRef.setInput('history', [
      { documentId: 'run-0123456789abcdef01234567', createdAt: '2026-11-09T21:09:00Z', updatedAt: '2026-11-09T21:09:00Z' },
      { documentId: 'run-older', createdAt: '2026-11-09T20:33:00Z', updatedAt: '2026-11-09T20:33:00Z' },
    ]);
    view.fixture.detectChanges();
    expect(view.query('member-360-history-row-run-0123456789abcdef01234567').textContent).toContain('Q4 2026 ·');
    expect(view.query('member-360-history-row-run-older').textContent).toMatch(/\d{1,2} Nov, \d{2}:\d{2}/);
    expect(view.query('member-360-history-open-run-older')).not.toBeNull();
  });
  it('leaves workbook export to the document header', () => {
    expect(render().fixture.nativeElement.querySelector('[data-testid="member-360-download"]')).toBeNull();
  });
});

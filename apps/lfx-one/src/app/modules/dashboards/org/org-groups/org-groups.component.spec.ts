// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import type { Account, OrgDropdownOption, OrgLensGroupSummary, OrgLensGroupsResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensGroupsService } from '@services/org-lens-groups.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { signal, type WritableSignal } from '@angular/core';

import { OrgGroupsComponent } from './org-groups.component';

interface RenderOptions {
  accountName?: string;
  orgNavigationLoaded?: boolean;
  getGroups?: () => ReturnType<OrgLensGroupsService['getGroups']>;
  queryParams?: Record<string, string>;
}

interface Rendered {
  fixture: ComponentFixture<OrgGroupsComponent>;
  navigate: ReturnType<typeof vi.fn>;
  selectedAccount: WritableSignal<Account>;
}

async function render(options: RenderOptions = {}): Promise<Rendered> {
  const { accountName = 'Acme Motors, Inc.', orgNavigationLoaded = true, getGroups = () => of(emptyGroupsResponse()), queryParams = {} } = options;

  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName, accountSlug: 'acme', membershipTier: '', uid: 'org-uid-1' });

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [OrgGroupsComponent],
    providers: [
      {
        provide: AccountContextService,
        useValue: { selectedAccount, hasOrgSelectorAccess: signal(true) },
      },
      { provide: OrgNavigationService, useValue: { loaded: signal(orgNavigationLoaded) } },
      { provide: OrgRoleGrantsService, useValue: { loaded: signal(true) } },
      { provide: PersonaService, useValue: { personaLoaded: signal(true) } },
      { provide: OrgLensGroupsService, useValue: { getGroups } },
      // Real Router (via provideRouter) so the rendered group rows' [routerLink] (createUrlTree, etc.)
      // keeps working; only `navigate` — the method the URL-sync subscription actually calls — is spied on.
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: convertToParamMap(queryParams), queryParams },
        },
      },
    ],
  }).compileComponents();

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

  const fixture = TestBed.createComponent(OrgGroupsComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, navigate, selectedAccount };
}

function emptyGroupsResponse(): OrgLensGroupsResponse {
  return { groups: [], total_groups: 0, total_seats: 0 };
}

/** Server-sorted (seat count desc, then name asc) — the component never re-sorts, so fixtures already reflect that order. */
function buildGroups(): OrgLensGroupSummary[] {
  return [
    { uid: 'g1', name: 'Committee Steering TAG', category: 'TSC', project_uid: 'p-cncf', project_slug: 'cncf', project_name: 'CNCF', org_seat_count: 10 },
    { uid: 'g2', name: 'Zephyr Working Group', category: 'Working Group', project_uid: 'p-zephyr', project_slug: 'zephyr-project', org_seat_count: 5 },
    {
      uid: 'g3',
      name: 'Ambassador Program',
      category: 'Ambassador',
      project_uid: 'p-ossf',
      project_slug: 'openssf',
      project_name: 'OpenSSF',
      org_seat_count: 3,
    },
    { uid: 'g4', name: 'Committee Newsletter', category: 'Newsletter', project_uid: 'p-cncf', project_slug: 'cncf', project_name: 'CNCF', org_seat_count: 1 },
  ];
}

function groupsResponse(groups: OrgLensGroupSummary[]): OrgLensGroupsResponse {
  return { groups, total_groups: groups.length, total_seats: groups.reduce((sum, g) => sum + g.org_seat_count, 0) };
}

function listSkeletonRows(fixture: ComponentFixture<OrgGroupsComponent>): NodeListOf<Element> {
  return fixture.nativeElement.querySelectorAll('[data-testid="org-groups-list-skeleton-row"]');
}

function statSkeletonCards(fixture: ComponentFixture<OrgGroupsComponent>): NodeListOf<Element> {
  return fixture.nativeElement.querySelectorAll('[data-testid="org-groups-stat-skeleton-card"]');
}

function has(fixture: ComponentFixture<OrgGroupsComponent>, testid: string): boolean {
  return !!fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
}

/** The row-link testid ('org-groups-row-link-<uid>') is deliberately not a prefix-extension of the
 *  row container's ('org-groups-item-<uid>') — the latter also prefixes the per-row -name/-project/-seats
 *  sub-testids, so it can't be used for a `^=` row count without over-matching. */
function renderedItemUids(fixture: ComponentFixture<OrgGroupsComponent>): string[] {
  return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="org-groups-row-link-"]')).map((el) =>
    (el as HTMLElement).getAttribute('data-testid')!.replace('org-groups-row-link-', '')
  );
}

/** filterForm/typeOptions are `protected` — reach in via a narrow cast, mirroring the repo's existing spec convention (see brand-kit-form.component.spec.ts). */
function filterForm(fixture: ComponentFixture<OrgGroupsComponent>): {
  get(key: string): { setValue(v: string): void } | null;
  reset(v: Record<string, string>): void;
} {
  return (
    fixture.componentInstance as unknown as {
      filterForm: { get(key: string): { setValue(v: string): void } | null; reset(v: Record<string, string>): void };
    }
  ).filterForm;
}

function typeOptions(fixture: ComponentFixture<OrgGroupsComponent>): OrgDropdownOption[] {
  return (fixture.componentInstance as unknown as { typeOptions: () => OrgDropdownOption[] }).typeOptions();
}

function foundationOptions(fixture: ComponentFixture<OrgGroupsComponent>): OrgDropdownOption[] {
  return (fixture.componentInstance as unknown as { foundationOptions: () => OrgDropdownOption[] }).foundationOptions();
}

/** Lets the real `debounceTime(150)` on the filter form settle, then flushes change detection. */
async function flushFilterChange(fixture: ComponentFixture<OrgGroupsComponent>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('OrgGroupsComponent', () => {
  it('renders the same skeleton shape for the initial page load and the group-fetch loading state', async () => {
    // !loaded() branch — org navigation hasn't resolved yet.
    const { fixture: initialLoad } = await render({ orgNavigationLoaded: false });
    expect(has(initialLoad, 'org-groups-skeleton')).toBe(true);
    expect(has(initialLoad, 'org-groups-stat-strip')).toBe(false);
    expect(has(initialLoad, 'org-groups-list-loading')).toBe(true);
    expect(has(initialLoad, 'org-groups-list')).toBe(false);
    expect(statSkeletonCards(initialLoad).length).toBe(4);
    expect(listSkeletonRows(initialLoad).length).toBe(5);

    // groupsLoading() branch — page loaded, but the group fetch never resolves.
    const { fixture: groupsFetching } = await render({ getGroups: () => new Subject<OrgLensGroupsResponse>() });
    expect(has(groupsFetching, 'org-groups-stat-strip')).toBe(true);
    expect(has(groupsFetching, 'org-groups-skeleton')).toBe(false);
    expect(has(groupsFetching, 'org-groups-list')).toBe(true);
    expect(has(groupsFetching, 'org-groups-list-loading')).toBe(false);
    expect(has(groupsFetching, 'org-groups-stat-total')).toBe(false);
    expect(statSkeletonCards(groupsFetching).length).toBe(4);
    expect(listSkeletonRows(groupsFetching).length).toBe(5);
  });

  it('renders the populated stat strip and group list once data arrives', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    expect(fixture.nativeElement.querySelector('[data-testid="org-groups-stat-total"]')?.textContent).toContain('4');
    expect(fixture.nativeElement.querySelector('[data-testid="org-groups-stat-seats"]')?.textContent).toContain('19');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="org-groups-list-items"] > div').length).toBe(4);
    expect(fixture.nativeElement.querySelector('[data-testid="org-groups-skeleton"]')).toBeNull();
  });

  it('includes the selected account name in the H1, separated by a dash', async () => {
    const { fixture } = await render({ accountName: 'Acme Motors, Inc.' });

    const title = fixture.nativeElement.querySelector('[data-testid="org-groups-title"]');

    expect(title?.textContent?.trim()).toBe('Groups — Acme Motors, Inc.');
  });

  it('omits the dash from the H1 when no account name is selected', async () => {
    const { fixture } = await render({ accountName: '' });

    const title = fixture.nativeElement.querySelector('[data-testid="org-groups-title"]');

    expect(title?.textContent?.trim()).toBe('Groups');
  });

  it('derives the roster-empty copy from COMMITTEE_LABEL rather than a hardcoded literal', async () => {
    const { fixture } = await render({ getGroups: () => of(emptyGroupsResponse()) });

    const emptyState = fixture.nativeElement.querySelector('[data-testid="org-groups-empty-state"]');

    expect(emptyState?.textContent).toContain(`No ${COMMITTEE_LABEL.singular.toLowerCase()} participation found.`);
    expect(emptyState?.textContent).toContain(`any ${COMMITTEE_LABEL.plural.toLowerCase()}.`);
  });

  it('renders the fetchError subtitle now that the empty-state input mismatch is fixed', async () => {
    const { fixture } = await render({ getGroups: () => throwError(() => new Error('boom')) });

    const errorState = fixture.nativeElement.querySelector('[data-testid="org-groups-error-state"]');

    expect(errorState?.textContent).toContain('Something went wrong while fetching group data. Please try refreshing the page.');
  });

  it('search matches on group name and on foundation name', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    filterForm(fixture).get('search')?.setValue('zephyr');
    await flushFilterChange(fixture);

    // 'zephyr' only appears in g2's NAME, not any foundation label.
    expect(renderedItemUids(fixture)).toEqual(['g2']);

    filterForm(fixture).get('search')?.setValue('cncf');
    await flushFilterChange(fixture);

    // 'cncf' appears only in g1/g4's FOUNDATION name ("CNCF"), not in either group's name.
    expect(renderedItemUids(fixture)).toEqual(['g1', 'g4']);
  });

  it('composes search, foundation, and type filters with AND', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    // 'committee' matches g1 + g4 by name; foundation slug 'cncf' also matches g1 + g4;
    // type 'special-interest-group' narrows to g4 alone (g1 is oversight-committee).
    filterForm(fixture).get('search')?.setValue('committee');
    filterForm(fixture).get('foundation')?.setValue('cncf');
    filterForm(fixture).get('type')?.setValue('special-interest-group');
    await flushFilterChange(fixture);

    expect(renderedItemUids(fixture)).toEqual(['g4']);
  });

  it('excludes zero-count classes from type options and shows correct counts for present ones', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    const options = typeOptions(fixture);
    const labels = options.map((o) => o.label);

    // No governing-board or "other" groups in the fixture — must not appear.
    expect(labels.some((l) => l.startsWith('Boards'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Other'))).toBe(false);

    expect(labels).toContain('All types');
    expect(labels).toContain('Oversight (1)');
    expect(labels).toContain('Working Groups (1)');
    expect(labels).toContain('Ambassadors (1)');
    expect(labels).toContain('SIGs (1)');
  });

  it('keys foundation options on project_slug (a stable identity) with the resolved name as the label', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    const options = foundationOptions(fixture);

    expect(options).toContainEqual({ label: 'All foundations', value: '' });
    expect(options).toContainEqual({ label: 'CNCF', value: 'cncf' });
    expect(options).toContainEqual({ label: 'OpenSSF', value: 'openssf' });
    // g2 has no project_name — falls back to the slug for both label and value.
    expect(options).toContainEqual({ label: 'zephyr-project', value: 'zephyr-project' });
    // g1 and g4 share the 'cncf' slug — must appear once, not twice.
    expect(options.filter((o) => o.value === 'cncf')).toHaveLength(1);
  });

  it('lets a resolved name win the shared label even when the unenriched sibling sorts first', async () => {
    // Server sort is seat-count desc, so the UNENRICHED group of this foundation sorts ahead of the
    // enriched one — exactly the ordering that would leak the raw slug if label selection depended on
    // iteration order instead of "does this group have a project_name".
    const groups: OrgLensGroupSummary[] = [
      { uid: 'h1', name: 'Big Unenriched Group', category: 'TSC', project_uid: 'p-x', project_slug: 'x-project', org_seat_count: 10 },
      {
        uid: 'h2',
        name: 'Small Enriched Group',
        category: 'Ambassador',
        project_uid: 'p-x',
        project_slug: 'x-project',
        project_name: 'X Project',
        org_seat_count: 1,
      },
    ];
    const { fixture } = await render({ getGroups: () => of(groupsResponse(groups)) });

    expect(foundationOptions(fixture)).toContainEqual({ label: 'X Project', value: 'x-project' });

    // Search by the resolved name must also match the unenriched sibling, not just the enriched group.
    filterForm(fixture).get('search')?.setValue('X Project');
    await flushFilterChange(fixture);
    expect(renderedItemUids(fixture)).toEqual(['h1', 'h2']);
  });

  it('also matches search on the raw slug, as a convenience for a search term that is the technical slug', async () => {
    const groups: OrgLensGroupSummary[] = [
      { uid: 'h1', name: 'Group One', category: 'TSC', project_uid: 'p-x', project_slug: 'x-project', project_name: 'X Project', org_seat_count: 1 },
    ];
    const { fixture } = await render({ getGroups: () => of(groupsResponse(groups)) });

    // 'x-project' appears only in the slug — not in the name or the resolved label ("X Project").
    filterForm(fixture).get('search')?.setValue('x-project');
    await flushFilterChange(fixture);

    expect(renderedItemUids(fixture)).toEqual(['h1']);
  });

  it('renders filtered-empty copy distinct from roster-empty copy when a filter matches nothing', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    filterForm(fixture).get('search')?.setValue('no-such-group-xyz');
    await flushFilterChange(fixture);

    const filteredEmpty = fixture.nativeElement.querySelector('[data-testid="org-groups-filtered-empty-state"]');
    const rosterEmpty = fixture.nativeElement.querySelector('[data-testid="org-groups-empty-state"]');

    expect(filteredEmpty).toBeTruthy();
    expect(rosterEmpty).toBeFalsy();
    expect(filteredEmpty?.textContent).toContain(`No ${COMMITTEE_LABEL.plural.toLowerCase()} match the current filters`);
    expect(filteredEmpty?.textContent).not.toContain('participation found');
  });

  it('hides the filter bar while the roster is empty or still loading', async () => {
    const { fixture: emptyRoster } = await render({ getGroups: () => of(emptyGroupsResponse()) });
    expect(emptyRoster.nativeElement.querySelector('[data-testid="org-groups-filter-bar"]')).toBeFalsy();

    const { fixture: stillLoading } = await render({ getGroups: () => new Subject<OrgLensGroupsResponse>() });
    expect(stillLoading.nativeElement.querySelector('[data-testid="org-groups-filter-bar"]')).toBeFalsy();

    const { fixture: loaded } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });
    expect(loaded.nativeElement.querySelector('[data-testid="org-groups-filter-bar"]')).toBeTruthy();
  });

  it('keeps a URL-seeded filter on first render (does not clear it as if the org just switched)', async () => {
    const { fixture } = await render({
      getGroups: () => of(groupsResponse(buildGroups())),
      queryParams: { q: 'zephyr' },
    });
    // Flush the same real-time debounce window an org-switch reset would go through — without this,
    // the assertion would pass whether or not the skip(1) guard actually protects the seeded value.
    await flushFilterChange(fixture);

    expect(renderedItemUids(fixture)).toEqual(['g2']);
  });

  it('clears the filter form when the selected org actually switches', async () => {
    const { fixture, selectedAccount } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    filterForm(fixture).get('search')?.setValue('zephyr');
    await flushFilterChange(fixture);
    expect(renderedItemUids(fixture)).toEqual(['g2']);

    // clearFilters() resets the form synchronously, but filteredGroups reads the debounced filterValues
    // signal, so this needs the same real-time flush as a direct user edit.
    selectedAccount.set({ accountId: 'acc-2', accountName: 'Vendor Corp', accountSlug: 'vendor-corp', membershipTier: '', uid: 'org-uid-2' });
    await flushFilterChange(fixture);

    expect(renderedItemUids(fixture)).toEqual(['g1', 'g2', 'g3', 'g4']);
  });

  it('clearing filters restores the full list in the original (seat-desc, name-asc) order', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    filterForm(fixture).get('search')?.setValue('zephyr');
    await flushFilterChange(fixture);
    expect(renderedItemUids(fixture)).toEqual(['g2']);

    const clearButton = fixture.nativeElement.querySelector('[data-testid="org-groups-clear-filters"]') as HTMLButtonElement;
    expect(clearButton).toBeTruthy();
    clearButton.click();
    await flushFilterChange(fixture);

    expect(renderedItemUids(fixture)).toEqual(['g1', 'g2', 'g3', 'g4']);
  });

  it('decodes ?q=, ?foundation=, and ?type= from the URL into the filtered result on initial render', async () => {
    const { fixture } = await render({
      getGroups: () => of(groupsResponse(buildGroups())),
      queryParams: { q: 'committee', foundation: 'cncf', type: 'special-interest-group' },
    });
    // Flush past the debounce window so this also proves the decoded filter *survives* first render,
    // not just that the (pre-debounce) initial value happens to already reflect it.
    await flushFilterChange(fixture);

    expect(renderedItemUids(fixture)).toEqual(['g4']);
  });

  it('writes the query param on filter change and removes it when reset to default', async () => {
    const { fixture, navigate } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    filterForm(fixture).get('type')?.setValue('working-group');
    await flushFilterChange(fixture);

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { q: null, foundation: null, type: 'working-group' },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
    );

    navigate.mockClear();
    filterForm(fixture).get('type')?.setValue('');
    await flushFilterChange(fixture);

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { q: null, foundation: null, type: null },
      })
    );
  });

  it('falls back to the default when ?type= is a malformed/unknown value, without throwing', async () => {
    // render() itself would reject/throw if construction failed on the bogus param — awaiting it directly
    // is the assertion that decoding a malformed value never throws.
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())), queryParams: { type: 'bogus-value' } });

    // No type filter applied — full roster renders.
    expect(renderedItemUids(fixture)).toEqual(['g1', 'g2', 'g3', 'g4']);
  });

  it('preserves an unrelated ?project= param (never overwrites the app-wide reserved key) when a filter changes', async () => {
    const { fixture, navigate } = await render({
      getGroups: () => of(groupsResponse(buildGroups())),
      queryParams: { project: 'some-other-project' },
    });

    filterForm(fixture).get('foundation')?.setValue('openssf');
    await flushFilterChange(fixture);

    expect(navigate).toHaveBeenCalled();
    const [, navOptions] = navigate.mock.calls[navigate.mock.calls.length - 1] as [unknown, { queryParams: Record<string, unknown> }];
    expect(navOptions.queryParams).not.toHaveProperty('project');
  });
});

describe('OrgGroupsComponent — project label and row/foundation routing', () => {
  let fixture: ComponentFixture<OrgGroupsComponent>;

  // Named renderRow (not render) — a same-named local function would shadow the module-level
  // render() and recurse into itself instead of delegating to it.
  async function renderRow(response: OrgLensGroupsResponse): Promise<void> {
    ({ fixture } = await render({ accountName: 'Acme Corp', getGroups: () => of(response) }));
  }

  function group(over: Partial<OrgLensGroupSummary> = {}): OrgLensGroupSummary {
    return {
      uid: 'g1',
      name: 'WG Identity & Trust',
      category: 'Working Group',
      org_seat_count: 3,
      ...over,
    };
  }

  function projectLineElement(): HTMLElement | null {
    // uid-keyed like the row link — matches the prefix-query convention used across this spec.
    return fixture.nativeElement.querySelector('[data-testid^="org-groups-item-project-"]');
  }

  function projectLine(): string | null {
    return projectLineElement()?.textContent?.trim() ?? null;
  }

  function rowAriaLabel(): string | null {
    // The row's accessible name lives on the stretched whole-row link, not the row container
    // itself — queried by its own data-testid rather than a DOM-structure selector.
    return fixture.nativeElement.querySelector('[data-testid^="org-groups-row-link-"]')?.getAttribute('aria-label') ?? null;
  }

  it('prefers project_name over project_slug in the project line and aria-label', async () => {
    await renderRow({
      groups: [group({ project_name: 'Cloud Native Computing Foundation', project_slug: 'cncf' })],
      total_groups: 1,
      total_seats: 3,
    });

    expect(projectLine()).toBe('Cloud Native Computing Foundation');
    expect(rowAriaLabel()).toContain('Cloud Native Computing Foundation');
  });

  it('falls back to project_slug when project_name is absent', async () => {
    await renderRow({
      groups: [group({ project_slug: 'cncf' })],
      total_groups: 1,
      total_seats: 3,
    });

    expect(projectLine()).toBe('cncf');
    expect(rowAriaLabel()).toContain('cncf');
  });

  it('omits the project line and label segment when neither is set', async () => {
    await renderRow({
      groups: [group()],
      total_groups: 1,
      total_seats: 3,
    });

    expect(projectLine()).toBeNull();
    expect(rowAriaLabel()).toBe('WG Identity & Trust, Working Groups, 3 seats');
  });

  it('uses the singular "seat" in the aria-label for a single-seat group', async () => {
    await renderRow({
      groups: [group({ org_seat_count: 1 })],
      total_groups: 1,
      total_seats: 1,
    });

    expect(rowAriaLabel()).toBe('WG Identity & Trust, Working Groups, 1 seat');
  });

  it('renders the foundation name as a link to /org/memberships/<slug> when project_slug is present', async () => {
    await renderRow({
      groups: [group({ project_name: 'Ultra Ethernet Consortium Fund', project_slug: 'uepf' })],
      total_groups: 1,
      total_seats: 3,
    });

    const link = projectLineElement();
    expect(link?.tagName).toBe('A');
    // Not /org/projects/:slug — that route is Snowflake/CDP-scoped to sub-project activity rows
    // and 404s for a foundation-level slug (verified live against uepf and cncf).
    // /org/memberships/:slug is the same convention org-memberships.component.html itself uses.
    expect(link?.getAttribute('href')).toBe('/org/memberships/uepf');
    expect(link?.getAttribute('aria-label')).toBe('View Ultra Ethernet Consortium Fund membership details');
  });

  it('renders the foundation name as plain text (no link) when project_slug is absent', async () => {
    await renderRow({
      // project_name can be set from the committee index even when project_slug is missing —
      // the link must still be gated on project_slug alone, per the destination route's contract.
      groups: [group({ project_name: 'Ultra Ethernet Consortium Fund', project_slug: undefined })],
      total_groups: 1,
      total_seats: 3,
    });

    const el = projectLineElement();
    expect(el?.tagName).toBe('P');
    expect(el?.textContent?.trim()).toBe('Ultra Ethernet Consortium Fund');
  });

  it('clicking the foundation link navigates to the membership route, not the group route', async () => {
    await renderRow({
      groups: [group({ project_name: 'Ultra Ethernet Consortium Fund', project_slug: 'uepf' })],
      total_groups: 1,
      total_seats: 3,
    });

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    projectLineElement()?.click();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0][0].toString()).toBe('/org/memberships/uepf');
  });

  // jsdom does no layout or hit-testing, so this asserts the row anchor's own target — not that
  // the absolute-inset-0 / pointer-events overlay actually covers the row and routes clicks
  // correctly at runtime. That overlay-mechanics risk needs an e2e/Playwright check to close.
  it('links the row itself to the group detail route', async () => {
    await renderRow({
      groups: [group({ uid: 'g1', project_slug: 'cncf' })],
      total_groups: 1,
      total_seats: 3,
    });

    const rowLink = fixture.nativeElement.querySelector('[data-testid="org-groups-row-link-g1"]');
    expect(rowLink?.getAttribute('href')).toBe('/groups/g1');
  });
});

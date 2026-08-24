// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BEHAVIORAL_CLASS_CONFIG, COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import type { Account, OrgDropdownOption, OrgLensGroupSummary, OrgLensGroupsResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensGroupsService } from '@services/org-lens-groups.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { Tooltip } from 'primeng/tooltip';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/** data-testid lands on <lfx-button>'s host element, two Angular component boundaries above the
 *  native <button> PrimeNG's <p-button> actually renders internally — query the descendant. */
function exportButton(fixture: ComponentFixture<OrgGroupsComponent>): HTMLButtonElement {
  const el = fixture.nativeElement.querySelector('[data-testid="org-groups-export-csv"] button');
  if (!el) throw new Error('no native button rendered inside org-groups-export-csv');
  return el as HTMLButtonElement;
}

/** pTooltip lives on the wrapper div, not the button — see the template comment for why (a
 *  disabled element can't be keyboard-focused, so the tooltip/aria explanation would be
 *  unreachable without it) — rendered on hover via a dynamic overlay rather than a static DOM
 *  attribute, so read the bound `content` off the Tooltip directive instance instead of asserting
 *  on hover behavior. */
function exportTooltip(fixture: ComponentFixture<OrgGroupsComponent>): string | undefined {
  const content = fixture.debugElement.query(By.css('[data-testid="org-groups-export-csv-wrapper"]'))?.injector.get(Tooltip, null)?.content;
  return typeof content === 'string' ? content : undefined;
}

/**
 * Clicks the export button and captures what downloadCsv() (shared/utils/file.utils.ts) hands to
 * the browser download APIs — the Blob passed to URL.createObjectURL and the filename set on the
 * anchor's `download` attribute — without mocking the shared `@lfx-one/shared/utils` module
 * specifier itself (this repo's Angular unit-test builder doesn't hoist `vi.mock` by specifier the
 * way plain Vitest does, so a factory-based module mock silently never takes effect here).
 */
async function captureExportedCsv(fixture: ComponentFixture<OrgGroupsComponent>): Promise<{ filename: string; rows: string[][] }> {
  let capturedBlob: Blob | undefined;
  let capturedFilename: string | undefined;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = ((blob: Blob) => {
    capturedBlob = blob;
    return 'blob:mock-url';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    capturedFilename = this.download;
  });

  try {
    exportButton(fixture).click();
  } finally {
    clickSpy.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }

  if (!capturedBlob || capturedFilename === undefined) {
    throw new Error('exportCsv() did not trigger a download');
  }
  const text = (await capturedBlob.text()).replace(new RegExp(String.fromCharCode(0xfeff)), '');
  const rows = text
    .split('\r\n')
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
  return { filename: capturedFilename, rows };
}

/** Quote-aware RFC 4180 cell split, matching escapeCsvCell's quoting (file.utils.ts) — a plain
 *  `line.split(',')` would misalign columns the moment a cell (e.g. a comma-containing name) is
 *  quoted. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

describe('OrgGroupsComponent', () => {
  it('renders the same skeleton shape for the initial page load and the group-fetch loading state', async () => {
    // !loaded() branch — org navigation hasn't resolved yet.
    const { fixture: initialLoad } = await render({ orgNavigationLoaded: false });
    expect(has(initialLoad, 'org-groups-skeleton')).toBe(true);
    expect(has(initialLoad, 'org-groups-stat-strip')).toBe(false);
    expect(has(initialLoad, 'org-groups-list-loading')).toBe(true);
    expect(has(initialLoad, 'org-groups-list')).toBe(false);
    expect(statSkeletonCards(initialLoad).length).toBe(8);
    expect(listSkeletonRows(initialLoad).length).toBe(5);

    // groupsLoading() branch — page loaded, but the group fetch never resolves.
    const { fixture: groupsFetching } = await render({ getGroups: () => new Subject<OrgLensGroupsResponse>() });
    expect(has(groupsFetching, 'org-groups-stat-strip')).toBe(true);
    expect(has(groupsFetching, 'org-groups-skeleton')).toBe(false);
    expect(has(groupsFetching, 'org-groups-list')).toBe(true);
    expect(has(groupsFetching, 'org-groups-list-loading')).toBe(false);
    expect(has(groupsFetching, 'org-groups-stat-total')).toBe(false);
    expect(statSkeletonCards(groupsFetching).length).toBe(8);
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

  describe('contrast (GH-1782)', () => {
    it('foundation link uses passing gray-500/blue-700 contrast, not gray-400/blue-600 (GH-1782)', async () => {
      await renderRow({
        groups: [group({ project_name: 'Ultra Ethernet Consortium Fund', project_slug: 'uepf' })],
        total_groups: 1,
        total_seats: 3,
      });

      const link = projectLineElement();
      expect(link).not.toBeNull();
      expect(link?.className).toContain('text-gray-500');
      expect(link?.className).not.toContain('text-gray-400');
      expect(link?.className).toContain('hover:text-blue-700');
      expect(link?.className).not.toContain('hover:text-blue-600');
    });

    it('foundation plain-text fallback uses passing gray-500 contrast, not gray-400 (GH-1782)', async () => {
      await renderRow({
        groups: [group({ project_name: 'Ultra Ethernet Consortium Fund', project_slug: undefined })],
        total_groups: 1,
        total_seats: 3,
      });

      const fallback = projectLineElement();
      expect(fallback).not.toBeNull();
      expect(fallback?.className).toContain('text-gray-500');
      expect(fallback?.className).not.toContain('text-gray-400');
    });

    it('group name hovers to passing blue-700, not blue-600 (GH-1782)', async () => {
      await renderRow({ groups: [group()], total_groups: 1, total_seats: 3 });

      // The name `<p>` sets no color of its own (see the template comment above this row) — it
      // inherits from this wrapper, so the hover color only takes effect if the name actually lives
      // inside it. Assert containment, not just that each element independently exists.
      const rowContent = fixture.nativeElement.querySelector('[data-testid^="org-groups-item-row-content-"]');
      const name = fixture.nativeElement.querySelector('[data-testid^="org-groups-item-name-"]');
      expect(rowContent).not.toBeNull();
      expect(rowContent?.contains(name)).toBe(true);
      expect(rowContent?.className).toContain('peer-hover:text-blue-700');
      expect(rowContent?.className).not.toContain('peer-hover:text-blue-600');

      // `peer-hover:` compiles to `.peer:hover ~ &` — it only fires if the stretched row link is a
      // *preceding* sibling of this wrapper (same parent, earlier in document order), not merely
      // present somewhere in the row.
      const rowLink = fixture.nativeElement.querySelector('[data-testid^="org-groups-row-link-"]');
      expect(rowLink).not.toBeNull();
      expect((rowLink?.className ?? '').split(/\s+/)).toContain('peer');
      expect(rowLink?.parentElement).toBe(rowContent?.parentElement);
      expect((rowLink?.compareDocumentPosition(rowContent) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('responsive row layout (GH-1782)', () => {
    it('behavioral class chip has no hidden class at any breakpoint (GH-1782)', async () => {
      await renderRow({
        groups: [group()],
        total_groups: 1,
        total_seats: 3,
      });

      const chip = fixture.nativeElement.querySelector('[data-testid^="org-groups-item-class-chip-"]');
      expect(chip).not.toBeNull();
      const chipClasses = (chip?.getAttribute('class') ?? '').split(/\s+/);
      expect(chipClasses.some((c: string) => c === 'hidden' || c.endsWith(':hidden'))).toBe(false);
    });

    it('behavioral class chip keeps its explicit flex display and shrink-0, so a "drop redundant class" pass cannot silently regress it (GH-1782)', async () => {
      // Without `flex`, the host still renders (it blockifies to `block` as a flex item either
      // way) — no other assertion here would fail, only the strut-height regression `flex` fixes
      // would silently come back. Without `shrink-0`, the chip would default to flex-shrink: 1 as
      // a direct sibling of the flex-1 name column once `sm:contents` folds the wrapper away at
      // `sm+`, letting it get squeezed instead of keeping its natural width.
      await renderRow({ groups: [group()], total_groups: 1, total_seats: 3 });

      const chip = fixture.nativeElement.querySelector('[data-testid^="org-groups-item-class-chip-"]');
      expect(chip).not.toBeNull();
      const chipClasses = (chip?.getAttribute('class') ?? '').split(/\s+/);
      expect(chipClasses).toContain('flex');
      expect(chipClasses).toContain('shrink-0');
    });

    it('name/meta block keeps a growing flex class, so it fills the row and pins the chip/seat/chevron right at every breakpoint (GH-1782)', async () => {
      // Regression coverage: an earlier revision of this fix moved `flex-1` onto the `sm:contents`
      // wrapper instead of this block. Since `display: contents` gives that wrapper no box of its
      // own at `sm+`, its flex classes stopped applying there, and the name column collapsed to
      // content width — bunching the chip/seat-count/chevron to the left instead of the row's right
      // edge. Every a11y assertion in this file still passed throughout, so this test locks the
      // layout-critical class directly onto the element that must carry it, and checks it's actually
      // the wrapper's child — not just that both elements independently exist somewhere in the DOM.
      await renderRow({ groups: [group()], total_groups: 1, total_seats: 3 });

      const nameBlock = fixture.nativeElement.querySelector('[data-testid^="org-groups-item-meta-block-"]');
      const wrapper = fixture.nativeElement.querySelector('[data-testid^="org-groups-item-meta-wrapper-"]');
      const nameBlockClasses = (nameBlock?.className ?? '').split(/\s+/);

      expect(nameBlock).not.toBeNull();
      expect(wrapper).not.toBeNull();
      expect(wrapper?.contains(nameBlock)).toBe(true);
      expect(wrapper?.className).toContain('sm:contents');
      expect(nameBlockClasses).toContain('flex-1');
      expect(nameBlockClasses).toContain('min-w-0');
    });
  });

  describe('row testid contract', () => {
    it('gives each row its own uid-scoped testids, not a duplicate shared across rows (GH-1782)', async () => {
      await renderRow({
        groups: [group({ uid: 'g1' }), group({ uid: 'g2', name: 'SIG Storage' })],
        total_groups: 2,
        total_seats: 6,
      });

      for (const prefix of ['org-groups-item-row-content-', 'org-groups-item-meta-wrapper-', 'org-groups-item-meta-block-', 'org-groups-item-class-chip-']) {
        const matches = fixture.nativeElement.querySelectorAll(`[data-testid^="${prefix}"]`);
        expect(matches.length).toBe(2);
        expect(matches[0].getAttribute('data-testid')).toBe(`${prefix}g1`);
        expect(matches[1].getAttribute('data-testid')).toBe(`${prefix}g2`);
      }

      // These wrapper/block testids must NOT fall under the `org-groups-item-name-` prefix: an
      // existing e2e spec (org-groups-row-link-robust.spec.ts) collects exactly that prefix and
      // asserts it resolves 1:1 to the name <p> elements — a collision here would silently break it.
      const nameMatches = fixture.nativeElement.querySelectorAll('[data-testid^="org-groups-item-name-"]');
      expect(nameMatches.length).toBe(2);
      expect(Array.from(nameMatches).every((el) => (el as HTMLElement).tagName === 'P')).toBe(true);
    });
  });
});

/**
 * GH-1779: the stat strip used to hardcode Working Groups + SIGs as if they were the only
 * behavioral classes, silently dropping every other class from the total (19 unaccounted groups
 * on a live org). This spec pins the fix — every non-zero class renders exactly one tile, a
 * zero-count class (e.g. governing-board, typically 0 since the BFF drops the exact "Board"
 * category) renders none, and the rendered tiles always sum back to total_groups — plus that the
 * two loading skeletons agree on a placeholder count so resolving data doesn't jump the tile
 * count twice.
 */
describe('OrgGroupsComponent stat strip', () => {
  // 4 oversight-committee / 3 working-group / 2 special-interest-group / 1 ambassador-program /
  // 1 other (Committee) — five of the six classes (governing-board stays 0 for the "renders no
  // tile" case below), with distinct non-tied counts (other ties ambassador-program at 1 but is
  // pinned last regardless) so a regression that hardcodes back to a subset of classes — the
  // original GH-1779 shape — fails here instead of passing on an accidentally-narrow fixture.
  const RESPONSE: OrgLensGroupsResponse = {
    groups: [
      { uid: 'g1', name: 'WG One', category: 'Working Group', org_seat_count: 5 },
      { uid: 'g2', name: 'WG Two', category: 'Working Group', org_seat_count: 3 },
      { uid: 'g3', name: 'WG Three', category: 'Working Group', org_seat_count: 1 },
      { uid: 'g4', name: 'SIG One', category: 'Special Interest Group', org_seat_count: 4 },
      { uid: 'g5', name: 'SIG Two', category: 'Special Interest Group', org_seat_count: 2 },
      { uid: 'g6', name: 'Committee One', category: 'Committee', org_seat_count: 1 },
      { uid: 'g7', name: 'TSC One', category: 'Technical Steering Committee', org_seat_count: 6 },
      { uid: 'g8', name: 'TSC Two', category: 'Technical Steering Committee', org_seat_count: 5 },
      { uid: 'g9', name: 'TSC Three', category: 'Technical Steering Committee', org_seat_count: 4 },
      { uid: 'g10', name: 'TSC Four', category: 'Technical Steering Committee', org_seat_count: 1 },
      { uid: 'g11', name: 'Ambassador One', category: 'Ambassador', org_seat_count: 2 },
    ],
    total_groups: 11,
    total_seats: 34,
  };

  let fixture: ComponentFixture<OrgGroupsComponent>;

  async function render(opts: { orgLoaded?: boolean; getGroups?: () => Observable<OrgLensGroupsResponse> } = {}): Promise<void> {
    const { orgLoaded = true, getGroups = () => of(RESPONSE) } = opts;

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgGroupsComponent],
      providers: [
        provideRouter([]),
        {
          provide: AccountContextService,
          useValue: { selectedAccount: signal({ accountId: 'org-1', accountName: 'Org One', uid: 'org-1' } as Account), hasOrgSelectorAccess: signal(true) },
        },
        { provide: OrgNavigationService, useValue: { loaded: signal(orgLoaded) } },
        { provide: OrgRoleGrantsService, useValue: { loaded: signal(orgLoaded) } },
        { provide: PersonaService, useValue: { personaLoaded: signal(orgLoaded) } },
        { provide: OrgLensGroupsService, useValue: { getGroups: vi.fn(getGroups) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgGroupsComponent);
    await fixture.whenStable();
  }

  function rootElement(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function statTile(cls: string): HTMLElement | null {
    return rootElement().querySelector(`[data-testid="org-groups-stat-${cls}"]`);
  }

  // Count testid is keyed by class, not position, and namespaced as org-groups-tile-count-*
  // (not org-groups-stat-*) so it can't be picked up by the tile-prefix queries below.
  function statCount(cls: string): number {
    return Number(rootElement().querySelector(`[data-testid="org-groups-tile-count-${cls}"]`)?.textContent?.trim());
  }

  // `div[...]` excludes the enclosing `<section data-testid="org-groups-stat-strip">`, whose own
  // testid also matches the `^=` prefix.
  function classTiles(): HTMLElement[] {
    const all = Array.from(rootElement().querySelectorAll<HTMLElement>('div[data-testid^="org-groups-stat-"]'));
    return all.filter((el) => !['org-groups-stat-total', 'org-groups-stat-seats'].includes(el.getAttribute('data-testid') ?? ''));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders no tile for a zero-count behavioral class', async () => {
    await render();

    expect(statTile('governing-board')).toBeNull();
  });

  it('renders one tile per non-zero behavioral class, labeled from BEHAVIORAL_CLASS_CONFIG', async () => {
    await render();

    expect(statTile('oversight-committee')?.textContent).toContain(BEHAVIORAL_CLASS_CONFIG['oversight-committee'].label);
    expect(statTile('working-group')?.textContent).toContain(BEHAVIORAL_CLASS_CONFIG['working-group'].label);
    expect(statTile('special-interest-group')?.textContent).toContain(BEHAVIORAL_CLASS_CONFIG['special-interest-group'].label);
    expect(statTile('ambassador-program')?.textContent).toContain(BEHAVIORAL_CLASS_CONFIG['ambassador-program'].label);
    expect(statTile('other')?.textContent).toContain(BEHAVIORAL_CLASS_CONFIG.other.label);
    expect(classTiles()).toHaveLength(5);
  });

  it('renders the correct count on each class tile', async () => {
    await render();

    expect(statCount('oversight-committee')).toBe(4);
    expect(statCount('working-group')).toBe(3);
    expect(statCount('special-interest-group')).toBe(2);
    expect(statCount('ambassador-program')).toBe(1);
    expect(statCount('other')).toBe(1);
  });

  // Independent of the per-class assertions above, so a class silently missing its tile (the
  // original GH-1779 bug) fails here regardless.
  it('sums the rendered class tiles to total_groups', async () => {
    await render();

    const counts = classTiles().map((el) => ({
      tile: el.getAttribute('data-testid'),
      count: Number(el.querySelector('[data-testid^="org-groups-tile-count-"]')?.textContent?.trim()),
    }));

    // Checked before the sum so a tile missing its count element fails with its testid named,
    // not a bare NaN.
    expect(counts.filter(({ count }) => !Number.isFinite(count))).toEqual([]);
    expect(counts.reduce((sum, { count }) => sum + count, 0)).toBe(RESPONSE.total_groups);
  });

  it('orders the class tiles largest-first, other last', async () => {
    await render();

    const order = classTiles().map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual([
      'org-groups-stat-oversight-committee',
      'org-groups-stat-working-group',
      'org-groups-stat-special-interest-group',
      'org-groups-stat-ambassador-program',
      'org-groups-stat-other',
    ]);
  });

  it('pins the other tile last even when it has the highest count', async () => {
    await render({
      getGroups: () =>
        of({
          groups: [
            { uid: 'g1', name: 'WG One', category: 'Working Group', org_seat_count: 1 },
            { uid: 'g2', name: 'Committee One', category: 'Committee', org_seat_count: 1 },
            { uid: 'g3', name: 'Committee Two', category: 'Committee', org_seat_count: 1 },
          ],
          total_groups: 3,
          total_seats: 3,
        }),
    });

    const order = classTiles().map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['org-groups-stat-working-group', 'org-groups-stat-other']);
  });

  it('sizes the grid to the actual rendered tile count via --cols', async () => {
    await render();

    const section = rootElement().querySelector('[data-testid="org-groups-stat-strip"]') as HTMLElement;
    // --cols must equal actual grid children (any tag, via :scope > *), not just testid-tagged
    // ones — paired with the completeness check below so an untagged child fails loudly.
    const gridChildren = section.querySelectorAll(':scope > *').length;

    expect(section.querySelectorAll('[data-testid^="org-groups-stat-"]')).toHaveLength(gridChildren);
    expect(section.style.getPropertyValue('--cols').trim()).toBe(String(gridChildren));
  });

  it('renders the same skeleton card count whether org access or group data is still loading', async () => {
    await render({ orgLoaded: false });
    const outerSkeleton = fixture.nativeElement.querySelectorAll('[data-testid="org-groups-skeleton"] [data-testid="org-groups-stat-skeleton-card"]');

    await render({ getGroups: () => NEVER });
    const innerSkeleton = fixture.nativeElement.querySelectorAll('[data-testid="org-groups-stat-strip"] [data-testid="org-groups-stat-skeleton-card"]');

    expect(outerSkeleton.length).toBeGreaterThan(0);
    expect(outerSkeleton.length).toBe(innerSkeleton.length);
  });

  // Pins the true max tile count (2 fixed + all 6 behavioral classes non-zero, incl.
  // governing-board — never exercised by RESPONSE above) against the skeleton's reserved card
  // count, so a 7th GroupBehavioralClass member — which would grow this max — fails here loudly
  // instead of silently letting the loaded grid outgrow the skeleton (per dealako's PR #1790
  // review: statSkeletonTiles' length is type-derived, but nothing asserted the two actually agree
  // at the true max).
  it('matches the skeleton reservation when every behavioral class, including governing-board, renders a tile', async () => {
    await render({
      getGroups: () =>
        of({
          groups: [
            { uid: 'g1', name: 'Board One', category: 'Board', org_seat_count: 1 },
            { uid: 'g2', name: 'TSC One', category: 'Technical Steering Committee', org_seat_count: 1 },
            { uid: 'g3', name: 'WG One', category: 'Working Group', org_seat_count: 1 },
            { uid: 'g4', name: 'SIG One', category: 'Special Interest Group', org_seat_count: 1 },
            { uid: 'g5', name: 'Ambassador One', category: 'Ambassador', org_seat_count: 1 },
            { uid: 'g6', name: 'Committee One', category: 'Committee', org_seat_count: 1 },
          ],
          total_groups: 6,
          total_seats: 6,
        }),
    });

    const section = rootElement().querySelector('[data-testid="org-groups-stat-strip"]') as HTMLElement;

    // 6 non-zero classes + the 2 fixed totals — the same 8 the skeleton reserves (see the
    // toBe(8) skeleton-card assertions in the top-level describe above).
    expect(classTiles()).toHaveLength(6);
    expect(section.style.getPropertyValue('--cols').trim()).toBe('8');
  });
});

describe('OrgGroupsComponent — CSV export', () => {
  function exportTooltipWrapper(fixture: ComponentFixture<OrgGroupsComponent>): HTMLElement {
    const el = fixture.nativeElement.querySelector('[data-testid="org-groups-export-csv-wrapper"]');
    if (!el) throw new Error('no export tooltip wrapper rendered');
    return el as HTMLElement;
  }

  function exportHint(fixture: ComponentFixture<OrgGroupsComponent>): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="org-groups-export-csv-hint"]');
  }

  it('enables the export button with no tooltip once there are rows to export', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    expect(exportButton(fixture).disabled).toBe(false);
    expect(exportTooltip(fixture)).toBeUndefined();
    // Not a keyboard stop when there's nothing to explain — a stray always-on tabindex/role would
    // add a no-op tab stop, and wrap the enabled button in a stray "note" role, for no reason.
    const wrapper = exportTooltipWrapper(fixture);
    expect(wrapper.hasAttribute('tabindex')).toBe(false);
    expect(wrapper.hasAttribute('role')).toBe(false);
    expect(exportHint(fixture)).toBeNull();
  });

  it('disables the export button and shows "No rows to export" when the active filter matches nothing', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    filterForm(fixture).get('search')?.setValue('no-such-group-xyz');
    await flushFilterChange(fixture);

    expect(exportButton(fixture).disabled).toBe(true);
    expect(exportTooltip(fixture)).toBe('No rows to export');
    // Keyboard/screen-reader path: the disabled button itself can't carry focus or an accessible
    // tooltip, so the always-hoverable wrapper picks up a tab stop + aria-label while it applies.
    const wrapper = exportTooltipWrapper(fixture);
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    expect(wrapper.getAttribute('role')).toBe('note');
    expect(wrapper.getAttribute('aria-label')).toBe('No rows to export');
    // Always-visible fallback for a sighted keyboard-only user, who gets no hover/focus tooltip —
    // aria-hidden so a screen reader (already covered by the wrapper's aria-label) doesn't double-read it.
    const hint = exportHint(fixture);
    expect(hint?.textContent?.trim()).toBe('No rows to export');
    expect(hint?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exports only the rows the active filter leaves visible, not the full roster', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    filterForm(fixture).get('foundation')?.setValue('cncf');
    await flushFilterChange(fixture);
    expect(renderedItemUids(fixture)).toEqual(['g1', 'g4']);

    const { rows } = await captureExportedCsv(fixture);

    // header + 2 filtered rows only — g2/g3 (not in the 'cncf' foundation) must be excluded.
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((row) => row[0])).toEqual(['Committee Steering TAG', 'Committee Newsletter']);
  });

  it('emits the BEHAVIORAL_CLASS_CONFIG label in the Type column, not the raw category string', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    const { rows } = await captureExportedCsv(fixture);

    const [header, ...body] = rows;
    expect(header).toEqual([COMMITTEE_LABEL.singular, 'Foundation', 'Type', 'Our Seats', `${COMMITTEE_LABEL.singular} UID`]);
    // g2 (Zephyr Working Group) has raw category "Working Group" — the exported Type column must
    // carry the display label ("Working Groups"), not that raw upstream string.
    const zephyrRow = body.find((row) => row[4] === 'g2');
    expect(zephyrRow?.[2]).toBe(BEHAVIORAL_CLASS_CONFIG['working-group'].label);
    expect(zephyrRow?.[2]).not.toBe('Working Group');
  });

  it('names the download with the org slug and today’s date', async () => {
    const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    const { filename } = await captureExportedCsv(fixture);

    expect(filename).toMatch(/^org-lens-groups-acme-\d{8}\.csv$/);
  });

  it('stamps the local date, not the UTC date, in the filename', async () => {
    // \d{8} alone can't catch a UTC/local-date mismatch, and CI runs UTC (the GitHub-hosted-runner
    // default — no workflow sets TZ), where local and UTC calendar dates always coincide — a
    // comparison against the *host's* current TZ would be a permanent no-op there. Pin TZ for this
    // test so the assertion is unconditional and deterministic on every machine, including CI.
    // vi.stubEnv (not a hand-rolled save/restore) mirrors the repo's own TZ-pinning precedent
    // (committee-activity-query.helper.spec.ts) and correctly restores "unset" — a plain
    // `process.env.TZ = originalTz` would coerce an originally-unset TZ into the literal string
    // "undefined" and pin the rest of the worker process to UTC instead.
    try {
      vi.stubEnv('TZ', 'America/Los_Angeles');
      vi.useFakeTimers({ toFake: ['Date'] });
      // 2026-08-25T02:30:00Z is still Aug 24 in America/Los_Angeles (UTC-7 in August).
      vi.setSystemTime(new Date('2026-08-25T02:30:00Z'));
      const { fixture } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

      const { filename } = await captureExportedCsv(fixture);

      expect(filename).toContain('20260824');
      expect(filename).not.toContain('20260825');
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it('falls back to the default slug when accountSlug is the empty-string placeholder (not just null/undefined)', async () => {
    const { fixture, selectedAccount } = await render({ getGroups: () => of(groupsResponse(buildGroups())) });

    // Mirrors AccountContextService's PLACEHOLDER_ACCOUNT / toAccount(), which normalize a missing
    // Snowflake slug to '' rather than null/undefined during org-switch/enrichment windows —
    // `?? 'org'` would miss this and produce a bare "org-lens-groups--<date>.csv".
    selectedAccount.update((account) => ({ ...account, accountSlug: '' }));

    const { filename } = await captureExportedCsv(fixture);

    expect(filename).toMatch(/^org-lens-groups-org-\d{8}\.csv$/);
  });

  it('quotes a comma-containing cell per RFC 4180, and the export still reports the correct value', async () => {
    const groups: OrgLensGroupSummary[] = [{ uid: 'h1', name: 'Steering, Governance & Ops', category: 'TSC', org_seat_count: 2 }];
    const { fixture } = await render({ getGroups: () => of(groupsResponse(groups)) });

    const { rows } = await captureExportedCsv(fixture);

    expect(rows[1][0]).toBe('Steering, Governance & Ops');
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensGroupsService } from '@services/org-lens-groups.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { Account, OrgLensGroupsResponse, OrgLensGroupSummary } from '@lfx-one/shared/interfaces';

import { OrgGroupsComponent } from './org-groups.component';

const ACCOUNT: Account = { accountId: 'a1', accountName: 'Acme Corp', uid: 'org-1' };

function group(over: Partial<OrgLensGroupSummary> = {}): OrgLensGroupSummary {
  return {
    uid: 'g1',
    name: 'WG Identity & Trust',
    category: 'Working Group',
    org_seat_count: 3,
    ...over,
  };
}

describe('OrgGroupsComponent — project label and row/foundation routing', () => {
  let fixture: ComponentFixture<OrgGroupsComponent>;

  async function render(response: OrgLensGroupsResponse): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgGroupsComponent],
      providers: [
        { provide: AccountContextService, useValue: { selectedAccount: signal(ACCOUNT), hasOrgSelectorAccess: signal(true) } },
        { provide: OrgNavigationService, useValue: { loaded: signal(true) } },
        { provide: OrgRoleGrantsService, useValue: { loaded: signal(true) } },
        { provide: PersonaService, useValue: { personaLoaded: signal(true) } },
        { provide: OrgLensGroupsService, useValue: { getGroups: () => of(response) } },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgGroupsComponent);
    await fixture.whenStable();
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
    await render({
      groups: [group({ project_name: 'Cloud Native Computing Foundation', project_slug: 'cncf' })],
      total_groups: 1,
      total_seats: 3,
    });

    expect(projectLine()).toBe('Cloud Native Computing Foundation');
    expect(rowAriaLabel()).toContain('Cloud Native Computing Foundation');
  });

  it('falls back to project_slug when project_name is absent', async () => {
    await render({
      groups: [group({ project_slug: 'cncf' })],
      total_groups: 1,
      total_seats: 3,
    });

    expect(projectLine()).toBe('cncf');
    expect(rowAriaLabel()).toContain('cncf');
  });

  it('omits the project line and label segment when neither is set', async () => {
    await render({
      groups: [group()],
      total_groups: 1,
      total_seats: 3,
    });

    expect(projectLine()).toBeNull();
    expect(rowAriaLabel()).toBe('WG Identity & Trust, Working Groups, 3 seats');
  });

  it('uses the singular "seat" in the aria-label for a single-seat group', async () => {
    await render({
      groups: [group({ org_seat_count: 1 })],
      total_groups: 1,
      total_seats: 1,
    });

    expect(rowAriaLabel()).toBe('WG Identity & Trust, Working Groups, 1 seat');
  });

  it('renders the foundation name as a link to /org/memberships/<slug> when project_slug is present', async () => {
    await render({
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
    await render({
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
    await render({
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
    await render({
      groups: [group({ uid: 'g1', project_slug: 'cncf' })],
      total_groups: 1,
      total_seats: 3,
    });

    const rowLink = fixture.nativeElement.querySelector('[data-testid="org-groups-row-link-g1"]');
    expect(rowLink?.getAttribute('href')).toBe('/groups/g1');
  });
});

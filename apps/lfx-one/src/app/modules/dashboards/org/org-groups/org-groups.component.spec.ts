// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensGroupsService } from '@services/org-lens-groups.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

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

describe('OrgGroupsComponent — project label', () => {
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
    fixture.detectChanges();
  }

  function projectLine(): string | null {
    return fixture.nativeElement.querySelector('[data-testid="org-groups-item-project"]')?.textContent?.trim() ?? null;
  }

  function rowAriaLabel(): string | null {
    return fixture.nativeElement.querySelector('[data-testid^="org-groups-item-"]')?.getAttribute('aria-label') ?? null;
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
});

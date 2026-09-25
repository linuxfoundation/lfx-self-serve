// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgLensProjectsService } from '@services/org-lens-projects.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { NEVER, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgProjectsComponent } from './org-projects.component';

describe('OrgProjectsComponent', () => {
  const pageState = signal<OrgLensEmptyStateName | null>(null);
  const pageReady = signal(true);
  const settled = signal(true);
  let fixture: ComponentFixture<OrgProjectsComponent>;

  beforeEach(async () => {
    pageState.set(null);
    pageReady.set(true);
    settled.set(true);

    await TestBed.configureTestingModule({
      imports: [OrgProjectsComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: '001Dn00000ExAmPleA', accountName: 'Acme' }) } },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null), editorSet: signal(new Set<string>()) } },
        // The org list never finishes loading, as for an admitted contractor with no switcher access (#2961).
        { provide: OrgNavigationService, useValue: { loaded: signal(false) } },
        { provide: OrgLensNavigationService, useValue: { orgLensLink: vi.fn(() => []) } },
        { provide: OrgLensProjectsService, useValue: { getWorkspaces: () => of({ workspaces: [] }), getProjects: () => NEVER } },
        {
          provide: OrgLensEmptyStateService,
          useValue: {
            pageState,
            hasPageState: computed(() => pageState() !== null),
            pageReady,
            settled,
            retrying: signal(false),
            retry: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgProjectsComponent);
  });

  function has(testid: string): boolean {
    return !!(fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);
  }

  function title(): string {
    return (fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-projects-title"]')?.textContent ?? '';
  }

  it('shows the loading skeleton, no projects content and no organization name until the page is ready', async () => {
    pageReady.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(has('org-projects-loading')).toBe(true);
    expect(has('org-projects-table-card')).toBe(false);
    expect(title()).not.toContain('Acme');
  });

  it('renders the projects content and names the organization once the page is ready, even though the org list never loads', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(has('org-projects-table-card')).toBe(true);
    expect(has('org-projects-loading')).toBe(false);
    expect(title()).toContain('Acme');
  });

  it('replaces the projects content with the page-level state for a contractor without a grant, without naming the organization', async () => {
    pageState.set('contractor-no-grant');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(has('org-projects-no-access-state')).toBe(true);
    expect(has('org-projects-table-card')).toBe(false);
    expect(has('org-projects-loading')).toBe(false);
    expect(title()).not.toContain('Acme');
  });
});

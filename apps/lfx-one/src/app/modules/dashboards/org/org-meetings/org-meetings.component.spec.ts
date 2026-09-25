// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Account, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { describe, expect, it, vi } from 'vitest';

import { OrgMeetingsComponent } from './org-meetings.component';

interface Rendered {
  fixture: ComponentFixture<OrgMeetingsComponent>;
}

async function render(options: { pageReady?: boolean; pageState?: OrgLensEmptyStateName | null } = {}): Promise<Rendered> {
  const pageState = signal<OrgLensEmptyStateName | null>(options.pageState ?? null);
  const pageReady = signal(options.pageReady ?? true);
  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });

  TestBed.resetTestingModule();
  // The meetings sections fetch their own data; shallow-render them so the page's own gating is what's under test.
  TestBed.overrideComponent(OrgMeetingsComponent, {
    set: { imports: [EmptyStateComponent, OrgLensEmptyStateComponent, SkeletonModule], schemas: [NO_ERRORS_SCHEMA] },
  });
  await TestBed.configureTestingModule({
    imports: [OrgMeetingsComponent],
    providers: [
      provideRouter([]),
      // lfxOpenIntercom (the empty state's contact-support link) injects the app-root MessageService.
      MessageService,
      { provide: AccountContextService, useValue: { selectedAccount } },
      // The org list never starts for a contractor with no switcher access (#2961).
      { provide: OrgNavigationService, useValue: { loaded: signal(false) } },
      { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
      {
        provide: OrgLensEmptyStateService,
        useValue: {
          pageState,
          hasPageState: computed(() => pageState() !== null),
          pageReady,
          settled: signal(true),
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgMeetingsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture };
}

function query(fixture: ComponentFixture<OrgMeetingsComponent>, selector: string): Element | null {
  return fixture.nativeElement.querySelector(selector);
}

function hasContent(fixture: ComponentFixture<OrgMeetingsComponent>): boolean {
  return (
    !!query(fixture, 'lfx-org-meetings-kpi-cards') && !!query(fixture, 'lfx-org-meetings-spend-breakdown') && !!query(fixture, 'lfx-org-meetings-influence')
  );
}

describe('OrgMeetingsComponent page gating', () => {
  it('shows the loading skeleton and no meetings sections before the page is ready', async () => {
    const { fixture } = await render({ pageReady: false });

    expect(query(fixture, '[data-testid="org-meetings-loading"]')).not.toBeNull();
    expect(hasContent(fixture)).toBe(false);
    expect(query(fixture, '[data-testid="org-meetings-no-access-state"]')).toBeNull();
  });

  it('renders the meetings sections once the page is ready even though the org list never loaded', async () => {
    const { fixture } = await render({ pageReady: true });

    expect(hasContent(fixture)).toBe(true);
    expect(query(fixture, '[data-testid="org-meetings-loading"]')).toBeNull();
    expect(query(fixture, '[data-testid="org-meetings-no-company-empty-state"]')).toBeNull();
  });

  it('replaces the page with the contractor-no-grant state and renders no meetings sections', async () => {
    const { fixture } = await render({ pageReady: true, pageState: 'contractor-no-grant' });

    const state = query(fixture, '[data-testid="org-meetings-no-access-state"]');
    expect(state).not.toBeNull();
    expect(state?.getAttribute('data-state')).toBe('contractor-no-grant');
    expect(hasContent(fixture)).toBe(false);
    expect(query(fixture, '[data-testid="org-meetings-loading"]')).toBeNull();
  });
});

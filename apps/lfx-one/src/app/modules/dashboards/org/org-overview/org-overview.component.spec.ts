// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Account, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgOverviewComponent } from './org-overview.component';

describe('OrgOverviewComponent page gate', () => {
  let fixture: ComponentFixture<OrgOverviewComponent>;
  const pageState = signal<OrgLensEmptyStateName | null>(null);
  const pageReady = signal(true);
  const settled = signal(true);

  const has = (testid: string): boolean => !!fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  const text = (testid: string): string => fixture.nativeElement.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim() ?? '';

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(OrgOverviewComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    pageState.set(null);
    pageReady.set(true);
    settled.set(true);
    // jsdom has no IntersectionObserver; a never-intersecting one keeps each `@defer (on viewport)` on its placeholder.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        public observe(): void {}
        public unobserve(): void {}
        public disconnect(): void {}
      }
    );

    const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgOverviewComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: AccountContextService, useValue: { selectedAccount } },
        // The org list has not answered: an admitted contractor without switcher access never gets one.
        { provide: OrgNavigationService, useValue: { loaded: signal(false), items: signal([]) } },
        { provide: OrgRoleGrantsService, useValue: { isStaff: signal(false), correlationId: signal(null) } },
        {
          provide: OrgLensEmptyStateService,
          useValue: { pageState, hasPageState: computed(() => pageState() !== null), pageReady, settled, retrying: signal(false), retry: vi.fn() },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows the skeleton and no org-named header before the page is ready', async () => {
    pageReady.set(false);
    await render();

    expect(has('org-overview-loading')).toBe(true);
    expect(has('org-overview-header')).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Acme Motors');
    expect(has('organization-involvement-placeholder')).toBe(false);
  });

  it('renders the content and header once the page is ready, without waiting for the org list', async () => {
    await render();

    expect(has('org-overview-loading')).toBe(false);
    expect(text('org-overview-title')).toBe('Acme Motors Overview');
    expect(has('organization-involvement-placeholder')).toBe(true);
  });

  it('replaces the page, header included, with the contractor-no-grant state', async () => {
    pageState.set('contractor-no-grant');
    await render();

    expect(has('org-overview-no-access-state')).toBe(true);
    expect(has('org-overview-header')).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Acme Motors');
    expect(has('organization-involvement-placeholder')).toBe(false);
  });
});

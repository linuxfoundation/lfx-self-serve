// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PersonDetailDrawerComponent } from '@components/person-detail-drawer/person-detail-drawer.component';
import type { OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgPeopleComponent } from './org-people.component';

// The shared drawer is mounted unconditionally and pulls HttpClient/feature flags; it is not under test here.
@Component({ selector: 'lfx-person-detail-drawer', template: '' })
class PersonDetailDrawerStubComponent {}

describe('OrgPeopleComponent', () => {
  const pageState = signal<OrgLensEmptyStateName | null>(null);
  let fixture: ComponentFixture<OrgPeopleComponent>;

  beforeEach(async () => {
    pageState.set(null);

    await TestBed.configureTestingModule({
      imports: [OrgPeopleComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: '001Dn00000ExAmPleA', accountName: 'Acme' }) } },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
        {
          provide: OrgLensEmptyStateService,
          useValue: {
            pageState,
            hasPageState: computed(() => pageState() !== null),
            pageReady: signal(true),
            settled: signal(true),
            retrying: signal(false),
            retry: vi.fn(),
          },
        },
      ],
    })
      .overrideComponent(OrgPeopleComponent, {
        remove: { imports: [PersonDetailDrawerComponent] },
        add: { imports: [PersonDetailDrawerStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(OrgPeopleComponent);
  });

  it('renders only the page-level empty state for a contractor without a grant', async () => {
    pageState.set('contractor-no-grant');
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="org-people-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-people-tab-bar"]')).toBeNull();
    // The page-level state never names the selected organization.
    expect(el.querySelector('[data-testid="org-people-title"]')?.textContent?.trim()).toBe('People');
  });
});

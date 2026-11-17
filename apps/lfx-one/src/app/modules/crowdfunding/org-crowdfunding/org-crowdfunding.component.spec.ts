// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CF_ORG_DONATIONS_FLAG } from '@lfx-one/shared/constants';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgCrowdfundingComponent } from './org-crowdfunding.component';

const ORG_UID = '001000000000000AAA';

@Component({ selector: 'lfx-stub-initiatives', template: '<p data-testid="stub-initiatives">initiatives</p>' })
class StubInitiativesComponent {}

@Component({ selector: 'lfx-stub-donations', template: '<p data-testid="stub-donations">donations</p>' })
class StubDonationsComponent {}

describe('OrgCrowdfundingComponent (#5838)', () => {
  const writerSet = signal(new Set<string>());
  const grantsLoaded = signal(true);
  const donationsEnabled = signal(false);

  const tabIds = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll('[role="tab"]')).map((el) => (el.getAttribute('data-testid') ?? '').replace('crowdfunding-tab-', ''));

  async function open(url: string): Promise<RouterTestingHarness> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    harness.detectChanges();
    return harness;
  }

  beforeEach(() => {
    writerSet.set(new Set());
    grantsLoaded.set(true);
    donationsEnabled.set(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'crowdfunding',
            component: OrgCrowdfundingComponent,
            children: [
              { path: 'initiatives', component: StubInitiativesComponent },
              { path: 'donations', component: StubDonationsComponent },
            ],
          },
        ]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ accountId: '', accountName: 'Synthetic Org', uid: ORG_UID }) } },
        { provide: OrgRoleGrantsService, useValue: { writerSet, loaded: grantsLoaded, error: signal<string | null>(null) } },
        {
          provide: FeatureFlagService,
          useValue: { getBooleanFlag: (key: string) => (key === CF_ORG_DONATIONS_FLAG ? donationsEnabled : signal(false)) },
        },
      ],
    });
  });

  it('names the company in the header and renders the active tab in the panel', async () => {
    donationsEnabled.set(true);
    const harness = await open('/crowdfunding/donations');
    const root: HTMLElement = harness.routeNativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="org-crowdfunding-title"]')?.textContent).toContain('Crowdfunding — Synthetic Org');
    expect(root.querySelector('[data-testid="stub-donations"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="crowdfunding-tab-donations"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('shows Initiatives only for a direct writer and Donations only with the flag on', async () => {
    donationsEnabled.set(true);
    const harness = await open('/crowdfunding/donations');
    expect(tabIds(harness.routeNativeElement as HTMLElement)).toEqual(['donations']);

    writerSet.set(new Set([ORG_UID]));
    harness.detectChanges();
    expect(tabIds(harness.routeNativeElement as HTMLElement)).toEqual(['initiatives', 'donations']);
  });

  it('hides Donations while the flag is off', async () => {
    writerSet.set(new Set([ORG_UID]));
    const harness = await open('/crowdfunding/initiatives');
    expect(tabIds(harness.routeNativeElement as HTMLElement)).toEqual(['initiatives']);
  });

  it('switches tabs by navigating, and arrow keys move to the next tab', async () => {
    writerSet.set(new Set([ORG_UID]));
    donationsEnabled.set(true);
    const harness = await open('/crowdfunding/initiatives');
    const root: HTMLElement = harness.routeNativeElement as HTMLElement;

    root.querySelector<HTMLElement>('[data-testid="crowdfunding-tab-donations"]')?.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/crowdfunding/donations');

    root.querySelector<HTMLElement>('[role="tablist"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/crowdfunding/initiatives');
  });

  it('offers New Initiative only on the Initiatives tab', async () => {
    writerSet.set(new Set([ORG_UID]));
    donationsEnabled.set(true);
    const harness = await open('/crowdfunding/initiatives');
    expect((harness.routeNativeElement as HTMLElement).querySelector('[data-testid="new-initiative-button"]')).not.toBeNull();

    await harness.navigateByUrl('/crowdfunding/donations');
    harness.detectChanges();
    expect((harness.routeNativeElement as HTMLElement).querySelector('[data-testid="new-initiative-button"]')).toBeNull();
  });

  it('lands the bare address on Initiatives for a direct writer, waiting for the grants to load', async () => {
    donationsEnabled.set(true);
    grantsLoaded.set(false);
    const harness = await open('/crowdfunding');
    expect(TestBed.inject(Router).url).toBe('/crowdfunding');

    writerSet.set(new Set([ORG_UID]));
    grantsLoaded.set(true);
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/crowdfunding/initiatives');
  });

  it('lands the bare address on Donations for a viewer who is not a writer', async () => {
    donationsEnabled.set(true);
    const harness = await open('/crowdfunding');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/crowdfunding/donations');
  });
});

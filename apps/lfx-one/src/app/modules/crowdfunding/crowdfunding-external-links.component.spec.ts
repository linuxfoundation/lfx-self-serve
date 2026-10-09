// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { environment } from '@environments/environment';
import {
  EMPTY_CROWDFUNDING_STATS,
  EMPTY_DONATION_STATS,
  EMPTY_INITIATIVES_RESPONSE,
  EMPTY_MY_DONATIONS,
  EMPTY_RECURRING_DONATIONS,
} from '@lfx-one/shared/constants';
import { FundType } from '@lfx-one/shared/enums';
import { InitiativeBase } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyDonationsComponent } from './my-donations/my-donations.component';
import { InitiativesListComponent } from './my-initiatives/components/initiatives-list/initiatives-list.component';
import { MyInitiativesComponent } from './my-initiatives/my-initiatives.component';

function expectExternalLink(root: HTMLElement, selector: string, label: string, href: string): void {
  const anchor = root.querySelector<HTMLAnchorElement>(selector);
  expect(anchor, `missing ${label} anchor at ${selector}`).not.toBeNull();
  expect(anchor?.textContent?.trim()).toBe(label);
  expect(anchor?.getAttribute('href')).toBe(href);
  expect(anchor?.getAttribute('target')).toBe('_blank');
  expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
}

function initiative(status: InitiativeBase['status'] = 'published'): InitiativeBase {
  return {
    id: 'synthetic-initiative-1',
    slug: 'synthetic-initiative',
    name: 'Synthetic Initiative',
    description: 'Synthetic fundraising description',
    status,
    initiativeType: FundType.PROJECT,
    color: 'blue',
    createdOn: '2026-01-01T00:00:00Z',
    updatedOn: '2026-01-01T00:00:00Z',
  };
}

function clickFilter(root: HTMLElement, filter: string): void {
  const button = root.querySelector<HTMLButtonElement>(`[data-testid="filter-pill-${filter}"]`);
  expect(button, `missing ${filter} filter`).not.toBeNull();
  button!.click();
}

function expectFilterEmpty(root: HTMLElement, title: string, subtitle: string): void {
  const emptyState = root.querySelector<HTMLElement>('[data-testid="initiatives-empty-state"]');
  expect(emptyState).not.toBeNull();
  expect(emptyState?.querySelector('h3')?.textContent).toBe(title);
  expect(emptyState?.querySelector('p')?.textContent).toBe(subtitle);
  expect(emptyState?.querySelectorAll('a, button')).toHaveLength(0);
  expect(root.querySelector('[data-testid="initiatives-cards"]')).toBeNull();
}

describe('InitiativesListComponent external empty-state handoff', () => {
  let fixture: ComponentFixture<InitiativesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [InitiativesListComponent], providers: [provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(InitiativesListComponent);
    fixture.componentRef.setInput('createUrl', 'https://crowdfunding.example/?fundraise=true');
  });

  it('renders a safe creation anchor for a globally empty list', async () => {
    fixture.componentRef.setInput('initiatives', []);
    await fixture.whenStable();

    expectExternalLink(fixture.nativeElement, '[data-testid="initiatives-empty-state"] a', 'New Initiative', 'https://crowdfunding.example/?fundraise=true');
  });

  it.each(['pending', 'submitted', 'hidden', 'declined'] as const)(
    'does not offer an in-panel CTA for %s initiatives after clicking Active',
    async (status) => {
      fixture.componentRef.setInput('initiatives', [initiative(status)]);
      await fixture.whenStable();
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector('[data-testid="initiative-card-synthetic-initiative-1"]')).not.toBeNull();

      clickFilter(root, 'active');
      await fixture.whenStable();

      expectFilterEmpty(root, 'No active initiatives', 'Fundraising initiatives you publish will appear here.');
    }
  );

  it.each([
    ['pending', 'No pending initiatives', 'Initiatives awaiting review will appear here.'],
    ['archived', 'No archived initiatives', 'Hidden or declined initiatives will appear here.'],
  ])('does not offer an in-panel CTA for published initiatives after clicking %s', async (filter, title, subtitle) => {
    fixture.componentRef.setInput('initiatives', [initiative()]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="initiative-card-synthetic-initiative-1"]')).not.toBeNull();

    clickFilter(root, filter);
    await fixture.whenStable();
    expectFilterEmpty(root, title, subtitle);

    clickFilter(root, 'active');
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="initiative-card-synthetic-initiative-1"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="initiatives-empty-state"]')).toBeNull();
  });
});

describe('MyInitiativesComponent external creation links', () => {
  let fixture: ComponentFixture<MyInitiativesComponent>;
  let items: InitiativeBase[];
  let service: { getMyInitiatives: ReturnType<typeof vi.fn>; getMyInitiativesStats: ReturnType<typeof vi.fn> };
  const projectContext = { activeContextUid: signal(''), activeContext: signal<{ name: string } | null>(null) };

  const configure = async (routeData: Record<string, string> = {}): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [MyInitiativesComponent],
      providers: [
        provideRouter([]),
        { provide: CrowdfundingService, useValue: service },
        { provide: ProjectContextService, useValue: projectContext },
        { provide: ActivatedRoute, useValue: { snapshot: { data: routeData } } },
      ],
    }).compileComponents();
  };

  beforeEach(async () => {
    items = [];
    projectContext.activeContextUid.set('');
    projectContext.activeContext.set(null);
    service = {
      getMyInitiatives: vi.fn(() => of({ ...EMPTY_INITIATIVES_RESPONSE, data: items, total: items.length })),
      getMyInitiativesStats: vi.fn(() => of(EMPTY_CROWDFUNDING_STATS)),
    };
  });

  it('uses the environment creation destination for both the header and globally empty list', async () => {
    await configure();
    fixture = TestBed.createComponent(MyInitiativesComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const href = `${environment.urls.crowdfunding}?fundraise=true`;
    expectExternalLink(root, '[data-testid="new-initiative-button"] a', 'New Initiative', href);
    expectExternalLink(root, '[data-testid="initiatives-empty-state"] a', 'New Initiative', href);
  });

  it('keeps the header creation link on empty filters and routes matching card clicks internally', async () => {
    items = [initiative()];
    await configure();
    fixture = TestBed.createComponent(MyInitiativesComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    clickFilter(root, 'pending');
    await fixture.whenStable();
    expectFilterEmpty(root, 'No pending initiatives', 'Initiatives awaiting review will appear here.');
    expectExternalLink(root, '[data-testid="new-initiative-button"] a', 'New Initiative', `${environment.urls.crowdfunding}?fundraise=true`);

    clickFilter(root, 'active');
    await fixture.whenStable();
    root.querySelector<HTMLElement>('[data-testid="initiative-card-synthetic-initiative-1"]')!.click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['synthetic-initiative'], expect.objectContaining({ queryParamsHandling: 'preserve' }));
    expect(service.getMyInitiatives).toHaveBeenCalledWith(expect.objectContaining({ projectUid: undefined }));
  });

  it('scopes a project lens page to the lens project once it resolves (#347)', async () => {
    const projectUid = '00000000-0000-4000-8000-000000000001';
    await configure({ lens: 'project' });
    fixture = TestBed.createComponent(MyInitiativesComponent);
    await fixture.whenStable();
    // Waits for the lens context instead of listing the caller's own initiatives.
    expect(service.getMyInitiatives).not.toHaveBeenCalled();

    projectContext.activeContextUid.set(projectUid);
    projectContext.activeContext.set({ name: 'Synthetic Project' });
    await fixture.whenStable();
    expect(service.getMyInitiatives).toHaveBeenCalledWith(expect.objectContaining({ projectUid, offset: 0 }));
    expect(service.getMyInitiativesStats).toHaveBeenCalledWith(projectUid);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Synthetic Project');
  });
});

describe('MyDonationsComponent external discovery links', () => {
  it('uses the environment catalog destination for both the header and empty history without prior donations', async () => {
    const service: Pick<CrowdfundingService, 'getMyDonationStats' | 'getMyRecurringDonations' | 'getMyPaymentMethod' | 'getMyDonations'> = {
      getMyDonationStats: () => of(EMPTY_DONATION_STATS),
      getMyRecurringDonations: () => of(EMPTY_RECURRING_DONATIONS),
      getMyPaymentMethod: () => of(null),
      getMyDonations: () => of(EMPTY_MY_DONATIONS),
    };
    await TestBed.configureTestingModule({
      imports: [MyDonationsComponent],
      providers: [provideRouter([]), MessageService, { provide: CrowdfundingService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(MyDonationsComponent);
    await fixture.whenStable();

    const root: HTMLElement = fixture.nativeElement;
    const href = `${environment.urls.crowdfunding}initiatives`;
    expectExternalLink(root, '[data-testid="explore-initiatives-btn"] a', 'Explore Initiatives', href);
    expectExternalLink(root, '[data-testid="donation-history-empty-state"] a', 'Explore Initiatives', href);
  });
});

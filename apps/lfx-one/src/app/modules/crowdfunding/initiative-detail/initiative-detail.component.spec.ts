// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Signal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { FundType } from '@lfx-one/shared/enums';
import { CrowdfundingInitiativeStatus, InitiativeDetail } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { InitiativeDetailComponent } from './initiative-detail.component';

function detail(overrides: { isOwner?: boolean; status?: CrowdfundingInitiativeStatus } = {}): InitiativeDetail {
  return {
    id: 'synthetic-initiative-1',
    slug: 'synthetic-initiative',
    name: 'Synthetic Initiative',
    description: '',
    status: overrides.status ?? 'submitted',
    initiativeType: FundType.GENERAL_FUND,
    color: '',
    createdOn: '2026-01-01T00:00:00Z',
    updatedOn: '2026-01-01T00:00:00Z',
    isOwner: overrides.isOwner ?? true,
  };
}

describe('InitiativeDetailComponent Edit attribution visibility (lfx-crowdfunding#342)', () => {
  afterEach(() => TestBed.resetTestingModule());

  interface Page {
    canEditAttribution: Signal<boolean>;
    initiative: Signal<InitiativeDetail | null>;
    onInitiativeSaved(updated: InitiativeDetail): void;
    openEditAttribution(initiative: InitiativeDetail): void;
  }

  const dialogClose = new Subject<InitiativeDetail | undefined>();

  const setup = (opts: { lens?: string; flag?: boolean; initiative?: InitiativeDetail } = {}): Page => {
    TestBed.configureTestingModule({
      imports: [InitiativeDetailComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { lens: opts.lens ?? 'me' }, queryParams: {} },
            paramMap: of(convertToParamMap({ slug: 'synthetic-initiative' })),
          },
        },
        { provide: CrowdfundingService, useValue: { getInitiativeBySlug: () => of(opts.initiative ?? detail()) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(opts.flag ?? true) } },
        { provide: OrgLensNavigationService, useValue: { orgLensLink: () => ['/org', 'initiatives'] } },
        { provide: DialogService, useValue: { open: () => ({ onClose: dialogClose }) } },
        { provide: MessageService, useValue: { add: () => undefined } },
      ],
    });
    // Only the visibility rule is under test; skip rendering the page's children.
    TestBed.overrideComponent(InitiativeDetailComponent, { set: { imports: [], template: '' } });
    const fixture = TestBed.createComponent(InitiativeDetailComponent);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as Page;
  };
  const canEdit = (opts: Parameters<typeof setup>[0] = {}): boolean => setup(opts).canEditAttribution();

  it('shows for the creator of a submitted initiative in the Me lens', () => {
    expect(canEdit()).toBe(true);
  });

  it.each(['org', 'project', 'foundation'])('hides on the %s lens page', (lens) => {
    expect(canEdit({ lens })).toBe(false);
  });

  it('hides for a writer who is not the creator', () => {
    expect(canEdit({ initiative: detail({ isOwner: false }) })).toBe(false);
  });

  it.each(['pending', 'published', 'declined', 'hidden'] as const)('hides once the initiative is %s', (status) => {
    expect(canEdit({ initiative: detail({ status }) })).toBe(false);
  });

  it('hides while the attribution flag is off', () => {
    expect(canEdit({ flag: false })).toBe(false);
  });

  it('stays visible after a settings save, whose response carries no is_owner', () => {
    const page = setup();
    page.onInitiativeSaved({ ...detail(), isOwner: false, name: 'Renamed' });
    expect(page.initiative()?.name).toBe('Renamed');
    expect(page.canEditAttribution()).toBe(true);
  });

  it('takes only the attribution from an attribution save', () => {
    const page = setup();
    page.openEditAttribution(detail());
    dialogClose.next({ ...detail(), isOwner: false, name: 'Unenriched', attribution: { type: 'organization', entityUid: 'x', name: 'Acme Motors' } });
    expect(page.initiative()).toMatchObject({ name: 'Synthetic Initiative', attribution: { name: 'Acme Motors' } });
    expect(page.canEditAttribution()).toBe(true);
  });
});

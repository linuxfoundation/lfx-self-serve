// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FundType } from '@lfx-one/shared/enums';
import { InitiativeDetail } from '@lfx-one/shared/interfaces';
import { ConfirmationService } from 'primeng/api';
import { afterEach, describe, expect, it } from 'vitest';

import { InitiativeDetailHeaderComponent } from './initiative-detail-header.component';

function detail(overrides: Partial<InitiativeDetail> = {}): InitiativeDetail {
  return {
    id: 'synthetic-initiative-1',
    slug: 'synthetic-initiative',
    name: 'Synthetic Initiative',
    description: '',
    status: 'published',
    initiativeType: FundType.GENERAL_FUND,
    color: '',
    createdOn: '2026-01-01T00:00:00Z',
    updatedOn: '2026-01-01T00:00:00Z',
    isOwner: false,
    ...overrides,
  };
}

describe('InitiativeDetailHeaderComponent creator (lfx-crowdfunding#452)', () => {
  let fixture: ComponentFixture<InitiativeDetailHeaderComponent>;

  afterEach(() => TestBed.resetTestingModule());

  const creatorLine = (value: InitiativeDetail, showCreator: boolean): Element | null => {
    TestBed.configureTestingModule({ imports: [InitiativeDetailHeaderComponent], providers: [ConfirmationService] });
    fixture = TestBed.createComponent(InitiativeDetailHeaderComponent);
    fixture.componentRef.setInput('initiative', value);
    fixture.componentRef.setInput('activeTab', 'overview');
    fixture.componentRef.setInput('showCreator', showCreator);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('[data-testid="initiative-creator"]');
  };

  it('shows the creator on a lens page', () => {
    expect(creatorLine(detail({ creator: 'Synthetic Owner' }), true)?.textContent?.trim()).toBe('Created by Synthetic Owner');
  });

  it('hides the creator outside the lens pages', () => {
    expect(creatorLine(detail({ creator: 'Synthetic Owner' }), false)).toBeNull();
  });

  it('shows no creator line when CF sends no creator', () => {
    expect(creatorLine(detail(), true)).toBeNull();
  });
});

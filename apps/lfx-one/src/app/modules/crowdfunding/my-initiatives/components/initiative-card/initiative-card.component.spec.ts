// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FundType } from '@lfx-one/shared/enums';
import { InitiativeBase } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it } from 'vitest';

import { InitiativeCardComponent } from './initiative-card.component';

function initiative(overrides: Partial<InitiativeBase> = {}): InitiativeBase {
  return {
    id: 'synthetic-initiative-1',
    slug: 'synthetic-initiative',
    name: 'Synthetic Initiative',
    description: '',
    status: 'submitted',
    initiativeType: FundType.GENERAL_FUND,
    color: '',
    createdOn: '2026-01-01T00:00:00Z',
    updatedOn: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('InitiativeCardComponent creator (lfx-crowdfunding#452)', () => {
  let fixture: ComponentFixture<InitiativeCardComponent>;

  afterEach(() => TestBed.resetTestingModule());

  const render = (value: InitiativeBase, showCreator: boolean): HTMLElement => {
    TestBed.configureTestingModule({ imports: [InitiativeCardComponent] });
    fixture = TestBed.createComponent(InitiativeCardComponent);
    fixture.componentRef.setInput('initiative', value);
    fixture.componentRef.setInput('showCreator', showCreator);
    fixture.detectChanges();
    return fixture.nativeElement;
  };
  const creatorLine = (root: HTMLElement): Element | null => root.querySelector('[data-testid="initiative-card-creator"]');
  const card = (root: HTMLElement): Element | null => root.querySelector('[data-testid="initiative-card-synthetic-initiative-1"]');

  it('shows the creator on a lens page', () => {
    const root = render(initiative({ creator: 'Synthetic Owner' }), true);
    expect(creatorLine(root)?.textContent?.trim()).toBe('Created by Synthetic Owner');
    expect(card(root)?.getAttribute('aria-label')).toBe('Synthetic Initiative, Created by Synthetic Owner');
  });

  it('hides the creator outside the lens pages', () => {
    const root = render(initiative({ creator: 'Synthetic Owner' }), false);
    expect(creatorLine(root)).toBeNull();
    expect(card(root)?.getAttribute('aria-label')).toBe('Synthetic Initiative');
  });

  it('shows no creator line when CF sends no creator', () => {
    expect(creatorLine(render(initiative(), true))).toBeNull();
  });
});

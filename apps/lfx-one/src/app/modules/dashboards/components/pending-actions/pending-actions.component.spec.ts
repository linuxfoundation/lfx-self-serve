// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { PendingActionItem } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingService } from '@services/meeting.service';
import { VoteService } from '@services/vote.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { InvitationAcceptFlowService } from '@shared/services/invitation-accept-flow.service';
import { InvitationService } from '@shared/services/invitation.service';
import { MessageService } from 'primeng/api';
import { describe, expect, it } from 'vitest';

import { PendingActionsComponent } from './pending-actions.component';

// #2732: the FormationItem row's rendering contract — the Me-lens design's badge, meta line, status
// chip and one navigation to the checklist item. The RSVP/vote/invitation rows have no spec here;
// this one is scoped to the formation row so it stays light.

const formationRow = (overrides: Partial<PendingActionItem> = {}): PendingActionItem => ({
  type: 'FormationItem',
  badge: 'Acme Project',
  text: 'Complete legal review',
  icon: 'fa-light fa-diagram-project',
  severity: 'accent',
  buttonText: 'View item',
  date: '2026-08-31',
  formationProjectUid: 'project-1',
  formationProjectSlug: 'acme-project',
  formationItemKey: 'legal-review',
  formationItemUid: 'item-1',
  formationItemStatus: 'in_progress',
  formationIsGating: true,
  ...overrides,
});

async function render(actions: PendingActionItem[], flagEnabled = true): Promise<ComponentFixture<PendingActionsComponent>> {
  await TestBed.configureTestingModule({
    imports: [PendingActionsComponent],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(flagEnabled) } },
      { provide: HiddenActionsService, useValue: { isActionHidden: () => false } },
      { provide: InvitationService, useValue: { resolvedInviteUids: signal(new Set<string>()) } },
      { provide: InvitationAcceptFlowService, useValue: {} },
      { provide: MeetingService, useValue: {} },
      { provide: VoteService, useValue: {} },
      // The real service: the template's `p-toast` subscribes to its message/clear observables.
      MessageService,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(PendingActionsComponent);
  fixture.componentRef.setInput('pendingActions', actions);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const byTestId = (fixture: ComponentFixture<PendingActionsComponent>, id: string): HTMLElement | null =>
  fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

describe('PendingActionsComponent — FormationItem row (#2732)', () => {
  it('renders the violet "Formation item" badge, the bold title and the project · due · required-for-Active meta line', async () => {
    const fixture = await render([formationRow()]);

    const row = byTestId(fixture, 'dashboard-pending-actions-item-FormationItem');
    expect(row).not.toBeNull();
    const badge = row?.querySelector('lfx-tag');
    expect(badge?.textContent).toContain('Formation item');
    expect(badge?.querySelector('.bg-violet-50')).not.toBeNull();

    expect(byTestId(fixture, 'dashboard-pending-actions-title')?.textContent).toContain('Complete legal review');
    expect(byTestId(fixture, 'dashboard-pending-actions-formation-project')?.textContent).toContain('Acme Project');
    expect(byTestId(fixture, 'dashboard-pending-actions-formation-due')?.textContent).toContain('due Aug 31');
    expect(byTestId(fixture, 'dashboard-pending-actions-formation-gating')?.textContent).toContain('required for Active');
  });

  it('renders the status chip from the item status', async () => {
    const fixture = await render([formationRow({ formationItemStatus: 'blocked' })]);

    expect(byTestId(fixture, 'dashboard-pending-actions-formation-status')?.textContent).toContain('Blocked');
  });

  it('links View item to the checklist with the item deep link, and offers no Dismiss', async () => {
    const fixture = await render([formationRow()]);

    const anchor = byTestId(fixture, 'dashboard-pending-actions-formation-view')?.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('/project/formation?project=acme-project&item=legal-review');
    expect(anchor?.textContent).toContain('View item');
    expect(anchor?.getAttribute('aria-label')).toBe('View Complete legal review on the formation checklist');
    expect(byTestId(fixture, 'dashboard-pending-actions-dismiss-FormationItem')).toBeNull();
    expect(byTestId(fixture, 'dashboard-pending-actions-formation-open')).toBeNull();
  });

  it('omits the due segment when the row carries no date', async () => {
    const fixture = await render([formationRow({ date: undefined })]);

    expect(byTestId(fixture, 'dashboard-pending-actions-formation-project')).not.toBeNull();
    expect(byTestId(fixture, 'dashboard-pending-actions-formation-due')).toBeNull();
  });

  it('renders no formation row while formation-enabled is off', async () => {
    const fixture = await render([formationRow()], false);

    expect(byTestId(fixture, 'dashboard-pending-actions-item-FormationItem')).toBeNull();
  });
});

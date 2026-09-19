// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { PendingActionItem } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { InvitationService } from '@shared/services/invitation.service';
import { MessageService } from 'primeng/api';
import { afterEach, describe, expect, it } from 'vitest';

import { PendingActionsDrawerComponent } from './pending-actions-drawer.component';

// #2732: the "View all" drawer's FormationItem branch — title over a meta line, a status chip, one
// View item link and no Dismiss — mirroring the dashboard list's own spec. The RSVP, vote and
// invitation branches predate this spec and are not covered here.

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

describe('PendingActionsDrawerComponent — FormationItem row (#2732)', () => {
  let fixture: ComponentFixture<PendingActionsDrawerComponent>;

  // p-drawer is a PrimeNG overlay: it renders into document.body, not into the fixture host, so
  // every assertion here queries the global document — same pattern as formation-item-drawer's spec.
  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
  });

  const render = async (actions: PendingActionItem[]): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PendingActionsDrawerComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: HiddenActionsService, useValue: { isActionHidden: () => false } },
        { provide: InvitationService, useValue: { resolvedInviteUids: signal(new Set<string>()) } },
        { provide: MeetingService, useValue: {} },
        MessageService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PendingActionsDrawerComponent);
    fixture.componentRef.setInput('pendingActions', actions);
    fixture.detectChanges();
    fixture.componentInstance.visible.set(true);
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const byTestId = (id: string): HTMLElement | null => document.body.querySelector(`[data-testid="${id}"]`);

  it('renders the title, the project · due · required-for-Active meta line and the status chip', async () => {
    await render([formationRow()]);

    const row = byTestId('pending-actions-drawer-item-FormationItem');
    expect(row).not.toBeNull();
    expect(row?.querySelector('lfx-tag')?.textContent).toContain('Formation item');
    // Scoped to the row: the drawer header carries the same `pending-actions-drawer-title` id.
    expect(row?.querySelector('[data-testid="pending-actions-drawer-title"]')?.textContent).toContain('Complete legal review');
    expect(byTestId('pending-actions-drawer-formation-project')?.textContent).toContain('Acme Project');
    expect(byTestId('pending-actions-drawer-formation-due')?.textContent).toContain('due Aug 31');
    expect(byTestId('pending-actions-drawer-formation-gating')?.textContent).toContain('required for Active');
    expect(byTestId('pending-actions-drawer-formation-status')?.textContent).toContain('In progress');
  });

  it('links View item to the checklist item and offers no Dismiss', async () => {
    await render([formationRow()]);

    const anchor = byTestId('pending-actions-drawer-formation-view')?.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('/project/formation?project=acme-project&item=legal-review');
    expect(anchor?.getAttribute('aria-label')).toBe('View Complete legal review on the formation checklist');
    expect(document.body.querySelector('[data-testid^="pending-actions-drawer-dismiss"]')).toBeNull();
    expect(byTestId('pending-actions-drawer-formation-open')).toBeNull();
  });

  it('omits the due and required-for-Active segments and the status chip when the row carries none', async () => {
    await render([formationRow({ date: undefined, formationIsGating: false, formationItemStatus: undefined })]);

    expect(byTestId('pending-actions-drawer-formation-project')).not.toBeNull();
    expect(byTestId('pending-actions-drawer-formation-due')).toBeNull();
    expect(byTestId('pending-actions-drawer-formation-gating')).toBeNull();
    expect(byTestId('pending-actions-drawer-formation-status')).toBeNull();
  });
});

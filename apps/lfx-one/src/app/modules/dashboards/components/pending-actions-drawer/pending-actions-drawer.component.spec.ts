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
import { afterEach, describe, expect, it, vi } from 'vitest';

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

// GH-2987: same contract as the dashboard list — a Survey click opens an external SurveyMonkey tab and
// must not write the 24h hide cookie; the row stays until the server drops it (`response_datetime`).
describe('PendingActionsDrawerComponent — Survey row click (GH-2987)', () => {
  const hiddenActions = { isActionHidden: () => false, hideAction: vi.fn(), dismissAction: vi.fn() };
  let fixture: ComponentFixture<PendingActionsDrawerComponent>;

  const surveyRow = (): PendingActionItem => ({
    type: 'Survey',
    badge: 'Acme Project',
    text: 'Acme Project survey is due Oct 1, 2026',
    icon: 'fa-regular fa-clipboard-list',
    severity: 'accent',
    buttonText: 'Submit Survey',
    buttonLink: 'https://www.surveymonkey.com/r/abc123',
    date: 'Due Thu, Oct 1',
  });

  const agendaRow = (): PendingActionItem => ({
    type: 'Agenda',
    badge: 'Oct 6',
    text: 'Review agenda for Board Meeting',
    icon: 'fa-regular fa-file-lines',
    severity: 'accent',
    buttonText: 'Review Agenda',
    buttonLink: '/meetings/meeting-1',
    date: 'Mon, Oct 6, 10:00 AM',
  });

  // p-drawer renders into document.body — query the global document like the formation block above.
  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
    hiddenActions.hideAction.mockClear();
  });

  const renderRow = async (actions: PendingActionItem[]): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PendingActionsDrawerComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: HiddenActionsService, useValue: hiddenActions },
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

  it('keeps the Survey row and writes no hide cookie when Submit Survey is clicked', async () => {
    await renderRow([surveyRow()]);

    const anchor = document.body.querySelector('[data-testid="pending-actions-drawer-item-Survey"] lfx-button a');
    expect(anchor).not.toBeNull();
    (anchor as HTMLAnchorElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(hiddenActions.hideAction).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="pending-actions-drawer-item-Survey"]')).not.toBeNull();
  });

  it('still writes the hide cookie for a non-survey link row (Agenda) on click', async () => {
    await renderRow([agendaRow()]);

    const anchor = document.body.querySelector('[data-testid="pending-actions-drawer-item-Agenda"] lfx-button a');
    expect(anchor).not.toBeNull();
    (anchor as HTMLAnchorElement).click();

    expect(hiddenActions.hideAction).toHaveBeenCalledTimes(1);
  });
});

// Section grouping: rows render under fixed-order section headers (label + count badge + gray divider),
// sections with no visible rows are omitted, and the drawer title keeps the grand total.
describe('PendingActionsDrawerComponent — section grouping', () => {
  let fixture: ComponentFixture<PendingActionsDrawerComponent>;

  // p-drawer renders into document.body — query the global document like the blocks above.
  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
  });

  const row = (type: PendingActionItem['type'], text: string, overrides: Partial<PendingActionItem> = {}): PendingActionItem => ({
    type,
    badge: 'Acme Project',
    text,
    icon: 'fa-light fa-list-check',
    severity: 'warn',
    buttonText: 'Open',
    ...overrides,
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
  // Only the <section> wrappers — the title (h2) and count (lfx-badge) testids share the same prefix.
  const sectionIds = (): (string | null)[] =>
    Array.from(document.body.querySelectorAll('section[data-testid^="pending-actions-drawer-section-"]')).map((el) => el.getAttribute('data-testid'));

  it('renders sections in fixed order with per-section counts, skipping empty sections', async () => {
    await render([row('Survey', 'Survey A'), row('RSVP', 'RSVP A'), row('Vote', 'Vote A'), row('RSVP', 'RSVP B')]);

    expect(sectionIds()).toEqual(['pending-actions-drawer-section-meetings', 'pending-actions-drawer-section-votes', 'pending-actions-drawer-section-surveys']);
    expect(byTestId('pending-actions-drawer-section-count-meetings')?.textContent?.trim()).toBe('2');
    expect(byTestId('pending-actions-drawer-section-count-votes')?.textContent?.trim()).toBe('1');
    expect(byTestId('pending-actions-drawer-section-count-surveys')?.textContent?.trim()).toBe('1');
    expect(byTestId('pending-actions-drawer-section-title-meetings')?.textContent).toContain('Meetings');
    expect(byTestId('pending-actions-drawer-section-title-votes')?.textContent).toContain('Votes');
    expect(byTestId('pending-actions-drawer-section-title-surveys')?.textContent).toContain('Surveys');
    // No Invitation/FormationItem rows fed — their sections stay out of the DOM entirely.
    expect(byTestId('pending-actions-drawer-section-invitations')).toBeNull();
    expect(byTestId('pending-actions-drawer-section-formation')).toBeNull();
    // The drawer title keeps the grand total across sections.
    expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(4)');
  });

  it('nests each row under its own section, preserving feed order within the section', async () => {
    await render([row('RSVP', 'RSVP A'), row('Agenda', 'Agenda A'), row('Vote', 'Vote A')]);

    const meetings = byTestId('pending-actions-drawer-section-meetings');
    // Agenda groups with the meeting RSVPs.
    expect(meetings?.querySelectorAll('[data-testid="pending-actions-drawer-item-RSVP"]').length).toBe(1);
    expect(meetings?.querySelectorAll('[data-testid="pending-actions-drawer-item-Agenda"]').length).toBe(1);
    const titles = Array.from(meetings?.querySelectorAll('[data-testid="pending-actions-drawer-title"]') ?? []).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['RSVP A', 'Agenda A']);

    const votes = byTestId('pending-actions-drawer-section-votes');
    expect(votes?.querySelectorAll('[data-testid="pending-actions-drawer-item-Vote"]').length).toBe(1);
  });

  it('maps the remaining types to their sections', async () => {
    await render([row('Invitation', 'Invite A'), row('FormationItem', 'Formation A'), row('Submitted', 'Submitted A'), row('BriefAction', 'Brief A')]);

    // Surveys leads: 'Submitted' (completed-survey acknowledgement) joins the surveys section ahead of invitations.
    expect(sectionIds()).toEqual([
      'pending-actions-drawer-section-surveys',
      'pending-actions-drawer-section-invitations',
      'pending-actions-drawer-section-formation',
      'pending-actions-drawer-section-other',
    ]);
    expect(byTestId('pending-actions-drawer-section-other')?.querySelectorAll('[data-testid="pending-actions-drawer-item-BriefAction"]').length).toBe(1);
  });

  it('renders the empty state and no sections when nothing is visible', async () => {
    await render([]);

    expect(byTestId('pending-actions-drawer-empty')).not.toBeNull();
    expect(document.body.querySelector('section[data-testid^="pending-actions-drawer-section-"]')).toBeNull();
  });
});

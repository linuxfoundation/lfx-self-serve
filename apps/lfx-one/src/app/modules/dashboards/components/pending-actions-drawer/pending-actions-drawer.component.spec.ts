// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { PENDING_ACTION_FADE_OUT_MS } from '@lfx-one/shared/constants';
import type { Meeting, PendingActionItem } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { InvitationService } from '@shared/services/invitation.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
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
// sections with no visible rows are omitted, and the drawer title keeps the grand total. The block also
// exercises the row actions inside the sectioned structure (GH-3166 criterion 5) — Dismiss, Cast Vote,
// invitation Accept/Decline and the inline RSVP group all live one nesting level deeper than before.
describe('PendingActionsDrawerComponent — section grouping', () => {
  let fixture: ComponentFixture<PendingActionsDrawerComponent>;

  // Mirror the real HiddenActionsService contract: hide/dismiss write a cookie, after which
  // isActionHidden reports the row hidden — the completion fade-out relies on that pair staying in sync.
  // Keyed on identity fields (like the real getActionIdentifier), not object identity: the drawer's
  // visibleRows decoration spreads each wire row into a fresh object on every recompute.
  const hiddenKeys = new Set<string>();
  const keyOf = (item: PendingActionItem): string =>
    [item.type, item.meetingUid, item.voteUid, item.briefActionUid, item.formationItemUid, item.badge, item.text, item.buttonLink].filter(Boolean).join('|');
  const hiddenActions = {
    isActionHidden: (item: PendingActionItem) => hiddenKeys.has(keyOf(item)),
    hideAction: vi.fn((item: PendingActionItem) => void hiddenKeys.add(keyOf(item))),
    dismissAction: vi.fn((item: PendingActionItem) => void hiddenKeys.add(keyOf(item))),
  };
  // Minimal Meeting the inline RSVP group will render: invite responses on, no recurrence.
  const meeting = { id: 'meeting-1', topic: 'Board Meeting', is_invite_responses_enabled: true } as unknown as Meeting;
  const meetingService = { getMeeting: vi.fn(() => of(meeting)), getMeetingRsvpForCurrentUser: vi.fn(() => of(null)) };

  // p-drawer renders into document.body — query the global document like the blocks above.
  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
    hiddenKeys.clear();
    vi.clearAllMocks();
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
        { provide: HiddenActionsService, useValue: hiddenActions },
        { provide: InvitationService, useValue: { resolvedInviteUids: signal(new Set<string>()) } },
        { provide: MeetingService, useValue: meetingService },
        // The inline RSVP child reads userService.user/authenticated at field-init. DialogService needs no
        // provider: the child declares its own component-level `providers: [DialogService]`, which shadows
        // any TestBed provider (the recurring-scope modal is never opened here).
        { provide: UserService, useValue: { user: signal(null), authenticated: signal(false) } },
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
    // Criterion 2: each header carries its divider line, and the section wrapper is a labeled group.
    for (const [section, label] of [
      ['meetings', 'Meetings'],
      ['votes', 'Votes'],
      ['surveys', 'Surveys'],
    ] as const) {
      const el = byTestId(`pending-actions-drawer-section-${section}`);
      expect(el?.getAttribute('role')).toBe('group');
      expect(el?.getAttribute('aria-label')).toBe(label);
      expect(el?.querySelector('div.border-t[aria-hidden="true"]')).not.toBeNull();
    }
    // No Invitation/FormationItem rows fed — their sections stay out of the DOM entirely.
    expect(byTestId('pending-actions-drawer-section-invitations')).toBeNull();
    expect(byTestId('pending-actions-drawer-section-formation')).toBeNull();
    // The drawer title keeps the grand total across sections.
    expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(4)');
  });

  it('keeps the header total equal to the sum of the section badges when a row is hidden', async () => {
    // Pre-hidden via the mock's cookie contract (matched by identity fields) — it never reaches visibleRows.
    hiddenActions.hideAction(row('Survey', 'Survey Hidden'));
    await render([row('RSVP', 'RSVP A'), row('Vote', 'Vote A'), row('Survey', 'Survey Hidden')]);

    // Three rows fed, one hidden: the header counts only what the sections render.
    expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(2)');
    expect(byTestId('pending-actions-drawer-section-count-meetings')?.textContent?.trim()).toBe('1');
    expect(byTestId('pending-actions-drawer-section-count-votes')?.textContent?.trim()).toBe('1');
    expect(byTestId('pending-actions-drawer-section-surveys')).toBeNull();
  });

  // A row whose type this bundle doesn't know still renders — under the catch-all section — so the
  // header total and the section counts never disagree (server/app bundle version skew).
  it('lands rows with an unknown type in the Other section rather than dropping them', async () => {
    await render([row('Bogus' as PendingActionItem['type'], 'Mystery A')]);

    const other = byTestId('pending-actions-drawer-section-other');
    expect(other).not.toBeNull();
    expect(other?.querySelectorAll('[data-testid="pending-actions-drawer-item-Bogus"]').length).toBe(1);
    expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(1)');
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

  const applicationRow = (overrides: Partial<PendingActionItem> = {}): PendingActionItem =>
    row('JoinApplication', 'Applicant', {
      badge: 'Group Alpha',
      committeeUid: 'group-alpha',
      applicationUid: 'application-1',
      applicationApplicantEmail: 'applicant@example.com',
      applicationApplicantName: 'Applicant Name',
      ...overrides,
    });

  it('places independent same-email applications after invitations and before formation, without links or Dismiss', async () => {
    const first = applicationRow({ buttonLink: '/must-not-navigate' });
    const second = applicationRow({ committeeUid: 'group-beta', badge: 'Group Beta', applicationApplicantName: undefined });
    await render([formationRow(), second, row('Invitation', 'Invite A'), first]);

    expect(sectionIds()).toEqual([
      'pending-actions-drawer-section-invitations',
      'pending-actions-drawer-section-applications',
      'pending-actions-drawer-section-formation',
    ]);
    const applications = byTestId('pending-actions-drawer-section-applications');
    const rows = applications?.querySelectorAll('[data-testid="pending-actions-drawer-item-JoinApplication"]');
    expect(rows?.length).toBe(2);
    expect(rows?.[0].textContent).toContain('applicant@example.com');
    expect(rows?.[0].textContent).toContain('Group Beta');
    expect(rows?.[0].querySelector('[data-testid="pending-actions-drawer-application-name"]')).toBeNull();
    expect(rows?.[1].textContent).toContain('Applicant Name');
    expect(rows?.[1].textContent).toContain('applicant@example.com');
    expect(rows?.[1].textContent).toContain('Group Alpha');
    expect(applications?.querySelector('a')).toBeNull();
    expect(applications?.querySelector('[data-testid^="pending-actions-drawer-dismiss-"]')).toBeNull();
    expect(byTestId('pending-actions-drawer-section-count-applications')?.textContent?.trim()).toBe('2');
    expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(4)');

    fixture.componentRef.setInput('pendingActions', [formationRow(), first, row('Invitation', 'Invite A')]);
    fixture.detectChanges();
    expect(applications?.querySelectorAll('[data-testid="pending-actions-drawer-item-JoinApplication"]').length).toBe(1);
    expect(applications?.textContent).toContain('Group Alpha');
    expect(applications?.textContent).not.toContain('Group Beta');
    expect(byTestId('pending-actions-drawer-section-count-applications')?.textContent?.trim()).toBe('1');
    expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(3)');
    expect(hiddenActions.hideAction).not.toHaveBeenCalled();
    expect(hiddenActions.dismissAction).not.toHaveBeenCalled();
  });

  it('retains rows and counts while only the matched approval loads and every review control is disabled', async () => {
    await render([applicationRow(), applicationRow({ committeeUid: 'group-beta', badge: 'Group Beta' })]);
    fixture.componentRef.setInput('processingApplicationKey', 'JoinApplication-group-alpha-application-1');
    fixture.detectChanges();

    const section = byTestId('pending-actions-drawer-section-applications');
    const approvals = section?.querySelectorAll('[data-testid="pending-actions-drawer-application-approve"] button');
    expect(approvals?.[0].textContent).toContain('Saving');
    expect(approvals?.[1].textContent).toContain('Approve');
    const controls = Array.from(section?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    expect(controls).toHaveLength(4);
    expect(controls.every((button) => button.disabled)).toBe(true);
    const loadingButtons = fixture.debugElement
      .queryAll(By.directive(ButtonComponent))
      .map((element) => element.componentInstance as ButtonComponent)
      .filter((button) => button.loading());
    expect(loadingButtons).toHaveLength(1);
    expect(loadingButtons[0].label()).toBe('Saving');
    expect(byTestId('pending-actions-drawer-section-count-applications')?.textContent?.trim()).toBe('2');
    expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(2)');

    fixture.componentRef.setInput('processingApplicationKey', null);
    fixture.detectChanges();
    expect(controls.every((button) => !button.disabled)).toBe(true);
    expect(hiddenActions.hideAction).not.toHaveBeenCalled();
    expect(hiddenActions.dismissAction).not.toHaveBeenCalled();
  });

  it.each(['committeeUid', 'applicationUid', 'applicationApplicantEmail'] as const)(
    'disables review when %s is missing without dropping the row',
    async (field) => {
      await render([applicationRow({ [field]: undefined })]);
      const controls = Array.from(byTestId('pending-actions-drawer-section-applications')?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      expect(controls).toHaveLength(2);
      expect(controls.every((button) => button.disabled)).toBe(true);
      expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(1)');
    }
  );

  it('preserves distinct incomplete request views when the feed reorders and replaces rows', async () => {
    const first = applicationRow({ applicationUid: undefined, text: 'first@example.com', applicationApplicantEmail: 'first@example.com' });
    const second = applicationRow({ applicationUid: undefined, text: 'second@example.com', applicationApplicantEmail: 'second@example.com' });
    await render([first, second]);
    const getRows = () => Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="pending-actions-drawer-item-JoinApplication"]'));
    const initial = getRows();
    fixture.componentRef.setInput('pendingActions', [{ ...second }, { ...first }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const reordered = getRows();
    expect(reordered[0]).toBe(initial[1]);
    expect(reordered[1]).toBe(initial[0]);
    expect(reordered.map((row) => row.querySelector('[data-testid="pending-actions-drawer-application-email"]')?.textContent?.trim())).toEqual([
      'second@example.com',
      'first@example.com',
    ]);

    const third = applicationRow({ applicationUid: undefined, text: 'third@example.com', applicationApplicantEmail: 'third@example.com' });
    fixture.componentRef.setInput('pendingActions', [{ ...second }, third]);
    fixture.detectChanges();
    expect(getRows()[0]).toBe(initial[1]);
    expect(initial[0].isConnected).toBe(false);
    expect(getRows().map((row) => row.querySelector('[data-testid="pending-actions-drawer-application-email"]')?.textContent?.trim())).toEqual([
      'second@example.com',
      'third@example.com',
    ]);
    expect(
      getRows()
        .flatMap((row) => Array.from(row.querySelectorAll<HTMLButtonElement>('button')))
        .every((button) => button.disabled)
    ).toBe(true);
  });

  it('cannot cookie-complete or dismiss an application through generic row handlers', async () => {
    await render([applicationRow()]);
    const component = fixture.componentInstance;
    const application = component['visibleRows']()[0];
    component['handleAgendaOrOtherClick'](application);
    component['handleDismiss'](application);
    component['startCompletion'](application);
    fixture.detectChanges();

    expect(hiddenActions.hideAction).not.toHaveBeenCalled();
    expect(hiddenActions.dismissAction).not.toHaveBeenCalled();
    expect(component['completingRowKeys']().size).toBe(0);
    expect(byTestId('pending-actions-drawer-item-JoinApplication')).not.toBeNull();
    expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(1)');
  });

  it('renders the empty state and no sections when nothing is visible', async () => {
    await render([]);

    expect(byTestId('pending-actions-drawer-empty')).not.toBeNull();
    expect(document.body.querySelector('section[data-testid^="pending-actions-drawer-section-"]')).toBeNull();
  });

  // Criterion 3's dynamic half: the section rides out the completing row's fade-out, then disappears
  // once the dismissal takes effect — its sibling section and the corrected grand total remain.
  it('keeps the section mounted through the fade-out, then removes it when its last row is dismissed', async () => {
    await render([row('Vote', 'Vote A', { voteUid: 'vote-1' }), row('Survey', 'Survey A')]);
    expect(byTestId('pending-actions-drawer-section-votes')).not.toBeNull();

    vi.useFakeTimers();
    try {
      const dismiss = document.body.querySelector('[data-testid="pending-actions-drawer-dismiss-Vote"]') as HTMLButtonElement | null;
      expect(dismiss).not.toBeNull();
      dismiss?.click();
      fixture.detectChanges();

      // Mid-fade: the completing row keeps its section and the grand total mounted.
      expect(hiddenActions.dismissAction).toHaveBeenCalledTimes(1);
      expect(byTestId('pending-actions-drawer-section-votes')).not.toBeNull();
      expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(2)');

      await vi.advanceTimersByTimeAsync(PENDING_ACTION_FADE_OUT_MS);
      fixture.detectChanges();

      // Fade drained: the empty section is gone, the sibling section stays, the total re-counts.
      expect(byTestId('pending-actions-drawer-section-votes')).toBeNull();
      expect(byTestId('pending-actions-drawer-section-surveys')).not.toBeNull();
      expect(byTestId('pending-actions-drawer-count')?.textContent).toContain('(1)');
    } finally {
      vi.useRealTimers();
    }
  });

  // Criterion 5 wiring, one per row action, each asserted inside its own section.
  it('closes the drawer and emits the vote uid when Cast Vote is clicked inside the votes section', async () => {
    await render([row('Vote', 'Vote A', { voteUid: 'vote-1', buttonText: 'Cast Vote' })]);
    const castVoteSpy = vi.fn();
    fixture.componentInstance.castVoteRequested.subscribe(castVoteSpy);

    const button = byTestId('pending-actions-drawer-section-votes')?.querySelector('[data-testid="pending-actions-drawer-vote-button"] button');
    expect(button).not.toBeNull();
    (button as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(castVoteSpy).toHaveBeenCalledWith('vote-1');
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('delegates invitation Accept/Decline to the parent outputs from the invitations section', async () => {
    await render([row('Invitation', 'Invite A', { inviteUid: 'inv-1', committeeUid: 'com-1', buttonText: 'Accept' })]);
    const acceptSpy = vi.fn();
    const declineSpy = vi.fn();
    fixture.componentInstance.acceptInvitationRequested.subscribe(acceptSpy);
    fixture.componentInstance.declineInvitationRequested.subscribe(declineSpy);

    const section = byTestId('pending-actions-drawer-section-invitations');
    const accept = section?.querySelector('[data-testid="pending-actions-drawer-invitation-accept"] button');
    const decline = section?.querySelector('[data-testid="pending-actions-drawer-invitation-decline"] button');
    expect(accept).not.toBeNull();
    expect(decline).not.toBeNull();
    (accept as HTMLButtonElement).click();
    (decline as HTMLButtonElement).click();

    expect(acceptSpy).toHaveBeenCalledTimes(1);
    expect(acceptSpy).toHaveBeenCalledWith(expect.objectContaining({ inviteUid: 'inv-1' }));
    expect(declineSpy).toHaveBeenCalledTimes(1);
    // The row stays put — resolution (and removal) is the parent's optimistic markResolved.
    expect(hiddenActions.dismissAction).not.toHaveBeenCalled();
    expect(hiddenActions.hideAction).not.toHaveBeenCalled();
  });

  it('renders the inline RSVP buttons inside the meetings section once the meeting loads', async () => {
    await render([row('RSVP', 'RSVP A', { meetingUid: 'meeting-1' })]);

    expect(meetingService.getMeeting).toHaveBeenCalledWith('meeting-1');
    await fixture.whenStable();
    fixture.detectChanges();

    const meetings = byTestId('pending-actions-drawer-section-meetings');
    expect(meetings?.querySelector('[data-testid="pending-actions-drawer-rsvp-buttons"]')).not.toBeNull();
    expect(meetings?.querySelector('[data-testid="meeting-rsvp-button-yes"]')).not.toBeNull();
  });

  it('loads a new RSVP after an empty feed refresh without closing the drawer', async () => {
    await render([row('Survey', 'Survey A')]);
    fixture.componentRef.setInput('pendingActions', []);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(byTestId('pending-actions-drawer-empty')).not.toBeNull();

    fixture.componentRef.setInput('pendingActions', [row('RSVP', 'New meeting', { meetingUid: 'meeting-1' })]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.visible()).toBe(true);
    expect(byTestId('pending-actions-drawer-rsvp-loading')).toBeNull();
    expect(byTestId('meeting-rsvp-button-yes')).not.toBeNull();
  });

  it('recovers a failed RSVP load on replacement feeds while the same drawer remains open', async () => {
    const action = row('RSVP', 'Synthetic meeting', { meetingUid: 'meeting-1', buttonLink: '/meetings/meeting-1' });
    meetingService.getMeeting.mockReturnValueOnce(throwError(() => new Error('Transient outage')));
    await render([action]);
    expect(byTestId('meeting-rsvp-button-yes')).toBeNull();
    expect(byTestId('pending-actions-drawer-item-RSVP')?.querySelector('a')?.getAttribute('href')).toBe('/meetings/meeting-1');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(meetingService.getMeeting).toHaveBeenCalledOnce();

    fixture.componentRef.setInput('pendingActions', [{ ...action }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.visible()).toBe(true);
    expect(byTestId('meeting-rsvp-button-yes')).not.toBeNull();
    expect(meetingService.getMeeting).toHaveBeenCalledTimes(2);
  });
});

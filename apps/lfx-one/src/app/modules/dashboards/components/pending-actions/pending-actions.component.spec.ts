// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { PendingActionItem } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { VoteService } from '@services/vote.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { InvitationAcceptFlowService } from '@shared/services/invitation-accept-flow.service';
import { InvitationService } from '@shared/services/invitation.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Spyable hide/dismiss mock: the Survey click contract (GH-2987) asserts no hide cookie is written.
const hiddenActions = { isActionHidden: () => false, hideAction: vi.fn(), dismissAction: vi.fn() };
const reviewClient = { approveApplication: vi.fn(), rejectApplication: vi.fn() };

async function render(actions: PendingActionItem[], flagEnabled = true): Promise<ComponentFixture<PendingActionsComponent>> {
  await TestBed.configureTestingModule({
    imports: [PendingActionsComponent],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(flagEnabled) } },
      { provide: HiddenActionsService, useValue: hiddenActions },
      { provide: InvitationService, useValue: { resolvedInviteUids: signal(new Set<string>()) } },
      { provide: InvitationAcceptFlowService, useValue: {} },
      { provide: MeetingService, useValue: {} },
      { provide: VoteService, useValue: {} },
      { provide: CommitteeService, useValue: reviewClient },
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

// GH-2987: a Survey row opens an external SurveyMonkey tab — a click is not a completion the app can
// observe, so it must not write the 24h hide cookie; the row stays until the server drops it
// (`response_datetime` stamped on submit). The Agenda contrast case pins the unchanged link-row behavior.
describe('PendingActionsComponent — Survey row click (GH-2987)', () => {
  const surveyRow = (overrides: Partial<PendingActionItem> = {}): PendingActionItem => ({
    type: 'Survey',
    badge: 'Acme Project',
    text: 'Acme Project survey is due Oct 1, 2026',
    icon: 'fa-regular fa-clipboard-list',
    severity: 'accent',
    buttonText: 'Submit Survey',
    buttonLink: 'https://www.surveymonkey.com/r/abc123',
    date: 'Due Thu, Oct 1',
    ...overrides,
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

  beforeEach(() => {
    hiddenActions.hideAction.mockClear();
  });

  it('keeps the Survey row visible and writes no hide cookie when Submit Survey is clicked', async () => {
    const fixture = await render([surveyRow()]);
    const clicked: PendingActionItem[] = [];
    fixture.componentInstance.actionClick.subscribe((item) => clicked.push(item));

    const anchor = byTestId(fixture, 'dashboard-pending-actions-item-Survey')?.querySelector('lfx-button a');
    expect(anchor).not.toBeNull();
    (anchor as HTMLAnchorElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(hiddenActions.hideAction).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(1);
    expect(byTestId(fixture, 'dashboard-pending-actions-item-Survey')).not.toBeNull();
  });

  it('still writes the hide cookie for a non-survey link row (Agenda) on click', async () => {
    const fixture = await render([agendaRow()]);

    const anchor = byTestId(fixture, 'dashboard-pending-actions-item-Agenda')?.querySelector('lfx-button a');
    expect(anchor).not.toBeNull();
    (anchor as HTMLAnchorElement).click();

    expect(hiddenActions.hideAction).toHaveBeenCalledTimes(1);
  });
});

describe('PendingActionsComponent — saved-only application review', () => {
  let fixture: ComponentFixture<PendingActionsComponent>;
  let save: Subject<unknown>;
  const application = (group: string, overrides: Partial<PendingActionItem> = {}): PendingActionItem => ({
    type: 'JoinApplication',
    badge: group,
    text: 'applicant@example.com',
    icon: 'fa-light fa-user-check',
    severity: 'warn',
    buttonText: '',
    committeeUid: group,
    applicationUid: 'same-request',
    applicationApplicantEmail: 'applicant@example.com',
    ...overrides,
  });
  const applications = () => [application('Group A'), application('Group B'), application('Group C'), formationRow()];
  const surfaces = ['dashboard', 'drawer'] as const;
  const decisions = ['approve', 'reject'] as const;
  const cases = surfaces.flatMap((surface) => decisions.map((decision) => ({ surface, decision })));
  const control = (id: string): HTMLButtonElement => document.body.querySelector<HTMLButtonElement>(`[data-testid="${id}"] button`)!;
  const stabilize = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const openDrawer = async () => {
    byTestId(fixture, 'dashboard-pending-actions-view-all')!.querySelector<HTMLButtonElement>('button')!.click();
    await stabilize();
  };
  const overlayButton = (label: string): HTMLButtonElement =>
    [...document.body.querySelectorAll<HTMLButtonElement>('.p-confirmdialog button')].find((button) => button.textContent?.trim() === label)!;
  const begin = async (surface: (typeof surfaces)[number], decision: (typeof decisions)[number]) => {
    if (surface === 'drawer') await openDrawer();
    const prefix = surface === 'drawer' ? 'pending-actions-drawer' : 'dashboard-pending-actions';
    const host = surface === 'drawer' ? document.body : (fixture.nativeElement as HTMLElement);
    host.querySelector<HTMLButtonElement>(`[data-testid="${prefix}-application-${decision}"] button`)!.click();
    await stabilize();
  };
  const finishOverlay = async (decision: (typeof decisions)[number], cancel = false, notes = '') => {
    if (decision === 'approve') overlayButton(cancel ? 'Cancel' : 'Approve').click();
    else {
      const textarea = document.body.querySelector<HTMLTextAreaElement>('[data-testid="reject-application-dialog"] textarea')!;
      textarea.value = notes;
      textarea.dispatchEvent(new Event('input'));
      control(cancel ? 'reject-application-cancel' : 'reject-application-submit').click();
    }
    await stabilize();
  };
  beforeEach(() => {
    save = new Subject<unknown>();
    reviewClient.approveApplication.mockReset().mockReturnValue(save);
    reviewClient.rejectApplication.mockReset().mockReturnValue(save);
    hiddenActions.hideAction.mockClear();
    hiddenActions.dismissAction.mockClear();
  });
  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
  });

  it.each(cases)(
    'retains both surfaces/counts until $decision from $surface saves, then removes only that address and refills',
    async ({ surface, decision }) => {
      fixture = await render(applications());
      const refresh = vi.fn();
      fixture.componentInstance.actionClick.subscribe(refresh);
      await begin(surface, decision);
      expect(reviewClient.approveApplication).not.toHaveBeenCalled();
      expect(reviewClient.rejectApplication).not.toHaveBeenCalled();
      await finishOverlay(decision, false, '  review notes  ');
      if (surface === 'dashboard') await openDrawer();
      expect(document.body.querySelector('[data-testid="pending-actions-drawer-count"]')?.textContent).toContain('(4)');
      expect(fixture.nativeElement.querySelectorAll('[data-testid="dashboard-pending-actions-item-JoinApplication"]')).toHaveLength(2);
      const controls = document.body.querySelectorAll<HTMLButtonElement>(
        '[data-testid*="application-approve"] button, [data-testid*="application-reject"] button'
      );
      expect(controls.length).toBe(10);
      expect([...controls].every((button) => button.disabled)).toBe(true);
      expect(refresh).not.toHaveBeenCalled();
      if (decision === 'reject') expect(reviewClient.rejectApplication).toHaveBeenCalledWith('Group A', 'same-request', 'review notes');
      save.next({});
      save.complete();
      await stabilize();
      expect(refresh).toHaveBeenCalledOnce();
      expect(document.body.querySelector('[data-testid="pending-actions-drawer-count"]')?.textContent).toContain('(3)');
      expect([...document.body.querySelectorAll('[data-testid="pending-actions-drawer-item-JoinApplication"]')].map((row) => row.textContent)).toEqual([
        expect.stringContaining('Group B'),
        expect.stringContaining('Group C'),
      ]);
      expect(
        [...fixture.nativeElement.querySelectorAll('[data-testid="dashboard-pending-actions-application-group"]')].map(
          (node) => (node as HTMLElement).textContent
        )
      ).toEqual(['Group B', 'Group C']);
      expect(hiddenActions.hideAction).not.toHaveBeenCalled();
      expect(hiddenActions.dismissAction).not.toHaveBeenCalled();
      expect(document.body.querySelector('[data-testid="dashboard-pending-actions-dismiss-JoinApplication"]')).toBeNull();
      expect(document.body.querySelector('[data-testid="pending-actions-drawer-dismiss-JoinApplication"]')).toBeNull();
      fixture.componentRef.setInput('pendingActions', applications());
      await stabilize();
      expect(document.body.querySelector('[data-testid="pending-actions-drawer-count"]')?.textContent).toContain('(4)');
      // A replacement feed can legitimately reinstate the same UID; it is reviewable again.
      await begin('drawer', 'approve');
      await finishOverlay('approve');
      expect(reviewClient.approveApplication.mock.calls.length + reviewClient.rejectApplication.mock.calls.length).toBe(2);
    }
  );

  it.each(decisions)('keeps the drawer open when the final %s saves, through empty refresh and explicit close', async (decision) => {
    fixture = await render(applications().slice(0, 3));
    await openDrawer();
    for (let remaining = 3; remaining > 0; remaining--) {
      save = new Subject<unknown>();
      reviewClient.approveApplication.mockReturnValue(save);
      reviewClient.rejectApplication.mockReturnValue(save);
      control(`pending-actions-drawer-application-${decision}`).click();
      await stabilize();
      await finishOverlay(decision);
      save.next({});
      save.complete();
      await stabilize();
    }

    // Leave the authoritative refresh pending beyond the section's empty grace and collapse timers.
    await new Promise((resolve) => setTimeout(resolve, 700));
    await stabilize();
    expect(document.body.querySelector('[data-testid="pending-actions-drawer-empty"]')?.textContent).toContain('All caught up!');
    expect(document.body.querySelector('[data-testid="pending-actions-drawer-count"]')?.textContent).toContain('(0)');
    expect(fixture.componentInstance['drawerVisible']()).toBe(true);

    fixture.componentRef.setInput('pendingActions', []);
    await stabilize();
    expect(document.body.querySelector('[data-testid="pending-actions-drawer-empty"]')?.textContent).toContain('All caught up!');
    document.body.querySelector<HTMLButtonElement>('[data-testid="pending-actions-drawer-close"]')!.click();
    await stabilize();
    expect(fixture.componentInstance['drawerVisible']()).toBe(false);
  });

  it.each(cases)('keeps the request when $decision from $surface is cancelled or fails, and permits a retry', async ({ surface, decision }) => {
    fixture = await render(applications());
    const refresh = vi.fn();
    fixture.componentInstance.actionClick.subscribe(refresh);
    await begin(surface, decision);
    await finishOverlay(decision, true);
    expect(reviewClient.approveApplication).not.toHaveBeenCalled();
    expect(reviewClient.rejectApplication).not.toHaveBeenCalled();
    // The drawer is already open after cancellation; initiate there to avoid clicking behind an overlay.
    if (surface === 'drawer') control(`pending-actions-drawer-application-${decision}`).click();
    else byTestId(fixture, `dashboard-pending-actions-application-${decision}`)!.querySelector<HTMLButtonElement>('button')!.click();
    await stabilize();
    await finishOverlay(decision);
    save.error(new HttpErrorResponse({ status: 409, error: { error: 'Already reviewed by another admin' } }));
    await stabilize();
    expect(fixture.nativeElement.textContent).toContain('Group A');
    expect(document.body.textContent).toContain('Already reviewed by another admin');
    expect(refresh).not.toHaveBeenCalled();
    expect(hiddenActions.hideAction).not.toHaveBeenCalled();
    expect(hiddenActions.dismissAction).not.toHaveBeenCalled();
    const retry = new Subject<unknown>();
    reviewClient.approveApplication.mockReturnValue(retry);
    reviewClient.rejectApplication.mockReturnValue(retry);
    if (surface === 'drawer') control(`pending-actions-drawer-application-${decision}`).click();
    else byTestId(fixture, `dashboard-pending-actions-application-${decision}`)!.querySelector<HTMLButtonElement>('button')!.click();
    await stabilize();
    await finishOverlay(decision);
    retry.next({});
    retry.complete();
    await stabilize();
    expect(refresh).toHaveBeenCalledOnce();
    expect(byTestId(fixture, 'dashboard-pending-actions-application-group')?.textContent).toBe('Group B');
  });

  it('renders untrusted applicant/group confirmation text inertly and refuses duplicate/stale approval callbacks', async () => {
    const markup = '<img src="https://host.example/p.gif"><a href="https://host.example">name</a>';
    const row = application(markup, { applicationApplicantName: markup });
    fixture = await render([row, ...applications().slice(1)]);
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    await begin('dashboard', 'approve');
    const dialog = document.body.querySelector('.p-confirmdialog')!;
    expect(dialog.querySelector('img, a')).toBeNull();
    expect(dialog.textContent).toContain(markup);
    const accept = confirm.mock.calls[0][0].accept!;
    await finishOverlay('approve');
    accept();
    expect(reviewClient.approveApplication).toHaveBeenCalledOnce();
    save.next({});
    save.complete();
    await stabilize();
    fixture.componentRef.setInput('pendingActions', [row, ...applications().slice(1)]);
    await stabilize();
    accept();
    expect(reviewClient.approveApplication).toHaveBeenCalledOnce();
    await begin('dashboard', 'approve');
    const stale = confirm.mock.calls[1][0].accept!;
    fixture.componentRef.setInput('pendingActions', applications().slice(1));
    await stabilize();
    stale();
    expect(reviewClient.approveApplication).toHaveBeenCalledOnce();
  });

  it('sends no rejection after its address leaves the current feed, and treats empty confirmed notes as a decision', async () => {
    fixture = await render(applications());
    await begin('dashboard', 'reject');
    fixture.componentRef.setInput('pendingActions', applications().slice(1));
    await stabilize();
    await finishOverlay('reject');
    expect(reviewClient.rejectApplication).not.toHaveBeenCalled();
    await begin('dashboard', 'reject');
    await finishOverlay('reject', false, '  ');
    expect(reviewClient.rejectApplication).toHaveBeenCalledWith('Group B', 'same-request', undefined);
    save.next({});
    save.complete();
    await stabilize();
    expect(byTestId(fixture, 'dashboard-pending-actions-application-group')?.textContent).toBe('Group C');
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal, TemplateRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GROUPS_HOME_UNDO_MS } from '@lfx-one/shared/constants';
import { MyCommittee, PendingInvitation, UiToastConfig } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { InvitationService } from '@services/invitation.service';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { EMPTY, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupsHomeStore } from '../../services/groups-home.store';

import { GroupInvitationsComponent } from './group-invitations.component';

const invitation = (uid: string, extra: Partial<PendingInvitation> = {}): PendingInvitation =>
  ({
    uid,
    committee_uid: `committee-${uid}`,
    committee_name: `Synthetic Group ${uid}`,
    project_name: 'Synthetic Foundation',
    project_logo_url: 'https://logos.example/synthetic.svg',
    category: 'Working Group',
    inviter_name: 'Synthetic Inviter',
    expires_at: '2026-11-12T12:00:00Z',
    invitee_email: 'invitee@synthetic.example',
    status: 'pending',
    created_at: '2026-10-13T12:00:00Z',
    organization_required: false,
    ...extra,
  }) as PendingInvitation;

describe('GroupInvitationsComponent', () => {
  let fixture: ComponentFixture<GroupInvitationsComponent>;
  let fallback: HTMLButtonElement;
  let pending: ReturnType<typeof signal<PendingInvitation[]>>;
  let resolved: ReturnType<typeof signal<Set<string>>>;
  let accept: ReturnType<typeof vi.fn<() => Observable<void>>>;
  let decline: ReturnType<typeof vi.fn<() => Observable<void>>>;
  let show: ReturnType<typeof vi.fn<(config: UiToastConfig) => { id: string; dismiss: () => void }>>;
  let dismiss: ReturnType<typeof vi.fn<() => void>>;
  let refresh: ReturnType<typeof vi.fn>;
  let openDrawer: ReturnType<typeof vi.fn>;
  let closeDrawer: ReturnType<typeof vi.fn<() => void>>;

  const byTestId = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
  const all = (testId: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const trigger = (): HTMLButtonElement | null => byTestId('groups-redesign-invitations-button')?.querySelector('button') ?? null;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
  };
  const render = async (invitations: PendingInvitation[]): Promise<void> => {
    pending.set(invitations);
    fixture = TestBed.createComponent(GroupInvitationsComponent);
    fixture.componentRef.setInput('fallbackFocus', fallback);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  };
  const open = async (): Promise<void> => {
    trigger()?.click();
    await settle();
  };
  const press = async (row: HTMLElement, testId: string): Promise<void> => {
    const button = row.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement;
    button.focus();
    button.click();
    await settle();
  };

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
    fallback = document.body.appendChild(document.createElement('button'));
    pending = signal<PendingInvitation[]>([]);
    resolved = signal(new Set<string>());
    accept = vi.fn(() => of(undefined));
    decline = vi.fn(() => of(undefined));
    dismiss = vi.fn<() => void>();
    show = vi.fn(() => ({ id: 'toast', dismiss }));
    refresh = vi.fn();
    closeDrawer = vi.fn<() => void>();
    // Renders the drawer template straight into the page; the uikit drawer has its own spec.
    openDrawer = vi.fn((template: TemplateRef<unknown>) => {
      const view = template.createEmbeddedView({});
      TestBed.inject(ApplicationRef).attachView(view);
      document.body.append(...view.rootNodes);
      const closed = new Subject<void>();
      return {
        closed,
        close: () => {
          closeDrawer();
          view.rootNodes.forEach((node: Node) => node.parentNode?.removeChild(node));
          view.destroy();
          closed.next();
          closed.complete();
        },
      };
    });
    const stash = new Map<string, PendingInvitation>();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: InvitationService,
          useValue: {
            pendingInvitations: pending,
            resolvedInviteUids: resolved,
            loadPendingInvitations: () => EMPTY,
            declineInvitation: decline,
            forgetResolved: vi.fn(),
            markResolved: (uid: string) => {
              const found = pending().find((item) => item.uid === uid);
              if (found) stash.set(uid, found);
              resolved.update((uids) => new Set([...uids, uid]));
              pending.update((items) => items.filter((item) => item.uid !== uid));
            },
            unmarkResolved: (uid: string) => {
              resolved.update((uids) => new Set([...uids].filter((item) => item !== uid)));
              const found = stash.get(uid);
              if (found) pending.update((items) => [...items, found]);
            },
          },
        },
        { provide: InvitationAcceptFlowService, useValue: { accept } },
        { provide: CommitteeService, useValue: { getMyCommittees: () => of([{ uid: 'committee-a' } as MyCommittee]) } },
        { provide: GroupsHomeStore, useValue: { refresh } },
        { provide: UiDrawerService, useValue: { open: openDrawer } },
        { provide: UiToastService, useValue: { show } },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture.destroy();
    fallback.remove();
    vi.restoreAllMocks();
  });

  it('is hidden while no invitation is open', async () => {
    await render([]);

    expect(trigger()).toBeNull();
  });

  it('counts the open invitations and opens a 640px drawer with the count waiting', async () => {
    await render([invitation('a'), invitation('b')]);

    expect(text(byTestId('groups-redesign-invitations-count'))).toBe('2');
    expect(trigger()?.getAttribute('aria-label')).toBe('Invitations (2)');
    await open();

    expect(openDrawer).toHaveBeenCalledWith(expect.any(TemplateRef), { width: 640, describedBy: true });
    expect(text(byTestId('ui-drawer-title'))).toBe('Invitations');
    expect(text(byTestId('ui-drawer-subtitle'))).toBe('2 waiting for a response');
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the scope, group, type and who invited, or a plain line without an inviter', async () => {
    await render([invitation('a'), invitation('b', { inviter_name: null, category: null })]);
    await open();

    const rows = all('groups-redesign-invitations-row');
    expect(text(rows[0].querySelector('[data-testid="groups-redesign-invitations-row-scope"]'))).toBe('Synthetic Foundation');
    expect(text(rows[0].querySelector('[data-testid="groups-redesign-invitations-row-name"]'))).toBe('Synthetic Group a');
    const meta = (row: HTMLElement): string[] =>
      Array.from(row.querySelectorAll('[data-testid="groups-redesign-invitations-row-meta"] > span'), (span) => text(span));
    expect(meta(rows[0])).toEqual(['Working Group', '·', 'Invited by Synthetic Inviter · Expires Nov 12, 2026']);
    expect(meta(rows[1])).toEqual(['Other', '·', "You've been invited"]);
    expect(rows[0].querySelector('[data-testid="groups-redesign-invitations-accept"] button')?.getAttribute('aria-label')).toBe(
      'Accept invite to Synthetic Group a'
    );
  });

  it('accepts, drops the row, confirms the join and refreshes the groups once the group is listed', async () => {
    await render([invitation('a'), invitation('b')]);
    await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    (all('groups-redesign-invitations-row')[0].querySelector('[data-testid="groups-redesign-invitations-accept"] button') as HTMLButtonElement).click();

    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ committeeUid: 'committee-a', inviteUid: 'a', committeeName: 'Synthetic Group a' }));
    expect(show).toHaveBeenCalledWith({ message: "You've joined Synthetic Group a" });
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    await settle();
    expect(all('groups-redesign-invitations-row')).toHaveLength(1);
  });

  it('closes the drawer before the company step, so its dialog is not under the drawer', async () => {
    const answered = new Subject<void>();
    accept.mockReturnValue(answered);
    await render([invitation('a', { organization_required: true }), invitation('b')]);
    await open();
    await press(all('groups-redesign-invitations-row')[0], 'groups-redesign-invitations-accept');

    expect(closeDrawer).toHaveBeenCalled();
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ inviteUid: 'a', inviteRequiresOrganization: true }));
    expect(text(byTestId('groups-redesign-invitations-count'))).toBe('2');
    expect(trigger()?.getAttribute('aria-busy')).toBe('true');
    answered.next();
    answered.complete();
    await settle();
    expect(text(byTestId('groups-redesign-invitations-count'))).toBe('1');
  });

  it('puts the invitation back when accepting fails', async () => {
    accept.mockReturnValue(throwError(() => new Error('upstream')));
    await render([invitation('a')]);
    await open();
    await press(all('groups-redesign-invitations-row')[0], 'groups-redesign-invitations-accept');

    expect(all('groups-redesign-invitations-row')).toHaveLength(1);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: "Couldn't accept the invitation" }));
  });

  it('declines after the Undo window and closes its toast', async () => {
    await render([invitation('a'), invitation('b')]);
    await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    (all('groups-redesign-invitations-row')[0].querySelector('[data-testid="groups-redesign-invitations-decline"] button') as HTMLButtonElement).click();

    expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invite declined', duration: GROUPS_HOME_UNDO_MS }));
    expect(decline).not.toHaveBeenCalled();
    vi.advanceTimersByTime(GROUPS_HOME_UNDO_MS);
    expect(decline).toHaveBeenCalledWith('committee-a', 'a');
    expect(dismiss).toHaveBeenCalled();
  });

  it('brings the invitation back on Undo without declining it', async () => {
    await render([invitation('a'), invitation('b')]);
    await open();
    await press(all('groups-redesign-invitations-row')[0], 'groups-redesign-invitations-decline');
    expect(all('groups-redesign-invitations-row')).toHaveLength(1);

    show.mock.calls[0][0].actions?.[0].run();
    await settle();
    expect(all('groups-redesign-invitations-row')).toHaveLength(2);
    fixture.destroy();
    expect(decline).not.toHaveBeenCalled();
  });

  it('repeats Undo in the drawer, where the keyboard can reach it', async () => {
    await render([invitation('a'), invitation('b')]);
    await open();
    await press(all('groups-redesign-invitations-row')[0], 'groups-redesign-invitations-decline');

    const undo = byTestId('groups-redesign-invitations-undo')?.querySelector('button') as HTMLButtonElement;
    expect(undo.getAttribute('aria-label')).toBe('Undo declining the invite to Synthetic Group a');
    undo.click();
    await settle();
    expect(dismiss).toHaveBeenCalled();
    expect(all('groups-redesign-invitations-row')).toHaveLength(2);
    expect(byTestId('groups-redesign-invitations-undo')).toBeNull();
    fixture.destroy();
    expect(decline).not.toHaveBeenCalled();
  });

  it('sends a pending decline when the page goes away', async () => {
    await render([invitation('a'), invitation('b')]);
    await open();
    await press(all('groups-redesign-invitations-row')[0], 'groups-redesign-invitations-decline');
    fixture.destroy();

    expect(decline).toHaveBeenCalledWith('committee-a', 'a');
  });

  it('closes the drawer with the last invitation and hands focus to the fallback', async () => {
    await render([invitation('a')]);
    await open();
    await press(all('groups-redesign-invitations-row')[0], 'groups-redesign-invitations-decline');

    expect(closeDrawer).toHaveBeenCalled();
    expect(trigger()).toBeNull();
    expect(document.activeElement).toBe(fallback);
  });
});

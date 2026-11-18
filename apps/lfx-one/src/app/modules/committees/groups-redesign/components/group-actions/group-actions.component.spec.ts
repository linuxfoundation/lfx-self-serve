// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '@environments/environment';
import { MyCommittee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupsHomeStore } from '../../services/groups-home.store';
import { GroupActionsComponent } from './group-actions.component';

const group = (extra: Partial<MyCommittee> = {}): MyCommittee =>
  ({
    uid: 'g1',
    name: 'Docs WG',
    category: 'Technical Advisory Committee',
    public: true,
    total_members: 12,
    my_role: 'Member',
    project_name: 'Synthetic Project',
    ...extra,
  }) as MyCommittee;

describe('GroupActionsComponent', () => {
  let leave$: Subject<void>;
  let removeGroup: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;
  let copy: ReturnType<typeof vi.fn>;

  const render = async (value: MyCommittee): Promise<ComponentFixture<GroupActionsComponent>> => {
    const fixture = TestBed.createComponent(GroupActionsComponent);
    fixture.componentRef.setInput('group', value);
    await fixture.whenStable();
    return fixture;
  };
  const byTestId = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
  const text = (element: Element | null): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const openMenu = async (fixture: ComponentFixture<GroupActionsComponent>): Promise<void> => {
    byTestId('group-actions-trigger')?.querySelector('button')?.click();
    await fixture.whenStable();
  };
  const openLeaveDialog = async (fixture: ComponentFixture<GroupActionsComponent>): Promise<void> => {
    await openMenu(fixture);
    byTestId('group-actions-leave')?.click();
    await fixture.whenStable();
  };

  beforeEach(() => {
    leave$ = new Subject();
    removeGroup = vi.fn();
    show = vi.fn();
    copy = vi.fn(() => true);
    TestBed.configureTestingModule({
      providers: [
        { provide: CommitteeService, useValue: { leaveCommittee: vi.fn(() => leave$) } },
        { provide: GroupsHomeStore, useValue: { removeGroup } },
        { provide: UiToastService, useValue: { show } },
        { provide: Clipboard, useValue: { copy } },
      ],
    });
  });

  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((container) => (container.innerHTML = '')));

  it('names the group on the trigger, and offers Copy group link only for a public group', async () => {
    const fixture = await render(group({ public: false }));
    expect(byTestId('group-actions-trigger')?.querySelector('button')?.getAttribute('aria-label')).toBe('More actions for Docs WG');

    await openMenu(fixture);
    expect(byTestId('group-actions-copy-link')).toBeNull();
    expect(text(byTestId('group-actions-leave'))).toBe('Leave group');
  });

  it("copies the group's vanity link", async () => {
    const fixture = await render(group({ sso_group_name: 'docs-wg' }));
    await openMenu(fixture);
    byTestId('group-actions-copy-link')?.click();

    expect(copy).toHaveBeenCalledWith(`${environment.urls.home}/groups/docs-wg`);
    expect(show).toHaveBeenCalledWith({ variant: 'dark', message: 'Link copied' });
  });

  it('confirms with the group, its type, members and visibility, then leaves and drops it from the list', async () => {
    const fixture = await render(group());
    await openLeaveDialog(fixture);

    expect(text(byTestId('group-leave-group'))).toContain('Docs WG');
    expect(text(byTestId('group-leave-meta'))).toBe('Technical Advisory Committee · 12 members · Public');

    byTestId('group-leave-confirm')?.querySelector('button')?.click();
    leave$.next();
    leave$.complete();
    await fixture.whenStable();

    expect(removeGroup).toHaveBeenCalledWith('g1');
    expect(show).toHaveBeenCalledWith({ variant: 'dark', message: 'You have left "Docs WG"' });
    expect(byTestId('group-leave-dialog')).toBeNull();
  });

  it('keeps the group and the dialog when leaving fails', async () => {
    const fixture = await render(group());
    await openLeaveDialog(fixture);

    byTestId('group-leave-confirm')?.querySelector('button')?.click();
    leave$.error(new HttpErrorResponse({ status: 404 }));
    await fixture.whenStable();

    expect(removeGroup).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: 'You are not a member of this group.' }));
    expect(byTestId('group-leave-dialog')).not.toBeNull();
  });
});

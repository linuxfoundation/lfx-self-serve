// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CommitteeMemberRole } from '@lfx-one/shared/enums';
import { MyCommittee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupsHomeStore } from '../../services/groups-home.store';
import { GroupsTableComponent } from './groups-table.component';

const group = (uid: string, extra: Partial<MyCommittee> = {}): MyCommittee =>
  ({
    uid,
    name: `Group ${uid}`,
    category: 'Technical Advisory Committee',
    behavioralClass: 'oversight-committee',
    public: true,
    enable_voting: true,
    total_members: 1200,
    my_role: 'Chair',
    is_foundation: false,
    project_slug: 'synthetic-proj',
    project_name: 'Synthetic Project',
    ...extra,
  }) as MyCommittee;

describe('GroupsTableComponent', () => {
  let navigate: ReturnType<typeof vi.spyOn>;

  const render = async (groups: MyCommittee[]): Promise<ComponentFixture<GroupsTableComponent>> => {
    const fixture = TestBed.createComponent(GroupsTableComponent);
    fixture.componentRef.setInput('groups', groups);
    await fixture.whenStable();
    return fixture;
  };
  const rows = (fixture: ComponentFixture<GroupsTableComponent>): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid="ui-table-row"]'));
  const cells = (row: HTMLElement): string[] =>
    Array.from(row.querySelectorAll('[data-testid="ui-table-cell"]')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: CommitteeService, useValue: {} }, { provide: GroupsHomeStore, useValue: {} }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  it("shows each group's name and project, own type, role, members and voting", async () => {
    const fixture = await render([group('a'), group('b', { category: '', my_role: CommitteeMemberRole.NONE, enable_voting: false, public: false })]);
    const [first, second] = rows(fixture);

    expect(cells(first).slice(0, 6)).toEqual(['Group aSynthetic Project', 'Technical Advisory Committee', 'Chair', '1,200', '', 'Enabled']);
    expect(cells(second)[1]).toBe('Oversight');
    expect(cells(second)[2]).toBe('Member');
    expect(cells(second)[5]).toBe('Disabled');
  });

  it('shows the chat channel and the menu in their columns', async () => {
    const fixture = await render([group('a', { chat_channel: 'https://acme.slack.com/archives/C1' })]);
    const [row] = rows(fixture);

    expect(row.querySelector('[data-testid="group-channel-slack"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="group-actions-trigger"]')).not.toBeNull();
  });

  it('opens the group on its tier when the row is clicked, keeping the back label', async () => {
    const fixture = await render([group('a')]);

    rows(fixture)[0].click();
    expect(navigate).toHaveBeenCalledWith(['/', 'project', 'groups', 'a'], {
      queryParams: { project: 'synthetic-proj' },
      state: { backLabel: 'Groups', fromMeLens: true },
    });
    expect(fixture.nativeElement.querySelector('[data-testid="groups-table-name"]')?.getAttribute('href')).toBe('/project/groups/a?project=synthetic-proj');
  });
});

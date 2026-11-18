// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BEHAVIORAL_CLASS_CONFIG, BEHAVIORAL_CLASS_TONE, GROUPS_HOME_LINK_STATE } from '@lfx-one/shared/constants';
import { CommitteeMemberRole } from '@lfx-one/shared/enums';
import { GroupsTableRow, MyCommittee, UiTableColumn } from '@lfx-one/shared/interfaces';
import { getGroupCommands } from '@lfx-one/shared/utils';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiTableCellDirective } from '@shared/uikit/table/table-cell.directive';
import { UiTableComponent } from '@shared/uikit/table/table.component';

import { GroupActionsComponent } from '../group-actions/group-actions.component';
import { GroupChannelsComponent } from '../group-channels/group-channels.component';
import { GroupScopeLinkComponent } from '../group-scope-link/group-scope-link.component';
import { GroupVisibilityComponent } from '../group-visibility/group-visibility.component';
import { GroupsTableRowPipe } from './groups-table-row.pipe';

/** The Groups page list view: one table row per group, opening the group on click. */
@Component({
  selector: 'lfx-groups-table',
  imports: [
    RouterLink,
    UiBadgeComponent,
    UiTableComponent,
    UiTableCellDirective,
    GroupActionsComponent,
    GroupChannelsComponent,
    GroupScopeLinkComponent,
    GroupVisibilityComponent,
    GroupsTableRowPipe,
  ],
  templateUrl: './groups-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class GroupsTableComponent {
  private readonly router = inject(Router);

  public readonly groups = input.required<MyCommittee[]>();

  protected readonly columns: UiTableColumn[] = [
    { key: 'name', header: 'Group' },
    { key: 'type', header: 'Type' },
    { key: 'role', header: 'My Role' },
    { key: 'members', header: 'Members', align: 'end' },
    { key: 'channels', header: 'Channels' },
    { key: 'voting', header: 'Voting' },
    { key: 'actions', header: '', align: 'end' },
  ];
  protected readonly linkState = GROUPS_HOME_LINK_STATE;
  protected readonly rows: Signal<GroupsTableRow[]> = this.initRows();

  protected openGroup(row: Record<string, unknown>): void {
    const { commands, queryParams } = row as GroupsTableRow;
    void this.router.navigate(commands, { queryParams, state: this.linkState });
  }

  private initRows(): Signal<GroupsTableRow[]> {
    return computed(() =>
      this.groups().map((group) => {
        const behavioralClass = group.behavioralClass ?? 'other';
        const display = group.classDisplay ?? BEHAVIORAL_CLASS_CONFIG[behavioralClass];
        const role = group.my_role && group.my_role !== CommitteeMemberRole.NONE ? group.my_role : 'Member';
        return {
          uid: group.uid,
          group,
          typeLabel: group.category?.trim() || display.label,
          typeIcon: display.icon,
          typeTone: BEHAVIORAL_CLASS_TONE[behavioralClass],
          role,
          members: (group.total_members ?? 0).toLocaleString('en-US'),
          commands: getGroupCommands(group) ?? ['/groups', group.uid],
          queryParams: group.project_slug ? { project: group.project_slug } : null,
        };
      })
    );
  }
}

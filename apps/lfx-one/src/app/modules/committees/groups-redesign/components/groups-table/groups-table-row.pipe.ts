// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { GroupsTableRow } from '@lfx-one/shared/interfaces';

/** Types a uikit table cell's row back to the groups table row it was built from. */
@Pipe({ name: 'groupsTableRow' })
export class GroupsTableRowPipe implements PipeTransform {
  public transform(row: Record<string, unknown>): GroupsTableRow {
    return row as GroupsTableRow;
  }
}

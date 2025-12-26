// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { PermissionMatrixItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-permissions-matrix',
  imports: [CardComponent, TagComponent],
  templateUrl: './permissions-matrix.component.html',
})
export class PermissionsMatrixComponent {
  protected readonly permissionMatrix: PermissionMatrixItem[] = [
    {
      scope: 'Project',
      level: 'View',
      description: 'View all project resources',
      capabilities: ['View project, committees, meetings, mailing lists'],
      badge: {
        color: 'text-blue-800',
        bgColor: 'bg-blue-100',
        severity: 'info',
      },
    },
    {
      scope: 'Project',
      level: 'Manage',
      description: 'Manage all project resources',
      capabilities: ['Manage project, committees, meetings, mailing lists'],
      badge: {
        color: 'text-emerald-800',
        bgColor: 'bg-emerald-100',
        severity: 'success',
      },
    },
  ];
}

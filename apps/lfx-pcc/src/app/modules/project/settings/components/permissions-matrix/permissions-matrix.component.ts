// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { PermissionMatrixItem } from '@lfx-pcc/shared/interfaces';

@Component({
  selector: 'lfx-permissions-matrix',
  standalone: true,
  imports: [CardComponent],
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
      },
    },
    {
      scope: 'Project',
      level: 'Manage',
      description: 'Manage all project resources',
      capabilities: ['Manage project, committees, meetings, mailing lists'],
      badge: {
        color: 'text-blue-800',
        bgColor: 'bg-blue-100',
      },
    },
    {
      scope: 'Committee',
      level: 'View',
      description: 'View specific committee only, including meetings and mailing lists that are associated with the committees.',
      capabilities: [
        'View project (limited to committees)',
        'View assigned committees',
        'View meetings associated with the committees',
        'View mailing lists associated with the committees',
      ],
      badge: {
        color: 'text-green-800',
        bgColor: 'bg-green-100',
      },
    },
    {
      scope: 'Committee',
      level: 'Manage',
      description: 'Manage specific committee only, including meetings and mailing lists that are associated with the committees.',
      capabilities: [
        'View project (limited to committees)',
        'Manage assigned committees',
        'Manage meetings associated with the committees',
        'Manage mailing lists associated with the committees',
      ],
      badge: {
        color: 'text-green-800',
        bgColor: 'bg-green-100',
      },
    },
  ];
}

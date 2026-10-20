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
    {
      scope: 'Project',
      level: 'Meeting Coordinator',
      description: 'Run meetings and review the project. Read-only outside of meetings',
      capabilities: [
        'View the project: details, links, folders and documents',
        'Create, update and delete meetings and past meetings, including registrants, attachments and recordings',
        'View every committee in the project: members and their email addresses, invites, applications, links, documents and settings',
        'View the mailing lists, votes and surveys linked to those committees',
      ],
      badge: {
        color: 'text-purple-800',
        bgColor: 'bg-purple-100',
        severity: 'secondary',
      },
    },
  ];
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { User } from './auth';
import { Committee } from './committee.interface';

export type PermissionLevel = 'read' | 'write';
export type PermissionScope = 'project' | 'committee';

export interface ProjectPermission {
  id: number;
  user_id: string;
  project_uid: string;
  permission_level: PermissionLevel;
  created_at?: string;
  updated_at?: string;
}

export interface CommitteePermission {
  id: number;
  user_id: string;
  project_uid: string;
  committee_id: string;
  permission_level: PermissionLevel;
  created_at?: string;
  updated_at?: string;
}

export interface MailingList {
  id: string;
  name: string;
  description?: string;
  committee_id?: string;
  project_uid: string;
}

export interface UserPermissionSummary {
  user: Partial<User>;
  projectPermission?: {
    level: PermissionLevel;
    scope: 'project';
  };
  committeePermissions: {
    committee: Committee;
    level: PermissionLevel;
    scope: 'committee';
  }[];
}

export interface CreateUserPermissionRequest {
  first_name: string;
  last_name: string;
  email: string;
  username?: string;
  project_uid: string;
  permission_scope: PermissionScope;
  permission_level: PermissionLevel;
  committee_ids?: string[]; // Required when scope is 'committee'
}

export interface UpdateUserPermissionRequest {
  user_id: string;
  project_uid: string;
  permission_scope: PermissionScope;
  permission_level: PermissionLevel;
  committee_ids?: string[]; // Required when scope is 'committee'
}

export interface PermissionMatrixItem {
  scope: string;
  level: string;
  description: string;
  capabilities: string[];
  badge: {
    color: string;
    bgColor: string;
  };
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { User } from './auth';

export interface Role {
  id: number;
  name: string;
  description: string;
}

export interface UserRole {
  id: number;
  user_id: string;
  project_id: string;
  role_id: number;
  roles?: Role;
}

export interface ObjectPermission {
  id: number;
  user_id: string;
  object_type: 'meeting' | 'committee' | 'mailing_list';
  object_id: string;
  permission: string;
  committee_name?: string;
}

export interface Meeting {
  id: number;
  name: string;
  description?: string;
  project_id: number;
}

export interface MailingList {
  id: number;
  name: string;
  description?: string;
  project_id: number;
}

export interface UserPermissions {
  user: Partial<User>;
  projectRoles: UserRole[];
  permissions: {
    meetings: {
      manageAll: boolean;
      specific: ObjectPermission[];
    };
    committees: {
      manageAll: boolean;
      specific: ObjectPermission[];
    };
    mailingLists: {
      manageAll: boolean;
      specific: ObjectPermission[];
    };
  };
}

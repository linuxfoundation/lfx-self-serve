// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { User } from './auth.interface';
import { Committee } from './committee.interface';
import { TagSeverity } from './components.interface';

/**
 * Permission levels available in the system
 * @description Access control levels for users within projects and committees
 */
export type PermissionLevel = 'read' | 'write';

/**
 * Permission scope types
 * @description Areas where permissions can be applied
 */
export type PermissionScope = 'project' | 'committee';

/**
 * Project-level permission assignment
 * @description Grants user access to entire project with specified permission level
 */
export interface ProjectPermission {
  /** Unique permission record ID */
  id: number;
  /** User ID this permission applies to */
  user_id: string;
  /** Project UID this permission applies to */
  project_uid: string;
  /** Level of access granted */
  permission_level: PermissionLevel;
  /** Timestamp when permission was created */
  created_at?: string;
  /** Timestamp when permission was last updated */
  updated_at?: string;
}

/**
 * Committee-level permission assignment
 * @description Grants user access to specific committee with specified permission level
 */
export interface CommitteePermission {
  /** Unique permission record ID */
  id: number;
  /** User ID this permission applies to */
  user_id: string;
  /** Project UID containing the committee */
  project_uid: string;
  /** Committee ID this permission applies to */
  committee_id: string;
  /** Level of access granted */
  permission_level: PermissionLevel;
  /** Timestamp when permission was created */
  created_at?: string;
  /** Timestamp when permission was last updated */
  updated_at?: string;
}

/**
 * Mailing list entity
 * @description Communication channel associated with projects or committees
 */
export interface MailingList {
  /** Unique mailing list identifier */
  id: string;
  /** Mailing list display name */
  name: string;
  /** Optional description of the mailing list purpose */
  description?: string;
  /** Associated committee ID (if committee-specific) */
  committee_id?: string;
  /** Project UID this mailing list belongs to */
  project_uid: string;
}

/**
 * Comprehensive user permission summary
 * @description Complete overview of a user's permissions across project and committees
 */
export interface UserPermissionSummary {
  /** User profile information */
  user: Partial<User>;
  /** Project-level permission (if any) */
  projectPermission?: {
    /** Permission level granted */
    level: PermissionLevel;
    /** Scope identifier */
    scope: 'project';
  };
  /** Array of committee-specific permissions */
  committeePermissions: {
    /** Committee this permission applies to */
    committee: Committee;
    /** Permission level granted */
    level: PermissionLevel;
    /** Scope identifier */
    scope: 'committee';
  }[];
}

/**
 * Data required to create user permissions
 * @description Input payload for granting permissions to new or existing users
 */
export interface CreateUserPermissionRequest {
  /** User's first name */
  first_name: string;
  /** User's last name */
  last_name: string;
  /** User's email address */
  email: string;
  /** User's username (optional) */
  username?: string;
  /** Project UID to grant permissions for */
  project_uid: string;
  /** Scope of permission (project or committee level) */
  permission_scope: PermissionScope;
  /** Level of access to grant */
  permission_level: PermissionLevel;
  /** Committee IDs (required when scope is 'committee') */
  committee_ids?: string[];
}

/**
 * Data required to update user permissions
 * @description Input payload for modifying existing user permissions
 */
export interface UpdateUserPermissionRequest {
  /** User ID to update permissions for */
  user_id: string;
  /** Project UID the permissions apply to */
  project_uid: string;
  /** Scope of permission (project or committee level) */
  permission_scope: PermissionScope;
  /** Level of access to grant */
  permission_level: PermissionLevel;
  /** Committee IDs (required when scope is 'committee') */
  committee_ids?: string[];
}

/**
 * Simplified user permission for display
 * @description Simplified representation of user permissions for table display
 */
export interface ProjectPermissionUser {
  /** User's full name */
  name: string;
  /** User's email address */
  email: string;
  /** Username identifier */
  username: string;
  /** URL to user's avatar image (optional) */
  avatar?: string;
  /** Permission role - 'view' for auditors, 'manage' for writers */
  role: 'view' | 'manage';
}

/**
 * Request payload for adding user to project
 * @description Data required to add a user to project writers or auditors
 * Can include optional manual entry fields when user is not found in directory
 */
export interface AddUserToProjectRequest {
  /** Username to add */
  username: string;
  /** Role to assign - 'view' for auditors, 'manage' for writers */
  role: 'view' | 'manage';
  /** User's full name (optional, for manual entry when user not found) */
  name?: string;
  /** User's email address (optional, for manual entry when user not found) */
  email?: string;
  /** User's avatar URL (optional, for manual entry when user not found) */
  avatar?: string;
}

/**
 * Request payload for updating user role in project
 * @description Data required to change a user's role in project
 */
export interface UpdateUserRoleRequest {
  /** New role to assign - 'view' for auditors, 'manage' for writers */
  role: 'view' | 'manage';
}

/**
 * Permission matrix display item
 * @description UI representation of permission capabilities with visual styling
 */
export interface PermissionMatrixItem {
  /** Permission scope (project/committee) */
  scope: string;
  /** Permission level (read/write) */
  level: string;
  /** Human-readable description of the permission */
  description: string;
  /** List of capabilities this permission grants */
  capabilities: string[];
  /** Visual styling for the permission badge */
  badge: {
    /** Text color */
    color: string;
    /** Background color */
    bgColor: string;
    /** Semantic severity level for tag component */
    severity?: TagSeverity;
  };
}

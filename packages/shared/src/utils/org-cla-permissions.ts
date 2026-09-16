// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ACS_CLA_APPROVAL_LIST_ACTION,
  ACS_CLA_APPROVAL_LIST_RESOURCE,
  ACS_CLA_PROJECT_ORG_OBJECT_TYPE,
  ACS_CLA_SIGN_ACTION,
  ACS_CLA_SIGN_RESOURCE,
  ORG_CLA_PERMISSION_ACTIONS,
} from '../constants/cla.constants';
import type { OrgClaGroup, OrgClaPermissionAction } from '../interfaces/cla.interface';

export function isOrgClaPermissionAction(value: unknown): value is OrgClaPermissionAction {
  return typeof value === 'string' && (ORG_CLA_PERMISSION_ACTIONS as readonly string[]).includes(value);
}

/**
 * The project/foundation half of an ACS `project|organization` pair, matching how Sign already
 * chooses `projectSfid`: foundation when the CLA Group is foundation-level, otherwise the sole
 * covered project. Ambiguous coverage (several projects, no foundation id) yields nothing so the
 * caller can fail closed rather than guess.
 */
export function orgClaPairProjectSfid(group: Pick<OrgClaGroup, 'foundationSfid' | 'projects'>): string | undefined {
  const foundation = group.foundationSfid?.trim();
  if (foundation) return foundation;

  if (group.projects.length !== 1) return undefined;
  const only = group.projects[0]?.projectSfid?.trim();
  return only || undefined;
}

export function buildOrgClaAcsPermission(input: { action: OrgClaPermissionAction; projectOrFoundationSfid: string; companySfid: string }): string {
  const resource = input.action === 'sign' ? ACS_CLA_SIGN_RESOURCE : ACS_CLA_APPROVAL_LIST_RESOURCE;
  const verb = input.action === 'sign' ? ACS_CLA_SIGN_ACTION : ACS_CLA_APPROVAL_LIST_ACTION;
  return `${resource}:${verb}:${ACS_CLA_PROJECT_ORG_OBJECT_TYPE}:${input.projectOrFoundationSfid}|${input.companySfid}`;
}

/**
 * Structured ACS ACL as GET `/v1/me/permissions` returns it — PascalCase from the user-service,
 * with camelCase accepted so a gateway rewrite cannot silently fail closed for the wrong reason.
 *
 * Live ACS puts every `project|organization` pair (or a company SFID) on one scope as `ID: string[]`.
 * A single string is still accepted.
 */
export interface AcsPermissionScope {
  ID?: string | string[];
  id?: string | string[];
  Type?: string;
  type?: string;
}

export interface AcsAclPermission {
  Resource?: string;
  resource?: string;
  Actions?: string[];
  actions?: string[];
  Scopes?: AcsPermissionScope[];
  scopes?: AcsPermissionScope[];
}

export interface AcsMePermissions {
  Permissions?: AcsAclPermission[];
  permissions?: AcsAclPermission[];
}

function asPermissionList(payload: unknown): AcsAclPermission[] {
  if (Array.isArray(payload)) return payload as AcsAclPermission[];
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as AcsMePermissions;
  const list = body.Permissions ?? body.permissions;
  return Array.isArray(list) ? list : [];
}

function asScopeIds(scope: AcsPermissionScope): string[] {
  const raw = scope.ID ?? scope.id;
  const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (id) ids.push(id);
  }
  return ids;
}

function idCoversCompany(id: string, companySfid: string): boolean {
  if (id === companySfid) return true;
  const sep = id.lastIndexOf('|');
  return sep !== -1 && id.slice(sep + 1) === companySfid;
}

function scopeCoversCompany(scope: AcsPermissionScope, companySfid: string): boolean {
  return asScopeIds(scope).some((id) => idCoversCompany(id, companySfid));
}

/**
 * Company-level Sign grant for the list toolbar, which has no project id yet.
 *
 * Walks GET `/v1/me/permissions`. Does not OR role names — a `cla-signatory` label without the
 * create-corporate-signature resource is not a grant.
 */
export function viewerHasCompanySignGrant(payload: unknown, companySfid: string): boolean {
  if (!companySfid) return false;

  for (const entry of asPermissionList(payload)) {
    const resource = (entry.Resource ?? entry.resource ?? '').trim();
    if (resource !== ACS_CLA_SIGN_RESOURCE) continue;

    const actions = entry.Actions ?? entry.actions ?? [];
    if (!actions.includes(ACS_CLA_SIGN_ACTION)) continue;

    const scopes = entry.Scopes ?? entry.scopes ?? [];
    if (scopes.some((scope) => scopeCoversCompany(scope, companySfid))) return true;
  }

  return false;
}

export function acsCheckAllowed(payload: unknown, permission: string): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const map = (payload as { permissions?: Record<string, boolean> }).permissions;
  return map?.[permission] === true;
}

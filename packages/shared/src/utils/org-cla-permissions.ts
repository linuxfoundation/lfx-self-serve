// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ACS_CLA_APPROVAL_LIST_ACTION,
  ACS_CLA_APPROVAL_LIST_RESOURCE,
  ACS_CLA_MANAGER_DELETE_ACTION,
  ACS_CLA_MANAGER_DELETE_RESOURCE,
  ACS_CLA_PROJECT_ORG_OBJECT_TYPE,
  ACS_CLA_SIGN_ACTION,
  ACS_CLA_SIGN_RESOURCE,
  CCLA_SIGN_COPY,
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

function acsParts(action: OrgClaPermissionAction): { resource: string; verb: string } {
  switch (action) {
    case 'sign':
      return { resource: ACS_CLA_SIGN_RESOURCE, verb: ACS_CLA_SIGN_ACTION };
    case 'approval-list-update':
      return { resource: ACS_CLA_APPROVAL_LIST_RESOURCE, verb: ACS_CLA_APPROVAL_LIST_ACTION };
    case 'cla-manager-delete':
      return { resource: ACS_CLA_MANAGER_DELETE_RESOURCE, verb: ACS_CLA_MANAGER_DELETE_ACTION };
  }
}

export function buildOrgClaAcsPermission(input: { action: OrgClaPermissionAction; projectOrFoundationSfid: string; companySfid: string }): string {
  const { resource, verb } = acsParts(input.action);
  return `${resource}:${verb}:${ACS_CLA_PROJECT_ORG_OBJECT_TYPE}:${input.projectOrFoundationSfid}|${input.companySfid}`;
}

/**
 * Live ACS `POST /v1/me/permissions/checks` answers a map keyed by the permission string.
 * A wrapped `{ permissions: { ... } }` envelope is not that contract and must fail closed.
 */
export function acsCheckAllowed(payload: unknown, permission: string): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return (payload as Record<string, unknown>)[permission] === true;
}

/** PrimeNG error toast when ACS denies (or the hop fails) a Sign pair check. */
export function orgClaSignForbiddenToast(): { severity: 'error'; summary: string; detail: string } {
  return {
    severity: 'error',
    summary: CCLA_SIGN_COPY.forbidden.summary,
    detail: CCLA_SIGN_COPY.forbidden.detail,
  };
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ACS_CLA_APPROVAL_LIST_ACTION,
  ACS_CLA_APPROVAL_LIST_RESOURCE,
  ACS_CLA_AUTO_ECLA_ACTION,
  ACS_CLA_AUTO_ECLA_RESOURCE,
  ACS_CLA_ECLA_INVALIDATE_ACTION,
  ACS_CLA_ECLA_INVALIDATE_RESOURCE,
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
 * The project/foundation half of an ACS `project|organization` pair, matching
 * `resolveClaGroupContext` in `apps/lfx-one/src/server/services/org-cla.service.ts`: first covered
 * project SFID, else foundation. `pairProjectSfid` is that scan taken before the mapper drops
 * nameless projects from `projects` for display — prefer it so a covered project with an id and
 * no name still beats a parent foundation. Deliberately not Sign's `signingChoiceFrom`, which
 * stays foundation-first. Signing grants `cla-manager` on mapped projects, so the covered project
 * comes first; a manager EasyCLA granted on the foundation instead is matched by
 * `orgClaPairFoundationSfid`. Yields nothing only when there is no project id and no foundation
 * id, so the caller can hide Add.
 */
export function orgClaPairProjectSfid(group: Pick<OrgClaGroup, 'foundationSfid' | 'projects' | 'pairProjectSfid'>): string | undefined {
  const pinned = group.pairProjectSfid?.trim();
  if (pinned) return pinned;

  const covered = group.projects.find((project) => !!project.projectSfid?.trim())?.projectSfid?.trim();
  if (covered) return covered;

  const foundation = group.foundationSfid?.trim();
  return foundation || undefined;
}

/**
 * The second pair a manager-only check also asks about: the CLA Group's foundation SFID, when it
 * differs from `orgClaPairProjectSfid`. EasyCLA grants `cla-manager` on the foundation alone when
 * the foundation is signed at foundation level, and an ACS check on a covered project does not
 * match that grant, although EasyCLA's own write authorization accepts it for the covered project.
 * Yields nothing when there is no foundation id or the pair is already the foundation.
 */
export function orgClaPairFoundationSfid(group: Pick<OrgClaGroup, 'foundationSfid' | 'projects' | 'pairProjectSfid'>): string | undefined {
  const foundation = group.foundationSfid?.trim();
  if (!foundation) return undefined;
  return foundation === orgClaPairProjectSfid(group) ? undefined : foundation;
}

function acsParts(action: OrgClaPermissionAction): { resource: string; verb: string } {
  switch (action) {
    case 'sign':
      return { resource: ACS_CLA_SIGN_RESOURCE, verb: ACS_CLA_SIGN_ACTION };
    case 'approval-list-update':
      return { resource: ACS_CLA_APPROVAL_LIST_RESOURCE, verb: ACS_CLA_APPROVAL_LIST_ACTION };
    case 'cla-manager-delete':
      return { resource: ACS_CLA_MANAGER_DELETE_RESOURCE, verb: ACS_CLA_MANAGER_DELETE_ACTION };
    case 'ecla-invalidate':
      return { resource: ACS_CLA_ECLA_INVALIDATE_RESOURCE, verb: ACS_CLA_ECLA_INVALIDATE_ACTION };
    case 'auto-ecla-update':
      return { resource: ACS_CLA_AUTO_ECLA_RESOURCE, verb: ACS_CLA_AUTO_ECLA_ACTION };
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

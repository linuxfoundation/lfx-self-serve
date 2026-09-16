// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CCLA_SIGN_COPY } from '../constants/cla.constants';
import { acsCheckAllowed, buildOrgClaAcsPermission, isOrgClaPermissionAction, orgClaPairProjectSfid, orgClaSignForbiddenToast } from './org-cla-permissions';

const COMPANY = '0014100000Te2ovAAB';
const PROJECT = 'a09410000182dD2AAI';

describe('isOrgClaPermissionAction', () => {
  it('accepts the two typed actions and nothing else', () => {
    expect(isOrgClaPermissionAction('sign')).toBe(true);
    expect(isOrgClaPermissionAction('approval-list-update')).toBe(true);
    expect(isOrgClaPermissionAction('cla-signatory')).toBe(false);
    expect(isOrgClaPermissionAction('self_serve_request_corporate_signature:create')).toBe(false);
  });
});

describe('orgClaPairProjectSfid', () => {
  it('prefers the foundation id when the CLA Group is foundation-level', () => {
    expect(orgClaPairProjectSfid({ foundationSfid: PROJECT, projects: [{ projectSfid: 'other', projectName: 'Cascade' }] })).toBe(PROJECT);
  });

  it('uses the sole covered project when there is no foundation id', () => {
    expect(orgClaPairProjectSfid({ projects: [{ projectSfid: PROJECT, projectName: 'Cascade' }] })).toBe(PROJECT);
  });

  it('yields nothing when several projects are covered without a foundation id', () => {
    expect(
      orgClaPairProjectSfid({
        projects: [
          { projectSfid: PROJECT, projectName: 'Cascade' },
          { projectSfid: 'a09410000182dD3AAI', projectName: 'Driftwood' },
        ],
      })
    ).toBeUndefined();
  });
});

describe('buildOrgClaAcsPermission', () => {
  it('interpolates the Sign string the gateway already enforces', () => {
    expect(buildOrgClaAcsPermission({ action: 'sign', projectOrFoundationSfid: PROJECT, companySfid: COMPANY })).toBe(
      `self_serve_request_corporate_signature:create:project|organization:${PROJECT}|${COMPANY}`
    );
  });

  it('interpolates the approval-list update string the corporate console already uses', () => {
    expect(buildOrgClaAcsPermission({ action: 'approval-list-update', projectOrFoundationSfid: PROJECT, companySfid: COMPANY })).toBe(
      `signature_approval_list:update:project|organization:${PROJECT}|${COMPANY}`
    );
  });
});

describe('acsCheckAllowed', () => {
  const permission = `self_serve_request_corporate_signature:create:project|organization:${PROJECT}|${COMPANY}`;

  it('requires an explicit true for that permission string', () => {
    expect(acsCheckAllowed({ permissions: { [permission]: true } }, permission)).toBe(true);
    expect(acsCheckAllowed({ permissions: { [permission]: false } }, permission)).toBe(false);
    expect(acsCheckAllowed({ permissions: {} }, permission)).toBe(false);
    expect(acsCheckAllowed(null, permission)).toBe(false);
  });
});

describe('orgClaSignForbiddenToast', () => {
  it('uses the Corporate Console forbidden page verbatim', () => {
    expect(CCLA_SIGN_COPY.forbidden.summary).toBe('Forbidden');
    expect(CCLA_SIGN_COPY.forbidden.detail).toBe("You Don't have access to this.");
    expect(orgClaSignForbiddenToast()).toEqual({
      severity: 'error',
      summary: 'Forbidden',
      detail: "You Don't have access to this.",
    });
  });
});

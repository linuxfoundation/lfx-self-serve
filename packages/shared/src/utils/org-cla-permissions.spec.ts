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
  it('uses the foundation id when there are no covered projects', () => {
    expect(orgClaPairProjectSfid({ foundationSfid: PROJECT, projects: [] })).toBe(PROJECT);
  });

  it('uses the first covered project even when a parent foundation id is also present', () => {
    expect(
      orgClaPairProjectSfid({
        foundationSfid: 'a09410000182dFOUND',
        projects: [
          { projectSfid: PROJECT, projectName: 'Cascade' },
          { projectSfid: 'a09410000182dD3AAI', projectName: 'Driftwood' },
        ],
      })
    ).toBe(PROJECT);
  });

  it('uses the sole covered project when there is no foundation id', () => {
    expect(orgClaPairProjectSfid({ projects: [{ projectSfid: PROJECT, projectName: 'Cascade' }] })).toBe(PROJECT);
  });

  it('uses the first covered project when several are listed without a foundation id', () => {
    expect(
      orgClaPairProjectSfid({
        projects: [
          { projectSfid: PROJECT, projectName: 'Cascade' },
          { projectSfid: 'a09410000182dD3AAI', projectName: 'Driftwood' },
        ],
      })
    ).toBe(PROJECT);
  });

  it('yields nothing when there is no project id and no foundation id', () => {
    expect(orgClaPairProjectSfid({ projects: [] })).toBeUndefined();
    expect(orgClaPairProjectSfid({ foundationSfid: '   ', projects: [{ projectSfid: '  ', projectName: 'Blank' }] })).toBeUndefined();
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

  it('requires an explicit true for that permission string on the live ACS map', () => {
    expect(acsCheckAllowed({ [permission]: true }, permission)).toBe(true);
    expect(acsCheckAllowed({ [permission]: false }, permission)).toBe(false);
    expect(acsCheckAllowed({}, permission)).toBe(false);
    expect(acsCheckAllowed(null, permission)).toBe(false);
    expect(acsCheckAllowed([permission], permission)).toBe(false);
    expect(acsCheckAllowed({ permissions: { [permission]: true } }, permission)).toBe(false);
  });
});

describe('orgClaSignForbiddenToast', () => {
  it('says the viewer is not designated to sign, not that the page is forbidden', () => {
    expect(CCLA_SIGN_COPY.forbidden.summary).toBe("Can't start signing");
    expect(CCLA_SIGN_COPY.forbidden.detail).toBe("You aren't designated to sign this corporate CLA for your organization.");
    expect(orgClaSignForbiddenToast()).toEqual({
      severity: 'error',
      summary: "Can't start signing",
      detail: "You aren't designated to sign this corporate CLA for your organization.",
    });
  });
});

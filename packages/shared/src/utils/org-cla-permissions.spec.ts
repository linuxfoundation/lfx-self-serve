// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ACS_CLA_SIGN_RESOURCE } from '../constants/cla.constants';
import { acsCheckAllowed, buildOrgClaAcsPermission, isOrgClaPermissionAction, orgClaPairProjectSfid, viewerHasCompanySignGrant } from './org-cla-permissions';

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

describe('viewerHasCompanySignGrant', () => {
  const grant = {
    Permissions: [
      {
        Resource: ACS_CLA_SIGN_RESOURCE,
        Actions: ['create'],
        Scopes: [{ ID: `${PROJECT}|${COMPANY}`, Type: 'project|organization' }],
      },
    ],
  };

  it('matches the company half of a project|organization scope id', () => {
    expect(viewerHasCompanySignGrant(grant, COMPANY)).toBe(true);
  });

  it('does not treat a grant for another company as this company’s', () => {
    expect(viewerHasCompanySignGrant(grant, '0014100000OtherOrgAA')).toBe(false);
  });

  it('does not OR a role name into a grant', () => {
    expect(
      viewerHasCompanySignGrant(
        {
          Permissions: [{ Resource: 'something-else', Actions: ['create'], Scopes: [{ ID: COMPANY, Role: 'cla-signatory' }] }],
        },
        COMPANY
      )
    ).toBe(false);
  });

  it('accepts camelCase field names', () => {
    expect(
      viewerHasCompanySignGrant(
        {
          permissions: [{ resource: ACS_CLA_SIGN_RESOURCE, actions: ['create'], scopes: [{ id: COMPANY, type: 'organization' }] }],
        },
        COMPANY
      )
    ).toBe(true);
  });

  it('is false on an unparseable payload', () => {
    expect(viewerHasCompanySignGrant(null, COMPANY)).toBe(false);
    expect(viewerHasCompanySignGrant('nope', COMPANY)).toBe(false);
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

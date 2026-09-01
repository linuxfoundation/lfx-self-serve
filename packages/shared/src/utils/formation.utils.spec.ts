// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationState } from '../enums/formation.enum';
import type { Formation } from '../interfaces/formation.interface';
import { describe, expect, it } from 'vitest';

import { buildFormationAdminToolLink } from './formation.utils';

function formation(overrides: Partial<Formation> = {}): Formation {
  return {
    uid: 'formation-1',
    state: FormationState.PROPOSED,
    parent_project_uid: null,
    project_uid: null,
    template_version: 'project-formation-v1',
    submitted_by: 'proposer1',
    submitted_at: '2026-08-31T00:00:00.000Z',
    intake: {
      parent_project_uid: null,
      project_name: 'Example Project',
      project_repository_url: null,
      project_logo_filename: null,
      trademark_status: 'not_filed',
      contributing_org_name: 'Example Org',
      contributing_org_id: null,
      contributing_org_domain: null,
      legal_contact: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.test' },
      additional_contacts: [],
      license: 'MIT',
      chat_platform: 'slack',
      mission_statement: 'Our mission.',
      agreement_type: 'dco',
      is_spec_project: false,
      description: 'A description.',
      website_url: null,
    },
    participant_granted: true,
    data_source: 'mock',
    ...overrides,
  };
}

describe('buildFormationAdminToolLink', () => {
  it('builds a create-project link carrying the project name, source, and formation uid', () => {
    const link = buildFormationAdminToolLink('https://projectadmin.lfx.linuxfoundation.org', formation());

    const url = new URL(link);
    expect(url.origin + url.pathname).toBe('https://projectadmin.lfx.linuxfoundation.org/project/new');
    expect(url.searchParams.get('name')).toBe('Example Project');
    expect(url.searchParams.get('source')).toBe('self-serve-proposal');
    expect(url.searchParams.get('formation_uid')).toBe('formation-1');
    expect(url.searchParams.has('parent')).toBe(false);
  });

  it('includes the parent when one was set at intake', () => {
    const link = buildFormationAdminToolLink('https://projectadmin.lfx.linuxfoundation.org', formation({ parent_project_uid: 'parent-uid-1' }));

    expect(new URL(link).searchParams.get('parent')).toBe('parent-uid-1');
  });

  it('trims a trailing slash off the base URL', () => {
    const link = buildFormationAdminToolLink('https://projectadmin.lfx.linuxfoundation.org/', formation());

    expect(link.startsWith('https://projectadmin.lfx.linuxfoundation.org/project/new?')).toBe(true);
  });
});

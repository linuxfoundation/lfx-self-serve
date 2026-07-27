// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ProjectFunding } from '../enums/project-funding.enum';
import { ProjectStage } from '../enums/project-stage.enum';
import { Project } from '../interfaces';
import { summarizeWriterGrants } from './project.utils';

/** Builds a Project fixture, defaulting every field so tests set only what they assert on. */
function project(partial: Partial<Project>): Project {
  return {
    uid: partial.uid ?? 'uid',
    slug: partial.slug ?? 'slug',
    description: partial.description ?? '',
    name: partial.name ?? '',
    writer: partial.writer,
    public: partial.public ?? true,
    parent_uid: partial.parent_uid ?? '',
    stage: partial.stage ?? ProjectStage.Active,
    category: partial.category ?? '',
    funding: partial.funding ?? ProjectFunding.Funded,
    funding_model: partial.funding_model ?? ['Membership'],
    charter_url: partial.charter_url ?? '',
    legal_entity_type: partial.legal_entity_type ?? '',
    legal_entity_name: partial.legal_entity_name ?? '',
    legal_parent_uid: partial.legal_parent_uid ?? '',
    autojoin_enabled: partial.autojoin_enabled ?? false,
    formation_date: partial.formation_date ?? '',
    logo_url: partial.logo_url ?? '',
    repository_url: partial.repository_url ?? '',
    website_url: partial.website_url ?? '',
    created_at: partial.created_at ?? '',
    updated_at: partial.updated_at ?? '',
    mailing_list_count: partial.mailing_list_count ?? 0,
  };
}

// Membership-funded + Active + not an Internal Allocation, per computeIsFoundation.
const foundation = (uid: string, writer: boolean) => project({ uid, writer, stage: ProjectStage.Active, funding_model: ['Membership'] });
// Missing the Membership funding model — computeIsFoundation returns false.
const nonFoundation = (uid: string, writer: boolean) => project({ uid, writer, stage: ProjectStage.Active, funding_model: [] });

describe('summarizeWriterGrants', () => {
  it('returns {true, false} when the only writer-held project is a foundation', () => {
    expect(summarizeWriterGrants([foundation('fdn', true)])).toEqual({ hasWriterFoundation: true, hasWriterProject: false });
  });

  it('returns {false, true} when the only writer-held project is non-foundation', () => {
    expect(summarizeWriterGrants([nonFoundation('proj', true)])).toEqual({ hasWriterFoundation: false, hasWriterProject: true });
  });

  it('returns {true, true} when writer grants span both a foundation and a non-foundation project', () => {
    expect(summarizeWriterGrants([foundation('fdn', true), nonFoundation('proj', true)])).toEqual({
      hasWriterFoundation: true,
      hasWriterProject: true,
    });
  });

  it('returns {false, false} for an empty list', () => {
    expect(summarizeWriterGrants([])).toEqual({ hasWriterFoundation: false, hasWriterProject: false });
  });

  it('ignores projects the caller can see but is not a writer on, even if visible-only rows outnumber grants', () => {
    const result = summarizeWriterGrants([foundation('visible-fdn', false), nonFoundation('visible-proj', false), nonFoundation('actual-grant', true)]);

    expect(result).toEqual({ hasWriterFoundation: false, hasWriterProject: true });
  });

  it('treats writer as false when the field is undefined (not requested / not access-checked)', () => {
    expect(summarizeWriterGrants([project({ uid: 'unchecked' })])).toEqual({ hasWriterFoundation: false, hasWriterProject: false });
  });
});

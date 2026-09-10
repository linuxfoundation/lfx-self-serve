// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { DRAFT_STAGE_SENTINEL } from '../constants/project-formation.constants';
import { ProjectFunding } from '../enums/project-funding.enum';
import { ProjectStage } from '../enums/project-stage.enum';
import { Project } from '../interfaces';
import { getFormationSubStageLabel, isFormationStage, summarizeWriterGrants } from './project.utils';

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

describe('isFormationStage', () => {
  it.each([
    [ProjectStage.FormationExploratory, true],
    [ProjectStage.FormationEngaged, true],
    [ProjectStage.FormationOnHold, true],
    [ProjectStage.FormationDisengaged, true],
    [ProjectStage.FormationConfidential, true],
    [DRAFT_STAGE_SENTINEL, true],
    [ProjectStage.Active, false],
    [ProjectStage.Archived, false],
    [ProjectStage.Prospect, false],
  ])('returns %s for stage %s', (stage, expected) => {
    expect(isFormationStage(stage)).toBe(expected);
  });

  it('returns false for undefined/null/empty stage', () => {
    expect(isFormationStage(undefined)).toBe(false);
    expect(isFormationStage(null)).toBe(false);
    expect(isFormationStage('')).toBe(false);
  });

  it('returns false for a stage string colliding with an inherited Object.prototype member name', () => {
    expect(isFormationStage('toString')).toBe(false);
    expect(isFormationStage('constructor')).toBe(false);
    expect(isFormationStage('hasOwnProperty')).toBe(false);
  });
});

describe('getFormationSubStageLabel', () => {
  it.each([
    [ProjectStage.FormationExploratory, 'Exploratory'],
    [ProjectStage.FormationEngaged, 'Engaged'],
    [ProjectStage.FormationOnHold, 'On Hold'],
    [ProjectStage.FormationDisengaged, 'Disengaged'],
    [ProjectStage.FormationConfidential, 'Confidential'],
    [DRAFT_STAGE_SENTINEL, 'Draft'],
    [ProjectStage.Active, null],
    [ProjectStage.Archived, null],
    [ProjectStage.Prospect, null],
  ])('returns %s for stage %s', (stage, expected) => {
    expect(getFormationSubStageLabel(stage)).toBe(expected);
  });

  it('returns null for undefined/null/empty stage', () => {
    expect(getFormationSubStageLabel(undefined)).toBeNull();
    expect(getFormationSubStageLabel(null)).toBeNull();
    expect(getFormationSubStageLabel('')).toBeNull();
  });

  it('returns null (not an inherited function) for a stage string colliding with an Object.prototype member name', () => {
    expect(getFormationSubStageLabel('toString')).toBeNull();
    expect(getFormationSubStageLabel('constructor')).toBeNull();
    expect(getFormationSubStageLabel('hasOwnProperty')).toBeNull();
  });
});

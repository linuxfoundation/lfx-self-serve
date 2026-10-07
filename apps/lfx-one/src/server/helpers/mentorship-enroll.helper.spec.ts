// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MENTORSHIP_MAX_OPEN_TERMS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';
import { parseMentorshipEnrollCreateRequest, toMentorshipEnrollProgramRef, toMentorshipProgramLogoUploadResult } from './mentorship-enroll.helper';

const OPERATION = 'create_mentorship_admin_program';
const PROJECT_ID = '3f2c1a9e-7b4d-4c1e-9a55-0d6e8f1a2b3c';

const term = (overrides: Record<string, unknown> = {}) => ({
  name: 'Term 1',
  startDate: '2030-03-01',
  endDate: '2030-05-31',
  applicationStartDate: '2030-01-01',
  applicationEndDate: '2030-02-28',
  ...overrides,
});

const validBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  projectId: PROJECT_ID,
  projectSlug: 'example-project',
  projectName: 'Example Project',
  name: 'Example Program',
  description: '<p>Build things.</p>',
  repositoryUrl: 'https://github.com/example/repo',
  skills: ['Go', 'Testing'],
  terms: [term()],
  prerequisites: [{ name: 'Resume', description: 'Upload it.', required: true, requireFile: true, dueDate: null }],
  termsAccepted: true,
  ...overrides,
});

describe('parseMentorshipEnrollCreateRequest', () => {
  it('rebuilds a valid body from its known fields', () => {
    expect(parseMentorshipEnrollCreateRequest(validBody(), OPERATION)).toEqual({
      projectId: PROJECT_ID,
      projectSlug: 'example-project',
      projectName: 'Example Project',
      name: 'Example Program',
      description: '<p>Build things.</p>',
      repositoryUrl: 'https://github.com/example/repo',
      skills: ['Go', 'Testing'],
      terms: [term()],
      prerequisites: [{ name: 'Resume', description: 'Upload it.', required: true, requireFile: true, dueDate: null }],
      termsAccepted: true,
    });
  });

  it('keeps the optional fields that hold text and leaves out blank ones', () => {
    const parsed = parseMentorshipEnrollCreateRequest(
      validBody({ projectLogoUrl: 'https://cdn.example/logo.png', websiteUrl: 'https://example.org', codeOfConductUrl: '  ', ciiProjectId: '' }),
      OPERATION
    );

    expect(parsed.projectLogoUrl).toBe('https://cdn.example/logo.png');
    expect(parsed.websiteUrl).toBe('https://example.org');
    expect(parsed).not.toHaveProperty('codeOfConductUrl');
    expect(parsed).not.toHaveProperty('ciiProjectId');
  });

  it('keeps industry trimmed and leaves it out when blank or not text', () => {
    expect(parseMentorshipEnrollCreateRequest(validBody({ industry: ' GO, Kubernetes ' }), OPERATION).industry).toBe('GO, Kubernetes');
    expect(parseMentorshipEnrollCreateRequest(validBody({ industry: '' }), OPERATION)).not.toHaveProperty('industry');
    expect(parseMentorshipEnrollCreateRequest(validBody({ industry: 5 }), OPERATION)).not.toHaveProperty('industry');
  });

  it('drops fields the create body must never carry', () => {
    const parsed = parseMentorshipEnrollCreateRequest(
      validBody({
        logo_url: 'https://x.example/a.png',
        logoUrl: 'https://x.example/a.png',
        status: 'published',
        logoFileName: 'a.png',
        terms: [term({ id: 'term-1-2030' })],
      }),
      OPERATION
    ) as unknown as Record<string, unknown>;

    expect(parsed).not.toHaveProperty('logo_url');
    expect(parsed).not.toHaveProperty('logoUrl');
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('logoFileName');
    expect(parsed['terms']).toEqual([term()]);
  });

  it('trims the text fields but leaves a prerequisite description as sent', () => {
    const parsed = parseMentorshipEnrollCreateRequest(
      validBody({
        projectId: ` ${PROJECT_ID} `,
        name: '  Example Program ',
        skills: [' Go', 'Testing '],
        websiteUrl: ' https://example.org ',
        terms: [term({ name: ' Term 1 ', startDate: ' 2030-03-01 ' })],
        prerequisites: [{ name: ' Resume ', description: ' Upload it. ', dueDate: ' 2030-02-01 ' }],
      }),
      OPERATION
    );

    expect(parsed.projectId).toBe(PROJECT_ID);
    expect(parsed.name).toBe('Example Program');
    expect(parsed.skills).toEqual(['Go', 'Testing']);
    expect(parsed.websiteUrl).toBe('https://example.org');
    expect(parsed.terms[0].name).toBe('Term 1');
    expect(parsed.terms[0].startDate).toBe('2030-03-01');
    expect(parsed.prerequisites[0]).toEqual({ name: 'Resume', description: ' Upload it. ', required: false, requireFile: false, dueDate: '2030-02-01' });
  });

  it('keeps a prerequisite due date and defaults the flags to false', () => {
    const parsed = parseMentorshipEnrollCreateRequest(validBody({ prerequisites: [{ name: 'Task', dueDate: '2030-02-01' }] }), OPERATION);

    expect(parsed.prerequisites).toEqual([{ name: 'Task', description: '', required: false, requireFile: false, dueDate: '2030-02-01' }]);
  });

  it('accepts no prerequisites and the largest number of terms', () => {
    const terms = Array.from({ length: MENTORSHIP_MAX_OPEN_TERMS }, () => term());

    expect(parseMentorshipEnrollCreateRequest(validBody({ prerequisites: [], terms }), OPERATION).terms).toHaveLength(MENTORSHIP_MAX_OPEN_TERMS);
  });

  it.each([
    ['no body', undefined, 'projectId'],
    ['a body that is not an object', 'program', 'projectId'],
    ['an array body', [], 'projectId'],
    ['a project id that is not a UUID', validBody({ projectId: 'proj-1' }), 'projectId'],
    ['no project slug', validBody({ projectSlug: ' ' }), 'projectSlug'],
    ['no project name', validBody({ projectName: undefined }), 'projectName'],
    ['no name', validBody({ name: '' }), 'name'],
    ['a name that is not a string', validBody({ name: 5 }), 'name'],
    ['no description', validBody({ description: undefined }), 'description'],
    ['no repository URL', validBody({ repositoryUrl: '' }), 'repositoryUrl'],
    ['skills that are not a list', validBody({ skills: 'Go' }), 'skills'],
    ['an empty skill list', validBody({ skills: [] }), 'skills'],
    ['a blank skill', validBody({ skills: ['Go', ' '] }), 'skills'],
    ['a skill that is not a string', validBody({ skills: [1] }), 'skills'],
    ['no terms', validBody({ terms: [] }), 'terms'],
    ['more terms than the program may hold', validBody({ terms: Array.from({ length: MENTORSHIP_MAX_OPEN_TERMS + 1 }, () => term()) }), 'terms'],
    ['a term that is not an object', validBody({ terms: ['Term 1'] }), 'terms[0].name'],
    ['a term with a blank name', validBody({ terms: [term({ name: '  ' })] }), 'terms[0].name'],
    ['a term with no start date', validBody({ terms: [term({ startDate: undefined })] }), 'terms[0].startDate'],
    ['a second term with no application end date', validBody({ terms: [term(), term({ applicationEndDate: '' })] }), 'terms[1].applicationEndDate'],
    ['prerequisites that are not a list', validBody({ prerequisites: undefined }), 'prerequisites'],
    ['a prerequisite with no name', validBody({ prerequisites: [{ description: 'x' }] }), 'prerequisites[0].name'],
    ['a prerequisite required as text', validBody({ prerequisites: [{ name: 'Resume', required: 'true' }] }), 'prerequisites[0].required'],
    ['a prerequisite with a null file flag', validBody({ prerequisites: [{ name: 'Resume', requireFile: null }] }), 'prerequisites[0].requireFile'],
    ['terms that are not accepted', validBody({ termsAccepted: false }), 'termsAccepted'],
    ['terms accepted as text', validBody({ termsAccepted: 'true' }), 'termsAccepted'],
  ])('rejects %s with a 400 on the field', (_label, body, field) => {
    try {
      parseMentorshipEnrollCreateRequest(body, OPERATION);
      expect.unreachable('expected a ServiceValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceValidationError);
      expect((error as ServiceValidationError).statusCode).toBe(400);
      expect((error as ServiceValidationError).validationErrors[0].field).toBe(field);
    }
  });
});

describe('toMentorshipEnrollProgramRef', () => {
  it('keeps the id, slug and status', () => {
    expect(toMentorshipEnrollProgramRef({ id: 'p-1', slug: 'example-program', status: 'pending' })).toEqual({
      id: 'p-1',
      slug: 'example-program',
      status: 'pending',
    });
  });

  it('falls back to the id when upstream returns no slug', () => {
    expect(toMentorshipEnrollProgramRef({ id: 'p-1', status: 'pending' }).slug).toBe('p-1');
    expect(toMentorshipEnrollProgramRef({ id: 'p-1', slug: '', status: 'pending' }).slug).toBe('p-1');
  });
});

describe('toMentorshipProgramLogoUploadResult', () => {
  it('returns the public URL as logoUrl', () => {
    expect(
      toMentorshipProgramLogoUploadResult({ public_url: 'https://cdn.example/logo.png', filename: 'logo.png', content_type: 'image/png', size: 10 })
    ).toEqual({ logoUrl: 'https://cdn.example/logo.png' });
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { ProjectApplication, UpstreamProjectApplicationDoc } from '../interfaces/project-application.interface';
import {
  buildCreateProjectRequest,
  buildProjectApplicationAnswerSections,
  formatProjectApplicationAnswer,
  getProjectApplicationStateMeta,
  getProjectApplicationStatusCallout,
  isLegalContactEmail,
  isProjectApplicationOpen,
  normalizeProjectApplicationDoc,
  projectSlugFromName,
  reconcileProjectApplications,
  toProjectApplicationEmailLink,
  toProjectApplicationUrlLink,
  upsertProjectApplication,
  validateProjectApplicationAnswers,
} from './project-application.utils';

function buildApplication(overrides: Partial<ProjectApplication> = {}): ProjectApplication {
  return {
    uid: 'app-1',
    state: 'submitted',
    revision: 1,
    submitter_username: 'jdoe',
    submitter_name: 'Jane Doe',
    submitter_email: 'jane@example.org',
    target_parent_uid: null,
    application: { project_name: 'Example Foundation' },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('normalizeProjectApplicationDoc', () => {
  it('maps object_id to uid and defaults missing optionals', () => {
    const doc: UpstreamProjectApplicationDoc = {
      object_id: 'abc',
      state: 'submitted',
      revision: 3,
      submitter_username: 'jdoe',
      submitter_name: 'Jane Doe',
      submitter_email: 'jane@example.org',
      created_at: 'c',
      updated_at: 'u',
    };
    expect(normalizeProjectApplicationDoc(doc)).toEqual({
      uid: 'abc',
      state: 'submitted',
      revision: 3,
      submitter_username: 'jdoe',
      submitter_name: 'Jane Doe',
      submitter_email: 'jane@example.org',
      target_parent_uid: null,
      application: {},
      created_at: 'c',
      updated_at: 'u',
    });
  });
});

describe('getProjectApplicationStateMeta', () => {
  it('returns configured metadata for known states', () => {
    expect(getProjectApplicationStateMeta('denied')).toEqual({ label: 'Denied', severity: 'danger' });
  });

  it('renders an unseen state by its humanized value instead of breaking', () => {
    expect(getProjectApplicationStateMeta('under_review')).toEqual({ label: 'Under review', severity: 'secondary' });
  });
});

describe('isProjectApplicationOpen', () => {
  it('is true only for submitted', () => {
    expect(isProjectApplicationOpen({ state: 'submitted' })).toBe(true);
    expect(isProjectApplicationOpen({ state: 'accepted' })).toBe(false);
    expect(isProjectApplicationOpen({ state: 'withdrawn' })).toBe(false);
  });
});

describe('formatProjectApplicationAnswer', () => {
  it('formats booleans, lists and blanks', () => {
    expect(formatProjectApplicationAnswer(true)).toBe('Yes');
    expect(formatProjectApplicationAnswer(false)).toBe('No');
    expect(formatProjectApplicationAnswer(['a@example.org', 'b@example.org'])).toBe('a@example.org, b@example.org');
    expect(formatProjectApplicationAnswer('  ')).toBe('');
    expect(formatProjectApplicationAnswer(null)).toBe('');
    expect(formatProjectApplicationAnswer({ nested: 1 })).toBe('{"nested":1}');
  });
});

describe('buildProjectApplicationAnswerSections', () => {
  it('groups known answers and surfaces unknown keys under Other answers', () => {
    const sections = buildProjectApplicationAnswerSections({
      project_name: 'Example',
      is_spec_project: false,
      license: 'MIT',
      future_question: 'kept',
      project_website: '',
    });
    expect(sections.map((section) => section.title)).toEqual(['Project', 'Governance and licensing', 'Other answers']);
    const text = { kind: 'text', links: [], long: false, labelHidden: false };
    expect(sections[1].rows).toEqual([
      { key: 'license', label: 'Code license', value: 'MIT', ...text },
      { key: 'is_spec_project', label: 'Will the project publish a specification or standard?', value: 'No', ...text },
    ]);
    expect(sections[2].rows).toEqual([{ key: 'future_question', label: 'Future question', value: 'kept', ...text }]);
  });

  it('links URL and email answers, one link per formation contact', () => {
    const sections = buildProjectApplicationAnswerSections({
      project_repository_url: 'https://github.com/example/repo',
      project_website: 'example.org',
      legal_contact_email: 'legal@example.org',
      formation_list: ['a@example.org', 'b@example.org?cc=x@example.org'],
    });
    const rows = sections.flatMap((section) => section.rows);
    const byKey = (key: string) => rows.find((row) => row.key === key);
    expect(byKey('project_repository_url')?.links).toEqual([
      { text: 'https://github.com/example/repo', href: 'https://github.com/example/repo', external: true },
    ]);
    expect(byKey('project_website')?.links).toEqual([{ text: 'example.org', href: null, external: true }]);
    expect(byKey('legal_contact_email')?.links).toEqual([{ text: 'legal@example.org', href: 'mailto:legal@example.org', external: false }]);
    expect(byKey('formation_list')?.kind).toBe('email-list');
    expect(byKey('formation_list')?.links.map((link) => link.href)).toEqual(['mailto:a@example.org', null]);
  });

  it('flags long-form answers and hides a label that repeats its one-answer section title', () => {
    const sections = buildProjectApplicationAnswerSections({ mission_statement: 'Mission', license: 'MIT', description: 'About' });
    const governance = sections.find((section) => section.title === 'Governance and licensing');
    const about = sections.find((section) => section.title === 'About the project');
    expect(governance?.rows.map((row) => [row.key, row.long, row.labelHidden])).toEqual([
      ['license', false, false],
      ['mission_statement', true, false],
    ]);
    expect(about?.rows).toEqual([expect.objectContaining({ key: 'description', long: true, labelHidden: true })]);
  });

  it('returns no sections for an empty map', () => {
    expect(buildProjectApplicationAnswerSections(undefined)).toEqual([]);
  });
});

describe('toProjectApplicationUrlLink / toProjectApplicationEmailLink', () => {
  it('links only http(s) URLs with a host', () => {
    expect(toProjectApplicationUrlLink('http://example.org').href).toBe('http://example.org');
    expect(toProjectApplicationUrlLink('javascript:alert(1)').href).toBeNull();
    expect(toProjectApplicationUrlLink('ftp://example.org').href).toBeNull();
  });

  it('links only a plain single address', () => {
    expect(toProjectApplicationEmailLink('legal@example.org').href).toBe('mailto:legal@example.org');
    expect(toProjectApplicationEmailLink('legal@example').href).toBeNull();
    expect(toProjectApplicationEmailLink('a@example.org&body=x').href).toBeNull();
    expect(toProjectApplicationEmailLink('a#b@example.org').href).toBeNull();
    expect(toProjectApplicationEmailLink('a/b@example.org').href).toBeNull();
    expect(toProjectApplicationEmailLink('a@.org').href).toBeNull();
    expect(toProjectApplicationEmailLink('a@example.').href).toBeNull();
    expect(toProjectApplicationEmailLink('a@b@example.org').href).toBeNull();
  });

  it('checks long adversarial addresses in linear time on every rejection path', () => {
    const body = `!@!.${'!.'.repeat(50_000)}`;
    // One input per rejection path: the forbidden-character test (trailing space), the `@` check (a second `@`),
    // and the domain-shape check (no forbidden character, one `@`, but it ends in `.`).
    for (const adversarial of [`${body} `, `${body}@`, body]) {
      const started = Date.now();
      expect(toProjectApplicationEmailLink(adversarial).href).toBeNull();
      expect(Date.now() - started).toBeLessThan(200);
    }
  });
});

describe('getProjectApplicationStatusCallout', () => {
  it('words the explainer per persona and returns null for an unseen state', () => {
    expect(getProjectApplicationStatusCallout('submitted', 'submitter')?.text).toContain('reviewing your proposal');
    expect(getProjectApplicationStatusCallout('submitted', 'staff')?.text).toContain('accept or deny');
    expect(getProjectApplicationStatusCallout('denied', 'staff')).toEqual(expect.objectContaining({ severity: 'warn' }));
    expect(getProjectApplicationStatusCallout('archived', 'staff')).toBeNull();
    expect(getProjectApplicationStatusCallout(undefined, 'submitter')).toBeNull();
  });
});

describe('upsertProjectApplication', () => {
  it('prepends an unseen application', () => {
    const list = [buildApplication({ uid: 'a' })];
    expect(upsertProjectApplication(list, buildApplication({ uid: 'b' })).map((a) => a.uid)).toEqual(['b', 'a']);
  });

  it('replaces with an equal or newer revision but never an older one', () => {
    const list = [buildApplication({ revision: 3, state: 'submitted' })];
    expect(upsertProjectApplication(list, buildApplication({ revision: 4, state: 'withdrawn' }))[0].state).toBe('withdrawn');
    expect(upsertProjectApplication(list, buildApplication({ revision: 2, state: 'denied' }))[0].state).toBe('submitted');
  });
});

describe('reconcileProjectApplications', () => {
  it('overlays newer local writes, adds not-yet-indexed ones and drops deleted UIDs', () => {
    const fetched = [buildApplication({ uid: 'a', revision: 1 }), buildApplication({ uid: 'gone', revision: 1 })];
    const local = [buildApplication({ uid: 'a', revision: 2, state: 'withdrawn' }), buildApplication({ uid: 'new', revision: 1 })];
    const merged = reconcileProjectApplications(fetched, local, new Set(['gone']));
    expect(merged.map((a) => `${a.uid}:${a.state}`)).toEqual(['new:submitted', 'a:withdrawn']);
  });
});

describe('isLegalContactEmail', () => {
  it('requires exactly one non-edge @ and no whitespace', () => {
    expect(isLegalContactEmail('legal@example.org')).toBe(true);
    expect(isLegalContactEmail('@example.org')).toBe(false);
    expect(isLegalContactEmail('legal@')).toBe(false);
    expect(isLegalContactEmail('a@b@c')).toBe(false);
    expect(isLegalContactEmail('le gal@example.org')).toBe(false);
  });
});

describe('validateProjectApplicationAnswers', () => {
  it('accepts a complete canonical payload', () => {
    expect(
      validateProjectApplicationAnswers({
        project_name: 'Example Foundation',
        project_repository_url: 'https://github.com/example/example-project',
        project_website: 'https://example.org',
        trademark_status: 'No',
        contributing_organization: 'Example Organization',
        legal_contact_email: 'legal@example.org',
        formation_list: ['person@example.org'],
        license: 'Apache-2.0',
        chat_platform: 'Slack',
        mission_statement: 'The Mission of the Project is to build.',
        agreement_type: 'DCO',
        is_spec_project: false,
        description: 'A short description.',
      })
    ).toEqual([]);
  });

  it('accepts blanks, nulls and unknown keys', () => {
    expect(validateProjectApplicationAnswers({ project_website: '', license: null, future: { any: 'shape' } })).toEqual([]);
  });

  it('refuses a non-object payload', () => {
    expect(validateProjectApplicationAnswers([])).toEqual([{ field: 'application', message: 'application must be an object' }]);
  });

  it('flags each invalid canonical field without echoing the value', () => {
    const issues = validateProjectApplicationAnswers({
      project_repository_url: 'ftp://example.org/repo',
      project_website: 'not a url',
      legal_contact_email: 'nobody',
      formation_list: 'person@example.org',
      is_spec_project: 'yes',
      license: 42,
      description: 'bad\u0000value',
    });
    expect(issues.map((issue) => issue.field)).toEqual([
      'project_repository_url',
      'project_website',
      'legal_contact_email',
      'formation_list',
      'is_spec_project',
      'license',
      'description',
    ]);
    expect(issues.some((issue) => issue.message.includes('nobody'))).toBe(false);
  });

  it('accepts legacy formation contacts upstream still accepts', () => {
    expect(validateProjectApplicationAnswers({ formation_list: ['a@localhost', 'a@b@c'] })).toEqual([]);
  });

  it('refuses a legal contact with surrounding whitespace, as upstream does', () => {
    expect(validateProjectApplicationAnswers({ legal_contact_email: ' legal@example.org' }).map((issue) => issue.field)).toEqual(['legal_contact_email']);
  });

  it('flags a formation list with a non-email entry', () => {
    expect(validateProjectApplicationAnswers({ formation_list: ['ok@example.org', 'nope'] })).toEqual([
      { field: 'formation_list', message: 'formation_list must be a list of email addresses' },
    ]);
  });
});

describe('buildCreateProjectRequest (#1995)', () => {
  const PARENT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

  it('maps the proposal onto the project-service create body', () => {
    const request = buildCreateProjectRequest(
      {
        project_name: '  Example Project ',
        description: 'About it',
        mission_statement: 'Mission',
        project_repository_url: 'https://github.com/example/project',
        project_website: 'https://example.org',
        is_spec_project: true,
        license: 'MIT',
        contributing_organization: 'Acme',
      },
      PARENT,
      'example-project'
    );
    expect(request).toEqual({
      name: 'Example Project',
      slug: 'example-project',
      description: 'About it',
      parent_uid: PARENT,
      mission_statement: 'Mission',
      repository_url: 'https://github.com/example/project',
      website_url: 'https://example.org',
      stage: 'Formation - Exploratory',
      legal_entity_type: 'Subproject',
      category: 'Standards',
    });
  });

  it('leaves out blank optional answers and the category when the project is not a spec project', () => {
    const request = buildCreateProjectRequest(
      { project_name: 'X', description: 'D', project_website: '  ', mission_statement: '', is_spec_project: false },
      PARENT,
      'x1'
    );
    expect(request).toEqual({
      name: 'X',
      slug: 'x1',
      description: 'D',
      parent_uid: PARENT,
      stage: 'Formation - Exploratory',
      legal_entity_type: 'Subproject',
    });
  });
});

describe('projectSlugFromName (#1995)', () => {
  it.each([
    ['LFX One', 'lfx-one'],
    ['  Shared AI: Findings Exchange! ', 'shared-ai-findings-exchange'],
    ['3D Printing Group', 'd-printing-group'],
    ['123', ''],
    [null, ''],
  ])('%j -> %j', (name, slug) => {
    expect(projectSlugFromName(name)).toBe(slug);
  });
});

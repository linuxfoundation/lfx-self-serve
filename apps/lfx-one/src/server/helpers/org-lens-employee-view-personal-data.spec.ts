// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as shared from '@lfx-one/shared/constants';
import {
  ORG_LENS_EMPLOYEE_VIEW_ANALYTICS_OPT_INS,
  ORG_LENS_EMPLOYEE_VIEW_ECOSYSTEM_CARD_KEYS,
  ORG_LENS_EMPLOYEE_VIEW_ENDPOINTS,
  ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS,
  ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES,
  ORG_LENS_EMPLOYEE_VIEW_INTERFACE_FILES,
  ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS,
  ORG_LENS_EMPLOYEE_VIEW_REGISTER,
  ORG_LENS_EMPLOYEE_VIEW_REGISTERED_HIDDEN_PAGES,
  ORG_LENS_EMPLOYEE_VIEW_REVIEWED_PERSONAL_FIELDS,
  ORG_LENS_EMPLOYEE_VIEW_REVIEWED_SHAPES,
  ORG_LENS_EMPLOYEE_VIEW_TECHNICAL_CARD_KEYS,
} from '@lfx-one/shared/constants';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./org-lens-read-access.helper', () => ({ getOrgLensViewMode: vi.fn() }));

const { stripPersonalFields } = await import('./org-lens-employee-view.helper');

/**
 * The personal-data review register for the all employee view (epic #5845, story #5861) has to track the code. This
 * spec fails when a personal field is allowed, a route, payload file, person-bearing field or analytics opt-in is added,
 * or the shared personal-field list changes, without a reviewed row in `org-lens-employee-view-register.constants.ts`
 * (and its twin, docs/architecture/backend/company-lens-employee-view-personal-data.md).
 */

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');
const interfacesDir = join(here, '../../../../../packages/shared/src/interfaces');

const normalize = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');
const registerIds = new Set(ORG_LENS_EMPLOYEE_VIEW_REGISTER.map((entry) => entry.id));
const registerPages = [...new Set(ORG_LENS_EMPLOYEE_VIEW_REGISTER.map((entry) => entry.page))];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('the register itself', () => {
  it('has unique ids and a followUp on every row that is not enforced', () => {
    expect(registerIds.size).toBe(ORG_LENS_EMPLOYEE_VIEW_REGISTER.length);
    for (const entry of ORG_LENS_EMPLOYEE_VIEW_REGISTER) {
      if (entry.status !== 'enforced') {
        expect(entry.followUp, `${entry.id} needs a followUp`).toBeTruthy();
      }
    }
  });

  it('uses only reserved example domains in its fixtures', () => {
    const emails = JSON.stringify(ORG_LENS_EMPLOYEE_VIEW_REGISTER).match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [];

    for (const email of emails) {
      expect(email, 'fixture email must use example.com or a .example host').toMatch(/@(example\.(com|org|net)|[\w.-]+\.example)$/);
    }
  });

  it('allows only public code contribution data, and only on the Technical Influence panels', () => {
    const allowed = ORG_LENS_EMPLOYEE_VIEW_REGISTER.filter((entry) => entry.verdict === 'allowed');

    expect(allowed.length).toBeGreaterThan(0);
    for (const entry of allowed) {
      expect(entry.page, `${entry.id} is allowed outside Project detail`).toBe('project-detail');
      expect(entry.publicBasis, `${entry.id} needs a publicBasis`).toBeTruthy();
      expect(['github', 'insights', 'cdp']).toContain(entry.source);
      expect(entry.endpoint, `${entry.id} is not a technical card`).toMatch(
        new RegExp(`cards/(${ORG_LENS_EMPLOYEE_VIEW_TECHNICAL_CARD_KEYS.join('|')})|cards/\\{`)
      );
    }
  });

  it('never marks an Ecosystem Influence card allowed', () => {
    for (const key of ORG_LENS_EMPLOYEE_VIEW_ECOSYSTEM_CARD_KEYS) {
      const entry = ORG_LENS_EMPLOYEE_VIEW_REGISTER.find((row) => row.id === `project-detail.ecosystem.${key}`);

      expect(entry, `missing row for ecosystem card ${key}`).toBeDefined();
      expect(entry?.verdict).toBe('count-only');
      expect(entry?.enforcement).toBe('blocked-403');
    }
  });

  it('keeps the register page set to the pages of the epic', () => {
    expect(registerPages.sort()).toEqual(
      ['all', 'code-contributions', 'events', 'hidden', 'meetings', 'navigation', 'overview', 'project-detail', 'projects', 'training'].sort()
    );
  });
});

describe('exceptions allow-list', () => {
  it('has a register row for every exception, and an exception for every row that claims one', () => {
    const exceptions = ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS.map((entry) => `${entry.page}:${normalize(entry.field)}`).sort();
    const claimed = ORG_LENS_EMPLOYEE_VIEW_REGISTER.filter((entry) => entry.enforcement === 'exceptions-allow-list').map(
      (entry) => `${entry.page}:${normalize(entry.field)}`
    );

    expect(exceptions).toEqual(claimed.sort());
    for (const exception of ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS) {
      expect(exception.reason.trim(), 'an exception needs a one-line reason').not.toBe('');
      expect(exception.approvedBy.trim(), 'an exception needs the product owner decision').not.toBe('');
      const row = ORG_LENS_EMPLOYEE_VIEW_REGISTER.find((entry) => entry.page === exception.page && normalize(entry.field) === normalize(exception.field));
      expect(row?.verdict, `${exception.page}:${exception.field} must be registered as allowed`).toBe('allowed');
    }
  });

  it('lets an allowed row pass the strip exactly as it claims: a field outside the shared list stays untouched', () => {
    const person = { person: { name: 'Ada Example', avatarUrl: 'https://example.com/a.png', initials: 'AE' }, username: 'example-handle' };

    for (const entry of ORG_LENS_EMPLOYEE_VIEW_REGISTER.filter((row) => row.enforcement === 'not-in-field-list')) {
      expect(stripPersonalFields(person, { page: entry.page })).toEqual(person);
    }
  });
});

describe('the shared personal-field list', () => {
  it('is the list that was reviewed (removing or adding a key needs a register update)', () => {
    const current = ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS.map(normalize).sort();

    expect(current).toEqual(ORG_LENS_EMPLOYEE_VIEW_REVIEWED_PERSONAL_FIELDS.map(normalize).sort());
  });

  it('is removed on every register page, at any depth, and an email under an unlisted key is dropped too', () => {
    const fields = Object.fromEntries(ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS.map((key) => [key, 'value']));

    for (const page of registerPages) {
      expect(stripPersonalFields({ rows: [fields], ...fields, note: 'kept', owner: 'user@example.com' }, { page })).toEqual({ rows: [{}], note: 'kept' });
    }
  });
});

describe('hidden pages', () => {
  it('registers exactly the hidden pages of the epic, each with its own row', () => {
    expect([...ORG_LENS_EMPLOYEE_VIEW_REGISTERED_HIDDEN_PAGES].sort()).toEqual([
      'donations',
      'easycla',
      'groups',
      'initiatives',
      'memberships',
      'people',
      'profile',
    ]);
    for (const page of ORG_LENS_EMPLOYEE_VIEW_REGISTERED_HIDDEN_PAGES) {
      expect(registerIds.has(`hidden.${page}`), `missing hidden.${page}`).toBe(true);
    }
  });

  it('never hides a page the register does not know about', () => {
    for (const page of ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES) {
      expect(ORG_LENS_EMPLOYEE_VIEW_REGISTERED_HIDDEN_PAGES, `${page} is hidden but not registered`).toContain(page);
    }
  });
});

describe('lens routes', () => {
  const routeSource = readFileSync(join(serverDir, 'routes/orgs.route.ts'), 'utf8');
  const found = [...routeSource.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)]
    .filter((match) => match[2].includes('/lens/'))
    .map((match) => `${match[1].toUpperCase()} ${match[2].replace(/:[A-Za-z]+/g, ':p')}`);

  it('registers every route under /lens, and nothing that is not a route', () => {
    const registered = ORG_LENS_EMPLOYEE_VIEW_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`).sort();

    expect(registered).toEqual([...new Set(found)].sort());
  });

  it('treats every write as read-only-refused and only blocks routes of a page that has something to block', () => {
    for (const endpoint of ORG_LENS_EMPLOYEE_VIEW_ENDPOINTS) {
      if (endpoint.method !== 'GET') expect(endpoint.treatment).toBe('read-only-refused');
      if (endpoint.treatment === 'blocked') expect(['hidden', 'events', 'training', 'project-detail']).toContain(endpoint.page);
    }
  });
});

describe('analytics routes', () => {
  it('lists every source file that opts an /api/analytics route into the employee view', () => {
    const optedIn = listSourceFiles(serverDir)
      .filter((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .some((line) => /allowEmployeeView:\s*true/.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line))
      )
      .map((file) => relative(serverDir, file))
      .sort();

    expect(optedIn).toEqual(ORG_LENS_EMPLOYEE_VIEW_ANALYTICS_OPT_INS.map((entry) => entry.file).sort());
    for (const entry of ORG_LENS_EMPLOYEE_VIEW_ANALYTICS_OPT_INS) {
      expect(entry.reason.trim()).not.toBe('');
    }
  });
});

describe('payload shapes', () => {
  const PERSON_PROPERTY =
    /^\s+(?:readonly\s+)?([A-Za-z_]*(?:[Ee]mail|[Ff]irstName|[Ll]astName|[Ff]ullName|[Dd]isplayName|[Pp]erson|[Cc]ommitter|[Cc]reator|[Dd]onor|[Ss]peaker|[Aa]ttendee|[Ll]earner|[Aa]vatar|[Pp]hoto|[Uu]sername|[Ii]nitials|[Mm]aintainerName|[Mm]emberName|[Cc]ontactName|[Oo]wner|[Aa]uthor)[A-Za-z_]*)\??:/gm;
  const PERSON_TYPE = /^export (?:interface|type) (\w*(?:Person|Attendee|Speaker|Employee|Learner|Committer|Donor)s?(?![a-z])\w*)/gm;
  const INLINE_PERSON = /\{\s*person\??:/;

  it('classifies every org-*.interface.ts file', () => {
    const files = readdirSync(interfacesDir).filter((name) => /^(org-.*|crowdfunding)\.interface\.ts$/.test(name));

    expect(files.sort()).toEqual(Object.keys(ORG_LENS_EMPLOYEE_VIEW_INTERFACE_FILES).sort());
  });

  it('has a reviewed register row for every person-bearing property or type in a payload file', () => {
    const scanned: string[] = [];

    for (const [file, kind] of Object.entries(ORG_LENS_EMPLOYEE_VIEW_INTERFACE_FILES)) {
      if (kind !== 'payload' || !existsSync(join(interfacesDir, file))) continue;
      const text = readFileSync(join(interfacesDir, file), 'utf8');
      const names = new Set<string>();
      for (const match of text.matchAll(PERSON_PROPERTY)) names.add(match[1]);
      for (const match of text.matchAll(PERSON_TYPE)) names.add(match[1]);
      if (INLINE_PERSON.test(text)) names.add('person');
      for (const name of names) scanned.push(`${file}:${name}`);
    }

    expect(scanned.sort()).toEqual(ORG_LENS_EMPLOYEE_VIEW_REVIEWED_SHAPES.map((shape) => shape.key).sort());
    for (const shape of ORG_LENS_EMPLOYEE_VIEW_REVIEWED_SHAPES) {
      expect(shape.coveredBy === 'presentation' || registerIds.has(shape.coveredBy), `${shape.key} points at an unknown row`).toBe(true);
    }
  });
});

describe('project detail cards', () => {
  it('classifies every roster card key in the project detail service as technical or ecosystem', () => {
    const source = readFileSync(join(serverDir, 'services/org-lens-project-detail.service.ts'), 'utf8');
    const start = source.indexOf('private rosterProvider(');
    const end = source.indexOf('A person cell for a roster row');
    const keys = [...source.slice(start, end).matchAll(/case '([a-z-]+)':/g)].map((match) => match[1]);

    expect(start).toBeGreaterThan(-1);
    expect(keys.sort()).toEqual([...ORG_LENS_EMPLOYEE_VIEW_TECHNICAL_CARD_KEYS, ...ORG_LENS_EMPLOYEE_VIEW_ECOSYSTEM_CARD_KEYS].sort());
  });

  it('matches the technical key set the project detail story ships, once it is merged', () => {
    const shipped = (shared as Record<string, unknown>)['PD_EMPLOYEE_VIEW_TECHNICAL_CARD_KEYS'] as ReadonlySet<string> | undefined;

    if (shipped) {
      expect([...shipped].sort()).toEqual([...ORG_LENS_EMPLOYEE_VIEW_TECHNICAL_CARD_KEYS].sort());
    }
  });
});

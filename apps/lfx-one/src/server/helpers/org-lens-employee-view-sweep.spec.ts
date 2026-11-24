// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES, ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS } from '@lfx-one/shared/constants';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./org-lens-read-access.helper', () => ({ getOrgLensViewMode: () => 'employee' }));

const { stripPersonalFields } = await import('./org-lens-employee-view.helper');

/**
 * Epic #5845 (S15, #5860): the stray name and email sweep.
 *
 * Two parts.
 *
 * 1. A runtime check that the redaction tool removes a person's name or address wherever it hides in a payload: under every listed
 *    key (any case or separator), in nested arrays and objects, and as an email-shaped value under an unlisted key.
 *    Fixture people are invented and use reserved domains only.
 *
 * 2. An inventory of every Company Lens controller (`controllers/org-lens-*.controller.ts`) and what keeps names and
 *    emails out of the employee view for it. A controller that is not in the table fails the suite, so a new page cannot
 *    ship unreviewed. `redacts` controllers must call the redaction tool; `blocked` controllers sit behind a hidden page (the
 *    route spec proves every route 403s); `counts-only` controllers return aggregates, reviewed by hand (see the doc).
 */

type Disposition = 'redacts' | 'blocked' | 'counts-only' | 'staff-only';

const CONTROLLER_DISPOSITION: Record<string, Disposition> = {
  'org-lens-access.controller.ts': 'blocked', // People page, Access tab
  'org-lens-board-committee.controller.ts': 'blocked', // Memberships page
  'org-lens-contributions.controller.ts': 'redacts',
  'org-lens-documents.controller.ts': 'blocked', // Memberships page
  'org-lens-events.controller.ts': 'counts-only', // summary/foundations/list are counts and event names; attendee and speaker panels are blocked
  'org-lens-foundations.controller.ts': 'redacts',
  'org-lens-groups.controller.ts': 'blocked', // Groups page
  'org-lens-key-contacts.controller.ts': 'blocked', // Memberships page
  'org-lens-meetings.controller.ts': 'redacts',
  'org-lens-memberships.controller.ts': 'blocked',
  'org-lens-people.controller.ts': 'blocked',
  'org-lens-project-detail.controller.ts': 'redacts',
  'org-lens-projects.controller.ts': 'redacts',
  'org-lens-roi.controller.ts': 'staff-only', // requireOrgLensRoiAudience: LF staff only, never the employee view
  'org-lens-training.controller.ts': 'counts-only', // stats, filters and group tables are counts; the roster panel is blocked
};

// The page stories live on sibling branches; on the bare gate every controller is still unredacted by design.
const PAGE_STORIES_APPLIED = ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES.length > 0;

describe('employee view sweep: redaction tool', () => {
  const people = {
    summary: { total: 3 },
    rows: [
      { project: 'Example Project', first_name: 'Ada', LAST_NAME: 'Example', 'full-name': 'Ada Example', count: 4 },
      { project: 'Other', notes: 'ada@example.com', owner: { workEmail: 'ada@acme.example', speakerName: 'Ada Example' } },
    ],
    contacts: ['grace@example.org', 'plain text'],
  };

  it.each(ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS)('removes the personal field "%s" at any depth', (field) => {
    const out = JSON.stringify(stripPersonalFields({ outer: [{ inner: { [field]: 'Value Example' } }] }, { page: 'sweep' }));

    expect(out).not.toContain('Value Example');
  });

  it('leaves no name or email in a mixed payload, and keeps the counts', () => {
    const out = stripPersonalFields(people, { page: 'sweep' });
    const text = JSON.stringify(out);

    expect(text).not.toMatch(/Ada|Grace|@example|@acme/i);
    expect(out.summary).toEqual({ total: 3 });
    expect(out.rows[0]).toMatchObject({ project: 'Example Project', count: 4 });
  });
});

describe('employee view sweep: controller inventory', () => {
  const controllerDir = join(__dirname, '..', 'controllers');
  const controllers = readdirSync(controllerDir).filter((f) => /^org-lens-.+\.controller\.ts$/.test(f));

  it('has a reviewed disposition for every org-lens controller, and none for a file that is gone', () => {
    expect(controllers.sort()).toEqual(Object.keys(CONTROLLER_DISPOSITION).sort());
  });

  it.skipIf(!PAGE_STORIES_APPLIED).each(controllers.filter((f) => CONTROLLER_DISPOSITION[f] === 'redacts'))(
    '%s routes its payload through the redaction tool',
    (file) => {
      const source = readFileSync(join(controllerDir, file), 'utf8');

      expect(source).toMatch(/redactForEmployeeView|redactProjectsForEmployeeView|stripPersonalFields/);
    }
  );
});

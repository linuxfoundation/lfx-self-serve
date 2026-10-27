// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { Survey, SurveyResponseItem } from '../interfaces/survey.interface';
import {
  buildSurveyFollowUpMailto,
  buildSurveyResponsesCsvRows,
  getSurveyEngagementRates,
  getSurveyResyncScope,
  renderSurveyEmailForRecipient,
} from './survey.utils';

const survey = {
  uid: 's-1',
  survey_title: 'Board NPS',
  survey_cutoff_date: '2026-11-30T00:00:00Z',
  committee_category: 'Board',
  committees: [{ committee_uid: 'c-1', committee_name: 'Governing Board', project_name: 'CNCF' }],
  email_subject: 'Your feedback for {{.ProjectName}}',
  email_body: '<p>Hi {{.FirstName}}, <a href="{{.SurveyLink}}">take it</a> — {{ .ExecutiveDirectorName }} {{Unknown}}</p>',
} as unknown as Survey;

const row = (overrides: Partial<SurveyResponseItem>): SurveyResponseItem => ({ id: 'r', committee_uid: 'c-1', ...overrides }) as SurveyResponseItem;
const comment = (text: string) => ({ survey_monkey_question_answers: [{ answers: [{ text }] }] }) as Partial<SurveyResponseItem>;

describe('getSurveyEngagementRates', () => {
  it('counts each funnel stage from SES flags or a later delivery status', () => {
    const rates = getSurveyEngagementRates([
      row({ response_status: 'Responded', response_datetime: '2026-11-03T10:00:00Z', ...comment('Great') }),
      row({ response_status: 'Clicked' }),
      row({ response_status: 'Delivered', ses_email_opened: true }),
      row({ response_status: 'Failed' }),
    ]);

    expect(rates).toEqual({
      recipients: 4,
      delivered: 3,
      opened: 3,
      clicked: 2,
      responded: 1,
      commented: 1,
      deliveryRate: 75,
      openRate: 100,
      clickRate: 67,
      commentRate: 100,
    });
  });

  it('returns zero rates for no rows', () => {
    expect(getSurveyEngagementRates([]).deliveryRate).toBe(0);
  });
});

describe('renderSurveyEmailForRecipient', () => {
  it('fills both placeholder styles, escapes body values, and leaves unknown placeholders', () => {
    const email = renderSurveyEmailForRecipient(survey, row({ first_name: '<b>Ana</b>', survey_link: 'https://www.surveymonkey.com/r/x?a=1&b="2"' }), {
      executiveDirectorName: 'Jane Doe',
    });

    expect(email.subject).toBe('Your feedback for CNCF');
    expect(email.html).toBe(
      '<p>Hi &lt;b&gt;Ana&lt;/b&gt;, <a href="https://www.surveymonkey.com/r/x?a=1&amp;b=&quot;2&quot;">take it</a> — Jane Doe {{Unknown}}</p>'
    );
  });
});

describe('renderSurveyEmailForRecipient — Self Serve wizard placeholders', () => {
  it('fills the cutoff date and renders the survey button as a link', () => {
    const email = renderSurveyEmailForRecipient(
      { ...survey, email_subject: 'Due {{CutoffDate}}', email_body: '<p>{{SurveyButton}}</p>' },
      row({ survey_link: 'https://www.surveymonkey.com/r/x' })
    );

    expect(email.subject).toBe('Due November 30, 2026');
    expect(email.html).toBe('<p><a href="https://www.surveymonkey.com/r/x" target="_blank" rel="noopener noreferrer">Take the survey</a></p>');
  });
});

describe('buildSurveyFollowUpMailto', () => {
  it('prefills subject and body with the personal link', () => {
    const url = buildSurveyFollowUpMailto(survey, row({ email: 'ana@example.com', first_name: 'Ana', survey_link: 'https://www.surveymonkey.com/r/x' }));

    expect(url).toMatch(/^mailto:ana%40example\.com\?subject=Reminder%3A%20Board%20NPS&body=/);
    const body = decodeURIComponent(url!.split('&body=')[1]);
    expect(body).toContain('Hi Ana,');
    expect(body).toContain('by November 30, 2026');
    expect(body).toContain('https://www.surveymonkey.com/r/x');
  });

  it('returns null without an email address', () => {
    expect(buildSurveyFollowUpMailto(survey, row({}))).toBeNull();
  });
});

describe('buildSurveyResponsesCsvRows', () => {
  it('emits a header and one row per recipient without personal links', () => {
    const rows = buildSurveyResponsesCsvRows(survey, [
      row({
        first_name: 'Ana',
        last_name: 'Lee',
        email: 'ana@example.com',
        response_status: 'Responded',
        response_datetime: '2026-11-03T10:00:00Z',
        nps_value: 9,
        ses_delivery_successful: true,
        survey_link: 'https://www.surveymonkey.com/r/x',
        ...comment('Great'),
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([
      'Ana Lee',
      'ana@example.com',
      '',
      'CNCF | Governing Board',
      '',
      'Responded',
      'Yes',
      'No',
      'No',
      '2026-11-03T10:00:00Z',
      9,
      'Great',
    ]);
    expect(rows.flat()).not.toContain('https://www.surveymonkey.com/r/x');
  });
});

describe('getSurveyResyncScope', () => {
  const withCommittees = (...projects: string[]) =>
    ({ ...survey, committees: projects.map((p, i) => ({ committee_uid: `c-${i}`, project_uid: p })) }) as unknown as Survey;

  it('resyncs the whole survey when every committee is in the project', () => {
    expect(getSurveyResyncScope(withCommittees('p-1', 'p-1'), 'p-1')).toEqual({});
  });

  it("scopes a multi-project survey to the project's one committee", () => {
    expect(getSurveyResyncScope(withCommittees('p-1', 'p-2', 'p-3'), 'p-2')).toEqual({ committeeUid: 'c-1' });
  });

  it('offers no resync when the project has no committee, several among other projects, or no project is active', () => {
    expect(getSurveyResyncScope(withCommittees('p-1', 'p-2'), 'p-9')).toBeNull();
    expect(getSurveyResyncScope(withCommittees('p-1', 'p-1', 'p-2'), 'p-1')).toBeNull();
    expect(getSurveyResyncScope(withCommittees('p-1'), null)).toBeNull();
  });
});

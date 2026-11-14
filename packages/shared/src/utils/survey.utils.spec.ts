// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { SURVEY_EMAIL_DRAFTS } from '../constants/survey.constants';
import type { Survey, SurveyCommittee, SurveyResponseItem } from '../interfaces/survey.interface';
import {
  buildSurveyEmailBodies,
  buildSurveyFollowUpMailto,
  buildSurveyResponsesCsvRows,
  getSurveyEmailDraft,
  getSurveyEmailStages,
  getSurveyEngagementRates,
  getSurveyResyncScope,
  isDefaultSurveyEmailField,
  renderSurveyEmailForRecipient,
  toSurveyTemplateVariables,
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

    // The responded row has no email evidence, so it counts as a response only.
    expect(rates).toEqual({
      recipients: 4,
      delivered: 2,
      opened: 2,
      clicked: 1,
      responded: 1,
      commented: 1,
      deliveryRate: 50,
      openRate: 100,
      clickRate: 50,
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

describe('getSurveyEmailStages', () => {
  it('rolls SES evidence up to earlier stages and never infers email stages from a response', () => {
    expect(getSurveyEmailStages(row({ response_status: 'Pending', ses_link_clicked: true }))).toEqual({ delivered: true, opened: true, clicked: true });
    expect(getSurveyEmailStages(row({ response_status: 'Failed', ses_email_opened: true }))).toEqual({ delivered: true, opened: true, clicked: false });
    expect(getSurveyEmailStages(row({ response_status: 'Responded', response_datetime: '2026-11-03T10:00:00Z' }))).toEqual({
      delivered: false,
      opened: false,
      clicked: false,
    });
  });

  it('keeps the CSV columns in line with the rates for a status-only row', () => {
    const [, csvRow] = buildSurveyResponsesCsvRows(survey, [row({ response_status: 'Clicked' })]);
    expect(csvRow.slice(6, 9)).toEqual(['Yes', 'Yes', 'Yes']);
  });
});

describe('renderSurveyEmailForRecipient — send quarter', () => {
  it('fills {{Quarter}} and {{Year}} from the send date', () => {
    const email = renderSurveyEmailForRecipient({ ...survey, survey_send_date: '2026-11-02T09:00:00Z', email_subject: '{{Quarter}} {{Year}} survey' }, row({}));
    expect(email.subject).toBe('Q4 2026 survey');
  });

  it('blanks wizard variables the survey service has no data for, instead of leaking the token', () => {
    const email = renderSurveyEmailForRecipient({ ...survey, email_subject: 'From {{SenderTitle}} <{{SenderEmail}}> re {{SurveyTemplate}}' }, row({}));
    expect(email.subject).toBe('From  <> re ');
  });
});

describe('getSurveyResyncScope', () => {
  const committee = (uid: string, projectUid: string): SurveyCommittee => ({
    committee_id: uid,
    committee_uid: uid,
    committee_name: 'Board',
    project_id: projectUid,
    project_uid: projectUid,
    project_name: 'Project',
    total_recipients: 0,
    total_responses: 0,
    nps_value: 0,
    num_detractors: 0,
    num_passives: 0,
    num_promoters: 0,
  });
  const withCommittees = (...projects: string[]): Survey => ({ ...survey, committees: projects.map((p, i) => committee(`c-${i}`, p)) });

  it("names the project's committees explicitly, never the whole survey", () => {
    expect(getSurveyResyncScope(withCommittees('p-1', 'p-1'), 'p-1')).toEqual({ committeeUids: ['c-0', 'c-1'] });
    expect(getSurveyResyncScope(withCommittees('p-1', 'p-2', 'p-1'), 'p-1')).toEqual({ committeeUids: ['c-0', 'c-2'] });
  });

  it('offers no resync when the project has no committee on the survey or no project is active', () => {
    expect(getSurveyResyncScope(withCommittees('p-1', 'p-2'), 'p-9')).toBeNull();
    expect(getSurveyResyncScope(withCommittees('p-1'), null)).toBeNull();
  });
});

describe('toSurveyTemplateVariables', () => {
  it('adds the leading dot Go templates require', () => {
    expect(toSurveyTemplateVariables('{{FirstName}}, hi {{ ProjectName }}')).toBe('{{.FirstName}}, hi {{.ProjectName}}');
  });

  it('leaves already-dotted placeholders unchanged', () => {
    expect(toSurveyTemplateVariables('{{.FirstName}}')).toBe('{{.FirstName}}');
  });
});

describe('buildSurveyEmailBodies', () => {
  it('expands the survey button and dots every placeholder', () => {
    const { html, text } = buildSurveyEmailBodies('Dear {{FirstName}}\n{{SurveyButton}}');
    expect(html).toContain('{{.FirstName}}');
    expect(html).toContain('<a href="{{.SurveyLink}}"');
    expect(html).not.toMatch(/\{\{[^.]/);
    expect(text).toBe('Dear {{.FirstName}}\n{{.SurveyLink}}');
  });
});

describe('getSurveyEmailDraft', () => {
  it('gives a title naming maintainers the maintainer draft, case-insensitively', () => {
    expect(getSurveyEmailDraft('Maintainer Survey')).toBe(SURVEY_EMAIL_DRAFTS.maintainer);
    expect(getSurveyEmailDraft('2026 MAINTAINER experience')).toBe(SURVEY_EMAIL_DRAFTS.maintainer);
  });

  it('gives every other title, and a missing one, the general draft', () => {
    expect(getSurveyEmailDraft('Board Satisfaction Survey')).toBe(SURVEY_EMAIL_DRAFTS.general);
    expect(getSurveyEmailDraft('')).toBe(SURVEY_EMAIL_DRAFTS.general);
    expect(getSurveyEmailDraft(undefined)).toBe(SURVEY_EMAIL_DRAFTS.general);
  });
});

describe('isDefaultSurveyEmailField', () => {
  it('recognises either default draft for the matching field', () => {
    expect(isDefaultSurveyEmailField('subject', SURVEY_EMAIL_DRAFTS.general.subject)).toBe(true);
    expect(isDefaultSurveyEmailField('subject', SURVEY_EMAIL_DRAFTS.maintainer.subject)).toBe(true);
    expect(isDefaultSurveyEmailField('body', SURVEY_EMAIL_DRAFTS.maintainer.body)).toBe(true);
  });

  it('treats edited text, a cross-field match, and non-strings as user content', () => {
    expect(isDefaultSurveyEmailField('subject', `${SURVEY_EMAIL_DRAFTS.general.subject} (edited)`)).toBe(false);
    expect(isDefaultSurveyEmailField('body', SURVEY_EMAIL_DRAFTS.general.subject)).toBe(false);
    expect(isDefaultSurveyEmailField('subject', null)).toBe(false);
  });
});

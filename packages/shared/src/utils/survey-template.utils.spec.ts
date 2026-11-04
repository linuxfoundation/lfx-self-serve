// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { buildSurveyEmailBodies, toSurveyTemplateVariables } from './survey.utils';

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

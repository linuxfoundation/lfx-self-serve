// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  CAMPAIGN_ACT_RESOLVE_FAILED_MESSAGE,
  CAMPAIGN_ACT_RESOLVE_INVALID_ID_MESSAGE,
  CAMPAIGN_ACT_RESOLVE_UNAVAILABLE_MESSAGE,
  CAMPAIGN_ADOPT_FAILURE_COPY,
  CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED,
  CAMPAIGN_ADOPT_UNCONFIRMED_TITLE,
  CAMPAIGN_SETTINGS_READ_CONFLICT_FALLBACK,
  CAMPAIGN_SETTINGS_READ_ERRORS,
  CAMPAIGN_SETTINGS_READ_FALLBACK,
} from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { campaignActResolveErrorMessage, campaignAdoptFailure, campaignSettingsReadErrorMessage } from './campaign-optimize-error.utils';

const httpError = (status: number, error: unknown): HttpErrorResponse => new HttpErrorResponse({ status, statusText: 'x', error });

describe('campaignSettingsReadErrorMessage', () => {
  it.each([400, 403, 404, 500, 503])('maps a %i to its fixed sentence', (status) => {
    expect(campaignSettingsReadErrorMessage(httpError(status, { error: 'upstream words', code: 'X' }))).toBe(CAMPAIGN_SETTINGS_READ_ERRORS[status]);
  });

  // Only campaign-service's own sentence tells the 409 reasons apart, so the envelope's is kept.
  it("keeps campaign-service's sentence from a BFF envelope 409", () => {
    const message = 'this campaign belongs to a different ad account than the project connection';
    expect(campaignSettingsReadErrorMessage(httpError(409, { error: message, code: 'CONFLICT' }))).toBe(message);
  });

  it.each([
    ['a plain-text 409 from a proxy', 'Conflict'],
    ['a JSON 409 without the envelope code', { error: 'proxy conflict' }],
    ['a BFF envelope 409 with a blank message', { error: '  ', code: 'CONFLICT' }],
    ['a 409 with no body', null],
  ])('falls back to the fixed conflict sentence for %s', (_label, body) => {
    expect(campaignSettingsReadErrorMessage(httpError(409, body))).toBe(CAMPAIGN_SETTINGS_READ_CONFLICT_FALLBACK);
  });

  it.each([
    ['an unmapped status', httpError(502, { error: 'Bad Gateway', code: 'BAD_GATEWAY' })],
    ['no response', httpError(0, null)],
    ['a non-HTTP error', new Error('boom')],
  ])('falls back to the generic sentence for %s', (_label, error) => {
    expect(campaignSettingsReadErrorMessage(error)).toBe(CAMPAIGN_SETTINGS_READ_FALLBACK);
  });
});

describe('campaignActResolveErrorMessage', () => {
  it('reports a 404 as the route not being served in this deployment', () => {
    expect(campaignActResolveErrorMessage(httpError(404, { error: 'Not Found', code: 'NOT_FOUND' }))).toBe(CAMPAIGN_ACT_RESOLVE_UNAVAILABLE_MESSAGE);
  });

  it('reports a 400 as an id in the wrong format', () => {
    expect(campaignActResolveErrorMessage(httpError(400, { error: 'bad id', code: 'BAD_REQUEST' }))).toBe(CAMPAIGN_ACT_RESOLVE_INVALID_ID_MESSAGE);
  });

  it.each([
    ['a 500', httpError(500, { error: 'boom', code: 'INTERNAL_ERROR' })],
    ['a 503', httpError(503, null)],
    ['no response', httpError(0, null)],
    ['a non-HTTP error', new Error('boom')],
  ])('reports %s as a generic failed lookup', (_label, error) => {
    expect(campaignActResolveErrorMessage(error)).toBe(CAMPAIGN_ACT_RESOLVE_FAILED_MESSAGE);
  });
});

describe('campaignAdoptFailure', () => {
  const platform = 'LinkedIn Ads';

  it.each(['400', '403', '404', '409', '503'] as const)('maps a BFF envelope %s to its title and message', (key) => {
    const failure = campaignAdoptFailure(httpError(Number(key), { error: 'the campaign could not be bound', code: 'X' }), platform);
    expect(failure.state).toBe('failed');
    expect(failure.title).toBe(CAMPAIGN_ADOPT_FAILURE_COPY[key].title);
    expect(failure.message).toBe(CAMPAIGN_ADOPT_FAILURE_COPY[key].message.replaceAll('{platform}', platform));
  });

  it('falls back to the default copy for an unmapped definite failure', () => {
    expect(campaignAdoptFailure(httpError(500, { error: 'internal error', code: 'INTERNAL_ERROR' }), platform)).toEqual({
      state: 'failed',
      title: CAMPAIGN_ADOPT_FAILURE_COPY.default.title,
      message: CAMPAIGN_ADOPT_FAILURE_COPY.default.message,
      detail: '',
    });
  });

  it('substitutes every {platform} in the message', () => {
    expect(CAMPAIGN_ADOPT_FAILURE_COPY['409'].message.match(/\{platform\}/g)?.length).toBeGreaterThan(1);
    const { message } = campaignAdoptFailure(httpError(409, { error: 'already bound', code: 'CONFLICT' }), platform);
    expect(message).not.toContain('{platform}');
    expect(message.split(platform).length - 1).toBe(CAMPAIGN_ADOPT_FAILURE_COPY['409'].message.split('{platform}').length - 1);
  });

  // Only a 400 or 409 carries several reasons that campaign-service's sentence tells apart.
  it.each([400, 409])("keeps campaign-service's sentence as detail on a %i", (status) => {
    const message = 'the brief already has a live campaign on this platform';
    expect(campaignAdoptFailure(httpError(status, { error: message, code: 'X' }), platform).detail).toBe(message);
  });

  it.each([403, 404, 503])('leaves detail empty on a %i', (status) => {
    expect(campaignAdoptFailure(httpError(status, { error: 'the campaign could not be bound', code: 'X' }), platform).detail).toBe('');
  });

  it('leaves detail empty on a message-less 409, rather than repeating the fallback', () => {
    expect(campaignAdoptFailure(httpError(409, { error: '', code: 'CONFLICT' }), platform)).toEqual({
      state: 'failed',
      title: CAMPAIGN_ADOPT_FAILURE_COPY['409'].title,
      message: CAMPAIGN_ADOPT_FAILURE_COPY['409'].message.replaceAll('{platform}', platform),
      detail: '',
    });
  });

  // A proxy's 409 is not proof the BFF refused the adoption: the row may already be written.
  it.each([
    ['a plain-text 409 from a proxy', 409, 'Conflict'],
    ['a JSON 400 without the envelope code', 400, { error: 'bad request' }],
    ['a gateway page with no response', 0, '<html><body>Bad Gateway</body></html>'],
    ['a 502 gateway page', 502, '<html><body>Bad Gateway</body></html>'],
    ['no response at all', 0, null],
  ])('reports %s as unconfirmed', (_label, status, body) => {
    expect(campaignAdoptFailure(httpError(status, body), platform)).toEqual({
      state: 'unconfirmed',
      title: CAMPAIGN_ADOPT_UNCONFIRMED_TITLE,
      message: CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED,
      detail: '',
    });
  });

  it('keeps the words of an envelope sentence that says the outcome is unconfirmed', () => {
    const message = 'the campaign adoption is unconfirmed — it may or may not have been recorded';
    expect(campaignAdoptFailure(httpError(503, { error: message, code: 'SERVICE_UNAVAILABLE' }), platform)).toEqual({
      state: 'unconfirmed',
      title: CAMPAIGN_ADOPT_UNCONFIRMED_TITLE,
      message,
      detail: '',
    });
  });

  it("reports the BFF's own unconfirmed adoption as unconfirmed", () => {
    expect(campaignAdoptFailure(httpError(504, { error: CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED, code: 'TIMEOUT' }), platform)).toEqual({
      state: 'unconfirmed',
      title: CAMPAIGN_ADOPT_UNCONFIRMED_TITLE,
      message: CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED,
      detail: '',
    });
  });

  it('reports a non-HTTP error as unconfirmed', () => {
    expect(campaignAdoptFailure(new Error('boom'), platform).state).toBe('unconfirmed');
  });
});

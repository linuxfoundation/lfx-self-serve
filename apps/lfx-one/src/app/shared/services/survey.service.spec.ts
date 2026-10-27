// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SURVEY_RESPONSES_MAX_PAGES, SURVEY_RESPONSES_PAGE_SIZE } from '@lfx-one/shared/constants';
import { SurveyResponseItem } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SurveyService } from './survey.service';

describe('SurveyService.getAllSurveyResponses', () => {
  let service: SurveyService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SurveyService, provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(SurveyService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const expectPage = (token: string | undefined) =>
    http.expectOne(
      (req) =>
        req.url === '/api/surveys/s-1/responses' &&
        req.params.get('per_page') === String(SURVEY_RESPONSES_PAGE_SIZE) &&
        req.params.get('project_uid') === 'p-1' &&
        req.params.get('page_token') === (token ?? null)
    );

  it('follows page tokens and returns every row', () => {
    let rows: SurveyResponseItem[] | undefined;
    service.getAllSurveyResponses('s-1', 'p-1').subscribe((r) => (rows = r));

    expectPage(undefined).flush({ data: [{ id: 'r-1' }], meta: { page_token: 't-2' } });
    expectPage('t-2').flush({ data: [{ id: 'r-2' }], meta: {} });

    expect(rows?.map((r) => r.id)).toEqual(['r-1', 'r-2']);
  });

  it('degrades a 404 to no rows', () => {
    let rows: SurveyResponseItem[] | undefined;
    service.getAllSurveyResponses('s-1', 'p-1').subscribe((r) => (rows = r));

    expectPage(undefined).flush(null, { status: 404, statusText: 'Not Found' });

    expect(rows).toEqual([]);
  });

  it('errors on any other failure so the caller can flag an incomplete list', () => {
    let error: unknown;
    service.getAllSurveyResponses('s-1', 'p-1').subscribe({ error: (e) => (error = e) });

    expectPage(undefined).flush({ data: [{ id: 'r-1' }], meta: { page_token: 't-2' } });
    expectPage('t-2').flush(null, { status: 500, statusText: 'Server Error' });

    expect(error).toBeDefined();
  });

  it('errors instead of returning a partial list when the page cap is reached', () => {
    let error: unknown;
    service.getAllSurveyResponses('s-1', 'p-1').subscribe({ error: (e) => (error = e) });

    expectPage(undefined).flush({ data: [{ id: 'r-0' }], meta: { page_token: 't-1' } });
    for (let i = 1; i < SURVEY_RESPONSES_MAX_PAGES; i++) {
      expectPage(`t-${i}`).flush({ data: [{ id: `r-${i}` }], meta: { page_token: `t-${i + 1}` } });
    }

    expect(error).toBeInstanceOf(Error);
  });
});

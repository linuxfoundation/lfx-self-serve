// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SURVEY_RESPONSES_MAX_PAGES, SURVEY_RESPONSES_PAGE_SIZE } from '@lfx-one/shared/constants';
import { SurveyResponseItem, SurveyTemplate } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('surfaces a 404 on a later page instead of discarding the rows already loaded', () => {
    let rows: SurveyResponseItem[] | undefined;
    let error: unknown;
    service.getAllSurveyResponses('s-1', 'p-1').subscribe({ next: (r) => (rows = r), error: (e) => (error = e) });

    expectPage(undefined).flush({ data: [{ id: 'r-1' }], meta: { page_token: 't-2' } });
    expectPage('t-2').flush(null, { status: 404, statusText: 'Not Found' });

    expect(rows).toBeUndefined();
    expect(error).toBeDefined();
  });
});

describe('SurveyService.getSurveyTemplates (#5124)', () => {
  let service: SurveyService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SurveyService, provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(SurveyService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('sends project_uid only when no committee is given', () => {
    let templates: SurveyTemplate[] | undefined;
    service.getSurveyTemplates('p-1', null).subscribe((t) => (templates = t));

    const req = http.expectOne((r) => r.url === '/api/surveys/templates');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual(['project_uid']);
    expect(req.request.params.get('project_uid')).toBe('p-1');
    req.flush([{ id: '1', title: 'Board Survey' }]);

    expect(templates).toEqual([{ id: '1', title: 'Board Survey' }]);
  });

  it('sends project_uid and committee_uid', () => {
    service.getSurveyTemplates('p-1', 'c-1').subscribe();

    const req = http.expectOne((r) => r.url === '/api/surveys/templates');
    expect(req.request.params.get('project_uid')).toBe('p-1');
    expect(req.request.params.get('committee_uid')).toBe('c-1');
    req.flush([]);
  });

  it('logs and rethrows template failures rather than treating them as an empty list', () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let templates: SurveyTemplate[] | undefined;
    let error: unknown;
    service.getSurveyTemplates('p-1').subscribe({ next: (value) => (templates = value), error: (value) => (error = value) });

    http.expectOne((request) => request.url === '/api/surveys/templates').flush(null, { status: 503, statusText: 'Service Unavailable' });

    expect(templates).toBeUndefined();
    expect(error).toBeDefined();
    expect(logError).toHaveBeenCalledExactlyOnceWith('Failed to load survey templates:', error);
  });
});

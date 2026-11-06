// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UserSearchResult } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SearchService } from './search.service';

function user(overrides: Partial<UserSearchResult>): UserSearchResult {
  return {
    uid: 'uid',
    email: 'jdoe@example.com',
    first_name: 'Jane',
    last_name: 'Doe',
    job_title: null,
    organization: null,
    committee: null,
    type: 'committee_member',
    username: 'jdoe',
    ...overrides,
  };
}

describe('SearchService', () => {
  let service: SearchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(SearchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  const collect = (term: string): Promise<UserSearchResult[]> => new Promise((resolve) => service.searchUsers(term, 'committee_member').subscribe(resolve));

  it('searches a plain term as a name', async () => {
    const result = collect('  Jane ');

    const req = http.expectOne((r) => r.url === '/api/search/users');
    expect(req.request.params.get('type')).toBe('committee_member');
    expect(req.request.params.get('name')).toBe('Jane');
    expect(req.request.params.has('tags')).toBe(false);
    req.flush({ results: [user({})] });

    await expect(result).resolves.toHaveLength(1);
  });

  it('looks a complete address up as an exact tag, as typed and lowercased, and merges the two answers', async () => {
    const result = collect('Jane.Doe@Example.com');

    const requests = http.match((r) => r.url === '/api/search/users');
    expect(requests.map((r) => r.request.params.get('tags'))).toEqual(['email:Jane.Doe@Example.com', 'email:jane.doe@example.com']);
    expect(requests.every((r) => !r.request.params.has('name'))).toBe(true);
    requests[0].flush({ results: [user({ uid: 'as-typed', email: 'Jane.Doe@Example.com' })] });
    requests[1].flush({ results: [user({ uid: 'lowercased', email: 'jane.doe@example.com' })] });

    await expect(result).resolves.toEqual([expect.objectContaining({ uid: 'as-typed' })]);
  });

  it('keeps a plus-addressed email encoded, so Express does not read the plus as a space', async () => {
    const result = collect('jane+lfx@example.com');

    const req = http.expectOne((r) => r.url === '/api/search/users');
    expect(req.request.urlWithParams).toContain('tags=email%3Ajane%2Blfx%40example.com');
    req.flush({ results: [] });

    await expect(result).resolves.toEqual([]);
  });

  it('issues a single tag lookup for an address that is already lowercase', async () => {
    const result = collect('jane.doe@example.com');

    const req = http.expectOne((r) => r.url === '/api/search/users');
    expect(req.request.params.get('tags')).toBe('email:jane.doe@example.com');
    req.flush({ results: [] });

    await expect(result).resolves.toEqual([]);
  });

  it('searches the local part of a partial address as a name and keeps only emails that start with what was typed', async () => {
    const result = collect('jdoe@exa');

    const req = http.expectOne((r) => r.url === '/api/search/users');
    expect(req.request.params.get('name')).toBe('jdoe');
    expect(req.request.params.has('tags')).toBe(false);
    req.flush({ results: [user({ uid: 'match', email: 'JDoe@example.com' }), user({ uid: 'other', email: 'jdoe@other.example', username: 'jdoe2' })] });

    await expect(result).resolves.toEqual([expect.objectContaining({ uid: 'match' })]);
  });

  it('returns nothing, without a request, for an empty term or one with no local part', async () => {
    await expect(collect('   ')).resolves.toEqual([]);
    await expect(collect('@example.com')).resolves.toEqual([]);
    http.expectNone((r) => r.url === '/api/search/users');
  });

  it('degrades a failed lookup to no results instead of erroring', async () => {
    const result = collect('Jane');

    http.expectOne((r) => r.url === '/api/search/users').flush('nope', { status: 500, statusText: 'Server Error' });

    await expect(result).resolves.toEqual([]);
  });
});

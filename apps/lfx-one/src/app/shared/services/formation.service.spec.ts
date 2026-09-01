// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Formation } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationService } from './formation.service';

describe('FormationService', () => {
  let service: FormationService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(FormationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('posts the intake payload to /api/formations and emits the created formation', async () => {
    const formation = { uid: 'formation-1' } as Formation;
    const result$ = service.createFormation({ project_name: 'Example' } as never);

    const promise = new Promise<Formation>((resolve) => result$.subscribe(resolve));
    const req = httpMock.expectOne('/api/formations');
    expect(req.request.method).toBe('POST');
    req.flush(formation);

    expect(await promise).toEqual(formation);
  });

  it('gets a formation by uid', async () => {
    const formation = { uid: 'formation-1' } as Formation;
    const result$ = service.getFormationByUid('formation-1');

    const promise = new Promise<Formation | null>((resolve) => result$.subscribe(resolve));
    const req = httpMock.expectOne('/api/formations/formation-1');
    expect(req.request.method).toBe('GET');
    req.flush(formation);

    expect(await promise).toEqual(formation);
  });

  it('encodes the uid in the GET url', async () => {
    const result$ = service.getFormationByUid('uid with spaces/slash');

    const promise = new Promise<Formation | null>((resolve) => result$.subscribe(resolve));
    const req = httpMock.expectOne('/api/formations/uid%20with%20spaces%2Fslash');
    req.flush({ uid: 'x' } as Formation);

    await promise;
  });

  it('degrades to null on a 404 without logging — an unknown/wrong-pod/wrong-user uid is an expected outcome', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result$ = service.getFormationByUid('unknown');

    const promise = new Promise<Formation | null>((resolve) => result$.subscribe(resolve));
    const req = httpMock.expectOne('/api/formations/unknown');
    req.flush('Not found', { status: 404, statusText: 'Not Found' });

    expect(await promise).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('degrades to null AND logs on a non-404 failure — a real error should not be indistinguishable from an unknown uid', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result$ = service.getFormationByUid('formation-1');

    const promise = new Promise<Formation | null>((resolve) => result$.subscribe(resolve));
    const req = httpMock.expectOne('/api/formations/formation-1');
    req.flush('Server error', { status: 500, statusText: 'Server Error' });

    expect(await promise).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

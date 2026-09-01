// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Formation } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

  it('degrades to null when the get request fails — the confirmation page renders its own not-found state', async () => {
    const result$ = service.getFormationByUid('unknown');

    const promise = new Promise<Formation | null>((resolve) => result$.subscribe(resolve));
    const req = httpMock.expectOne('/api/formations/unknown');
    req.flush('Not found', { status: 404, statusText: 'Not Found' });

    expect(await promise).toBeNull();
  });
});

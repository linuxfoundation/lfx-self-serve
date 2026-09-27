// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ProjectApplication } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectApplicationService } from './project-application.service';

const UID = '3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c';

function buildApplication(overrides: Partial<ProjectApplication> = {}): ProjectApplication {
  return {
    uid: UID,
    state: 'submitted',
    revision: 7,
    submitter_username: 'jdoe',
    submitter_name: 'Jane Doe',
    submitter_email: 'jane@example.org',
    target_parent_uid: null,
    application: { project_name: 'Example', future_question: 'kept' },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('ProjectApplicationService (#3037)', () => {
  let service: ProjectApplicationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ProjectApplicationService);
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('reads the submitter list from /mine and the staff queue from /queue', () => {
    service.getApplications('submitter').subscribe();
    http.expectOne('/api/project-applications/mine').flush([]);
    service.getApplications('staff').subscribe();
    http.expectOne('/api/project-applications/queue').flush([]);
  });

  it('rethrows a failed list read rather than presenting it as an empty list', () => {
    let failed = false;
    service.getApplications('submitter').subscribe({ error: () => (failed = true) });
    http.expectOne('/api/project-applications/mine').flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
    expect(failed).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it('reports formation-team access, failing closed on error', () => {
    const results: boolean[] = [];
    service.getAccess().subscribe((value) => results.push(value));
    http.expectOne('/api/project-applications/access').flush({ is_formation_team: true });
    service.getAccess().subscribe((value) => results.push(value));
    http.expectOne('/api/project-applications/access').flush({ error: 'boom' }, { status: 503, statusText: 'Unavailable' });
    expect(results).toEqual([true, false]);
  });

  it('creates with the answers only', () => {
    service.create({ project_name: 'Example' }).subscribe();
    const request = http.expectOne('/api/project-applications');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ application: { project_name: 'Example' } });
    request.flush({ application: buildApplication(), etag: null });
  });

  it('sends the held revision as If-Match on every mutation', () => {
    const application = buildApplication();
    service.revise(application, { project_name: 'Renamed' }).subscribe();
    service.withdraw(application).subscribe();
    service.deny(application).subscribe();
    service.accept(application, 'parent-uid').subscribe();
    service.remove(application).subscribe();

    const revise = http.expectOne({ method: 'PUT', url: `/api/project-applications/${UID}` });
    const withdraw = http.expectOne(`/api/project-applications/${UID}/withdraw`);
    const deny = http.expectOne(`/api/project-applications/${UID}/deny`);
    const accept = http.expectOne(`/api/project-applications/${UID}/accept`);
    const remove = http.expectOne({ method: 'DELETE', url: `/api/project-applications/${UID}` });

    for (const request of [revise, withdraw, deny, accept, remove]) {
      expect(request.request.headers.get('If-Match')).toBe('7');
    }
    expect(revise.request.body).toEqual({ application: { project_name: 'Renamed' } });
    // Accept carries the complete held answers so the BFF's revise keeps unknown keys.
    expect(accept.request.body).toEqual({ parent_project_uid: 'parent-uid', application: { project_name: 'Example', future_question: 'kept' } });

    for (const request of [revise, withdraw, deny, accept]) {
      request.flush({ application: buildApplication(), etag: '8' });
    }
    remove.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('keeps write overlays per mode and prunes them once a read catches up', () => {
    service.recordWrite('submitter', buildApplication({ revision: 8, state: 'withdrawn' }));
    expect(
      service
        .overlay('submitter')()
        .map((app) => app.state)
    ).toEqual(['withdrawn']);
    expect(service.overlay('staff')()).toEqual([]);

    // A read still at the older revision keeps the overlay; one at the same revision prunes it.
    service.reconcile('submitter', [buildApplication({ revision: 7 })]);
    expect(service.overlay('submitter')()).toHaveLength(1);
    service.reconcile('submitter', [buildApplication({ revision: 8, state: 'withdrawn' })]);
    expect(service.overlay('submitter')()).toEqual([]);
  });

  it('remembers deletions until the index stops returning them', () => {
    service.recordWrite('staff', buildApplication());
    service.recordDeleted('staff', UID);
    expect(service.overlay('staff')()).toEqual([]);
    expect([...service.deletedUids('staff')()]).toEqual([UID]);

    service.reconcile('staff', [buildApplication()]);
    expect([...service.deletedUids('staff')()]).toEqual([UID]);
    service.reconcile('staff', []);
    expect([...service.deletedUids('staff')()]).toEqual([]);
  });

  it('forget drops one overlay entry so the next read wins', () => {
    service.recordWrite('submitter', buildApplication());
    service.forget('submitter', UID);
    expect(service.overlay('submitter')()).toEqual([]);
  });
});

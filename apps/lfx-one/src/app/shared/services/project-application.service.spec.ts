// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ProjectApplication } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectApplicationService } from './project-application.service';
import { UserService } from './user.service';

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
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: MessageService, useValue: { add: vi.fn() } }] });
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

  it('reads both access answers from one request, each failing closed (#5544)', () => {
    const results: unknown[] = [];
    service.getAccessState().subscribe((value) => results.push(value));
    http.expectOne('/api/project-applications/access').flush({ is_formation_team: false, is_lf_staff: true });
    // An older response without the staff field reads as not staff.
    service.getAccessState().subscribe((value) => results.push(value));
    http.expectOne('/api/project-applications/access').flush({ is_formation_team: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    service.getAccessState().subscribe((value) => results.push(value));
    http.expectOne('/api/project-applications/access').flush({ error: 'boom' }, { status: 503, statusText: 'Unavailable' });
    expect(results).toEqual([
      { isFormationTeam: false, isLfStaff: true },
      { isFormationTeam: true, isLfStaff: false },
      { isFormationTeam: false, isLfStaff: false },
    ]);
  });

  it('creates with the answers only', () => {
    service.create({ project_name: 'Example' }).subscribe();
    const request = http.expectOne('/api/project-applications');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ application: { project_name: 'Example' } });
    request.flush({ application: buildApplication(), etag: null });
  });

  it('sends the starting foundation as target_parent_uid when given, and nothing when null (#5187)', () => {
    service.create({ project_name: 'Example' }, '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d').subscribe();
    const withParent = http.expectOne('/api/project-applications');
    expect(withParent.request.body).toEqual({ application: { project_name: 'Example' }, target_parent_uid: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' });
    withParent.flush({ application: buildApplication(), etag: null });

    service.create({ project_name: 'Example' }, null).subscribe();
    const without = http.expectOne('/api/project-applications');
    expect(without.request.body).toEqual({ application: { project_name: 'Example' } });
    without.flush({ application: buildApplication(), etag: null });
  });

  describe('getStartedFrom (#5187)', () => {
    const uid = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const foundation = { uid, name: 'Example Foundation', stage: 'Active', funding: 'Funded', funding_model: ['Membership'], legal_entity_type: 'Corporation' };

    const resolve = (value: string | null | undefined, response?: { body: object; status?: number }): unknown => {
      let result: unknown = 'pending';
      service.getStartedFrom(value).subscribe((project) => (result = project));
      if (response) {
        http.expectOne(`/api/projects/${value}`).flush(response.body, { status: response.status ?? 200, statusText: 'x' });
      }
      return result;
    };

    it('resolves a foundation through the cached project read, once per uid', () => {
      const names: (string | undefined)[] = [];
      service.getStartedFrom(uid).subscribe((project) => names.push(project?.name));
      service.getStartedFrom(uid).subscribe((project) => names.push(project?.name));
      http.expectOne(`/api/projects/${uid}`).flush(foundation);
      expect(names).toEqual(['Example Foundation', 'Example Foundation']);
    });

    it('matches the hint to the project case-insensitively, since a UUID is valid in either case', () => {
      const upper = uid.toUpperCase();
      let result: { uid: string } | null = null;
      service.getStartedFrom(upper).subscribe((project) => (result = project));
      http.expectOne(`/api/projects/${upper}`).flush(foundation);
      expect(result).toEqual(expect.objectContaining({ uid }));
    });

    it('resolves to null, with no request, without a usable uid', () => {
      expect(resolve(null)).toBeNull();
      expect(resolve(undefined)).toBeNull();
      expect(resolve('agentic-ai-foundation')).toBeNull();
      http.expectNone('/api/projects/agentic-ai-foundation');
    });

    it('resolves to null for a project that cannot be read', () => {
      expect(resolve('11111111-2222-4333-8444-555555555555', { body: { error: 'forbidden' }, status: 403 })).toBeNull();
    });

    it('resolves to null for a project that is not a foundation, so a submitter-chosen uid is never shown or prefilled', () => {
      const other = '22222222-3333-4444-8555-666666666666';
      expect(resolve(other, { body: { ...foundation, uid: other, funding: 'Unfunded', funding_model: [] } })).toBeNull();
    });

    it('resolves to null when the read returns a different project than the one asked for', () => {
      const other = '33333333-4444-4555-8666-777777777777';
      expect(resolve(other, { body: foundation })).toBeNull();
    });
  });

  it('sends the held revision as If-Match on every mutation', () => {
    const application = buildApplication();
    service.revise(application, { project_name: 'Renamed' }).subscribe();
    service.withdraw(application).subscribe();
    service.deny(application).subscribe();
    service.accept(application, 'parent-uid', 'new-project').subscribe();
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
    expect(accept.request.body).toEqual({
      parent_project_uid: 'parent-uid',
      project_slug: 'new-project',
      application: { project_name: 'Example', future_question: 'kept' },
    });

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

  describe('shared staff read and pending count (#5229)', () => {
    const queue = [buildApplication({ uid: 'a' }), buildApplication({ uid: 'b' }), buildApplication({ uid: 'c', state: 'accepted' })];
    const flushQueue = (list = queue): void => http.expectOne('/api/project-applications/queue').flush(list);

    it('has no count before a read, and counts only awaiting-decision states over the read', () => {
      expect(service.pendingStaffCount()).toBeNull();
      service.refreshStaff();
      expect(service.pendingStaffCount()).toBeNull();
      flushQueue();
      expect(service.pendingStaffCount()).toBe(2);
    });

    it('drops the count on an overlay accept, deny or withdraw, without a refetch', () => {
      service.refreshStaff();
      flushQueue();
      service.recordWrite('staff', buildApplication({ uid: 'a', state: 'accepted', revision: 8 }));
      expect(service.pendingStaffCount()).toBe(1);
      service.recordWrite('staff', buildApplication({ uid: 'b', state: 'withdrawn', revision: 8 }));
      expect(service.pendingStaffCount()).toBe(0);
      http.expectNone('/api/project-applications/queue');
    });

    it('drops the count on a deletion', () => {
      service.refreshStaff();
      flushQueue();
      service.recordDeleted('staff', 'a');
      expect(service.pendingStaffCount()).toBe(1);
    });

    it('joins a read already in flight, so two callers make one request', () => {
      service.refreshStaff();
      service.refreshStaff();
      flushQueue();
      http.expectNone('/api/project-applications/queue');
      service.refreshStaff();
      flushQueue();
    });

    it('cancels the in-flight read when asked to supersede it', () => {
      service.refreshStaff();
      const stale = http.expectOne('/api/project-applications/queue');
      service.refreshStaff({ supersede: true });
      expect(stale.cancelled).toBe(true);
      flushQueue([buildApplication({ uid: 'x' })]);
      expect(service.pendingStaffCount()).toBe(1);
    });

    it('never caches an error: no count, the last good list is kept, and the next refresh tries again', () => {
      service.refreshStaff();
      flushQueue();
      service.refreshStaff();
      http.expectOne('/api/project-applications/queue').flush('boom', { status: 500, statusText: 'Server Error' });
      expect(service.staffError()).toBe(true);
      expect(service.pendingStaffCount()).toBeNull();
      expect(service.staffApplications()).toHaveLength(3);

      service.refreshStaff();
      flushQueue();
      expect(service.staffError()).toBe(false);
      expect(service.pendingStaffCount()).toBe(2);
    });

    it('keeps a failed read hidden through its retry, and keeps the last good count while a healthy refresh is pending', () => {
      service.refreshStaff();
      flushQueue();
      service.refreshStaff();
      expect(service.pendingStaffCount()).toBe(2);
      http.expectOne('/api/project-applications/queue').flush('boom', { status: 500, statusText: 'Server Error' });
      expect(service.pendingStaffCount()).toBeNull();

      service.refreshStaff();
      expect(service.staffLoading()).toBe(true);
      expect(service.pendingStaffCount()).toBeNull();
      flushQueue();
      expect(service.pendingStaffCount()).toBe(2);
    });

    it('shows no count, not zero, when the very first read fails', () => {
      service.refreshStaff();
      http.expectOne('/api/project-applications/queue').flush('boom', { status: 500, statusText: 'Server Error' });
      expect(service.pendingStaffCount()).toBeNull();
      expect(service.staffApplications()).toBeNull();
    });

    it('prunes the overlay against each fresh read', () => {
      service.recordWrite('staff', buildApplication({ uid: 'a', state: 'denied', revision: 8 }));
      service.refreshStaff();
      flushQueue([buildApplication({ uid: 'a', state: 'denied', revision: 8 }), buildApplication({ uid: 'b' })]);
      expect(service.overlay('staff')()).toEqual([]);
    });

    it('leaves the submitter read uncached: every call is its own request', () => {
      service.getApplications('submitter').subscribe();
      service.getApplications('submitter').subscribe();
      expect(http.match('/api/project-applications/mine')).toHaveLength(2);
    });

    it('clears the list, overlays and deletions when the signed-in identity changes', () => {
      service.refreshStaff();
      flushQueue();
      service.recordWrite('staff', buildApplication({ uid: 'a', state: 'denied', revision: 8 }));
      service.recordDeleted('submitter', 'z');

      const user = TestBed.inject(UserService);
      TestBed.tick(); // let the identity watcher take its initial value before the identity changes
      (user.user as ReturnType<typeof signal>).set({ sub: 'auth0|someone-else' });
      TestBed.tick();

      expect(service.staffApplications()).toBeNull();
      expect(service.pendingStaffCount()).toBeNull();
      expect(service.overlay('staff')()).toEqual([]);
      expect([...service.deletedUids('submitter')()]).toEqual([]);
      http.match('/api/profile'); // UserService's own post-render avatar read, unrelated to this test
    });

    it('drops a response that belongs to the previous identity and reads again for the new one', () => {
      const first = new Subject<ProjectApplication[]>();
      const second = new Subject<ProjectApplication[]>();
      const read = vi.spyOn(service, 'getApplications').mockReturnValueOnce(first).mockReturnValueOnce(second);
      const user = TestBed.inject(UserService);
      TestBed.tick();

      (user.user as ReturnType<typeof signal>).set({ sub: 'auth0|a' });
      TestBed.tick();
      service.refreshStaff();
      expect(read).toHaveBeenCalledTimes(1);

      (user.user as ReturnType<typeof signal>).set({ sub: 'auth0|b' });
      TestBed.tick();
      first.next([buildApplication({ uid: 'a-only' })]);
      first.complete();
      expect(service.staffApplications()).toBeNull();
      expect(service.pendingStaffCount()).toBeNull();

      expect(read).toHaveBeenCalledTimes(2);
      second.next([buildApplication({ uid: 'b-only' })]);
      second.complete();
      expect(service.staffApplications()?.map((app) => app.uid)).toEqual(['b-only']);
      expect(service.pendingStaffCount()).toBe(1);
      http.match('/api/profile');
    });
  });
});

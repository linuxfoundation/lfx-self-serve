// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ProjectPermissionUser, ProjectSettings } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(PermissionsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  describe('getProjectPermissions', () => {
    it('collapses a user present in both auditors and writers into a single manage row (#3218)', () => {
      const settings: ProjectSettings = {
        uid: 'project-1',
        announcement_date: '',
        auditors: [{ name: 'Avery Stone', email: 'astone@acme-motors.example', username: 'averystone' }],
        writers: [{ name: 'Avery Stone', email: 'astone@acme-motors.example', username: 'averystone' }],
        created_at: '',
        updated_at: '',
      };

      let result: ProjectPermissionUser[] = [];
      service.getProjectPermissions('project-1').subscribe((users) => {
        result = users;
      });

      http.expectOne('/api/projects/project-1/permissions').flush(settings);

      expect(result).toEqual([
        {
          name: 'Avery Stone',
          email: 'astone@acme-motors.example',
          username: 'averystone',
          avatar: undefined,
          role: 'manage',
        },
      ]);
    });

    it("collapses a user whose username is present on only one of the two entries, carrying the other entry's email as duplicateIdentifier (#3218/#3245)", () => {
      const settings: ProjectSettings = {
        uid: 'project-1',
        announcement_date: '',
        auditors: [{ name: 'Blair Chen', email: 'bchen@vendor-corp.example' }],
        writers: [{ name: 'Blair Chen', email: 'bchen@vendor-corp.example', username: 'blairchen' }],
        created_at: '',
        updated_at: '',
      };

      let result: ProjectPermissionUser[] = [];
      service.getProjectPermissions('project-1').subscribe((users) => {
        result = users;
      });

      http.expectOne('/api/projects/project-1/permissions').flush(settings);

      expect(result).toEqual([
        {
          name: 'Blair Chen',
          email: 'bchen@vendor-corp.example',
          username: 'blairchen',
          avatar: undefined,
          role: 'manage',
          duplicateIdentifier: 'bchen@vendor-corp.example',
        },
      ]);
    });

    it("preserves the real username when it is present only on the losing (view) entry, carrying the other entry's email as duplicateIdentifier (#3244 review)", () => {
      const settings: ProjectSettings = {
        uid: 'project-1',
        announcement_date: '',
        auditors: [{ name: 'Blair Chen', email: 'bchen@vendor-corp.example', username: 'blairchen' }],
        writers: [{ name: 'Blair Chen', email: 'bchen@vendor-corp.example' }],
        created_at: '',
        updated_at: '',
      };

      let result: ProjectPermissionUser[] = [];
      service.getProjectPermissions('project-1').subscribe((users) => {
        result = users;
      });

      http.expectOne('/api/projects/project-1/permissions').flush(settings);

      expect(result).toEqual([
        {
          name: 'Blair Chen',
          email: 'bchen@vendor-corp.example',
          username: 'blairchen',
          avatar: undefined,
          role: 'manage',
          duplicateIdentifier: 'bchen@vendor-corp.example',
        },
      ]);
    });

    it('collapses entries sharing a username even when only one of them also carries an email (Copilot #3244 review)', () => {
      const settings: ProjectSettings = {
        uid: 'project-1',
        announcement_date: '',
        auditors: [{ name: 'Jordan Pike', email: '', username: 'jordanpike' }],
        writers: [{ name: 'Jordan Pike', email: 'jpike@acme-motors.example', username: 'jordanpike' }],
        created_at: '',
        updated_at: '',
      };

      let result: ProjectPermissionUser[] = [];
      service.getProjectPermissions('project-1').subscribe((users) => {
        result = users;
      });

      http.expectOne('/api/projects/project-1/permissions').flush(settings);

      // Both entries share the username, so a single identifier ('jordanpike') matches both
      // backend entries — no duplicateIdentifier needed.
      expect(result).toEqual([
        {
          name: 'Jordan Pike',
          email: 'jpike@acme-motors.example',
          username: 'jordanpike',
          avatar: undefined,
          role: 'manage',
        },
      ]);
    });

    it('keeps distinct users as separate rows', () => {
      const settings: ProjectSettings = {
        uid: 'project-1',
        announcement_date: '',
        auditors: [{ name: 'Casey Doyle', email: 'cdoyle@vendor-corp.example', username: 'caseydoyle' }],
        writers: [{ name: 'Dakota Reyes', email: 'dreyes@acme-motors.example', username: 'dakotareyes' }],
        created_at: '',
        updated_at: '',
      };

      let result: ProjectPermissionUser[] = [];
      service.getProjectPermissions('project-1').subscribe((users) => {
        result = users;
      });

      http.expectOne('/api/projects/project-1/permissions').flush(settings);

      expect(result).toEqual([
        {
          name: 'Casey Doyle',
          email: 'cdoyle@vendor-corp.example',
          username: 'caseydoyle',
          avatar: undefined,
          role: 'view',
        },
        {
          name: 'Dakota Reyes',
          email: 'dreyes@acme-motors.example',
          username: 'dakotareyes',
          avatar: undefined,
          role: 'manage',
        },
      ]);
    });

    it('does not collapse distinct users who both lack a username and an email', () => {
      const settings: ProjectSettings = {
        uid: 'project-1',
        announcement_date: '',
        auditors: [{ name: 'Anonymous One', email: '' }],
        writers: [{ name: 'Anonymous Two', email: '' }],
        created_at: '',
        updated_at: '',
      };

      let result: ProjectPermissionUser[] = [];
      service.getProjectPermissions('project-1').subscribe((users) => {
        result = users;
      });

      http.expectOne('/api/projects/project-1/permissions').flush(settings);

      expect(result).toEqual([
        {
          name: 'Anonymous One',
          email: '',
          username: '',
          avatar: undefined,
          role: 'view',
        },
        {
          name: 'Anonymous Two',
          email: '',
          username: '',
          avatar: undefined,
          role: 'manage',
        },
      ]);
    });
  });

  describe('removeUserFromProject', () => {
    it('removes only the primary identifier when there is no duplicateIdentifier', () => {
      let completed = false;
      service.removeUserFromProject('project-1', 'blairchen').subscribe(() => {
        completed = true;
      });

      http.expectOne('/api/projects/project-1/permissions/blairchen').flush(null);
      expect(completed).toBe(true);
    });

    it('also deletes the duplicateIdentifier entry so a collapsed dual-role user does not reappear (#3245/#3244)', () => {
      let completed = false;
      service.removeUserFromProject('project-1', 'blairchen', 'bchen@vendor-corp.example').subscribe(() => {
        completed = true;
      });

      http.expectOne('/api/projects/project-1/permissions/blairchen').flush(null);
      http.expectOne('/api/projects/project-1/permissions/bchen%40vendor-corp.example').flush(null);
      expect(completed).toBe(true);
    });

    it('tolerates a 404 on the duplicateIdentifier cleanup (already removed by a concurrent edit)', () => {
      let completed = false;
      service.removeUserFromProject('project-1', 'blairchen', 'bchen@vendor-corp.example').subscribe(() => {
        completed = true;
      });

      http.expectOne('/api/projects/project-1/permissions/blairchen').flush(null);
      http.expectOne('/api/projects/project-1/permissions/bchen%40vendor-corp.example').flush(null, { status: 404, statusText: 'Not Found' });
      expect(completed).toBe(true);
    });
  });

  describe('updateUserRole', () => {
    it('also deletes the duplicateIdentifier entry after a role change so no stray duplicate remains (#3245/#3244)', () => {
      let completed = false;
      service.updateUserRole('project-1', 'blairchen', { role: 'manage' }, 'bchen@vendor-corp.example').subscribe(() => {
        completed = true;
      });

      http.expectOne('/api/projects/project-1/permissions/blairchen').flush(null);
      http.expectOne('/api/projects/project-1/permissions/bchen%40vendor-corp.example').flush(null);
      expect(completed).toBe(true);
    });
  });
});

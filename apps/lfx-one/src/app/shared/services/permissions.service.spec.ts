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

    it('collapses a user whose username is present on only one of the two entries (#3218)', () => {
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
});

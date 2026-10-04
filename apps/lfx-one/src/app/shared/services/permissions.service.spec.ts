// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ProjectSettings } from '@lfx-one/shared/interfaces';
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
        auditors: [{ name: 'Reden Martinez', email: 'rmartinez@linuxfoundation.org', username: 'redenmartinez' }],
        writers: [{ name: 'Reden Martinez', email: 'rmartinez@linuxfoundation.org', username: 'redenmartinez' }],
        created_at: '',
        updated_at: '',
      };

      let result: unknown[] = [];
      service.getProjectPermissions('project-1').subscribe((users) => {
        result = users;
      });

      http.expectOne('/api/projects/project-1/permissions').flush(settings);

      expect(result).toEqual([
        {
          name: 'Reden Martinez',
          email: 'rmartinez@linuxfoundation.org',
          username: 'redenmartinez',
          avatar: undefined,
          role: 'manage',
        },
      ]);
    });

    it('keeps distinct users as separate rows', () => {
      const settings: ProjectSettings = {
        uid: 'project-1',
        announcement_date: '',
        auditors: [{ name: 'Betty Masila', email: 'bmasila@linuxfoundation.com', username: 'bmasila' }],
        writers: [{ name: 'Deb Giles', email: 'dgiles@linuxfoundation.org', username: 'debgiles' }],
        created_at: '',
        updated_at: '',
      };

      let result: unknown[] = [];
      service.getProjectPermissions('project-1').subscribe((users) => {
        result = users;
      });

      http.expectOne('/api/projects/project-1/permissions').flush(settings);

      expect(result).toEqual([
        {
          name: 'Betty Masila',
          email: 'bmasila@linuxfoundation.com',
          username: 'bmasila',
          avatar: undefined,
          role: 'view',
        },
        {
          name: 'Deb Giles',
          email: 'dgiles@linuxfoundation.org',
          username: 'debgiles',
          avatar: undefined,
          role: 'manage',
        },
      ]);
    });
  });
});

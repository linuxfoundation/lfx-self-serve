// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Route } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { MeetingComposerRouteComponent } from './meeting-composer/meeting-composer-route.component';
import { MEETING_ROUTES } from './meetings.routes';

describe('MEETING_ROUTES deep links', () => {
  const entries = (path: string): Route[] => MEETING_ROUTES.filter((route) => route.path === path);

  for (const path of ['create', ':id/edit']) {
    it(`sends ${path} to the composer`, async () => {
      const [route] = entries(path);

      expect(entries(path)).toHaveLength(1);
      expect(route.canMatch).toBeUndefined();
      expect(await route.loadComponent?.()).toBe(MeetingComposerRouteComponent);
    });
  }
});

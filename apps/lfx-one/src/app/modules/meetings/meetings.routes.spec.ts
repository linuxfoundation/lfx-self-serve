// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Route } from '@angular/router';
import { meetingsV2Guard } from '@shared/guards/meetings-v2.guard';
import { describe, expect, it } from 'vitest';

import { MeetingComposerRouteComponent } from './meeting-composer/meeting-composer-route.component';
import { MeetingManageComponent } from './meeting-manage/meeting-manage.component';
import { MEETING_ROUTES } from './meetings.routes';

describe('MEETING_ROUTES deep links', () => {
  const entries = (path: string): Route[] => MEETING_ROUTES.filter((route) => route.path === path);
  const loads = async (route: Route): Promise<unknown> => route.loadComponent?.();

  for (const path of ['create', ':id/edit']) {
    it(`sends ${path} to the composer while the flag matches, and falls through to the wizard otherwise`, async () => {
      const [composer, wizard] = entries(path);

      expect(entries(path)).toHaveLength(2);
      expect(composer.canMatch).toEqual([meetingsV2Guard]);
      expect(await loads(composer)).toBe(MeetingComposerRouteComponent);
      expect(wizard.canMatch).toBeUndefined();
      expect(await loads(wizard)).toBe(MeetingManageComponent);
      // Authorization never depends on the flag.
      expect(composer.canActivate).toEqual(wizard.canActivate);
      expect(composer.data).toEqual(wizard.data);
    });
  }
});

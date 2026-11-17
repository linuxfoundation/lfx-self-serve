// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Route } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';
import { writerGuard } from '@shared/guards/writer.guard';
import { describe, expect, it } from 'vitest';

import { MeetingComposerRouteComponent } from './meeting-composer/meeting-composer-route.component';
import { MEETING_ROUTES } from './meetings.routes';

describe('MEETING_ROUTES deep links', () => {
  const entries = (path: string): Route[] => MEETING_ROUTES.filter((route) => route.path === path);

  it.each([
    ['create', { writeFeature: 'meetings' }],
    [':id/edit', { writeFeature: 'meetings', entityScopedSlug: true }],
  ])('sends %s to the composer behind authGuard and writerGuard', async (path, data) => {
    const [route] = entries(path);

    expect(entries(path)).toHaveLength(1);
    expect(route.canMatch).toBeUndefined();
    expect(await route.loadComponent?.()).toBe(MeetingComposerRouteComponent);
    expect(route.canActivate).toEqual([authGuard, writerGuard]);
    expect(route.data).toEqual(data);
  });
});

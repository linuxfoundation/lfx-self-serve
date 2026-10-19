// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CanMatchFn } from '@angular/router';

/**
 * `/votes/:id` (the vote permalink) is mounted ahead of the flat `votes` mount, so without this guard
 * its `:id` would also capture the module's static `create` child. Rejecting that segment lets
 * `/votes/create` fall through to `VOTE_ROUTES` as before.
 */
export const votePermalinkMatchGuard: CanMatchFn = (_route, segments) => {
  const id = segments[1]?.path;
  return !!id && id !== 'create';
};

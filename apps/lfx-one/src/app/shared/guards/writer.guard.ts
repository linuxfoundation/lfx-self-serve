// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { ProjectService } from '../services/project.service';
import { UserService } from '../services/user.service';

/**
 * Writer access guard that protects routes requiring project writer permissions.
 *
 * Redirects users without writer access to the project dashboard.
 * Requires the user to be authenticated and have writer access to the current project.
 */
export const writerGuard: CanActivateFn = (route) => {
  const userService = inject(UserService);
  const projectService = inject(ProjectService);
  const router = inject(Router);

  // Check if user is authenticated first
  if (!userService.authenticated()) {
    return false;
  }

  // Get project slug from route parameters
  const projectSlug = route.parent?.params?.['slug'] || route.params['slug'];

  if (!projectSlug) {
    return false;
  }

  // Fetch project and check writer access
  return projectService.getProject(projectSlug, false).pipe(
    map((project) => {
      if (!project) {
        // Project not found, redirect to home
        router.navigate(['/']);
        return false;
      }

      if (!project.writer) {
        // User doesn't have writer access, redirect to project dashboard
        router.navigate(['/project', projectSlug]);
        return false;
      }

      return true;
    })
  );
};

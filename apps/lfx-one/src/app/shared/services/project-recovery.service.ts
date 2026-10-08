// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { RedirectCommand, Router } from '@angular/router';
import { Project } from '@lfx-one/shared/interfaces';
import { Observable } from 'rxjs';

import { retryTransientHttpError } from '../utils/http-error.utils';
import { ProjectService } from './project.service';

/** Shared lookup policy and recovery target for guards that resolve selected projects. */
@Injectable({ providedIn: 'root' })
export class ProjectRecoveryService {
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);

  public retryUrl: string | undefined;

  public resolve(slug: string): Observable<Project> {
    return this.projectService.getProjectStrict(slug).pipe(retryTransientHttpError());
  }

  public unavailable(url: string): RedirectCommand {
    // Write before redirecting: same-URL redirects can be skipped without recreating the view.
    this.retryUrl = url;
    return new RedirectCommand(this.router.parseUrl('/unavailable'), { skipLocationChange: true });
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { LINKEDIN_API, MKTG_DOCUMENT_ID_REGEX, MKTG_RUN_STORAGE_TTL_MS } from '@lfx-one/shared/constants';
import { LinkedinGeneration, LinkedinProfile, LinkedinSetup, LinkedinStoredProfile, MktgAgentIntake } from '@lfx-one/shared/interfaces';
import { catchError, Observable, take, tap, throwError } from 'rxjs';
import { UserService } from './user.service';

/** Per-user profile client and accepted document transport. No feedback request exists here. */
@Injectable({ providedIn: 'root' })
export class LinkedinPostService {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PLATFORM_ID);
  private readonly user = inject(UserService);
  private readonly unsavedSetup = new Map<string, { setup: LinkedinSetup; savedAt: number }>();

  public profile(): Observable<{ profile: LinkedinStoredProfile | null }> {
    return this.http.get<{ profile: LinkedinStoredProfile | null }>(`${LINKEDIN_API}/profile`).pipe(
      catchError((error) => {
        console.error('Could not load the LinkedIn profile');
        return throwError(() => error);
      })
    );
  }
  public save(body: { setup?: LinkedinSetup; profile?: LinkedinProfile }): Observable<{ profile: LinkedinStoredProfile }> {
    return this.http.put<{ profile: LinkedinStoredProfile }>(`${LINKEDIN_API}/profile`, body).pipe(take(1));
  }
  public startForDocument(intake: MktgAgentIntake, project: string, answers: Record<string, string>, setup?: LinkedinSetup): Observable<LinkedinGeneration> {
    return this.create(intake, project, answers, setup).pipe(
      tap((run) => {
        if (setup) this.unsavedSetup.set(this.setupKey(project, run.documentId), { setup: { ...setup }, savedAt: Date.now() });
      })
    );
  }

  /** Explicit profile editing only. A new client/browser cannot recover private setup. */
  public setupForDocument(project: string, documentId: string): LinkedinSetup | null {
    if (!isPlatformBrowser(this.platform) || !this.user.user()?.sub) return null;
    const key = this.setupKey(project, documentId);
    const value = this.unsavedSetup.get(key);
    if (!value || Date.now() - value.savedAt > MKTG_RUN_STORAGE_TTL_MS) {
      this.unsavedSetup.delete(key);
      return null;
    }
    return { ...value.setup };
  }

  private setupKey(project: string, documentId: string): string {
    return `${this.user.user()?.sub ?? ''}:${project}:${documentId}`;
  }

  private create(intake: MktgAgentIntake, project: string, answers: Record<string, string>, setup?: LinkedinSetup): Observable<LinkedinGeneration> {
    const owner = this.user.user()?.sub;
    return this.http.post<LinkedinGeneration>(intake.endpoints.generate, { project, answers, ...(setup ? { setup } : {}) }).pipe(
      take(1),
      tap((run) => {
        if (!owner || owner !== this.user.user()?.sub || !MKTG_DOCUMENT_ID_REGEX.test(run.documentId))
          throw new Error('The run belongs to a different user or has no document destination.');
      })
    );
  }
}

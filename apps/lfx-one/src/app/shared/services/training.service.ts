// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Certification } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class TrainingService {
  private readonly http = inject(HttpClient);

  public getCertifications(): Observable<Certification[]> {
    return this.http.get<Certification[]>('/api/training/certifications').pipe(catchError(() => of([])));
  }
}

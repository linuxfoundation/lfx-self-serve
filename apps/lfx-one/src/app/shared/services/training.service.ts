// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Certification, TrainingEnrollment } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class TrainingService {
  private readonly http = inject(HttpClient);

  public getCertifications(productType?: string): Observable<Certification[]> {
    let params = new HttpParams();
    if (productType) {
      params = params.set('productType', productType);
    }
    return this.http.get<Certification[]>('/api/training/certifications', { params }).pipe(catchError(() => of([])));
  }

  public getEnrollments(): Observable<TrainingEnrollment[]> {
    return this.http.get<TrainingEnrollment[]>('/api/training/enrollments').pipe(catchError(() => of([])));
  }
}

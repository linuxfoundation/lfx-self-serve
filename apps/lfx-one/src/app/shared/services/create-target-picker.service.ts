// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { EMPTY_CREATE_PICKER_RESULT } from '@lfx-one/shared/constants';
import { CreatableArtifactType, CreatePickerResultSet } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

/**
 * Thin HTTP wrapper around the create picker's three BFF endpoints (LFXV2-2838). `getTree()` and
 * `search()` fail closed to an empty result set rather than surfacing an error — a picker that
 * can't load should look empty, not broken, since the create dialog has no error-recovery UI of
 * its own. `getChildren()` is the exception — see its own doc comment.
 */
@Injectable({
  providedIn: 'root',
})
export class CreateTargetPickerService {
  private readonly http = inject(HttpClient);

  /** Top-level direct-grant tree nodes for the given artifact type. */
  public getTree(artifactType: CreatableArtifactType): Observable<CreatePickerResultSet> {
    const params = new HttpParams().set('artifactType', artifactType);
    return this.http.get<CreatePickerResultSet>('/api/create-picker/tree', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load create-picker tree:', error);
        return of(EMPTY_CREATE_PICKER_RESULT);
      })
    );
  }

  /**
   * Lazy fan-out for one tree node. Unlike `getTree()`/`search()`, errors are NOT swallowed here —
   * the caller (the tree node itself) needs to tell a real failure (worth retrying on next expand)
   * apart from a confirmed, genuinely empty result (a real leaf — must not retry indefinitely).
   */
  public getChildren(parentType: 'project' | 'committee', parentUid: string, artifactType: CreatableArtifactType): Observable<CreatePickerResultSet> {
    const params = new HttpParams().set('parentType', parentType).set('parentUid', parentUid).set('artifactType', artifactType);
    return this.http.get<CreatePickerResultSet>('/api/create-picker/tree/children', { params });
  }

  /** Type-ahead search across both resource types. */
  public search(term: string, artifactType: CreatableArtifactType): Observable<CreatePickerResultSet> {
    const params = new HttpParams().set('q', term).set('artifactType', artifactType);
    return this.http.get<CreatePickerResultSet>('/api/create-picker/search', { params }).pipe(
      catchError((error) => {
        console.error('Failed to search create-picker targets:', error);
        return of(EMPTY_CREATE_PICKER_RESULT);
      })
    );
  }
}

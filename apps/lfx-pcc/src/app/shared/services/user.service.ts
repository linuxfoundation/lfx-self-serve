// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { CreateUserPermissionRequest, User } from '@lfx-pcc/shared/interfaces';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private readonly http = inject(HttpClient);

  public authenticated: WritableSignal<boolean> = signal<boolean>(false);
  public user: WritableSignal<User | null> = signal<User | null>(null);

  // Create a new user with permissions
  public createUserWithPermissions(userData: CreateUserPermissionRequest): Observable<any> {
    return this.http.post(`/api/projects/${userData.project_uid}/permissions`, userData);
  }
}

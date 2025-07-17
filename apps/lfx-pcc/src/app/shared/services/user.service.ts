// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal, WritableSignal } from '@angular/core';
import { User } from '@lfx-pcc/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  public authenticated: WritableSignal<boolean> = signal<boolean>(false);
  public user: WritableSignal<User | null> = signal<User | null>(null);
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface User {
  sid: string;
  'https://sso.linuxfoundation.org/claims/username': string;
  given_name: string;
  family_name: string;
  nickname: string;
  name: string;
  picture: string;
  updated_at: string;
  email: string;
  email_verified: boolean;
  sub: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  id?: string;
  created_at?: string;
}

export interface AuthContext {
  authenticated: boolean;
  user: User | null;
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface InviteTokenPayload {
  email: string;
  exp: number;
  iat: number;
  jti: string;
  invite_uid: string;
  resource_uid: string;
  return_url: string;
  role: string;
}

export interface AcceptInviteResponse {
  return_url: string;
}

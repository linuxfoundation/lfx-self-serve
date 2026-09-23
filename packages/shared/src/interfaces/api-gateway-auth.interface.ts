// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { M2MTokenResponse } from './auth.interface';

export interface ApiGatewayGrant {
  sub: string;
  issuer: string;
  audience: string;
  clientId: string;
}

export interface ApiGatewayAuthState extends ApiGatewayGrant {
  state: string;
  returnTo: string;
  silent: boolean;
  codeVerifier: string;
  expiresAt: number;
}

export interface ApiGatewayTokenResponse extends M2MTokenResponse {
  refresh_token?: string;
}

export type ApiGatewayAuthStatus = 'ready' | 'required' | 'unavailable' | 'not_configured' | 'impersonating';

export interface ApiGatewayRefreshResult {
  status: 'success' | 'invalid_grant' | 'invalid_token' | 'unavailable';
  token?: ApiGatewayTokenResponse;
  expiresAt?: number;
}

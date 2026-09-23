// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ApiGatewayAuthState, ApiGatewayAuthStatus, ApiGatewayGrant } from '@lfx-one/shared/interfaces';

declare global {
  namespace Express {
    interface Request {
      bearerToken?: string;
      apiGatewayToken?: string;
      apiGatewayAuthStatus?: ApiGatewayAuthStatus;
      crowdfundingToken?: string;
      impersonationActive?: boolean;
      appSession?:
        | {
            profileAccessToken?: string;
            profileTokenType?: string;
            profileScope?: string;
            profileExpiresIn?: number;
            profileExpiresAt?: number;
            // No-Valkey fallback only for Flow C's CSRF state (#1938) — see AuthStateService.
            profileAuthState?: string;
            profileAuthReturnTo?: string;
            profileAuthSub?: string;
            pendingEmailVerification?: { email: string; otp: string };
            pendingSocialConnect?: { provider: string; returnTo: string };
            socialAuthState?: string;
            socialConnectReturnTo?: string;
            apiGatewayToken?: string;
            apiGatewayTokenExpiresAt?: number;
            apiGatewayRefreshToken?: string;
            apiGatewayGrant?: ApiGatewayGrant;
            apiGatewayAuthState?: ApiGatewayAuthState;
            apiGatewayAuthAttempted?: boolean;
            crowdfundingToken?: string;
            crowdfundingTokenExpiresAt?: number;
            crowdfundingRefreshToken?: string;
            crowdfundingAuthState?: string;
            crowdfundingAuthReturnTo?: string;
            [key: string]: any;
          }
        // express-openid-connect's setter for req.appSession only accepts null/undefined (to clear the
        // session) or a value carrying its internal REASSIGN symbol — see appSession.js's `attachSessionObject`.
        | null;
    }
  }
}

export {};

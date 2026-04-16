// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

declare global {
  namespace Express {
    interface Request {
      bearerToken?: string;
      apiGatewayToken?: string;
      appSession?: {
        profileAccessToken?: string;
        profileTokenType?: string;
        profileScope?: string;
        profileExpiresIn?: number;
        profileExpiresAt?: number;
        profileAuthState?: string;
        pendingEmailVerification?: { email: string; otp: string };
        pendingSocialConnect?: { provider: string; returnTo: string };
        socialAuthState?: string;
        apiGatewayToken?: string;
        apiGatewayTokenExpiresAt?: number;
        [key: string]: any;
      };
    }
  }
}

export {};

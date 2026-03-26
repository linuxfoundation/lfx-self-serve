// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { M2MTokenResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const TOKEN_EXPIRY_BUFFER_SECONDS = 300; // 5 minutes before actual expiry
const tokenCache = new Map<string, CachedToken>();

export interface M2MTokenOptions {
  audience?: string; // Override default M2M_AUTH_AUDIENCE
}

/**
 * Generates a machine-to-machine (M2M) token from Auth0 (production) or Authelia (local dev)
 * @param req Express request object for logging context
 * @param options Optional overrides (e.g. audience for auth-service)
 * @returns Promise resolving to the access token string
 * @throws MicroserviceError if token generation fails
 */
export async function generateM2MToken(req: Request, options?: M2MTokenOptions): Promise<string> {
  const issuerBaseUrl = process.env['M2M_AUTH_ISSUER_BASE_URL'];
  const isAuthelia = issuerBaseUrl?.includes('auth.k8s.orb.local');

  const audience = options?.audience || process.env['M2M_AUTH_AUDIENCE'];
  const cacheKey = audience || '__default__';

  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    logger.debug(req, 'generate_m2m_token', 'Using cached M2M token', { audience });
    return cached.token;
  }

  const startTime = logger.startOperation(req, 'generate_m2m_token', {
    audience,
    issuer: issuerBaseUrl,
    auth_provider: isAuthelia ? 'authelia' : 'auth0',
  });

  try {
    // Select the appropriate request configuration, passing audience override
    const config = isAuthelia ? createAutheliaTokenRequest(audience) : createAuth0TokenRequest(audience);
    const tokenEndpoint = new URL(config.endpoint, issuerBaseUrl).toString();

    // Prepare request options based on auth provider
    const requestOptions = {
      method: config.method,
      headers: config.createHeaders!(),
      body: config.createBody(),
    };

    const response = await fetch(tokenEndpoint, requestOptions);

    if (!response.ok) {
      let errorBody: any = {};
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
        // If JSON parsing fails, use empty object
      }

      logger.error(req, 'generate_m2m_token', startTime, new Error(`${isAuthelia ? 'Authelia' : 'Auth0'} token request failed: ${response.status}`), {
        status: response.status,
        statusText: response.statusText,
        error_body: errorBody,
        auth_provider: isAuthelia ? 'authelia' : 'auth0',
      });

      throw new MicroserviceError('Failed to generate M2M token', response.status, isAuthelia ? 'AUTHELIA_TOKEN_FAILED' : 'AUTH0_TOKEN_FAILED', {
        operation: 'generate_m2m_token',
        service: isAuthelia ? 'authelia' : 'auth0',
        path: tokenEndpoint,
        errorBody: errorBody,
      });
    }

    const tokenResponse: M2MTokenResponse = await response.json();

    if (!tokenResponse.access_token) {
      logger.error(req, 'generate_m2m_token', startTime, new Error('No access token in response'), {
        token_response: tokenResponse,
      });

      throw new MicroserviceError('Invalid token response: missing access_token', 500, 'INVALID_TOKEN_RESPONSE', {
        operation: 'generate_m2m_token',
        service: isAuthelia ? 'authelia' : 'auth0',
        path: tokenEndpoint,
      });
    }

    logger.success(req, 'generate_m2m_token', startTime, {
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in,
      scope: tokenResponse.scope,
    });

    // Cache with 5-minute buffer before expiry
    tokenCache.set(cacheKey, {
      token: tokenResponse.access_token,
      expiresAt: Date.now() + (tokenResponse.expires_in - TOKEN_EXPIRY_BUFFER_SECONDS) * 1000,
    });

    return tokenResponse.access_token;
  } catch (error) {
    // If it's already a structured error, re-throw it
    if (error instanceof MicroserviceError) {
      throw error;
    }

    // Log and wrap unexpected errors
    logger.error(req, 'generate_m2m_token', startTime, error, {});

    const issuerBaseUrl = process.env['M2M_AUTH_ISSUER_BASE_URL'];
    const isAuthelia = issuerBaseUrl?.includes('auth.k8s.orb.local');

    throw new MicroserviceError('Unexpected error during M2M token generation', 500, 'M2M_TOKEN_UNEXPECTED_ERROR', {
      operation: 'generate_m2m_token',
      service: isAuthelia ? 'authelia' : 'auth0',
      errorBody: {
        original_error: error,
      },
    });
  }
}

/**
 * Creates request configuration for Auth0 M2M token generation
 */
function createAuth0TokenRequest(audience: string | undefined) {
  return {
    endpoint: 'oauth/token',
    method: 'POST',
    createHeaders: () => ({
      ['Cache-Control']: 'no-cache',
      ['Content-Type']: 'application/json',
    }),
    createBody: () =>
      JSON.stringify({
        audience,
        grant_type: 'client_credentials',
        client_id: process.env['M2M_AUTH_CLIENT_ID'],
        client_secret: process.env['M2M_AUTH_CLIENT_SECRET'],
      }),
  };
}

/**
 * Creates request configuration for Authelia M2M token generation
 */
function createAutheliaTokenRequest(audience: string | undefined) {
  return {
    endpoint: 'api/oidc/token',
    method: 'POST',
    createHeaders: () => {
      const clientId = process.env['M2M_AUTH_CLIENT_ID'];
      const clientSecret = process.env['M2M_AUTH_CLIENT_SECRET'];
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      return {
        ['Authorization']: `Basic ${basicAuth}`,
        ['Content-Type']: 'application/x-www-form-urlencoded',
      };
    },
    createBody: () => {
      const formData = new URLSearchParams({
        grant_type: 'client_credentials',
        audience: audience || '',
      });
      return formData.toString();
    },
  };
}

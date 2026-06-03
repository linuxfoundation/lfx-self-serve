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

const TOKEN_EXPIRY_BUFFER_SECONDS = 300;
const tokenCache = new Map<string, CachedToken>();

export interface ClientCredentialsOptions {
  issuerBaseUrl: string;
  clientId: string;
  clientSecret: string;
  audience: string;
}

/**
 * Fetches an OAuth client_credentials token from Auth0 or Authelia.
 * Caller supplies the full credential set, making this reusable for any
 * OAuth application registered on either provider.
 * Results are cached per (issuerBaseUrl + audience) with a 5-minute expiry buffer.
 *
 * @param req     Express request for logging context
 * @param options Credential set and target audience
 * @returns Access token string
 * @throws MicroserviceError if token fetch fails
 */
export async function fetchClientCredentialsToken(req: Request, options: ClientCredentialsOptions): Promise<string> {
  const issuerBaseUrl = options.issuerBaseUrl.replace(/\/+$/, '');
  const isAuthelia = issuerBaseUrl.includes('auth.k8s.orb.local');

  const cacheKey = `${issuerBaseUrl}:${options.audience}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    logger.debug(req, 'fetch_client_credentials_token', 'Using cached token', { audience: options.audience });
    return cached.token;
  }

  const startTime = logger.startOperation(req, 'fetch_client_credentials_token', {
    audience: options.audience,
    issuer: issuerBaseUrl,
    auth_provider: isAuthelia ? 'authelia' : 'auth0',
  });

  try {
    const config = isAuthelia ? createAutheliaTokenRequest(issuerBaseUrl, options) : createAuth0TokenRequest(issuerBaseUrl, options);
    const tokenEndpoint = config.endpoint;

    const requestOptions = {
      method: config.method,
      headers: config.createHeaders(),
      body: config.createBody(),
    };

    const response = await fetch(tokenEndpoint, requestOptions);

    if (!response.ok) {
      let errorBody: unknown = {};
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      logger.error(req, 'fetch_client_credentials_token', startTime, new Error(`Token request failed: ${response.status}`), {
        status: response.status,
        statusText: response.statusText,
        error_body: errorBody,
        auth_provider: isAuthelia ? 'authelia' : 'auth0',
      });

      throw new MicroserviceError('Failed to fetch client credentials token', response.status, isAuthelia ? 'AUTHELIA_TOKEN_FAILED' : 'AUTH0_TOKEN_FAILED', {
        operation: 'fetch_client_credentials_token',
        service: isAuthelia ? 'authelia' : 'auth0',
        path: tokenEndpoint,
        errorBody,
      });
    }

    const tokenResponse: M2MTokenResponse = await response.json();

    if (!tokenResponse.access_token) {
      throw new MicroserviceError('Invalid token response: missing access_token', 500, 'INVALID_TOKEN_RESPONSE', {
        operation: 'fetch_client_credentials_token',
        service: isAuthelia ? 'authelia' : 'auth0',
        path: tokenEndpoint,
      });
    }

    logger.success(req, 'fetch_client_credentials_token', startTime, {
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in,
    });

    tokenCache.set(cacheKey, {
      token: tokenResponse.access_token,
      expiresAt: Date.now() + (tokenResponse.expires_in - TOKEN_EXPIRY_BUFFER_SECONDS) * 1000,
    });

    return tokenResponse.access_token;
  } catch (error) {
    if (error instanceof MicroserviceError) {
      throw error;
    }

    logger.error(req, 'fetch_client_credentials_token', startTime, error, {});

    throw new MicroserviceError('Unexpected error during client credentials token fetch', 500, 'CLIENT_CREDENTIALS_TOKEN_UNEXPECTED_ERROR', {
      operation: 'fetch_client_credentials_token',
      service: isAuthelia ? 'authelia' : 'auth0',
      errorBody: { original_error: error },
    });
  }
}

function createAuth0TokenRequest(issuerBaseUrl: string, options: ClientCredentialsOptions) {
  return {
    endpoint: `${issuerBaseUrl}/oauth/token`,
    method: 'POST',
    createHeaders: () => ({
      ['Content-Type']: 'application/x-www-form-urlencoded',
    }),
    createBody: () =>
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.clientId,
        client_secret: options.clientSecret,
        audience: options.audience,
      }).toString(),
  };
}

function createAutheliaTokenRequest(issuerBaseUrl: string, options: ClientCredentialsOptions) {
  return {
    endpoint: `${issuerBaseUrl}/api/oidc/token`,
    method: 'POST',
    createHeaders: () => {
      const basicAuth = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64');
      return {
        ['Authorization']: `Basic ${basicAuth}`,
        ['Content-Type']: 'application/x-www-form-urlencoded',
      };
    },
    createBody: () =>
      new URLSearchParams({
        grant_type: 'client_credentials',
        audience: options.audience,
      }).toString(),
  };
}

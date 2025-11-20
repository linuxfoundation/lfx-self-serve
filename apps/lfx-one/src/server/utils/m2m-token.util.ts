// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { M2MTokenResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { Logger } from '../helpers/logger';

/**
 * Generates a machine-to-machine (M2M) token from Auth0 (production) or Authelia (local dev)
 * @param req Express request object for logging context
 * @returns Promise resolving to the access token string
 * @throws MicroserviceError if token generation fails
 */
export async function generateM2MToken(req: Request): Promise<string> {
  // TODO: Cache the token
  const issuerBaseUrl = process.env['M2M_AUTH_ISSUER_BASE_URL'];
  const isAuthelia = issuerBaseUrl?.includes('auth.k8s.orb.local');

  const startTime = Logger.start(req, 'generate_m2m_token', {
    audience: process.env['M2M_AUTH_AUDIENCE'],
    issuer: issuerBaseUrl,
    auth_provider: isAuthelia ? 'authelia' : 'auth0',
  });

  try {
    req.log.debug(req, 'generate_m2m_token', startTime, { auth_provider: isAuthelia ? 'authelia' : 'auth0' }, 'Generating M2M token...');

    // Select the appropriate request configuration
    const config = isAuthelia ? AUTHELIA_TOKEN_REQUEST : AUTH0_TOKEN_REQUEST;
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

      Logger.error(req, 'generate_m2m_token', startTime, new Error(`${isAuthelia ? 'Authelia' : 'Auth0'} token request failed: ${response.status}`), {
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
      Logger.error(req, 'generate_m2m_token', startTime, new Error('No access token in response'), {
        token_response: tokenResponse,
      });

      throw new MicroserviceError('Invalid token response: missing access_token', 500, 'INVALID_TOKEN_RESPONSE', {
        operation: 'generate_m2m_token',
        service: isAuthelia ? 'authelia' : 'auth0',
        path: tokenEndpoint,
      });
    }

    Logger.success(req, 'generate_m2m_token', startTime, {
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in,
      scope: tokenResponse.scope,
    });

    // TODO: Cache the token

    return tokenResponse.access_token;
  } catch (error) {
    // If it's already a structured error, re-throw it
    if (error instanceof MicroserviceError) {
      throw error;
    }

    // Log and wrap unexpected errors
    Logger.error(req, 'generate_m2m_token', startTime, error, {});

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
 * Request configuration for Auth0 M2M token generation
 */
const AUTH0_TOKEN_REQUEST = {
  endpoint: 'oauth/token',
  method: 'POST',
  createHeaders: () => ({
    ['Cache-Control']: 'no-cache',
    ['Content-Type']: 'application/json',
  }),
  createBody: () =>
    JSON.stringify({
      audience: process.env['M2M_AUTH_AUDIENCE'],
      grant_type: 'client_credentials',
      client_id: process.env['M2M_AUTH_CLIENT_ID'],
      client_secret: process.env['M2M_AUTH_CLIENT_SECRET'],
    }),
};

/**
 * Request configuration for Authelia M2M token generation
 */
const AUTHELIA_TOKEN_REQUEST = {
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
      audience: process.env['M2M_AUTH_AUDIENCE'] || '',
    });
    return formData.toString();
  },
};

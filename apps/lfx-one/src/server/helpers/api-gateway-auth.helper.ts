// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { API_GATEWAY_AUTH } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { validateAndSanitizeUrl } from './url-validation';

export function apiGatewayAuthRequiredError(operation: string, service?: string): MicroserviceError {
  return new MicroserviceError(
    `API Gateway authorization required. Open ${API_GATEWAY_AUTH.START_PATH} in your browser, then retry the operation.`,
    403,
    API_GATEWAY_AUTH.REQUIRED_CODE,
    {
      service,
      operation,
      errorBody: { details: { authorize_url: API_GATEWAY_AUTH.START_PATH } },
    }
  );
}

export function isDocumentNavigation(req: Request): boolean {
  const mode = req.get('Sec-Fetch-Mode');
  const destination = req.get('Sec-Fetch-Dest');
  return (
    req.method === 'GET' &&
    !req.xhr &&
    (!mode || mode === 'navigate') &&
    (!destination || destination === 'document') &&
    /(?:^|,)\s*(?:text\/html|application\/xhtml\+xml)(?:[;,]|$)/i.test(req.get('Accept') ?? '')
  );
}

export function normalizeApiGatewayReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.includes('\\') || raw.startsWith('//')) return '/';
  try {
    const base = new URL(process.env['PCC_BASE_URL'] || 'http://localhost:4000');
    const validated = validateAndSanitizeUrl(new URL(raw, base).href, [base.origin]);
    if (!validated) return '/';
    const url = new URL(validated);
    const path = decodeURIComponent(url.pathname);
    if (
      url.username ||
      url.password ||
      path.startsWith('//') ||
      path.includes('\\') ||
      [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      /^\/(?:api(?:-gateway)?|public\/api|login|logout|auth-error)(?:[;/]|$)/i.test(path) ||
      /(?:^|\/)callback(?:[;/]|$)/i.test(path)
    ) {
      return '/';
    }
    url.searchParams.delete(API_GATEWAY_AUTH.ERROR_PARAM);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

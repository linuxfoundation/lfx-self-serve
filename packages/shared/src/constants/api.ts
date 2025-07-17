// Copyright (c) 2025 The Linux Foundation and each contributor.
// SPDX-License-Identifier: MIT

import { MicroserviceUrls } from '../interfaces';

/**
 * Microservice URLs configuration
 * Note: These values can be overridden by environment variables
 */
export const MICROSERVICE_URLS: MicroserviceUrls = {
  QUERY_SERVICE: process.env['QUERY_SERVICE_URL'] || 'http://localhost:8080/query/resources',
};

/**
 * Default query parameters for different microservices
 * These parameters cannot be overridden by API callers
 */
export const DEFAULT_QUERY_PARAMS: Record<string, Record<string, string>> = {
  QUERY_SERVICE: {
    v: '1',
    type: 'project',
  },
};
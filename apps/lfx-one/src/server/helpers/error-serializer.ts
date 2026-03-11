// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Custom error serializer for Pino logging
 * Provides full stack traces in development for debugging while keeping production logs clean
 *
 * Development: Includes stack traces for local debugging
 * Production: Excludes stack traces unless LOG_LEVEL=debug (cleaner CloudWatch logs)
 */
export const customErrorSerializer = (err: any) => {
  if (!err) return err;

  const serialized: any = {
    type: err.constructor?.name || err.name || 'Error',
    message: err.message || String(err),
  };

  // Add common error properties if they exist
  if (err.code) serialized.code = err.code;
  if (err.statusCode) serialized.statusCode = err.statusCode;
  if (err.status) serialized.status = err.status;

  // Include stack trace in development or when debug logging is enabled
  if (process.env['NODE_ENV'] !== 'production' || process.env['LOG_LEVEL'] === 'debug') {
    serialized.stack = err.stack;
  }

  // Include any additional custom properties from error object
  Object.keys(err).forEach((key) => {
    if (!['message', 'stack', 'name', 'constructor'].includes(key)) {
      serialized[key] = err[key];
    }
  });

  return serialized;
};

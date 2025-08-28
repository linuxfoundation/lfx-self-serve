// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Error handling operation types for logging and monitoring
 * @description Identifies different phases of error processing
 */
export enum ErrorOperation {
  EXTRACTION = 'error_extraction',
  CLASSIFICATION = 'error_classification',
  ENRICHMENT = 'error_enrichment',
  STANDARDIZATION = 'error_standardization',
  LOGGING = 'error_logging',
  MONITORING = 'error_monitoring',
  RESPONSE_GENERATION = 'error_response_generation',
}

/**
 * Error source types for traceability
 * @description Identifies where errors originate from
 */
export enum ErrorSource {
  UPSTREAM_API = 'upstream_api',
  VALIDATION_ENGINE = 'validation_engine',
  AUTHENTICATION_SERVICE = 'authentication_service',
  AUTHORIZATION_SERVICE = 'authorization_service',
  RATE_LIMITER = 'rate_limiter',
  CIRCUIT_BREAKER = 'circuit_breaker',
  PROXY_SERVICE = 'proxy_service',
  INTERNAL_SERVICE = 'internal_service',
  EXTERNAL_DEPENDENCY = 'external_dependency',
  CONFIGURATION = 'configuration',
  INFRASTRUCTURE = 'infrastructure',
}

/**
 * Error handling strategies
 * @description Defines how different types of errors should be handled
 */
export enum ErrorHandlingStrategy {
  RETRY = 'retry',
  FAIL_FAST = 'fail_fast',
  CIRCUIT_BREAK = 'circuit_break',
  FALLBACK = 'fallback',
  IGNORE = 'ignore',
  ALERT = 'alert',
  ESCALATE = 'escalate',
}

/**
 * Error context preservation levels
 * @description Defines how much context to preserve from upstream errors
 */
export enum ErrorContextLevel {
  MINIMAL = 'minimal',
  STANDARD = 'standard',
  DETAILED = 'detailed',
  FULL_DEBUG = 'full_debug',
}

/**
 * Error transformation types
 * @description Types of transformations applied to error messages
 */
export enum ErrorTransformationType {
  SANITIZATION = 'sanitization',
  MESSAGE_MAPPING = 'message_mapping',
  ENRICHMENT = 'enrichment',
  CATEGORIZATION = 'categorization',
  SEVERITY_ASSIGNMENT = 'severity_assignment',
}

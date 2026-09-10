// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Where a client-visible message is kept, when it must differ from `message`.
 *
 * A symbol, not a string key, and that is the whole mechanism. Two log paths read an error by
 * enumerating its string keys — `customErrorSerializer` copies everything `Object.keys` returns
 * onto the log payload, and anything reached by `JSON.stringify` does the same — so a plain
 * `public clientMessage` would be written into the log line by both, which is the thing this
 * exists to prevent. Symbol-keyed properties are invisible to `Object.keys`, `JSON.stringify`
 * and spread alike, so the value cannot reach a log through the generic paths at all.
 *
 * Non-enumerable would also work and would be one line shorter. It is rejected because it is a
 * flag on a property that a later `Object.assign`, clone or refactor can silently drop, whereas
 * a symbol key cannot be un-symboled by accident.
 */
const CLIENT_MESSAGE = Symbol('BaseApiError.clientMessage');

/**
 * Base error class for all API errors with structured metadata
 */
export abstract class BaseApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly operation?: string;
  public readonly service?: string;
  public readonly path?: string;
  public readonly metadata?: Record<string, any>;
  public readonly originalError?: Error;
  /** Set ONLY by the sites that raise a genuine transport failure. See toResponse. */
  public readonly transportFailure?: boolean;

  public constructor(
    message: string,
    statusCode: number,
    code: string,
    options: {
      operation?: string;
      service?: string;
      path?: string;
      metadata?: Record<string, any>;
      originalError?: Error;
      transportFailure?: boolean;
      clientMessage?: string;
    } = {}
  ) {
    super(message);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.operation = options.operation;
    this.service = options.service;
    this.path = options.path;
    this.metadata = options.metadata;
    this.originalError = options.originalError;
    this.transportFailure = options.transportFailure;

    if (options.clientMessage) {
      (this as Record<symbol, unknown>)[CLIENT_MESSAGE] = options.clientMessage;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * The message written for the client, when that differs from `message`.
   *
   * A getter on the prototype rather than an own property, so it is doubly out of reach of the
   * key-enumerating log paths described at CLIENT_MESSAGE: not an own key to begin with, and its
   * backing store is keyed by a symbol.
   *
   * Set this whenever the sentence the client should read is not one that may be logged —
   * an upstream refusal that names the caller or their organization's compliance standing being
   * the case this was built for. `message` then stays generic and is what the log records.
   */
  public get clientMessage(): string | undefined {
    return (this as Record<symbol, unknown>)[CLIENT_MESSAGE] as string | undefined;
  }

  /**
   * Get the error severity level for logging
   */
  public getSeverity(): 'error' | 'warn' | 'info' {
    if (this.statusCode >= 500) {
      return 'error';
    }
    if (this.statusCode >= 400) {
      return 'warn';
    }
    return 'info';
  }

  /**
   * Get structured logging context
   */
  public getLogContext(): Record<string, any> {
    return {
      error_type: this.name,
      error_code: this.code,
      status_code: this.statusCode,
      operation: this.operation,
      service: this.service,
      path: this.path,
      metadata: this.metadata,
      original_error: this.originalError?.message,
    };
  }

  /**
   * Convert to JSON response format
   */
  public toResponse(): Record<string, any> {
    return {
      // `clientMessage` when the throwing site set one, `message` otherwise — so the only errors
      // whose response text differs from their log text are the ones that asked for it.
      error: this.clientMessage ?? this.message,
      code: this.code,
      // Whether the BFF raised this as a TRANSPORT failure, declared explicitly by the site that
      // threw it -- not inferred from `originalError`.
      //
      // An earlier version derived it from `originalError !== undefined`, on the stated belief
      // that only transport sites set that. They do not: seven non-transport sites attach a
      // caught error to it (committee-access, org-lens x2, guild, snowflake x2, project), so
      // their 5xx responses were all being marked as lost connections. A client reading the
      // marker would have treated a genuine service fault as "our transport broke".
      //
      // Declared rather than inferred, because the syscall code is no proxy either: an ingress
      // 503 maps to SERVICE_UNAVAILABLE exactly like a real one, and ETIMEDOUT/EPIPE look
      // nothing like NETWORK_ERROR. The throwing site is the only thing that knows.
      ...(this.transportFailure && { transport: true }),
      ...(this.service && { service: this.service }),
      ...(this.path && { path: this.path }),
      ...(this.metadata && { metadata: this.metadata }),
    };
  }
}

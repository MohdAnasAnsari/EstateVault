import pino, { type Logger as PinoLogger, type LoggerOptions as PinoLoggerOptions } from 'pino';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Logger = PinoLogger;

export interface LoggerOptions {
  /** Log level override. Defaults to 'info' in prod, 'debug' in dev. */
  level?: string;
  /** Additional static fields merged into every log line. */
  base?: Record<string, unknown>;
  /** Redact additional paths on top of the defaults. */
  redact?: string[];
}

export interface FastifyLoggerOptions {
  level: string;
  serializers: {
    req: (req: { method: string; url: string; hostname: string; remoteAddress: string; remotePort: number }) => Record<string, unknown>;
    res: (res: { statusCode: number }) => Record<string, unknown>;
  };
  redact: pino.redactOptions;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

/**
 * Default redaction paths covering the most common secrets.
 * pino will replace these values with "[Redacted]" in log output.
 */
const DEFAULT_REDACT_PATHS: string[] = [
  'password',
  'passwd',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  'cookie',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'body.password',
  'body.token',
  'body.secret',
];

// ─── Core factory ─────────────────────────────────────────────────────────────

/**
 * Creates a structured Pino logger bound to `serviceName`.
 *
 * - In development (NODE_ENV !== 'production') logs are formatted with
 *   pino-pretty for human-readable output.
 * - In production logs are emitted as newline-delimited JSON for ingestion
 *   by log aggregators (Loki, CloudWatch, Datadog, etc.).
 *
 * @example
 * ```ts
 * import createLogger from '@vault/logger';
 * const logger = createLogger('listing-service');
 * logger.info({ listingId: 'abc' }, 'Listing created');
 * ```
 */
export function createLogger(serviceName: string, options: LoggerOptions = {}): Logger {
  const {
    level = IS_PRODUCTION ? 'info' : 'debug',
    base: extraBase = {},
    redact: extraRedact = [],
  } = options;

  const redactPaths = [...DEFAULT_REDACT_PATHS, ...extraRedact];

  const baseOptions: PinoLoggerOptions = {
    level,
    base: {
      service: serviceName,
      env: process.env['NODE_ENV'] ?? 'development',
      ...extraBase,
    },
    redact: {
      paths: redactPaths,
      censor: '[Redacted]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };

  if (!IS_PRODUCTION) {
    // Development: pretty-print with colours and human-readable timestamps.
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
          messageFormat: '[{service}] {msg}',
          singleLine: false,
        },
      },
    });
  }

  // Production: plain JSON to stdout (structured, machine-parseable).
  return pino(baseOptions);
}

// ─── Fastify integration ──────────────────────────────────────────────────────

/**
 * Returns a logger options object compatible with Fastify's `logger` option.
 *
 * Usage:
 * ```ts
 * import Fastify from 'fastify';
 * import { createFastifyLogger } from '@vault/logger';
 *
 * const app = Fastify({ logger: createFastifyLogger('listing-service') });
 * ```
 */
export function createFastifyLogger(
  serviceName: string,
  options: LoggerOptions = {},
): FastifyLoggerOptions {
  const { level = IS_PRODUCTION ? 'info' : 'debug', redact: extraRedact = [] } = options;

  const redactPaths = [...DEFAULT_REDACT_PATHS, ...extraRedact];

  return {
    level,
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
          hostname: req.hostname,
          remoteAddress: req.remoteAddress,
          remotePort: req.remotePort,
          service: serviceName,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
    redact: {
      paths: redactPaths,
      censor: '[Redacted]',
    },
  };
}

// ─── Convenience child-logger helper ─────────────────────────────────────────

/**
 * Attach a request-scoped child logger with a correlation ID.
 *
 * @example
 * ```ts
 * const reqLogger = childLogger(logger, { requestId: req.id, userId });
 * reqLogger.info('Processing request');
 * ```
 */
export function childLogger(
  parent: Logger,
  bindings: Record<string, unknown>,
): Logger {
  return parent.child(bindings);
}

// ─── Default export ───────────────────────────────────────────────────────────

export default createLogger;

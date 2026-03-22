import type { HttpMethod } from "./types";

// ─────────────────────────────────────────────
// Error base
// ─────────────────────────────────────────────

/**
 * Error base de @boolean/http.
 * Todos los errores del cliente extienden de aquí,
 * lo que permite hacer `catch (e) { if (e instanceof BooleanHttpError) ... }`
 */
export class BooleanHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BooleanHttpError";
    // Necesario para que `instanceof` funcione correctamente en TS compilado a ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────
// Error de configuración
// ─────────────────────────────────────────────

/**
 * Se lanza cuando el cliente está mal configurado.
 * Por ejemplo: baseURL vacía, timeout negativo, etc.
 */
export class ConfigurationError extends BooleanHttpError {
  constructor(message: string) {
    super(`[Configuration] ${message}`);
    this.name = "ConfigurationError";
  }
}

// ─────────────────────────────────────────────
// Errores de red / request
// ─────────────────────────────────────────────

export interface HttpErrorMeta {
  status: number;
  method: HttpMethod;
  url: string;
  /** Body de la respuesta de error, si pudo parsearse como JSON. */
  body?: unknown;
}

/**
 * Error HTTP: el servidor respondió con un status code de error (4xx / 5xx).
 * Contiene toda la metadata del request para facilitar el debugging.
 */
export class HttpError extends BooleanHttpError {
  public readonly status: number;
  public readonly method: HttpMethod;
  public readonly url: string;
  public readonly body: unknown;

  constructor(message: string, meta: HttpErrorMeta) {
    super(message);
    this.name = "HttpError";
    this.status = meta.status;
    this.method = meta.method;
    this.url = meta.url;
    this.body = meta.body;
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/**
 * Error 401 - No autenticado.
 * El token es inválido o expiró.
 */
export class UnauthorizedError extends HttpError {
  constructor(meta: Omit<HttpErrorMeta, "status">) {
    super(`Unauthorized: ${meta.method} ${meta.url}`, {
      ...meta,
      status: 401,
    });
    this.name = "UnauthorizedError";
  }
}

/**
 * Error 403 - Sin permisos.
 * El usuario está autenticado pero no tiene acceso al recurso.
 */
export class ForbiddenError extends HttpError {
  constructor(meta: Omit<HttpErrorMeta, "status">) {
    super(`Forbidden: ${meta.method} ${meta.url}`, {
      ...meta,
      status: 403,
    });
    this.name = "ForbiddenError";
  }
}

/**
 * Error 404 - No encontrado.
 */
export class NotFoundError extends HttpError {
  constructor(meta: Omit<HttpErrorMeta, "status">) {
    super(`Not Found: ${meta.method} ${meta.url}`, {
      ...meta,
      status: 404,
    });
    this.name = "NotFoundError";
  }
}

/**
 * Error 422 - Validación fallida (body rechazado por el servidor).
 */
export class ValidationError extends HttpError {
  constructor(meta: Omit<HttpErrorMeta, "status">) {
    super(`Validation Error: ${meta.method} ${meta.url}`, {
      ...meta,
      status: 422,
    });
    this.name = "ValidationError";
  }
}

/**
 * Error 429 - Rate limit excedido.
 */
export class RateLimitError extends HttpError {
  constructor(meta: Omit<HttpErrorMeta, "status">) {
    super(`Rate Limit Exceeded: ${meta.method} ${meta.url}`, {
      ...meta,
      status: 429,
    });
    this.name = "RateLimitError";
  }
}

// ─────────────────────────────────────────────
// Errores de red
// ─────────────────────────────────────────────

/**
 * El request fue abortado (via AbortController o timeout interno).
 */
export class RequestAbortedError extends BooleanHttpError {
  public readonly method: HttpMethod;
  public readonly url: string;
  public readonly reason: "timeout" | "manual";

  constructor(meta: {
    method: HttpMethod;
    url: string;
    reason: "timeout" | "manual";
  }) {
    const msg =
      meta.reason === "timeout"
        ? `Request timed out: ${meta.method} ${meta.url}`
        : `Request aborted: ${meta.method} ${meta.url}`;
    super(msg);
    this.name = "RequestAbortedError";
    this.method = meta.method;
    this.url = meta.url;
    this.reason = meta.reason;
  }
}

/**
 * Error de red genérico: no hubo respuesta del servidor.
 * Puede ser por conexión perdida, CORS, DNS, etc.
 */
export class NetworkError extends BooleanHttpError {
  public readonly method: HttpMethod;
  public readonly url: string;
  public readonly cause: unknown;

  constructor(meta: { method: HttpMethod; url: string; cause: unknown }) {
    super(`Network error: ${meta.method} ${meta.url}`);
    this.name = "NetworkError";
    this.method = meta.method;
    this.url = meta.url;
    this.cause = meta.cause;
  }
}

// ─────────────────────────────────────────────
// Factory: construye el error específico a partir del status code
// ─────────────────────────────────────────────

/**
 * Construye el error tipado más específico para el status code dado.
 * Así, el consumer puede hacer `catch (e) { if (e instanceof NotFoundError) ... }`
 */
export function createHttpError(meta: HttpErrorMeta): HttpError {
  const base = { method: meta.method, url: meta.url, body: meta.body };

  switch (meta.status) {
    case 401:
      return new UnauthorizedError(base);
    case 403:
      return new ForbiddenError(base);
    case 404:
      return new NotFoundError(base);
    case 422:
      return new ValidationError(base);
    case 429:
      return new RateLimitError(base);
    default:
      return new HttpError(
        `HTTP ${meta.status}: ${meta.method} ${meta.url}`,
        meta
      );
  }
}

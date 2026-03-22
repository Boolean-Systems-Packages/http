import { InterceptorManager } from "./interceptors";
import {
  ConfigurationError,
  NetworkError,
  RequestAbortedError,
  createHttpError,
} from "./errors";
import type {
  HttpClientConfig,
  HttpMethod,
  HttpResponse,
  BooleanEnvelope,
  BooleanMeta,
  BooleanPagination,
  BooleanApiError,
  RequestContext,
  RequestInterceptor,
  RequestOptions,
  ResponseInterceptor,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Cliente HTTP base de la plataforma Boolean.
 *
 * Responsabilidades:
 * - Construir URLs completas a partir de baseURL + path + queryParams
 * - Agregar el header Authorization (via `getAuthHeader`)
 * - Manejar timeout con AbortController
 * - Parsear respuestas como JSON
 * - Convertir errores HTTP en instancias tipadas
 * - Ejecutar la cadena de interceptors
 *
 * NO tiene lógica de negocio. NO conoce modelos de dominio.
 *
 * @example
 * const client = new BooleanHttpClient({
 *   baseURL: "https://api.boolean.com.ar/inventory",
 *   getAuthHeader: () => `Bearer ${getToken()}`,
 * });
 *
 * const response = await client.get<Product[]>("/products");
 * console.log(response.data);
 */
export class BooleanHttpClient {
  private readonly config: Required<
    Omit<HttpClientConfig, "defaultHeaders" | "onUnauthorized">
  > & {
    defaultHeaders: Record<string, string>;
    onUnauthorized: (() => Promise<boolean>) | undefined;
  };

  private readonly interceptors: InterceptorManager;

  /**
   * Singleton promise del refresh en curso.
   * Si múltiples requests fallan con 401 al mismo tiempo,
   * todos esperan esta misma promesa — solo se llama a onUnauthorized UNA vez.
   */
  private refreshingPromise: Promise<boolean> | null = null;

  constructor(config: HttpClientConfig) {
    validateConfig(config);

    this.config = {
      baseURL: config.baseURL.replace(/\/$/, ""),
      getAuthHeader: config.getAuthHeader,
      timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
      defaultHeaders: config.defaultHeaders ?? {},
      onUnauthorized: config.onUnauthorized,
    };

    this.interceptors = new InterceptorManager();
  }

  // ─────────────────────────────────────────────
  // Métodos HTTP convenientes
  // ─────────────────────────────────────────────

  async get<T>(
    path: string,
    options?: Omit<RequestOptions, "path" | "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, path, method: "GET" });
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "path" | "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, path, method: "POST", body });
  }

  async put<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "path" | "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, path, method: "PUT", body });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "path" | "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, path, method: "PATCH", body });
  }

  async delete<T>(
    path: string,
    options?: Omit<RequestOptions, "path" | "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>({ ...options, path, method: "DELETE" });
  }

  // ─────────────────────────────────────────────
  // Método principal
  // ─────────────────────────────────────────────

  /**
   * Ejecuta un request HTTP con todos los interceptors aplicados.
   * Es el método de bajo nivel. Los métodos `get`, `post`, etc. son
   * wrappers convenientes sobre este.
   */
  async request<T>(options: RequestOptions): Promise<HttpResponse<T>> {
    const url = this.buildURL(options.path, options.params);
    const method = options.method;

    // Construye headers base
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...this.config.defaultHeaders,
      ...options.headers,
    };

    // Agrega auth (a menos que se pida explícitamente omitirla)
    if (!options.skipAuth) {
      headers["Authorization"] = await this.config.getAuthHeader();
    }

    // Contexto inicial del request (antes de interceptors)
    let requestCtx: RequestContext = {
      url,
      method,
      headers,
      body: options.body,
      options,
    };

    // Aplica interceptors de request
    requestCtx = await this.interceptors.applyRequestInterceptors(requestCtx);

    // Configura timeout y abort
    const timeoutMs = options.timeout ?? this.config.timeout;
    const internalAbort = new AbortController();
    const timeoutId = setTimeout(
      () => internalAbort.abort("timeout"),
      timeoutMs
    );

    // Combina el signal del caller con el interno
    const signal = options.signal
      ? anySignal([options.signal, internalAbort.signal])
      : internalAbort.signal;

    let fetchResponse: Response;

    try {
      fetchResponse = await fetch(requestCtx.url, {
        method: requestCtx.method,
        headers: requestCtx.headers,
        body:
          requestCtx.body !== undefined
            ? JSON.stringify(requestCtx.body)
            : null,
        signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);

      // Distingue entre timeout/abort y error de red
      if (isAbortError(err)) {
        const reason =
          internalAbort.signal.aborted &&
          internalAbort.signal.reason === "timeout"
            ? "timeout"
            : "manual";

        throw new RequestAbortedError({ method, url, reason });
      }

      throw new NetworkError({ method, url, cause: err });
    }

    clearTimeout(timeoutId);

    // Intenta parsear el body como JSON (puede fallar si el body es vacío)
    const responseBody = await safeParseJSON(fetchResponse);

    // ── 401: intenta refresh automático (una sola vez) ──────────────────
    if (
      fetchResponse.status === 401 &&
      !options.skipAuth &&
      !options._retried &&
      this.config.onUnauthorized
    ) {
      // Singleton: si ya hay un refresh en curso, esperamos ese mismo.
      // Si no, iniciamos uno nuevo y lo guardamos para los demás.
      if (!this.refreshingPromise) {
        this.refreshingPromise = this.config
          .onUnauthorized()
          .finally(() => { this.refreshingPromise = null; });
      }

      let shouldRetry = false;
      try {
        shouldRetry = await this.refreshingPromise;
      } catch {
        // El refresh falló — propagamos el 401 original
      }

      if (shouldRetry) {
        // Reintenta el request original con los tokens renovados
        return this.request<T>({ ...options, _retried: true });
      }
    }

    // Manejo de errores HTTP
    if (!fetchResponse.ok) {
      throw createHttpError({
        status: fetchResponse.status,
        method,
        url: fetchResponse.url,
        body: responseBody,
      });
    }

    // Desempaqueta el envelope Boolean Platform v2
    const httpResponse: HttpResponse<T> = unpackEnvelope<T>(
      responseBody,
      fetchResponse.status,
      fetchResponse.headers,
      fetchResponse.url
    );

    // Aplica interceptors de response
    const responseCtx = await this.interceptors.applyResponseInterceptors({
      response: httpResponse,
      requestContext: requestCtx,
    });

    return responseCtx.response;
  }

  // ─────────────────────────────────────────────
  // Gestión de interceptors (API pública)
  // ─────────────────────────────────────────────

  /**
   * Registra un interceptor de request.
   * @returns ID para poder removerlo después con `removeInterceptor(id)`.
   */
  addRequestInterceptor(interceptor: RequestInterceptor): string {
    return this.interceptors.addRequestInterceptor(interceptor);
  }

  /**
   * Registra un interceptor de response.
   * @returns ID para poder removerlo después con `removeInterceptor(id)`.
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): string {
    return this.interceptors.addResponseInterceptor(interceptor);
  }

  /**
   * Remueve un interceptor por su ID.
   */
  removeInterceptor(id: string): boolean {
    return this.interceptors.remove(id);
  }

  // ─────────────────────────────────────────────
  // Helpers de instancia
  // ─────────────────────────────────────────────

  /**
   * Construye la URL completa: baseURL + path + query params.
   */
  private buildURL(
    path: string,
    params?: Record<string, string | number | boolean | undefined | null>
  ): string {
    const base = this.config.baseURL;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const fullURL = `${base}${normalizedPath}`;

    if (!params) return fullURL;

    const query = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");

    return query ? `${fullURL}?${query}` : fullURL;
  }

  /**
   * Retorna la configuración actual (para debugging / testing).
   * Omite `getAuthHeader` para no exponer tokens.
   */
  get debugInfo(): { baseURL: string; timeout: number } {
    return {
      baseURL: this.config.baseURL,
      timeout: this.config.timeout ?? DEFAULT_TIMEOUT_MS,
    };
  }
}

// ─────────────────────────────────────────────
// Helpers privados
// ─────────────────────────────────────────────

function validateConfig(config: HttpClientConfig): void {
  if (!config.baseURL || config.baseURL.trim() === "") {
    throw new ConfigurationError(
      "baseURL es requerido. No se admiten valores vacíos para evitar requests accidentales."
    );
  }

  if (!config.baseURL.startsWith("http://") && !config.baseURL.startsWith("https://")) {
    throw new ConfigurationError(
      `baseURL debe comenzar con http:// o https://. Recibido: "${config.baseURL}"`
    );
  }

  if (typeof config.getAuthHeader !== "function") {
    throw new ConfigurationError(
      "getAuthHeader debe ser una función. Recibido: " + typeof config.getAuthHeader
    );
  }

  if (config.timeout !== undefined && config.timeout <= 0) {
    throw new ConfigurationError(
      `timeout debe ser un número positivo. Recibido: ${config.timeout}`
    );
  }
}

async function safeParseJSON(response: Response): Promise<unknown> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Combina múltiples AbortSignals: aborta cuando cualquiera de ellos se aborta.
 * Equivalente a `AbortSignal.any()` que aún no está disponible en todos los entornos.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  // Usa AbortSignal.any si está disponible (Node 20+, Modern browsers)
  if ("any" in AbortSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }

  // Fallback manual
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

/**
 * Desempaqueta el envelope Boolean Platform v2.
 *
 * Si la respuesta tiene la forma `{ data, pagination, errors, meta }` la
 * mapea directamente a `HttpResponse`. Si es un JSON libre (servicios legacy
 * o respuestas raw sin envelope) pone el body completo en `data` y rellena
 * los campos del envelope con valores vacíos seguros.
 *
 * De esta forma los SDKs y el frontend siempre trabajan con la misma
 * interfaz, sin importar si el microservicio implementó el envelope o no.
 */
function unpackEnvelope<T>(
  raw: unknown,
  status: number,
  headers: Headers,
  url: string
): HttpResponse<T> {
  // Detecta si tiene forma de envelope Boolean
  const isEnvelope =
    raw !== null &&
    typeof raw === "object" &&
    "data" in (raw as object) &&
    "meta" in (raw as object) &&
    "errors" in (raw as object);

  if (isEnvelope) {
    const env = raw as BooleanEnvelope<T>;
    return {
      data: env.data,
      pagination: env.pagination ?? null,
      errors: Array.isArray(env.errors) ? (env.errors as BooleanApiError[]) : [],
      meta: (env.meta as BooleanMeta) ?? { message: "" },
      status,
      headers,
      url,
    };
  }

  // Fallback: respuesta sin envelope (legacy / pruebas)
  return {
    data: raw as T,
    pagination: null,
    errors: [],
    meta: { message: "" },
    status,
    headers,
    url,
  };
}

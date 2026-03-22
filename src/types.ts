// ─────────────────────────────────────────────
// Tipos de configuración del cliente
// ─────────────────────────────────────────────

/**
 * Función que retorna el header de autenticación.
 * Se llama en cada request, así que siempre obtiene el token más actualizado.
 *
 * @example
 * getAuthHeader: () => `Bearer ${localStorage.getItem('token')}`
 * getAuthHeader: async () => `Bearer ${await getToken()}`
 */
export type GetAuthHeader = () => string | Promise<string>;

/**
 * Configuración mínima compartida por todos los clientes `@boolean/api-*`.
 *
 * Cada SDK hereda de este tipo en lugar de redefinir los mismos campos.
 * Si se agregan nuevas opciones base (ej: `retries`), todos los SDKs
 * las reciben automáticamente.
 *
 * @example
 * // En @boolean/api-auth:
 * export interface AuthClientConfig extends BaseClientConfig {
 *   // Opciones específicas de auth si las hubiera
 * }
 *
 * // En @boolean/api-inventory:
 * export interface InventoryClientConfig extends BaseClientConfig {
 *   warehouseId?: string;
 * }
 */
export interface BaseClientConfig {
  /**
   * URL base del microservicio. Sin trailing slash.
   * @example "https://api.boolean.com.ar/inventory"
   */
  baseURL: string;

  /**
   * Función que retorna el header Authorization completo (con esquema).
   * Se llama en cada request para obtener siempre el token vigente.
   * @example () => `Bearer ${localStorage.getItem("access_token")}`
   */
  getAuthHeader: GetAuthHeader;

  /**
   * Timeout en milisegundos. Default: 15000 (15s).
   */
  timeout?: number | undefined;
}

/**
 * Configuración base para crear un cliente HTTP.
 * TODAS las propiedades son requeridas para evitar defaults silenciosos
 * que puedan causar requests accidentales a producción.
 */
export interface HttpClientConfig extends BaseClientConfig {
  /**
   * Headers adicionales que se envían en todos los requests.
   */
  defaultHeaders?: Record<string, string>;

  /**
   * Hook llamado cuando el servidor responde 401 (token vencido).
   *
   * Útil para implementar refresh automático: el consumer renueva
   * el accessToken y retorna `true` para reintentar el request original.
   * Si retorna `false` o lanza, el error se propaga al caller.
   *
   * El cliente garantiza que este hook se llama UNA sola vez aunque
   * múltiples requests fallen con 401 simultáneamente (singleton promise).
   *
   * @example
   * onUnauthorized: async () => {
   *   const newTokens = await refreshMyToken();
   *   saveTokens(newTokens);
   *   return true; // reintenta el request
   * }
   */
  onUnauthorized?: (() => Promise<boolean>) | undefined;
}


// ─────────────────────────────────────────────
// Tipos para requests
// ─────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  /**
   * Path relativo al baseURL. Los path params se pueden pasar
   * directamente en el string: `/products/${id}`
   */
  path: string;

  method: HttpMethod;

  /** Query params. Se serializan automáticamente. */
  params?: Record<string, string | number | boolean | undefined | null>;

  /** Body del request. Se serializa a JSON automáticamente. */
  body?: unknown;

  /**
   * Si es `true`, omite el header Authorization.
   * Default: `false`. Solo para endpoints públicos.
   */
  skipAuth?: boolean;

  /**
   * Timeout en ms para este request específico.
   */
  timeout?: number;

  /**
   * Headers adicionales específicos de este request.
   */
  headers?: Record<string, string>;

  /**
   * Signal de AbortController para cancelar el request.
   */
  signal?: AbortSignal;

  /**
   * Uso interno — evita bucles infinitos en el retry de 401.
   * No usar desde afuera del cliente HTTP.
   * @internal
   */
  _retried?: boolean;
}

// ─────────────────────────────────────────────
// Boolean Response Envelope — Platform v2
// ─────────────────────────────────────────────

/**
 * Paginación incluida en respuestas de listas.
 */
export interface BooleanPagination {
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Error individual dentro del campo `errors` del envelope.
 * Siempre es un array, incluso si hay un solo error.
 */
export interface BooleanApiError {
  /** Código de error en SCREAMING_SNAKE_CASE. ej: INVALID_CREDENTIALS */
  code: string;
  /** Ubicación del error (útil para validaciones de formularios). */
  path?: (string | number)[] | null;
  message: string;
  severity: "error" | "warning";
  meta?: Record<string, unknown> | null;
}

/**
 * Metadata de la respuesta.
 */
export interface BooleanMeta {
  message: string;
  /** ID único del request. Generado por el servidor. */
  requestId?: string;
  /** Timestamp ISO 8601. */
  timestamp?: string;
}

/**
 * Envelope estándar de respuesta Boolean Platform v2.
 *
 * Todas las respuestas del backend (2xx y 4xx/5xx) tienen esta forma.
 * El cliente HTTP desempaqueta `data` automáticamente en `HttpResponse.data`,
 * y expone `pagination`, `errors` y `meta` como campos de primer nivel.
 *
 * @example
 * // Respuesta del servidor:
 * {
 *   "data": [{ "id": "1", "name": "Producto" }],
 *   "pagination": { "total": 100, "page": 1, "limit": 20, "hasNext": true, "hasPrev": false },
 *   "errors": [],
 *   "meta": { "message": "OK", "requestId": "req_abc123" }
 * }
 *
 * // Lo que ve el dev:
 * const { data, pagination, meta } = await client.get<Product[]>("/products");
 * // data → Product[]
 * // pagination → BooleanPagination | null
 * // meta → BooleanMeta
 */
export interface BooleanEnvelope<T = unknown> {
  data: T;
  pagination: BooleanPagination | null;
  errors: BooleanApiError[];
  meta: BooleanMeta;
}

// ─────────────────────────────────────────────
// Respuesta del cliente HTTP
// ─────────────────────────────────────────────

/**
 * Respuesta tipada del cliente HTTP.
 *
 * Siempre desempaqueta el envelope Boolean automáticamente:
 * - `data` → el campo `data` del envelope, con el tipo declarado en el genérico `T`
 * - `pagination` → `null` si no es una lista paginada
 * - `errors` → array de errores (vacío en 2xx exitosos)
 * - `meta` → mensaje, requestId, timestamp
 * - `status` → HTTP status code
 * - `headers` → headers de la respuesta
 *
 * @example
 * // El dev declara solo el tipo de `data`:
 * const { data, pagination } = await client.get<Product[]>("/products");
 *
 * // Si el endpoint devuelve una acción sin contenido:
 * const { meta } = await client.delete("/sessions");
 * console.log(meta.message); // "Operación realizada correctamente"
 */
export interface HttpResponse<T = unknown> {
  /** El campo `data` del envelope, ya desempaquetado. */
  data: T;
  /** Presente cuando la respuesta es una lista paginada. */
  pagination: BooleanPagination | null;
  /** Errores semánticos. En respuestas 2xx exitosas, siempre es `[]`. */
  errors: BooleanApiError[];
  /** Mensaje, requestId y timestamp de la respuesta. */
  meta: BooleanMeta;
  /** HTTP status code. */
  status: number;
  /** Headers de la respuesta. */
  headers: Headers;
  /** URL final del request (tras posibles redirects). */
  url: string;
}

// ─────────────────────────────────────────────
// Tipos de interceptors
// ─────────────────────────────────────────────

export interface RequestContext {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: unknown;
  options: RequestOptions;
}

export interface ResponseContext<T = unknown> {
  response: HttpResponse<T>;
  requestContext: RequestContext;
}

/**
 * Interceptor de request. Puede mutar el contexto o retornar uno nuevo.
 * Si retorna `null`, el request se cancela (no recomendado — preferir AbortController).
 */
export type RequestInterceptor = (
  context: RequestContext
) => RequestContext | Promise<RequestContext>;

/**
 * Interceptor de response. Puede transformar la respuesta o re-lanzar errores.
 */
export type ResponseInterceptor<T = unknown> = (
  context: ResponseContext<T>
) => ResponseContext<T> | Promise<ResponseContext<T>>;

export interface InterceptorPair {
  onRequest?: RequestInterceptor;
  onResponse?: ResponseInterceptor;
}

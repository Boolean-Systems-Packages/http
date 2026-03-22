/**
 * @boolean/http
 *
 * Cliente HTTP base para la plataforma Boolean.
 *
 * Este paquete provee la capa de comunicación HTTP de bajo nivel:
 * - Autenticación via header Authorization
 * - Interceptors de request y response
 * - Manejo de errores tipados
 * - Timeout configurable
 * - Serialización/deserialización JSON automática
 *
 * NO contiene lógica de negocio. Está diseñado para ser la base
 * de los paquetes @boolean/api-* de cada microservicio.
 *
 * @example
 * import { BooleanHttpClient } from "@boolean/http";
 *
 * const client = new BooleanHttpClient({
 *   baseURL: "https://api.boolean.com.ar/inventory",
 *   getAuthHeader: () => `Bearer ${getToken()}`,
 * });
 *
 * const { data } = await client.get<Product[]>("/products");
 */

// Cliente principal
export { BooleanHttpClient } from "./client";

// Sistema de interceptors (por si alguien necesita el manager directamente)
export { InterceptorManager } from "./interceptors";

// Jerarquía de errores
export {
  BooleanHttpError,
  ConfigurationError,
  HttpError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  RequestAbortedError,
  NetworkError,
  createHttpError,
} from "./errors";

// Tipos públicos
export type {
  HttpClientConfig,
  BaseClientConfig,
  GetAuthHeader,
  HttpMethod,
  HttpResponse,
  RequestOptions,
  RequestContext,
  ResponseContext,
  RequestInterceptor,
  ResponseInterceptor,
  InterceptorPair,
  // Boolean envelope v2
  BooleanEnvelope,
  BooleanPagination,
  BooleanApiError,
  BooleanMeta,
} from "./types";

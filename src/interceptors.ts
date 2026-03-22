import type {
  RequestInterceptor,
  ResponseInterceptor,
  RequestContext,
  ResponseContext,
} from "./types";

/**
 * Gestor de interceptors del cliente HTTP.
 *
 * Los interceptors se ejecutan en orden de registro (FIFO).
 * Cada uno recibe el contexto del anterior y puede modificarlo.
 *
 * @example
 * const manager = new InterceptorManager();
 *
 * // Agregar un interceptor de logging
 * const id = manager.addRequestInterceptor(async (ctx) => {
 *   console.log(`→ ${ctx.method} ${ctx.url}`);
 *   return ctx;
 * });
 *
 * // Removerlo después
 * manager.remove(id);
 */
export class InterceptorManager {
  private requestInterceptors: Map<string, RequestInterceptor> = new Map();
  private responseInterceptors: Map<string, ResponseInterceptor> = new Map();
  private counter = 0;

  private nextId(): string {
    return `interceptor_${++this.counter}`;
  }

  /**
   * Registra un interceptor de request.
   * @returns ID del interceptor para poder removerlo después.
   */
  addRequestInterceptor(interceptor: RequestInterceptor): string {
    const id = this.nextId();
    this.requestInterceptors.set(id, interceptor);
    return id;
  }

  /**
   * Registra un interceptor de response.
   * @returns ID del interceptor para poder removerlo después.
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): string {
    const id = this.nextId();
    this.responseInterceptors.set(id, interceptor);
    return id;
  }

  /**
   * Remueve un interceptor por su ID.
   * @returns `true` si existía y fue removido, `false` si no existía.
   */
  remove(id: string): boolean {
    return (
      this.requestInterceptors.delete(id) ||
      this.responseInterceptors.delete(id)
    );
  }

  /**
   * Remueve todos los interceptors de request y response.
   */
  clear(): void {
    this.requestInterceptors.clear();
    this.responseInterceptors.clear();
  }

  /**
   * Ejecuta todos los interceptors de request en cadena.
   * Cada uno recibe el contexto modificado por el anterior.
   */
  async applyRequestInterceptors(
    context: RequestContext
  ): Promise<RequestContext> {
    let ctx = context;
    for (const interceptor of this.requestInterceptors.values()) {
      ctx = await interceptor(ctx);
    }
    return ctx;
  }

  /**
   * Ejecuta todos los interceptors de response en cadena.
   */
  async applyResponseInterceptors<T>(
    context: ResponseContext<T>
  ): Promise<ResponseContext<T>> {
    let ctx = context as ResponseContext<unknown>;
    for (const interceptor of this.responseInterceptors.values()) {
      ctx = await interceptor(ctx);
    }
    return ctx as ResponseContext<T>;
  }

  get requestInterceptorCount(): number {
    return this.requestInterceptors.size;
  }

  get responseInterceptorCount(): number {
    return this.responseInterceptors.size;
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BooleanHttpClient } from "../src/client";
import {
  ConfigurationError,
  HttpError,
  NetworkError,
  NotFoundError,
  RequestAbortedError,
  UnauthorizedError,
  ValidationError,
} from "../src/errors";

// ─────────────────────────────────────────────
// Helpers para mockear fetch
// ─────────────────────────────────────────────

function mockFetch(status: number, body: unknown, headers?: HeadersInit) {
  const responseHeaders = new Headers({
    "Content-Type": "application/json",
    ...headers,
  });

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: responseHeaders,
      url: "https://api.boolean.com.ar/test/products",
      json: () => Promise.resolve(body),
    })
  );
}

function mockFetchNetworkError(error: Error) {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
}

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────

const BASE_CONFIG = {
  baseURL: "https://api.boolean.com.ar/test",
  getAuthHeader: () => "Bearer test-token",
};

describe("BooleanHttpClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─────────────────────────────────────────────
  // Configuración
  // ─────────────────────────────────────────────

  describe("configuración", () => {
    it("lanza ConfigurationError si baseURL está vacía", () => {
      expect(
        () =>
          new BooleanHttpClient({
            ...BASE_CONFIG,
            baseURL: "",
          })
      ).toThrow(ConfigurationError);
    });

    it("lanza ConfigurationError si baseURL no tiene protocolo", () => {
      expect(
        () =>
          new BooleanHttpClient({
            ...BASE_CONFIG,
            baseURL: "api.boolean.com.ar",
          })
      ).toThrow(ConfigurationError);
    });

    it("lanza ConfigurationError si getAuthHeader no es función", () => {
      expect(
        () =>
          new BooleanHttpClient({
            ...BASE_CONFIG,
            // @ts-expect-error – test intencional
            getAuthHeader: "Bearer token",
          })
      ).toThrow(ConfigurationError);
    });

    it("lanza ConfigurationError si timeout es negativo", () => {
      expect(
        () =>
          new BooleanHttpClient({
            ...BASE_CONFIG,
            timeout: -1,
          })
      ).toThrow(ConfigurationError);
    });

    it("normaliza el trailing slash del baseURL", () => {
      const client = new BooleanHttpClient({
        ...BASE_CONFIG,
        baseURL: "https://api.boolean.com.ar/test/",
      });
      expect(client.debugInfo.baseURL).toBe("https://api.boolean.com.ar/test");
    });
  });

  // ─────────────────────────────────────────────
  // Requests exitosos
  // ─────────────────────────────────────────────

  describe("requests exitosos", () => {
    it("hace GET y retorna datos tipados", async () => {
      const products = [{ id: 1, name: "Teclado" }];
      mockFetch(200, products);

      const client = new BooleanHttpClient(BASE_CONFIG);
      const response = await client.get<typeof products>("/products");

      expect(response.data).toEqual(products);
      expect(response.status).toBe(200);
    });

    it("hace POST con body JSON", async () => {
      mockFetch(201, { id: 2, name: "Mouse" });

      const client = new BooleanHttpClient(BASE_CONFIG);
      const response = await client.post("/products", { name: "Mouse" });

      expect(response.status).toBe(201);
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Mouse" }),
        })
      );
    });

    it("hace PUT correctamente", async () => {
      mockFetch(200, { id: 1, name: "Teclado Pro" });
      const client = new BooleanHttpClient(BASE_CONFIG);
      const { status } = await client.put("/products/1", {
        name: "Teclado Pro",
      });
      expect(status).toBe(200);
    });

    it("hace PATCH correctamente", async () => {
      mockFetch(200, { id: 1, name: "Teclado Pro" });
      const client = new BooleanHttpClient(BASE_CONFIG);
      const { status } = await client.patch("/products/1", { name: "Pro" });
      expect(status).toBe(200);
    });

    it("hace DELETE correctamente", async () => {
      mockFetch(204, null);
      const client = new BooleanHttpClient(BASE_CONFIG);
      const { status } = await client.delete("/products/1");
      expect(status).toBe(204);
    });
  });

  // ─────────────────────────────────────────────
  // Headers y auth
  // ─────────────────────────────────────────────

  describe("headers y auth", () => {
    it("incluye el header Authorization en todos los requests", async () => {
      mockFetch(200, {});
      const client = new BooleanHttpClient(BASE_CONFIG);
      await client.get("/products");

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("omite Authorization si skipAuth es true", async () => {
      mockFetch(200, {});
      const client = new BooleanHttpClient(BASE_CONFIG);
      await client.get("/public-endpoint", { skipAuth: true });

      const callArgs = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
      const headers = callArgs.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("resuelve getAuthHeader asíncrono", async () => {
      mockFetch(200, {});
      const asyncAuth = vi
        .fn()
        .mockResolvedValue("Bearer async-token");

      const client = new BooleanHttpClient({
        ...BASE_CONFIG,
        getAuthHeader: asyncAuth,
      });
      await client.get("/products");

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer async-token",
          }),
        })
      );
    });

    it("incluye defaultHeaders en todos los requests", async () => {
      mockFetch(200, {});
      const client = new BooleanHttpClient({
        ...BASE_CONFIG,
        defaultHeaders: { "X-Tenant-ID": "acme" },
      });
      await client.get("/products");

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Tenant-ID": "acme",
          }),
        })
      );
    });
  });

  // ─────────────────────────────────────────────
  // Construcción de URLs y query params
  // ─────────────────────────────────────────────

  describe("construcción de URL", () => {
    it("agrega query params al URL", async () => {
      mockFetch(200, []);
      const client = new BooleanHttpClient(BASE_CONFIG);
      await client.get("/products", {
        params: { page: 1, limit: 20, q: "teclado" },
      });

      const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("page=1");
      expect(calledUrl).toContain("limit=20");
      expect(calledUrl).toContain("q=teclado");
    });

    it("omite params con valor null o undefined", async () => {
      mockFetch(200, []);
      const client = new BooleanHttpClient(BASE_CONFIG);
      await client.get("/products", {
        params: { page: 1, q: undefined, category: null },
      });

      const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("page=1");
      expect(calledUrl).not.toContain("q=");
      expect(calledUrl).not.toContain("category=");
    });

    it("normaliza paths sin slash inicial", async () => {
      mockFetch(200, []);
      const client = new BooleanHttpClient(BASE_CONFIG);
      await client.get("products"); // sin slash

      const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe(
        "https://api.boolean.com.ar/test/products"
      );
    });
  });

  // ─────────────────────────────────────────────
  // Manejo de errores HTTP
  // ─────────────────────────────────────────────

  describe("errores HTTP", () => {
    it("lanza UnauthorizedError en 401", async () => {
      mockFetch(401, { detail: "Token expirado" });
      const client = new BooleanHttpClient(BASE_CONFIG);
      await expect(client.get("/private")).rejects.toThrow(UnauthorizedError);
    });

    it("lanza NotFoundError en 404", async () => {
      mockFetch(404, { detail: "No encontrado" });
      const client = new BooleanHttpClient(BASE_CONFIG);
      await expect(client.get("/products/999")).rejects.toThrow(NotFoundError);
    });

    it("lanza ValidationError en 422", async () => {
      mockFetch(422, { detail: "Campo requerido" });
      const client = new BooleanHttpClient(BASE_CONFIG);
      await expect(client.post("/products", {})).rejects.toThrow(
        ValidationError
      );
    });

    it("lanza HttpError genérico en 500", async () => {
      mockFetch(500, { detail: "Error interno" });
      const client = new BooleanHttpClient(BASE_CONFIG);
      await expect(client.get("/products")).rejects.toThrow(HttpError);
    });

    it("el HttpError contiene el body de error del servidor", async () => {
      const errorBody = { detail: "Producto no encontrado", code: "NOT_FOUND" };
      mockFetch(404, errorBody);
      const client = new BooleanHttpClient(BASE_CONFIG);

      try {
        await client.get("/products/999");
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundError);
        expect((e as NotFoundError).body).toEqual(errorBody);
      }
    });
  });

  // ─────────────────────────────────────────────
  // Errores de red
  // ─────────────────────────────────────────────

  describe("errores de red", () => {
    it("lanza NetworkError cuando fetch falla sin respuesta", async () => {
      mockFetchNetworkError(new TypeError("Failed to fetch"));
      const client = new BooleanHttpClient(BASE_CONFIG);
      await expect(client.get("/products")).rejects.toThrow(NetworkError);
    });

    it("lanza RequestAbortedError en timeout", async () => {
      vi.useFakeTimers();

      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            // Simula un fetch que dura para siempre, salvo que lo aborten
            const signal = init?.signal;
            const abort = () =>
              reject(Object.assign(new Error(), { name: "AbortError" }));
            if (signal?.aborted) {
              abort();
              return;
            }
            signal?.addEventListener("abort", abort);
          })
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new BooleanHttpClient({
        ...BASE_CONFIG,
        timeout: 100,
      });

      const promise = client.get("/slow-endpoint");
      const assertion = expect(promise).rejects.toThrow(RequestAbortedError);
      await vi.advanceTimersByTimeAsync(200);

      await assertion;

      vi.useRealTimers();
    });
  });

  // ─────────────────────────────────────────────
  // Interceptors
  // ─────────────────────────────────────────────

  describe("interceptors", () => {
    it("ejecuta interceptors de request y puede modificar headers", async () => {
      mockFetch(200, {});
      const client = new BooleanHttpClient(BASE_CONFIG);

      client.addRequestInterceptor(async (ctx) => ({
        ...ctx,
        headers: { ...ctx.headers, "X-Request-ID": "test-123" },
      }));

      await client.get("/products");

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Request-ID": "test-123",
          }),
        })
      );
    });

    it("ejecuta interceptors de response y puede transformar datos", async () => {
      mockFetch(200, { items: [1, 2, 3] });
      const client = new BooleanHttpClient(BASE_CONFIG);

      client.addResponseInterceptor(async (ctx) => ({
        ...ctx,
        response: {
          ...ctx.response,
          data: { items: [1, 2, 3], total: 3 },
        },
      }));

      const { data } = await client.get<{ items: number[]; total: number }>(
        "/products"
      );
      expect(data.total).toBe(3);
    });

    it("puede remover un interceptor por ID", async () => {
      mockFetch(200, {});
      const client = new BooleanHttpClient(BASE_CONFIG);

      const id = client.addRequestInterceptor(async (ctx) => ({
        ...ctx,
        headers: { ...ctx.headers, "X-Should-Not-Appear": "true" },
      }));

      const removed = client.removeInterceptor(id);
      expect(removed).toBe(true);

      await client.get("/products");

      const callArgs = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
      const headers = callArgs.headers as Record<string, string>;
      expect(headers["X-Should-Not-Appear"]).toBeUndefined();
    });

    it("encadena múltiples interceptors en orden", async () => {
      mockFetch(200, {});
      const log: string[] = [];
      const client = new BooleanHttpClient(BASE_CONFIG);

      client.addRequestInterceptor(async (ctx) => { log.push("first"); return ctx; });
      client.addRequestInterceptor(async (ctx) => { log.push("second"); return ctx; });
      client.addRequestInterceptor(async (ctx) => { log.push("third"); return ctx; });

      await client.get("/products");
      expect(log).toEqual(["first", "second", "third"]);
    });
  });
});

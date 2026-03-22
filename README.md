# @boolean/http

> Cliente HTTP base para la plataforma Boolean. Capa de comunicación de bajo nivel, sin lógica de negocio.

## ¿Qué es esto?

`@boolean/http` es la **capa 1** del SDK interno Boolean. Provee:

- 🔐 **Auth automática**: el header `Authorization` se inyecta en cada request vía una función configurable
- 🔁 **Interceptors**: pipeline de transformación de request/response, idéntico al de Axios
- ❌ **Errores tipados**: jerarquía completa de errores para hacer `instanceof` en el consumer
- ⏱️ **Timeout**: cancela requests colgados automáticamente
- 🚫 **Sin defaults silenciosos**: `baseURL` siempre requerido, sin URL hardcodeada

Este paquete **no sabe nada del negocio**. No conoce productos, usuarios, inventario, ni nada. Solo habla HTTP.

---

## Instalación

```bash
# Este paquete es privado y se usa dentro del monorepo
# No se publica en npm
```

---

## Uso básico

```ts
import { BooleanHttpClient } from "@boolean/http";

const client = new BooleanHttpClient({
  baseURL: "https://api.boolean.com.ar/inventory",
  getAuthHeader: () => `Bearer ${localStorage.getItem("token")}`,
});

// GET
const { data } = await client.get<Product[]>("/products");

// POST
const { data: created } = await client.post<Product>("/products", {
  name: "Teclado Mecánico",
  sku: "KB-001",
});

// PUT
await client.put(`/products/${id}`, { name: "Teclado Pro" });

// PATCH
await client.patch(`/products/${id}`, { stock: 5 });

// DELETE
await client.delete(`/products/${id}`);
```

---

## Configuración

```ts
const client = new BooleanHttpClient({
  // REQUERIDO: URL base del microservicio, sin trailing slash
  baseURL: "https://api.boolean.com.ar/inventory",

  // REQUERIDO: función que retorna el header Auth completo
  // Se llama en CADA request, así siempre usa el token más nuevo
  // Puede ser async (ej: renovar token antes de enviarlo)
  getAuthHeader: async () => `Bearer ${await refreshTokenIfNeeded()}`,

  // OPCIONAL: timeout en ms (default: 15000)
  timeout: 10_000,

  // OPCIONAL: headers que se envían en cada request
  defaultHeaders: {
    "X-API-Version": "2",
    "X-Tenant-ID": "acme",
  },
});
```

> ⚠️ **Sin defaults silenciosos**: si `baseURL` está vacío o no tiene `http://`/`https://`, el constructor lanza `ConfigurationError` inmediatamente.

---

## Query params

```ts
// GET /products?page=1&limit=20&q=teclado&category=electronics
const { data } = await client.get("/products", {
  params: {
    page: 1,
    limit: 20,
    q: "teclado",
    category: "electronics",
    archived: undefined, // Se omite automáticamente
    deleted: null,       // Se omite automáticamente
  },
});
```

---

## Manejo de errores

El cliente convierte los errores HTTP en instancias tipadas. Podés hacer `instanceof` para manejarlos específicamente:

```ts
import {
  BooleanHttpError,
  HttpError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  RequestAbortedError,
  NetworkError,
} from "@boolean/http";

try {
  const { data } = await client.get(`/products/${id}`);
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log("Producto no encontrado");
  } else if (error instanceof UnauthorizedError) {
    // Token expirado → redirigir a login
    router.push("/login");
  } else if (error instanceof ValidationError) {
    // El servidor rechazó el body → mostrar errores al usuario
    console.log("Errores de validación:", error.body);
  } else if (error instanceof RequestAbortedError) {
    if (error.reason === "timeout") {
      console.log("El request tardó demasiado");
    }
  } else if (error instanceof NetworkError) {
    console.log("Sin conexión");
  } else if (error instanceof HttpError) {
    // Cualquier otro error HTTP (500, 503, etc.)
    console.log(`Error ${error.status}: ${error.message}`);
  }
}
```

### Jerarquía de errores

```
BooleanHttpError
├── ConfigurationError     – Cliente mal configurado
├── HttpError              – Respuesta HTTP con error (4xx / 5xx)
│   ├── UnauthorizedError  – 401
│   ├── ForbiddenError     – 403
│   ├── NotFoundError      – 404
│   ├── ValidationError    – 422
│   └── RateLimitError     – 429
├── RequestAbortedError    – Timeout o cancelación manual
└── NetworkError           – No hubo respuesta del servidor
```

---

## Interceptors

Los interceptors permiten transformar requests y responses de forma reutilizable, sin tocar el código de cada llamada.

### Interceptor de request

```ts
// Agregar un request ID único a cada request
const id = client.addRequestInterceptor(async (ctx) => ({
  ...ctx,
  headers: {
    ...ctx.headers,
    "X-Request-ID": crypto.randomUUID(),
  },
}));

// Remover el interceptor cuando ya no se necesita
client.removeInterceptor(id);
```

### Interceptor de response

```ts
// Loguear cada response
client.addResponseInterceptor(async (ctx) => {
  console.log(
    `← ${ctx.requestContext.method} ${ctx.requestContext.url}`,
    `→ ${ctx.response.status}`
  );
  return ctx;
});
```

### Interceptors comunes listos para usar

```ts
// Logging completo
client.addRequestInterceptor(async (ctx) => {
  console.group(`→ ${ctx.method} ${ctx.url}`);
  console.log("Headers:", ctx.headers);
  console.log("Body:", ctx.body);
  console.groupEnd();
  return ctx;
});

// Agregar version header
client.addRequestInterceptor(async (ctx) => ({
  ...ctx,
  headers: { ...ctx.headers, "X-Client-Version": "1.0.0" },
}));
```

---

## Cancelar requests

```ts
const controller = new AbortController();

// En algún punto cancelamos el request
setTimeout(() => controller.abort(), 3000);

try {
  const { data } = await client.get("/slow-report", {
    signal: controller.signal,
  });
} catch (error) {
  if (error instanceof RequestAbortedError && error.reason === "manual") {
    console.log("Request cancelado por el usuario");
  }
}
```

---

## Diseño: ¿por qué así?

### `getAuthHeader` es una función, no un string

```ts
// ❌ Mal: el token se captura una sola vez
const client = new BooleanHttpClient({ ..., auth: localStorage.getItem("token") });

// ✅ Bien: se llama en cada request, siempre token fresco
const client = new BooleanHttpClient({ ..., getAuthHeader: () => `Bearer ${localStorage.getItem("token")}` });
```

### Sin defaults silenciosos

```ts
// ❌ Esto lanza un error inmediatamente → no llega a producción
const client = new BooleanHttpClient({ baseURL: "", getAuthHeader: () => "" });
// ConfigurationError: baseURL es requerido...
```

### Errores instanceof

```ts
// ✅ Podés hacer pattern matching por tipo de error
if (error instanceof NotFoundError) { ... }
if (error instanceof UnauthorizedError) { ... }

// También podés atrapar todos los errores del cliente
if (error instanceof BooleanHttpError) { ... }
```

---

## Scripts

```bash
# Build de la librería (CJS + ESM + tipos)
npm run build

# Build en modo watch (desarrollo)
npm run dev

# Tests
npm test

# Type check
npm run type-check
```

---

## Arquitectura del SDK Boolean

```
@boolean/http          ← Este paquete (capa base HTTP)
    ↑
@boolean/api-inventory ← Encapsula endpoints del servicio inventario
@boolean/api-users     ← Encapsula endpoints del servicio usuarios
    ↑
Frontend / App         ← Usa los clientes de cada servicio
```

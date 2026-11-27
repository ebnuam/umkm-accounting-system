interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = unknown>(): Promise<{ success: boolean; results?: T[]; meta?: Record<string, unknown> }>;
  all<T = unknown>(): Promise<{ success: boolean; results: T[]; meta?: Record<string, unknown> }>;
  first<T = unknown>(colName?: string): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean; results?: T[] }>>;
  exec(query: string): Promise<unknown>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    SESSION_SECRET?: string;
    TRUST_AUTH_PROXY_SECRET?: string;
    [key: string]: unknown;
  };
}

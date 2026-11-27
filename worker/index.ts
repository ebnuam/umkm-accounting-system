/** Cloudflare Worker entry point for NeracaKita / UMKM Accounting System. */
import { drizzle } from "drizzle-orm/d1";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { cleanupExpiredDemoSandboxes } from "../db/demo-cleanup.ts";
import * as schema from "../db/schema.ts";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  APP_DEMO_MODE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.APP_DEMO_MODE !== "true" || !env.DB) return;
    const db = drizzle(env.DB, { schema });
    ctx.waitUntil(cleanupExpiredDemoSandboxes(db));
  },
};

export default worker;

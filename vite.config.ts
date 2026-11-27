import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig, type UserConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const isSelfHostedSqlite =
  (process.env.DB_ADAPTER ?? "").trim().toLowerCase() === "sqlite";

export default defineConfig(async (): Promise<UserConfig> => {
  if (isSelfHostedSqlite) {
    return {
      server: {
        host: "0.0.0.0",
        allowedHosts: ["terminal.local"],
      },
      resolve: {
        alias: {
          "cloudflare:workers": fileURLToPath(
            new URL("./db/cloudflare-workers-stub.ts", import.meta.url),
          ),
        },
      },
      ssr: {
        external: ["node:sqlite"],
      },
      build: {
        rolldownOptions: {
          external: ["node:sqlite"],
        },
      },
      plugins: [vinext()],
    };
  }

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  const stubPath = fileURLToPath(new URL("./db/local-sqlite-stub.ts", import.meta.url));

  return {
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      {
        name: "exclude-local-sqlite-for-workers",
        enforce: "pre",
        resolveId(source) {
          if (
            source === "node:sqlite" ||
            source === "./local-sqlite-repository.ts" ||
            source.endsWith("/local-sqlite-repository.ts") ||
            source.endsWith("\\local-sqlite-repository.ts")
          ) {
            return stubPath;
          }
          return null;
        },
      },
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        configPath: "./config/wrangler.demo.jsonc",
      }),
    ],
  };
});

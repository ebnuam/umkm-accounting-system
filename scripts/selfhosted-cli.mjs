process.env.DB_ADAPTER = process.env.DB_ADAPTER || "sqlite";
await import("../node_modules/vinext/dist/cli.js");

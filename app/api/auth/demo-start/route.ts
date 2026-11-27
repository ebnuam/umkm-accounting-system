import { getRepositories, getRuntimeFlag } from "../../../../db/index.ts";
import { handleDemoStart } from "../_handler.ts";

export async function POST(request: Request) {
  const [{ accountingRepo, authRepo }, demoMode] = await Promise.all([
    getRepositories(),
    getRuntimeFlag("APP_DEMO_MODE"),
  ]);
  return handleDemoStart(request, authRepo, accountingRepo, { demoMode });
}

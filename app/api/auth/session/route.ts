import { getRepositories, getRuntimeFlag } from "../../../../db/index.ts";
import { handleGetAuthSession } from "../_handler.ts";

export async function GET(request: Request) {
  const [{ accountingRepo, authRepo }, disablePublicSignup, demoMode] = await Promise.all([
    getRepositories(),
    getRuntimeFlag("DISABLE_PUBLIC_SIGNUP"),
    getRuntimeFlag("APP_DEMO_MODE"),
  ]);
  return handleGetAuthSession(request, authRepo, accountingRepo, {
    disablePublicSignup,
    demoMode,
  });
}

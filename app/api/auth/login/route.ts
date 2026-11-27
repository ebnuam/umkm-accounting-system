import { getRepositories } from "../../../../db/index.ts";
import { handleLogin } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleLogin(request, authRepo, accountingRepo);
}

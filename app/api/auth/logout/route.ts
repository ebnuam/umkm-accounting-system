import { getRepositories } from "../../../../db/index.ts";
import { handleLogoutAuth } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleLogoutAuth(request, authRepo, accountingRepo);
}

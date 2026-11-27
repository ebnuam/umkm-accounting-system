import { getRepositories } from "../../../../db/index.ts";
import { handleLogout } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleLogout(request, authRepo, accountingRepo);
}

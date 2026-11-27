import { getRepositories } from "../../../../db/index.ts";
import { handleResetWorkspace } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleResetWorkspace(request, accountingRepo, authRepo);
}

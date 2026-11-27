import { getRepositories } from "../../../../db/index.ts";
import { handleGetWorkspace } from "../_handler.ts";

export async function GET(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleGetWorkspace(request, accountingRepo, authRepo);
}

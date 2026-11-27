import { getRepositories } from "../../../../db/index.ts";
import { handleCreateBusiness } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleCreateBusiness(request, authRepo, accountingRepo);
}

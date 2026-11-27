import { getRepositories } from "../../../../db/index.ts";
import { handleMasterMutation } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleMasterMutation(request, accountingRepo, authRepo);
}

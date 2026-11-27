import { getRepositories } from "../../../../db/index.ts";
import { handlePostTransaction } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handlePostTransaction(request, accountingRepo, authRepo);
}

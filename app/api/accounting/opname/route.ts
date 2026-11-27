import { getRepositories } from "../../../../db/index.ts";
import { handlePostOpname } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handlePostOpname(request, accountingRepo, authRepo);
}

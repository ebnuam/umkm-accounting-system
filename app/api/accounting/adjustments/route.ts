import { getRepositories } from "../../../../db/index.ts";
import { handlePostAdjustment } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handlePostAdjustment(request, accountingRepo, authRepo);
}

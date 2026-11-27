import { getRepositories } from "../../../../../db/index.ts";
import { handleClosePeriod } from "../../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleClosePeriod(request, accountingRepo, authRepo);
}

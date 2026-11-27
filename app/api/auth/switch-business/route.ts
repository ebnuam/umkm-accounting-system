import { getRepositories } from "../../../../db/index.ts";
import { handleSwitchBusiness } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleSwitchBusiness(request, authRepo, accountingRepo);
}

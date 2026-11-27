import { getRepositories } from "../../../../db/index.ts";
import { handleListMembers, handleManageMembers } from "../_handler.ts";

export async function GET(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleListMembers(request, authRepo, accountingRepo);
}

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleManageMembers(request, authRepo, accountingRepo);
}

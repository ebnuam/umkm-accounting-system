import { getRepositories } from "../../../../db/index.ts";
import { handleRegister } from "../_handler.ts";

export async function POST(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleRegister(request, authRepo, accountingRepo);
}

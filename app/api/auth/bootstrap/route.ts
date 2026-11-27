import { getRepositories, getRuntimeBootstrapSecret } from "../../../../db/index.ts";
import { handleBootstrapOwner } from "../_handler.ts";

export async function POST(request: Request) {
  const [{ accountingRepo, authRepo }, bootstrapSecret] = await Promise.all([
    getRepositories(),
    getRuntimeBootstrapSecret(),
  ]);
  return handleBootstrapOwner(request, authRepo, accountingRepo, { bootstrapSecret });
}

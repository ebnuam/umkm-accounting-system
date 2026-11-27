import { getRepositories } from "../../../../../../db/index.ts";
import { handleVoidEntry } from "../../../_handler.ts";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const [{ id }, { accountingRepo, authRepo }] = await Promise.all([
    context.params,
    getRepositories(),
  ]);
  return handleVoidEntry(request, id, accountingRepo, authRepo);
}

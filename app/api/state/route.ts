import { getRepositories } from "../../../db/index.ts";
import { handleGetWorkspace } from "../accounting/_handler.ts";

export async function GET(request: Request) {
  const { accountingRepo, authRepo } = await getRepositories();
  return handleGetWorkspace(request, accountingRepo, authRepo);
}

export async function PUT() {
  return Response.json(
    {
      error:
        "Penyimpanan JSON mentah dinonaktifkan. Seluruh mutasi wajib melalui endpoint /api/accounting/* yang tervalidasi double-entry.",
      code: "DEPRECATED_ENDPOINT",
    },
    { status: 410 },
  );
}

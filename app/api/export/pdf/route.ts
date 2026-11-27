import { AccountingError, assertPermission, AuthService } from "../../../../core/index.ts";
import { getRepositories } from "../../../../db/index.ts";
import {
  attachAuthSessionCookie,
  authenticateRequest,
  verifySameOriginRequest,
} from "../../../request-session.ts";
import { buildPdfBytes, buildVerifiedExportData } from "../../accounting/_export.ts";

export async function POST(request: Request) {
  try {
    verifySameOriginRequest(request);
    const { accountingRepo, authRepo } = await getRepositories();
    const authService = new AuthService(authRepo, accountingRepo);
    const ctx = await authenticateRequest(request, authService);
    assertPermission(ctx.role, "reports:export");
    let period: string | undefined;
    try {
      const body = (await request.json()) as { period?: string };
      if (body?.period) period = String(body.period);
    } catch {
      // Optional JSON body; defaults to activePeriod
    }
    const data = await buildVerifiedExportData(accountingRepo, ctx.tenantId, period);
    const bytes = buildPdfBytes(data.businessName, data.sections);
    const filename = data.pdfFilename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const response = new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
    return ctx.rotatedToken ? attachAuthSessionCookie(response, request, ctx.rotatedToken) : response;
  } catch (error) {
    if (error instanceof AccountingError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }
    return Response.json({ error: "Export PDF gagal." }, { status: 500 });
  }
}

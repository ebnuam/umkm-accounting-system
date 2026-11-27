import {
  AccountingEngine,
  AccountingError,
  type AccountingRepository,
  assertPermission,
  type AuthRepository,
  AuthService,
  type AuthenticatedContext,
  seedAnekaSnackDemoWorkspace,
  seedSampleWorkspace,
  ValidationError,
} from "../../../core/index.ts";
import {
  attachAuthSessionCookie,
  authenticateRequest,
  clearAuthSessionCookie,
  extractAuthToken,
  verifySameOriginRequest,
} from "../../request-session.ts";

export interface HandlerOptions {
  nowMs?: number;
}

const MAX_JSON_BODY_BYTES = 65_536;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseJsonBody(request: Request): Promise<Record<string, any>> {
  const raw = await request.text();
  if (raw.length > MAX_JSON_BODY_BYTES) {
    throw new AccountingError("PAYLOAD_TOO_LARGE", "Ukuran permintaan melebihi batas 64 KB.", 413);
  }
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ValidationError("Payload JSON harus berupa objek.");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AccountingError) throw err;
    throw new ValidationError("Format JSON permintaan tidak valid.", "INVALID_JSON");
  }
}

async function buildWorkspaceResponse(
  engine: AccountingEngine,
  ctx: AuthenticatedContext,
  request: Request,
  extra?: Record<string, unknown>,
  status = 200,
): Promise<Response> {
  const workspace = await engine.getWorkspace(ctx.tenantId);
  // Staff does not receive full audit log stream unless authorized
  const safeWorkspace =
    ctx.role === "owner" ? workspace : { ...workspace, auditLogs: [] };
  const period = workspace.profile.activePeriod;
  const [statements, trialBalanceUnadjusted, trialBalanceAdjusted] = await Promise.all([
    engine.getFinancialStatements(ctx.tenantId, period),
    engine.getTrialBalance(ctx.tenantId, period, false, false),
    engine.getTrialBalance(ctx.tenantId, period, true, false),
  ]);

  const response = Response.json(
    {
      user: ctx.user,
      activeTenantId: ctx.tenantId,
      role: ctx.role,
      memberships: ctx.memberships,
      workspace: safeWorkspace,
      statements,
      trialBalanceUnadjusted,
      trialBalanceAdjusted,
      ...(extra ?? {}),
    },
    { status },
  );

  return ctx.rotatedToken
    ? attachAuthSessionCookie(response, request, ctx.rotatedToken)
    : response;
}

function handleError(error: unknown): Response {
  if (error instanceof AccountingError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }
  console.error("accounting_api_error", error);
  return Response.json({ error: "Terjadi kesalahan pada server akuntansi." }, { status: 500 });
}

export async function handleLogout(
  request: Request,
  authRepo: AuthRepository,
  accountingRepo: AccountingRepository,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, accountingRepo);
    await authService.logout(extractAuthToken(request));
    const response = Response.json({ loggedOut: true });
    return clearAuthSessionCookie(response, request);
  } catch (error) {
    return handleError(error);
  }
}

export async function handleGetWorkspace(
  request: Request,
  repo: AccountingRepository,
  authRepo: AuthRepository,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    const authService = new AuthService(authRepo, repo);
    const ctx = await authenticateRequest(request, authService, { nowMs: options?.nowMs });
    assertPermission(ctx.role, "workspace:read");
    const engine = new AccountingEngine(repo);
    return await buildWorkspaceResponse(engine, ctx, request);
  } catch (error) {
    return handleError(error);
  }
}

export async function handlePostTransaction(
  request: Request,
  repo: AccountingRepository,
  authRepo: AuthRepository,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, repo);
    const ctx = await authenticateRequest(request, authService, { nowMs: options?.nowMs });
    assertPermission(ctx.role, "transactions:post");
    const engine = new AccountingEngine(repo);
    const body = await parseJsonBody(request);
    const type = String(body.type ?? "");
    let result: unknown;

    switch (type) {
      case "capital":
      case "drawing":
        result = await engine.postCapitalOrDrawing(ctx.tenantId, ctx.user.id, {
          type,
          date: String(body.date ?? ""),
          amount: Number(body.amount),
          cashAccountCode: body.cashAccountCode === "1102" ? "1102" : "1101",
          description: body.description ? String(body.description) : undefined,
        });
        break;
      case "cash_expense":
        result = await engine.postCashExpense(ctx.tenantId, ctx.user.id, {
          date: String(body.date ?? ""),
          amount: Number(body.amount),
          expenseAccountCode: String(body.expenseAccountCode ?? ""),
          cashAccountCode: body.cashAccountCode === "1102" ? "1102" : "1101",
          partyName: body.partyName ? String(body.partyName) : undefined,
          description: body.description ? String(body.description) : undefined,
        });
        break;
      case "cash_sale":
      case "bank_sale":
      case "credit_sale":
        result = await engine.postSale(ctx.tenantId, ctx.user.id, {
          date: String(body.date ?? ""),
          paymentMethod:
            type === "credit_sale" ? "credit" : body.cashAccountCode === "1102" || type === "bank_sale" ? "bank" : "cash",
          partyId: body.partyId ? String(body.partyId) : null,
          itemId: body.itemId ? String(body.itemId) : null,
          quantity: body.quantity !== undefined && body.quantity !== "" ? Number(body.quantity) : undefined,
          totalAmount: Number(body.amount ?? body.totalAmount),
          revenueAccountCode: body.revenueAccountCode ? String(body.revenueAccountCode) : null,
          description: body.description ? String(body.description) : undefined,
          dueDate: body.dueDate ? String(body.dueDate) : null,
        });
        break;
      case "inventory_cash":
      case "inventory_credit":
      case "equipment_cash":
      case "equipment_credit":
        result = await engine.postPurchase(ctx.tenantId, ctx.user.id, {
          date: String(body.date ?? ""),
          paymentMethod:
            type.endsWith("_credit") ? "credit" : body.cashAccountCode === "1102" ? "bank" : "cash",
          partyId: body.partyId ? String(body.partyId) : null,
          itemId: body.itemId ? String(body.itemId) : null,
          quantity: body.quantity !== undefined && body.quantity !== "" ? Number(body.quantity) : undefined,
          totalCost: Number(body.amount ?? body.totalCost),
          description: body.description ? String(body.description) : undefined,
          dueDate: body.dueDate ? String(body.dueDate) : null,
          isEquipment: type.startsWith("equipment_"),
          assetAccountCode: body.assetAccountCode ? String(body.assetAccountCode) : null,
        });
        break;
      case "collect_receivable":
      case "pay_payable":
        result = await engine.postInvoicePayment(ctx.tenantId, ctx.user.id, {
          kind: type === "collect_receivable" ? "receivable" : "payable",
          date: String(body.date ?? ""),
          partyId: String(body.partyId ?? ""),
          invoiceId: String(body.invoiceId ?? ""),
          amount: Number(body.amount),
          cashAccountCode: body.cashAccountCode === "1102" ? "1102" : "1101",
          description: body.description ? String(body.description) : undefined,
        });
        break;
      case "material_usage":
      case "production_transfer":
        result = await engine.postMaterialUsageOrTransfer(ctx.tenantId, ctx.user.id, {
          date: String(body.date ?? ""),
          sourceItemId: String(body.sourceItemId ?? ""),
          sourceQuantity: Number(body.sourceQuantity),
          targetItemId: type === "production_transfer" && body.targetItemId ? String(body.targetItemId) : null,
          targetQuantity:
            type === "production_transfer" && body.targetQuantity !== undefined
              ? Number(body.targetQuantity)
              : undefined,
          batchRef: body.batchRef ? String(body.batchRef) : null,
          description: body.description ? String(body.description) : undefined,
        });
        break;
      case "production_run":
        result = await engine.postProductionRun(ctx.tenantId, ctx.user.id, {
          date: String(body.date ?? ""),
          materials: Array.isArray(body.materials)
            ? body.materials.map((m: Record<string, unknown>) => ({
                itemId: String(m.itemId ?? ""),
                quantity: Number(m.quantity),
              }))
            : [],
          targetItemId: String(body.targetItemId ?? ""),
          targetQuantity: Number(body.targetQuantity),
          directLaborCost: body.directLaborCost !== undefined ? Number(body.directLaborCost) : 0,
          overheadCost: body.overheadCost !== undefined ? Number(body.overheadCost) : 0,
          costCreditAccountCode: body.costCreditAccountCode ? String(body.costCreditAccountCode) : undefined,
          batchRef: body.batchRef ? String(body.batchRef) : null,
          description: body.description ? String(body.description) : undefined,
        });
        break;
      case "general_journal":
        result = await engine.postGeneralJournal(ctx.tenantId, ctx.user.id, {
          date: String(body.date ?? ""),
          description: String(body.description ?? ""),
          lines: Array.isArray(body.lines)
            ? body.lines.map((l: Record<string, unknown>) => ({
                accountCode: String(l.accountCode ?? ""),
                debit: l.debit !== undefined ? Number(l.debit) : 0,
                credit: l.credit !== undefined ? Number(l.credit) : 0,
                memo: l.memo ? String(l.memo) : null,
              }))
            : [],
        });
        break;
      default:
        return Response.json({ error: `Jenis transaksi "${type}" tidak dikenal.` }, { status: 400 });
    }

    return await buildWorkspaceResponse(engine, ctx, request, { result }, 201);
  } catch (error) {
    return handleError(error);
  }
}

export async function handlePostOpname(
  request: Request,
  repo: AccountingRepository,
  authRepo: AuthRepository,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, repo);
    const ctx = await authenticateRequest(request, authService, { nowMs: options?.nowMs });
    assertPermission(ctx.role, "opname:post");
    const engine = new AccountingEngine(repo);
    const body = await parseJsonBody(request);
    const result = await engine.postStockOpname(ctx.tenantId, ctx.user.id, {
      date: String(body.date ?? ""),
      itemId: String(body.itemId ?? ""),
      physicalQuantity: Number(body.physicalQuantity),
      unitCostIfZero: body.unitCostIfZero !== undefined ? Number(body.unitCostIfZero) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
    });
    return await buildWorkspaceResponse(engine, ctx, request, { result }, 201);
  } catch (error) {
    return handleError(error);
  }
}

export async function handlePostAdjustment(
  request: Request,
  repo: AccountingRepository,
  authRepo: AuthRepository,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, repo);
    const ctx = await authenticateRequest(request, authService, { nowMs: options?.nowMs });
    assertPermission(ctx.role, "adjustments:post");
    const engine = new AccountingEngine(repo);
    const body = await parseJsonBody(request);

    const result =
      body.type === "depreciation"
        ? await engine.postAdjustment(ctx.tenantId, ctx.user.id, {
            type: "depreciation",
            date: String(body.date ?? ""),
            assetCost: Number(body.assetCost),
            lifeMonths: Number(body.lifeMonths),
            description: body.description ? String(body.description) : undefined,
          })
        : await engine.postAdjustment(ctx.tenantId, ctx.user.id, {
            type: "accrued_expense",
            date: String(body.date ?? ""),
            expenseAccountCode: String(body.expenseAccountCode ?? ""),
            amount: Number(body.amount),
            description: body.description ? String(body.description) : undefined,
          });

    return await buildWorkspaceResponse(engine, ctx, request, { result }, 201);
  } catch (error) {
    return handleError(error);
  }
}

export async function handleVoidEntry(
  request: Request,
  entryId: string,
  repo: AccountingRepository,
  authRepo: AuthRepository,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, repo);
    const ctx = await authenticateRequest(request, authService, { nowMs: options?.nowMs });
    assertPermission(ctx.role, "entry:void");
    const engine = new AccountingEngine(repo);
    const body = await parseJsonBody(request);
    const result = await engine.voidJournalEntry(ctx.tenantId, ctx.user.id, {
      entryId,
      reason: String(body.reason ?? ""),
      reversalDate: body.reversalDate ? String(body.reversalDate) : undefined,
    });
    return await buildWorkspaceResponse(engine, ctx, request, { result });
  } catch (error) {
    return handleError(error);
  }
}

export async function handleClosePeriod(
  request: Request,
  repo: AccountingRepository,
  authRepo: AuthRepository,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, repo);
    const ctx = await authenticateRequest(request, authService, { nowMs: options?.nowMs });
    assertPermission(ctx.role, "period:close");
    const engine = new AccountingEngine(repo);
    const body = await parseJsonBody(request);
    const result = await engine.closePeriod(
      ctx.tenantId,
      ctx.user.id,
      String(body.period ?? ""),
    );
    return await buildWorkspaceResponse(engine, ctx, request, { result });
  } catch (error) {
    return handleError(error);
  }
}

export async function handleMasterMutation(
  request: Request,
  repo: AccountingRepository,
  authRepo: AuthRepository,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, repo);
    const ctx = await authenticateRequest(request, authService, { nowMs: options?.nowMs });
    const engine = new AccountingEngine(repo);
    const body = await parseJsonBody(request);
    const action = String(body.action ?? "");
    let result: unknown;

    switch (action) {
      case "create_item":
        assertPermission(ctx.role, "master:write");
        result = await engine.createItem(ctx.tenantId, ctx.user.id, {
          name: String(body.name ?? ""),
          category: body.category,
          unit: String(body.unit ?? ""),
          sku: body.sku ? String(body.sku) : null,
          defaultSalePrice: body.defaultSalePrice !== undefined ? Number(body.defaultSalePrice) : 0,
          defaultPurchaseCost: body.defaultPurchaseCost !== undefined ? Number(body.defaultPurchaseCost) : 0,
          revenueAccountCode: body.revenueAccountCode ? String(body.revenueAccountCode) : null,
          cogsAccountCode: body.cogsAccountCode ? String(body.cogsAccountCode) : null,
          openingQuantity: body.openingQuantity !== undefined ? Number(body.openingQuantity) : 0,
          openingTotalCost: body.openingTotalCost !== undefined ? Number(body.openingTotalCost) : 0,
          openingDate: body.openingDate ? String(body.openingDate) : undefined,
        });
        break;
      case "toggle_item":
        assertPermission(ctx.role, "master:write");
        result = await engine.toggleItemActive(
          ctx.tenantId,
          ctx.user.id,
          String(body.itemId ?? ""),
        );
        break;
      case "create_party":
        assertPermission(ctx.role, "master:write");
        result = await engine.createParty(ctx.tenantId, ctx.user.id, {
          name: String(body.name ?? ""),
          type: body.type,
          phone: body.phone ? String(body.phone) : null,
          address: body.address ? String(body.address) : null,
        });
        break;
      case "create_account":
        assertPermission(ctx.role, "profile:update");
        result = await engine.createAccount(ctx.tenantId, ctx.user.id, {
          code: String(body.code ?? ""),
          name: String(body.name ?? ""),
          group: body.group,
          category: body.category ? String(body.category) : undefined,
        });
        break;
      case "toggle_account":
        assertPermission(ctx.role, "profile:update");
        result = await engine.toggleAccountActive(
          ctx.tenantId,
          ctx.user.id,
          String(body.code ?? ""),
        );
        break;
      case "update_profile":
        assertPermission(ctx.role, "profile:update");
        result = await engine.updateProfile(ctx.tenantId, ctx.user.id, {
          businessName: body.businessName !== undefined ? String(body.businessName) : undefined,
          city: body.city !== undefined ? String(body.city) : undefined,
          businessSector: body.businessSector !== undefined ? body.businessSector : undefined,
          activePeriod: body.activePeriod !== undefined ? String(body.activePeriod) : undefined,
        });
        break;
      default:
        return Response.json({ error: `Aksi master "${action}" tidak dikenal.` }, { status: 400 });
    }

    return await buildWorkspaceResponse(engine, ctx, request, { result });
  } catch (error) {
    return handleError(error);
  }
}

export async function handleResetWorkspace(
  request: Request,
  repo: AccountingRepository,
  authRepo: AuthRepository,
  options?: HandlerOptions,
): Promise<Response> {
  try {
    verifySameOriginRequest(request);
    const authService = new AuthService(authRepo, repo);
    const ctx = await authenticateRequest(request, authService, { nowMs: options?.nowMs });
    assertPermission(ctx.role, "workspace:reset");
    const engine = new AccountingEngine(repo);
    if (ctx.tenantId.startsWith("demo-")) {
      await seedAnekaSnackDemoWorkspace(repo, engine, ctx.tenantId, ctx.user.id);
    } else {
      await seedSampleWorkspace(repo, engine, ctx.tenantId, ctx.user.id);
    }
    return await buildWorkspaceResponse(engine, ctx, request);
  } catch (error) {
    return handleError(error);
  }
}

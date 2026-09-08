"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  budgetEntries,
  companies,
  companyFinance,
  deliveryNotes,
  earningTripLogs,
  earnings,
  financeCategories,
  financeTransactions,
  ledgerEntries,
  pricingForms,
  reconciliations,
  routePrices,
  vehicleOperators,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { applyRate, calcVat, netFromGross, subMoney } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { isInScope } from "@/lib/scope";
import { calcEarning } from "./hakedis-hesap";
import { eligibleTripLogs, listLedger } from "./queries";
import {
  BudgetSchema,
  CompanyFinanceSchema,
  DeliveryNoteSchema,
  EarningDraftSchema,
  FinanceCategorySchema,
  FinanceTransactionSchema,
  LedgerEntrySchema,
  PricingFormSchema,
  RoutePriceSchema,
  VehicleOperatorSchema,
} from "./validators";

export type ActionState = { error: string } | { ok: string } | null;

const read = (formData: FormData, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")]));

/* ---------- İşleten mali bilgileri ---------- */

const FINANCE_KEYS = [
  "companyId", "accountCode", "idNumber", "bankName", "bankBranch", "iban",
  "contractStart", "contractEnd", "withholdingPolicy", "fuelCreditRate", "notes",
] as const;

export async function saveCompanyFinanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("isletenler:update", "muhasebe");

  const parsed = CompanyFinanceSchema.safeParse({
    ...read(formData, FINANCE_KEYS),
    isPrimaryOperator: formData.get("isPrimaryOperator") === "on",
    isDriver: formData.get("isDriver") === "on",
    isTitleHolder: formData.get("isTitleHolder") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { companyId, ...values } = parsed.data;

  if (!isInScope(session.scope, companyId)) return { error: "Bu firma kapsamınızda değil." };

  try {
    await withTenant(session.tenantId, async (tx) => {
      // İşleten olarak işaretle — companies.type tek kaynak.
      await tx
        .update(companies)
        .set({ type: "isleten", updatedAt: new Date() })
        .where(and(eq(companies.tenantId, session.tenantId), eq(companies.id, companyId)));

      const existing = await tx
        .select({ id: companyFinance.id })
        .from(companyFinance)
        .where(
          and(eq(companyFinance.tenantId, session.tenantId), eq(companyFinance.companyId, companyId)),
        );

      if (existing[0]) {
        await tx
          .update(companyFinance)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(companyFinance.id, existing[0].id));
      } else {
        await tx.insert(companyFinance).values({ ...values, companyId, tenantId: session.tenantId });
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Bu cari kod başka bir firmada kullanılıyor." };
    }
    throw error;
  }

  revalidatePath("/muhasebe/isletenler");
  return { ok: "Mali bilgiler kaydedildi." };
}

/**
 * Aracı işletene bağlar. Açık atama varsa kapatılır — bir araç aynı anda
 * tek işletene ait olur, yoksa hakediş iki kez hesaplanır.
 */
export async function assignVehicleOperatorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("isletenler:update", "muhasebe");

  const parsed = VehicleOperatorSchema.safeParse({
    vehicleId: formData.get("vehicleId") ?? "",
    operatorId: formData.get("operatorId") ?? "",
    startsOn: formData.get("startsOn") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { vehicleId, operatorId, startsOn, notes } = parsed.data;

  await withTenant(session.tenantId, async (tx) => {
    // Açık atamaları yeni atamanın başladığı gün kapat.
    await tx
      .update(vehicleOperators)
      .set({ endsOn: startsOn })
      .where(
        and(
          eq(vehicleOperators.tenantId, session.tenantId),
          eq(vehicleOperators.vehicleId, vehicleId),
          isNull(vehicleOperators.endsOn),
        ),
      );

    await tx.insert(vehicleOperators).values({
      tenantId: session.tenantId,
      vehicleId,
      operatorId,
      startsOn,
      notes,
    });
  });

  revalidatePath("/muhasebe/isletenler");
  return { ok: "Araç işletene bağlandı." };
}

/* ---------- Ücretlendirme formları ---------- */

const FORM_KEYS = ["name", "groupName", "unitPrice", "vatRate", "withholdingRate", "notes"] as const;

export async function savePricingFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule("hakedis:update", "muhasebe");

  const parsed = PricingFormSchema.safeParse({
    ...read(formData, FORM_KEYS),
    id: formData.get("id") || undefined,
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  try {
    await withTenant(session.tenantId, async (tx) => {
      if (isUpdate && id) {
        await tx
          .update(pricingForms)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(pricingForms.tenantId, session.tenantId), eq(pricingForms.id, id)));
      } else {
        await tx.insert(pricingForms).values({ ...values, tenantId: session.tenantId });
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Bu form adı zaten var." };
    throw error;
  }

  revalidatePath("/muhasebe/ucretlendirme");
  return { ok: isUpdate ? "Form güncellendi." : "Form eklendi." };
}

/* ---------- Hakediş ---------- */

const EARNING_KEYS = [
  "operatorId", "vehicleId", "pricingFormId", "periodStart", "periodEnd",
  "unitPrice", "vatRate", "withholdingRate", "deductions", "notes",
] as const;

/**
 * Hakediş taslağı üretir: dönemdeki onaylı ve başka hakedişe bağlanmamış
 * çeteleleri toplar, sefer sayısıyla çarpar, KDV ve tevkifatı hesaplar.
 * Kaynak çeteleler kayda bağlanır — aynı çetele ikinci kez ödenmez.
 */
export async function createEarningAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("hakedis:create", "muhasebe");

  const parsed = EarningDraftSchema.safeParse(read(formData, EARNING_KEYS));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const input = parsed.data;

  if (input.periodEnd < input.periodStart) return { error: "Dönem bitişi başlangıçtan önce olamaz." };
  if (!isInScope(session.scope, input.operatorId)) return { error: "Bu işleten kapsamınızda değil." };

  const trips = await eligibleTripLogs(session.tenantId, {
    operatorId: input.operatorId,
    vehicleId: input.vehicleId,
    from: input.periodStart,
    to: input.periodEnd,
  });
  if (trips.length === 0) {
    return { error: "Bu dönemde hakedişe bağlanabilecek onaylı çetele yok." };
  }

  const breakdown = calcEarning({
    unitPrice: input.unitPrice,
    tripCount: trips.length,
    vatRate: input.vatRate,
    withholdingRate: input.withholdingRate,
    deductions: input.deductions,
  });

  // Numara ve kayıt aynı transaction'da: numara alınıp kayıt düşerse boşluk kalmasın.
  const documentNo = await withTenant(session.tenantId, async (tx) => {
    const no = await nextNumber(tx, session.tenantId, "hakedis");
    const [row] = await tx
      .insert(earnings)
      .values({
        tenantId: session.tenantId,
        operatorId: input.operatorId,
        vehicleId: input.vehicleId,
        pricingFormId: input.pricingFormId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        documentNo: no,
        gross: breakdown.gross,
        vatRate: input.vatRate,
        vat: breakdown.vat,
        withholdingRate: input.withholdingRate,
        withholding: breakdown.withholding,
        deductions: breakdown.deductions,
        net: breakdown.net,
        tripCount: String(trips.length),
        notes: input.notes,
        createdBy: session.userId,
      })
      .returning({ id: earnings.id });

    await tx.insert(earningTripLogs).values(
      trips.map((trip) => ({
        tenantId: session.tenantId,
        earningId: row!.id,
        tripLogId: trip.id,
      })),
    );
    return no;
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "earning.created",
    entityType: "earning",
    metadata: { documentNo, trips: trips.length, net: breakdown.net },
  });
  revalidatePath("/muhasebe/hakedis");
  return { ok: `${documentNo} oluşturuldu — ${trips.length} sefer, net ${breakdown.net} ₺.` };
}

const EARNING_FLOW: Record<string, readonly string[]> = {
  taslak: ["tahakkuk", "iptal"],
  tahakkuk: ["onaylandi", "iptal"],
  onaylandi: ["odendi", "iptal"],
  odendi: [],
  iptal: [],
};

/**
 * Hakediş durumunu ilerletir. "odendi" adımında cariye otomatik hareket yazar —
 * ödeme kaydı elle girilmeyi bekleyip unutulmasın.
 */
export async function setEarningStatusAction(formData: FormData): Promise<void> {
  const session = await requireModule("hakedis:approve", "muhasebe");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!id || !(to in EARNING_FLOW)) return;

  await withTenant(session.tenantId, async (tx) => {
    const [current] = await tx
      .select()
      .from(earnings)
      .where(and(eq(earnings.tenantId, session.tenantId), eq(earnings.id, id)));
    if (!current || !EARNING_FLOW[current.status]!.includes(to)) return;

    const now = new Date();
    await tx
      .update(earnings)
      .set({
        status: to as "tahakkuk",
        accruedAt: to === "tahakkuk" ? now : undefined,
        approvedAt: to === "onaylandi" ? now : undefined,
        paidAt: to === "odendi" ? now : undefined,
        updatedAt: now,
      })
      .where(eq(earnings.id, id));

    if (to === "odendi") {
      await tx.insert(ledgerEntries).values({
        tenantId: session.tenantId,
        companyId: current.operatorId,
        entryDate: now.toISOString().slice(0, 10),
        credit: current.net,
        kind: "hakedis",
        description: `${current.documentNo ?? "Hakediş"} ödemesi`,
        referenceType: "earning",
        referenceId: id,
        createdBy: session.userId,
      });
    }
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "earning.status_changed",
    entityType: "earning",
    entityId: id,
    metadata: { to },
  });
  revalidatePath("/muhasebe/hakedis");
}

/* ---------- Cari ---------- */

const LEDGER_KEYS = ["companyId", "entryDate", "dueDate", "debit", "credit", "kind", "description"] as const;

export async function addLedgerEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("cari:create", "muhasebe");

  const parsed = LedgerEntrySchema.safeParse(read(formData, LEDGER_KEYS));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const values = parsed.data;

  if (!isInScope(session.scope, values.companyId)) return { error: "Bu firma kapsamınızda değil." };
  if (values.debit === "0" && values.credit === "0") {
    return { error: "Borç ya da alacak tutarından biri girilmeli." };
  }

  await withTenant(session.tenantId, (tx) =>
    tx.insert(ledgerEntries).values({ ...values, tenantId: session.tenantId, createdBy: session.userId }),
  );
  revalidatePath(`/muhasebe/cari/${values.companyId}`);
  return { ok: "Cari hareket eklendi." };
}

/* ---------- Mutabakat ---------- */

/** Dönem bakiyesini dondurup mutabakat kaydı açar. */
export async function createReconciliationAction(formData: FormData): Promise<void> {
  const session = await requireModule("mutabakat:create", "muhasebe");
  const companyId = String(formData.get("companyId") ?? "");
  const period = String(formData.get("period") ?? "");
  if (!companyId || !/^\d{4}-\d{2}$/.test(period)) return;

  const entries = await listLedger(session.tenantId, companyId);
  const balance = entries.reduce(
    (sum, e) => subMoney(sum, subMoney(e.credit, e.debit)),
    "0.00",
  );

  await withTenant(session.tenantId, (tx) =>
    tx
      .insert(reconciliations)
      .values({
        tenantId: session.tenantId,
        companyId,
        period: `${period}-01`,
        balance,
      })
      .onConflictDoNothing(),
  );
  revalidatePath("/muhasebe/mutabakat");
}

export async function setReconciliationStatusAction(formData: FormData): Promise<void> {
  const session = await requireModule("mutabakat:approve", "muhasebe");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  const objection = String(formData.get("objection") ?? "").trim() || null;
  if (!id || !["gonderildi", "onaylandi", "itiraz"].includes(to)) return;

  const now = new Date();
  await withTenant(session.tenantId, (tx) =>
    tx
      .update(reconciliations)
      .set({
        status: to as "gonderildi",
        sentAt: to === "gonderildi" ? now : undefined,
        respondedAt: to === "gonderildi" ? undefined : now,
        objection: to === "itiraz" ? objection : undefined,
        updatedAt: now,
      })
      .where(and(eq(reconciliations.tenantId, session.tenantId), eq(reconciliations.id, id))),
  );
  revalidatePath("/muhasebe/mutabakat");
}

/* ---------- Gelir / gider ---------- */

const TX_KEYS = [
  "kind", "entryDate", "documentNo", "categoryId", "companyId", "vehicleId",
  "routeId", "amount", "vatRate", "currency", "rate", "status", "description",
] as const;

export async function saveTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const permission = formData.get("kind") === "gelir" ? "finans_hareket" : "finans_gider";
  const session = await requireModule(`${permission}:${isUpdate ? "update" : "create"}`, "muhasebe");

  const parsed = FinanceTransactionSchema.safeParse({
    ...read(formData, TX_KEYS),
    id: formData.get("id") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, vatRate, rate, amount, ...rest } = parsed.data;

  if (rest.companyId && !isInScope(session.scope, rest.companyId)) {
    return { error: "Seçilen firma kapsamınızda değil." };
  }

  // Girilen tutar KDV dahil brüt; net ve KDV bundan geri hesaplanır.
  const netBasis = netFromGross(amount, vatRate);
  const vat = subMoney(amount, netBasis);
  const amountTry = applyRate(amount, rate);

  const values = { ...rest, amount, vat, net: netBasis, rate, amountTry };

  await withTenant(session.tenantId, async (tx) => {
    if (isUpdate && id) {
      await tx
        .update(financeTransactions)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(financeTransactions.tenantId, session.tenantId), eq(financeTransactions.id, id)));
    } else {
      await tx
        .insert(financeTransactions)
        .values({ ...values, tenantId: session.tenantId, createdBy: session.userId });
    }
  });

  revalidatePath("/muhasebe/hareketler");
  return { ok: isUpdate ? "Hareket güncellendi." : "Hareket eklendi." };
}

export async function deleteTransactionAction(formData: FormData): Promise<void> {
  const session = await requireModule("finans_gider:delete", "muhasebe");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(financeTransactions)
      .where(and(eq(financeTransactions.tenantId, session.tenantId), eq(financeTransactions.id, id))),
  );
  revalidatePath("/muhasebe/hareketler");
}

export async function saveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("finans_gider:update", "muhasebe");

  const parsed = FinanceCategorySchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    kind: formData.get("kind") ?? "gider",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  try {
    await withTenant(session.tenantId, async (tx) => {
      if (id) {
        await tx
          .update(financeCategories)
          .set(values)
          .where(and(eq(financeCategories.tenantId, session.tenantId), eq(financeCategories.id, id)));
      } else {
        await tx.insert(financeCategories).values({ ...values, tenantId: session.tenantId });
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Bu kategori zaten var." };
    throw error;
  }

  revalidatePath("/muhasebe/kategoriler");
  return { ok: id ? "Kategori güncellendi." : "Kategori eklendi." };
}

/* ---------- Bütçe ve fiyat ---------- */

export async function saveBudgetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("butce:create", "muhasebe");

  const parsed = BudgetSchema.safeParse(read(formData, ["categoryId", "companyId", "period", "amount", "notes"]));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  await withTenant(session.tenantId, (tx) =>
    tx
      .insert(budgetEntries)
      .values({ ...parsed.data, tenantId: session.tenantId })
      .onConflictDoUpdate({
        target: [budgetEntries.tenantId, budgetEntries.period, budgetEntries.categoryId, budgetEntries.companyId],
        set: { amount: parsed.data.amount, notes: parsed.data.notes, updatedAt: new Date() },
      }),
  );
  revalidatePath("/muhasebe/butce");
  return { ok: "Bütçe kaydedildi." };
}

export async function saveRoutePriceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("hakedis:update", "muhasebe");

  const parsed = RoutePriceSchema.safeParse(
    read(formData, ["routeId", "companyId", "supplierId", "price", "validFrom"]),
  );
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  await withTenant(session.tenantId, async (tx) => {
    // Aynı güzergah + tedarikçi için açık fiyat varsa yeni fiyatın başladığı
    // gün kapatılır; iki fiyat aynı anda geçerli olmaz.
    await tx
      .update(routePrices)
      .set({ validTo: parsed.data.validFrom })
      .where(
        and(
          eq(routePrices.tenantId, session.tenantId),
          eq(routePrices.routeId, parsed.data.routeId),
          isNull(routePrices.validTo),
        ),
      );
    await tx.insert(routePrices).values({ ...parsed.data, tenantId: session.tenantId });
  });
  revalidatePath("/muhasebe/guzergah-fiyatlari");
  return { ok: "Fiyat kaydedildi." };
}

export async function deleteEarningAction(formData: FormData): Promise<void> {
  const session = await requireModule("hakedis:delete", "muhasebe");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(earnings)
      .where(
        and(
          eq(earnings.tenantId, session.tenantId),
          eq(earnings.id, id),
          // Ödenmiş hakediş silinemez; bağlı çeteleler serbest kalmamalı.
          inArray(earnings.status, ["taslak", "iptal"]),
        ),
      ),
  );
  revalidatePath("/muhasebe/hakedis");
}

/* ---------- İrsaliye ---------- */

const NOTE_KEYS = [
  "companyId", "vehicleId", "issueDate", "shipDate", "fromAddress",
  "toAddress", "description", "quantity", "unit", "status", "notes",
] as const;

export async function saveDeliveryNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule("cari:create", "muhasebe");

  const parsed = DeliveryNoteSchema.safeParse({
    ...read(formData, NOTE_KEYS),
    id: formData.get("id") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  if (values.companyId && !isInScope(session.scope, values.companyId)) {
    return { error: "Seçilen firma kapsamınızda değil." };
  }

  const documentNo = await withTenant(session.tenantId, async (tx) => {
    if (isUpdate && id) {
      await tx
        .update(deliveryNotes)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(deliveryNotes.tenantId, session.tenantId), eq(deliveryNotes.id, id)));
      return null;
    }
    // Numara ve kayıt aynı transaction'da — düşen kayıt numara boşluğu bırakmasın.
    const no = await nextNumber(tx, session.tenantId, "irsaliye");
    await tx
      .insert(deliveryNotes)
      .values({ ...values, documentNo: no, tenantId: session.tenantId, createdBy: session.userId });
    return no;
  });

  revalidatePath("/muhasebe/irsaliyeler");
  return { ok: documentNo ? `${documentNo} oluşturuldu.` : "İrsaliye güncellendi." };
}

export async function deleteDeliveryNoteAction(formData: FormData): Promise<void> {
  const session = await requireModule("cari:create", "muhasebe");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(deliveryNotes)
      .where(
        and(
          eq(deliveryNotes.tenantId, session.tenantId),
          eq(deliveryNotes.id, id),
          // Sevk edilmiş irsaliye silinemez: fiziksel hareketin belgesi.
          eq(deliveryNotes.status, "taslak"),
        ),
      ),
  );
  revalidatePath("/muhasebe/irsaliyeler");
}

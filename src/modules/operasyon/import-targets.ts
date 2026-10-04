import { and, eq } from "drizzle-orm";
import { companies, drivers, passengers, vehicles } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { registerImportTarget } from "@/lib/import/targets";
import { normalizePlate } from "@/modules/filo/validators";

/** Firma adını kimliğe çevirir; yoksa oluşturur — dosyada firma adı geldiği için. */
async function resolveCompany(
  tx: TenantTx,
  tenantId: string,
  name: string | undefined,
): Promise<string | null> {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) return null;

  const found = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.tenantId, tenantId), eq(companies.name, trimmed)))
    .limit(1);
  if (found[0]) return found[0].id;

  const created = await tx.insert(companies).values({ tenantId, name: trimmed }).returning({ id: companies.id });
  return created[0]!.id;
}

export function registerOperasyonImports(): void {
  registerImportTarget({
    key: "firmalar",
    label: "Firmalar",
    permission: "firmalar:create",
    columns: [
      { key: "name", label: "Ünvan", required: true, type: "text" },
      { key: "code", label: "Kod", required: false, type: "text" },
      { key: "taxNumber", label: "Vergi No", required: false, type: "text" },
      { key: "phone", label: "Telefon", required: false, type: "text" },
      { key: "email", label: "E-posta", required: false, type: "text" },
      { key: "address", label: "Adres", required: false, type: "text" },
    ],
    insert: async (tx, tenantId, values) => {
      const rows = await tx
        .insert(companies)
        .values({
          tenantId,
          name: values.name!,
          code: values.code || null,
          taxNumber: values.taxNumber || null,
          phone: values.phone || null,
          email: values.email || null,
          address: values.address || null,
        })
        .returning({ id: companies.id });
      return rows[0]!.id;
    },
    remove: async (tx, tenantId, id) => {
      await tx.delete(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, id)));
    },
  });

  registerImportTarget({
    key: "araclar",
    label: "Araçlar",
    permission: "araclar:import",
    columns: [
      { key: "plate", label: "Plaka", required: true, type: "text" },
      { key: "company", label: "Firma", required: false, type: "text" },
      { key: "brand", label: "Marka", required: false, type: "text" },
      { key: "model", label: "Model", required: false, type: "text" },
      { key: "capacity", label: "Kapasite", required: false, type: "number" },
    ],
    insert: async (tx, tenantId, values) => {
      const companyId = await resolveCompany(tx, tenantId, values.company);
      const rows = await tx
        .insert(vehicles)
        .values({
          tenantId,
          companyId,
          plate: normalizePlate(values.plate!),
          brand: values.brand || null,
          model: values.model || null,
          capacity: values.capacity ? Number(values.capacity) : null,
        })
        .returning({ id: vehicles.id });
      return rows[0]!.id;
    },
    remove: async (tx, tenantId, id) => {
      await tx.delete(vehicles).where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.id, id)));
    },
  });

  registerImportTarget({
    key: "yolcular",
    label: "Yolcular",
    permission: "yolcular:import",
    columns: [
      { key: "fullName", label: "Ad Soyad", required: true, type: "text" },
      { key: "company", label: "Firma", required: false, type: "text" },
      { key: "phone", label: "Telefon", required: false, type: "text" },
      { key: "idNumber", label: "TC Kimlik", required: false, type: "text" },
      { key: "pickupAddress", label: "Biniş Adresi", required: false, type: "text" },
      { key: "dropoffAddress", label: "İniş Adresi", required: false, type: "text" },
    ],
    insert: async (tx, tenantId, values) => {
      const companyId = await resolveCompany(tx, tenantId, values.company);
      const rows = await tx
        .insert(passengers)
        .values({
          tenantId,
          companyId,
          fullName: values.fullName!,
          phone: values.phone || null,
          idNumber: values.idNumber || null,
          pickupAddress: values.pickupAddress || null,
          dropoffAddress: values.dropoffAddress || null,
        })
        .returning({ id: passengers.id });
      return rows[0]!.id;
    },
    remove: async (tx, tenantId, id) => {
      await tx.delete(passengers).where(and(eq(passengers.tenantId, tenantId), eq(passengers.id, id)));
    },
  });

  registerImportTarget({
    key: "suruculer",
    label: "Sürücüler",
    permission: "suruculer:import",
    columns: [
      { key: "fullName", label: "Ad Soyad", required: true, type: "text" },
      { key: "company", label: "Firma", required: false, type: "text" },
      { key: "phone", label: "Telefon", required: false, type: "text" },
      { key: "licenseClass", label: "Ehliyet Sınıfı", required: false, type: "text" },
      { key: "licenseExpiry", label: "Ehliyet Bitiş", required: false, type: "date" },
    ],
    insert: async (tx, tenantId, values) => {
      const companyId = await resolveCompany(tx, tenantId, values.company);
      const rows = await tx
        .insert(drivers)
        .values({
          tenantId,
          companyId,
          fullName: values.fullName!,
          phone: values.phone || null,
          licenseClass: values.licenseClass || null,
          licenseExpiry: values.licenseExpiry || null,
        })
        .returning({ id: drivers.id });
      return rows[0]!.id;
    },
    remove: async (tx, tenantId, id) => {
      await tx.delete(drivers).where(and(eq(drivers.tenantId, tenantId), eq(drivers.id, id)));
    },
  });
}

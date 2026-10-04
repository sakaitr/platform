import { and, asc, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { companies, drivers, transferPassengers, transfers, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export type TransferFilter = { status?: string; q?: string; scope: string[] | null };

export async function listTransfers(tenantId: string, f: TransferFilter) {
  const parts: SQL[] = [eq(transfers.tenantId, tenantId)];
  if (f.scope !== null) {
    parts.push(
      f.scope.length > 0
        ? or(inArray(transfers.companyId, f.scope), isNull(transfers.companyId))!
        : isNull(transfers.companyId),
    );
  }
  if (f.status) parts.push(eq(transfers.status, f.status as "istek"));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: transfers.id,
        title: transfers.title,
        status: transfers.status,
        transferDate: transfers.transferDate,
        transferTime: transfers.transferTime,
        pickupLocation: transfers.pickupLocation,
        dropoffLocation: transfers.dropoffLocation,
        passengerCount: transfers.passengerCount,
        price: transfers.price,
        companyName: companies.name,
        plate: vehicles.plate,
        driverName: drivers.fullName,
      })
      .from(transfers)
      .leftJoin(companies, eq(companies.id, transfers.companyId))
      .leftJoin(vehicles, eq(vehicles.id, transfers.vehicleId))
      .leftJoin(drivers, eq(drivers.id, transfers.driverId))
      .where(and(...parts))
      .orderBy(desc(transfers.transferDate), desc(transfers.createdAt)),
  );
}

export async function getTransfer(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(transfers).where(and(eq(transfers.tenantId, tenantId), eq(transfers.id, id))),
  );
  return rows[0] ?? null;
}

export async function listTransferPassengers(tenantId: string, transferId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(transferPassengers)
      .where(
        and(eq(transferPassengers.tenantId, tenantId), eq(transferPassengers.transferId, transferId)),
      )
      .orderBy(asc(transferPassengers.name)),
  );
}

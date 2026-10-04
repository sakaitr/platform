import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  entityFields,
  numberingSequences,
  rolePermissions,
  roles,
  subscriptions,
  tenantCapabilities,
  tenantModules,
  tenants,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { SECTOR_PACKS, type SectorPack } from "./packs";

export { SECTOR_PACKS };
export type { SectorPack };

export function getPack(packKey: string): SectorPack {
  const pack = SECTOR_PACKS[packKey];
  if (!pack) throw new Error(`Unknown sector pack: ${packKey}`);
  return pack;
}

/**
 * Sektör paketini kiracıya uygular. Idempotent — tekrar çağrılabilir,
 * mevcut kayıtları çoğaltmaz (paket sürümü yükseltmede de kullanılır).
 * Provizyon kritik yolu olduğu için dbAdmin (RLS baypas) kullanır.
 */
export async function applySectorPack(tenantId: string, packKey: string): Promise<void> {
  const pack = getPack(packKey);

  for (const moduleKey of pack.modules) {
    const existing = await dbAdmin
      .select({ id: tenantModules.id })
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, moduleKey)))
      .limit(1);
    if (existing.length === 0) {
      await dbAdmin.insert(tenantModules).values({ tenantId, moduleKey, status: "active" });
    }
  }

  for (const capabilityKey of pack.capabilities) {
    const existing = await dbAdmin
      .select({ id: tenantCapabilities.id })
      .from(tenantCapabilities)
      .where(
        and(
          eq(tenantCapabilities.tenantId, tenantId),
          eq(tenantCapabilities.capabilityKey, capabilityKey),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      await dbAdmin.insert(tenantCapabilities).values({ tenantId, capabilityKey, enabled: true });
    }
  }

  for (const field of pack.entityFields) {
    const existing = await dbAdmin
      .select({ id: entityFields.id })
      .from(entityFields)
      .where(
        and(
          eq(entityFields.tenantId, tenantId),
          eq(entityFields.entityKey, field.entityKey),
          eq(entityFields.fieldKey, field.fieldKey),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      await dbAdmin.insert(entityFields).values({
        tenantId,
        entityKey: field.entityKey,
        fieldKey: field.fieldKey,
        label: field.label,
        type: field.type,
        options: field.options ?? [],
        required: field.required ?? false,
        position: field.position,
      });
    }
  }

  for (const seq of pack.numbering) {
    const existing = await dbAdmin
      .select({ id: numberingSequences.id })
      .from(numberingSequences)
      .where(
        and(
          eq(numberingSequences.tenantId, tenantId),
          eq(numberingSequences.sequenceKey, seq.sequenceKey),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      await dbAdmin.insert(numberingSequences).values({
        tenantId,
        sequenceKey: seq.sequenceKey,
        prefix: seq.prefix,
        padding: seq.padding,
        periodReset: seq.periodReset,
      });
    }
  }

  for (const packRole of pack.roles) {
    const existing = await dbAdmin
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, packRole.key)))
      .limit(1);

    if (existing.length === 0) {
      const [created] = await dbAdmin
        .insert(roles)
        .values({
          tenantId,
          key: packRole.key,
          label: packRole.label,
          hierarchyLevel: packRole.hierarchyLevel,
          isSystem: packRole.isSystem ?? false,
        })
        .returning({ id: roles.id });

      if (packRole.permissions.length > 0) {
        await dbAdmin.insert(rolePermissions).values(
          packRole.permissions.map((permissionKey) => ({
            tenantId,
            roleId: created!.id,
            permissionKey,
          })),
        );
      }
    }
  }

  await dbAdmin
    .update(tenants)
    .set({ sectorPack: pack.key, sectorPackVersion: pack.version, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
}

export type ProvisionInput = {
  name: string;
  slug: string;
  sectorPack: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
  trialDays?: number;
};

/**
 * Yeni kiracıyı uçtan uca kurar: kiracı + owner kullanıcı + abonelik + sektör paketi.
 * Provizyon çekirdek yetenektir — elle script'le yapılmaz, hep buradan geçer.
 */
export async function provisionTenant(
  input: ProvisionInput,
): Promise<{ tenantId: string; userId: string }> {
  const pack = getPack(input.sectorPack);
  const trialDays = input.trialDays ?? 14;

  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({
      name: input.name,
      slug: input.slug,
      sectorPack: pack.key,
      sectorPackVersion: pack.version,
    })
    .returning({ id: tenants.id });

  const tenantId = tenant!.id;

  await dbAdmin.insert(subscriptions).values({
    tenantId,
    status: "trial",
    trialEndsAt: new Date(Date.now() + trialDays * 86_400_000),
  });

  const [user] = await dbAdmin
    .insert(users)
    .values({
      tenantId,
      email: input.ownerEmail,
      name: input.ownerName,
      passwordHash: await hashPassword(input.ownerPassword),
      role: "owner",
    })
    .returning({ id: users.id });

  await applySectorPack(tenantId, pack.key);

  // Owner kullanıcıyı "owner" rolüne bağla — paket kurulduktan SONRA
  const [ownerRole] = await dbAdmin
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, "owner")))
    .limit(1);

  if (ownerRole) {
    await dbAdmin.update(users).set({ roleId: ownerRole.id }).where(eq(users.id, user!.id));
  }

  return { tenantId, userId: user!.id };
}

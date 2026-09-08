import "dotenv/config";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  companies,
  companyShifts,
  drivers,
  passengers,
  routeAssignments,
  routes,
  tenants,
  vehicleArrivals,
  vehicles,
} from "@/db/schema";
import { istanbulDayKey, shiftDay } from "@/lib/time";

/**
 * Demo verisi — satış görüşmelerinde boş ekran göstermemek için.
 * Idempotent değil: yalnız firması olmayan kiracıya basar.
 */
const SLUG = process.argv[2] ?? "demo-lojistik";

const FIRMALAR = ["Dilovası Plastik", "Gebze Metal", "Çayırova Tekstil"];

const ARAC = [
  { plate: "34ABC101", brand: "Mercedes", model: "Sprinter", capacity: 16 },
  { plate: "34ABC102", brand: "Mercedes", model: "Sprinter", capacity: 16 },
  { plate: "34DEF203", brand: "Ford", model: "Transit", capacity: 14 },
  { plate: "41GHJ304", brand: "Otokar", model: "Sultan", capacity: 27 },
  { plate: "41GHJ305", brand: "Otokar", model: "Sultan", capacity: 27 },
  { plate: "41KLM406", brand: "Isuzu", model: "Novo", capacity: 31 },
];

const SOFOR = ["Ahmet Yılmaz", "Mehmet Demir", "Hasan Kaya", "Mustafa Çelik", "Ali Şahin", "Osman Aydın"];

async function main(): Promise<void> {
  const [tenant] = await dbAdmin.select().from(tenants).where(eq(tenants.slug, SLUG));
  if (!tenant) throw new Error(`Kiracı bulunamadı: ${SLUG}`);
  const tenantId = tenant.id;

  const mevcut = await dbAdmin.select({ id: companies.id }).from(companies).where(eq(companies.tenantId, tenantId));
  if (mevcut.length > 0) {
    console.log(`${SLUG} zaten ${mevcut.length} firmaya sahip; dokunulmadı.`);
    process.exit(0);
  }

  const firmalar = await dbAdmin
    .insert(companies)
    .values(
      FIRMALAR.map((name, i) => ({
        tenantId,
        name,
        code: `F${100 + i}`,
        phone: `0262 ${300 + i} 00 0${i}`,
        taxNumber: `${1234567890 + i}`,
      })),
    )
    .returning();

  // Vardiyalar: her firmada sabah ve akşam
  await dbAdmin.insert(companyShifts).values(
    firmalar.flatMap((f) => [
      { tenantId, companyId: f.id, name: "sabah", expectedAt: "08:00", toleranceLate: 10 },
      { tenantId, companyId: f.id, name: "akşam", expectedAt: "17:30", toleranceLate: 15 },
    ]),
  );

  const araclar = await dbAdmin
    .insert(vehicles)
    .values(
      ARAC.map((a, i) => ({
        tenantId,
        companyId: firmalar[i % firmalar.length]!.id,
        ...a,
        modelYear: 2019 + (i % 5),
        vehicleType: a.capacity > 20 ? "otobüs" : "minibüs",
        sortOrder: i,
      })),
    )
    .returning();

  const soforler = await dbAdmin
    .insert(drivers)
    .values(
      SOFOR.map((fullName, i) => ({
        tenantId,
        companyId: firmalar[i % firmalar.length]!.id,
        fullName,
        phone: `053${i} 111 22 3${i}`,
        licenseClass: i % 2 === 0 ? "D" : "E",
        licenseExpiry: `202${7 + (i % 2)}-0${1 + (i % 9)}-15`,
      })),
    )
    .returning();

  const guzergahlar = await dbAdmin
    .insert(routes)
    .values(
      firmalar.map((f, i) => ({
        tenantId,
        companyId: f.id,
        name: `${f.name} Servis Hattı ${i + 1}`,
        code: `H${i + 1}`,
        shiftName: "sabah",
        capacity: 27,
        morningArrival: "08:00",
        eveningDeparture: "17:30",
      })),
    )
    .returning();

  const bugun = istanbulDayKey();
  await dbAdmin.insert(routeAssignments).values(
    guzergahlar.map((g, i) => ({
      tenantId,
      routeId: g.id,
      vehicleId: araclar[i]!.id,
      driverId: soforler[i]!.id,
      startsOn: shiftDay(bugun, -30),
    })),
  );

  await dbAdmin.insert(passengers).values(
    Array.from({ length: 24 }, (_, i) => ({
      tenantId,
      companyId: firmalar[i % firmalar.length]!.id,
      fullName: `Personel ${i + 1}`,
      phone: `054${i % 10} 222 33 ${10 + i}`,
      type: "personel" as const,
      pickupAddress: `Örnek Mah. ${i + 1}. Sokak No:${i + 3}`,
      pickupLat: String(40.83 + (i % 8) * 0.012),
      pickupLng: String(29.36 + (i % 6) * 0.015),
    })),
  );

  // Son üç günün gelişleri: bazıları zamanında, bazıları gecikmeli
  const gelisler = [];
  for (let gun = 1; gun <= 3; gun += 1) {
    const tarih = shiftDay(bugun, -gun);
    for (const [i, arac] of araclar.entries()) {
      if ((i + gun) % 5 === 0) continue; // birkaç araç o gün gelmemiş
      const gecikme = (i * 7 + gun * 3) % 25;
      const dakika = 55 + gecikme;
      gelisler.push({
        tenantId,
        companyId: arac.companyId,
        vehicleId: arac.id,
        arrivalDate: tarih,
        shift: "sabah",
        arrivedAt: `0${7 + Math.floor(dakika / 60)}:${String(dakika % 60).padStart(2, "0")}`,
        plannedAt: "08:00",
        expectedPassengers: arac.capacity,
        actualPassengers: arac.capacity! - (i % 4),
      });
    }
  }
  await dbAdmin.insert(vehicleArrivals).values(gelisler);

  console.log(
    `${SLUG}: ${firmalar.length} firma, ${araclar.length} araç, ${soforler.length} sürücü, ` +
      `${guzergahlar.length} güzergah, 24 yolcu, ${gelisler.length} geliş kaydı.`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

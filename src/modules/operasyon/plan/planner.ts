/**
 * Rota planlama motoru.
 *
 * aycanops'taki sürüm mesafe matrisi için OSRM'nin halka açık sunucusuna
 * bağlıydı; o servis kapanırsa planlama tümden durur. Burada mesafe
 * haversine ile yerelde hesaplanıyor: dış servis yok, deterministik,
 * test edilebilir. Yol mesafesi gerektiğinde matris dışarıdan verilebilir.
 *
 * Akış: kapasiteye göre kümeleme → en yakın komşu → 2-opt iyileştirme.
 */

export type PlanPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export type PlanVehicle = {
  id: string;
  label: string;
  capacity: number;
};

export type PlanInput = {
  /** Toplama noktası (fabrika/okul) — tüm rotalar burada biter. */
  depot: { lat: number; lng: number };
  passengers: readonly PlanPoint[];
  vehicles: readonly PlanVehicle[];
};

export type PlannedStop = PlanPoint & { order: number };

export type PlannedRoute = {
  vehicleId: string;
  vehicleLabel: string;
  stops: PlannedStop[];
  /** Metre. */
  distance: number;
};

export type PlanResult = {
  routes: PlannedRoute[];
  /** Kapasite yetmediği için yerleştirilemeyenler. */
  unassigned: PlanPoint[];
  totalDistance: number;
};

const EARTH_RADIUS_M = 6_371_000;

/** İki nokta arası kuş uçuşu mesafe (metre). */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/** Rotanın toplam uzunluğu: ilk duraktan başlayıp depoda biter. */
export function routeDistance(
  depot: { lat: number; lng: number },
  stops: readonly PlanPoint[],
): number {
  if (stops.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < stops.length - 1; i += 1) {
    total += haversineMeters(stops[i]!, stops[i + 1]!);
  }
  return total + haversineMeters(stops[stops.length - 1]!, depot);
}

/**
 * Kapasiteye göre kümeleme: her araç, depoya en uzak yolcudan başlayıp
 * ona en yakın olanları toplar. Uzaktan başlamak, uzak yolcuların
 * son araca artık kalmasını önler.
 */
function cluster(
  depot: { lat: number; lng: number },
  passengers: readonly PlanPoint[],
  vehicles: readonly PlanVehicle[],
): { groups: PlanPoint[][]; unassigned: PlanPoint[] } {
  const remaining = [...passengers].sort(
    (a, b) => haversineMeters(depot, b) - haversineMeters(depot, a),
  );
  const groups: PlanPoint[][] = vehicles.map(() => []);

  for (let v = 0; v < vehicles.length && remaining.length > 0; v += 1) {
    const capacity = Math.max(0, vehicles[v]!.capacity);
    if (capacity === 0) continue;

    const seed = remaining.shift()!;
    const group = [seed];

    while (group.length < capacity && remaining.length > 0) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < remaining.length; i += 1) {
        const d = haversineMeters(group[group.length - 1]!, remaining[i]!);
        if (d < bestDistance) {
          bestDistance = d;
          bestIndex = i;
        }
      }
      group.push(remaining.splice(bestIndex, 1)[0]!);
    }
    groups[v] = group;
  }

  return { groups, unassigned: remaining };
}

/** En yakın komşu: en uzaktaki yolcudan başlar, hep en yakına gider. */
function nearestNeighbour(depot: { lat: number; lng: number }, points: readonly PlanPoint[]): PlanPoint[] {
  if (points.length <= 1) return [...points];

  const pool = [...points];
  let currentIndex = 0;
  let farthest = -1;
  for (let i = 0; i < pool.length; i += 1) {
    const d = haversineMeters(depot, pool[i]!);
    if (d > farthest) {
      farthest = d;
      currentIndex = i;
    }
  }

  const ordered = [pool.splice(currentIndex, 1)[0]!];
  while (pool.length > 0) {
    const last = ordered[ordered.length - 1]!;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pool.length; i += 1) {
      const d = haversineMeters(last, pool[i]!);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    ordered.push(pool.splice(bestIndex, 1)[0]!);
  }
  return ordered;
}

/**
 * 2-opt: kesişen iki kenarı ters çevirerek rotayı kısaltır.
 * U dönüşlerini ve çapraz geçişleri temizler.
 */
export function twoOpt(
  depot: { lat: number; lng: number },
  route: readonly PlanPoint[],
): PlanPoint[] {
  if (route.length < 4) return [...route];

  let best = [...route];
  let bestDistance = routeDistance(depot, best);
  let improved = true;

  // Küçük rotalarda bile sonlanmayı garanti etmek için tur sınırı.
  let guard = 0;
  while (improved && guard < 50) {
    improved = false;
    guard += 1;

    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ];
        const distance = routeDistance(depot, candidate);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
          improved = true;
        }
      }
    }
  }
  return best;
}

export function planRoutes(input: PlanInput): PlanResult {
  const usable = input.vehicles.filter((v) => v.capacity > 0);
  if (usable.length === 0 || input.passengers.length === 0) {
    return { routes: [], unassigned: [...input.passengers], totalDistance: 0 };
  }

  const { groups, unassigned } = cluster(input.depot, input.passengers, usable);

  const routes: PlannedRoute[] = [];
  let totalDistance = 0;

  for (let i = 0; i < usable.length; i += 1) {
    const group = groups[i] ?? [];
    if (group.length === 0) continue;

    const ordered = twoOpt(input.depot, nearestNeighbour(input.depot, group));
    const distance = routeDistance(input.depot, ordered);
    totalDistance += distance;

    routes.push({
      vehicleId: usable[i]!.id,
      vehicleLabel: usable[i]!.label,
      stops: ordered.map((stop, index) => ({ ...stop, order: index + 1 })),
      distance,
    });
  }

  return { routes, unassigned, totalDistance };
}

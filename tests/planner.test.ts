import { describe, expect, it } from "vitest";
import {
  haversineMeters,
  planRoutes,
  routeDistance,
  twoOpt,
  type PlanPoint,
} from "@/modules/operasyon/plan/planner";

const DEPOT = { lat: 40.8, lng: 29.4 }; // Gebze civarı

function point(id: string, lat: number, lng: number): PlanPoint {
  return { id, name: id, lat, lng };
}

describe("haversine", () => {
  it("aynı nokta sıfır mesafe", () => {
    expect(haversineMeters(DEPOT, DEPOT)).toBe(0);
  });

  it("bilinen mesafeyi makul hesaplar", () => {
    // İstanbul (41.0082, 28.9784) – Ankara (39.9334, 32.8597): ~350 km
    const d = haversineMeters({ lat: 41.0082, lng: 28.9784 }, { lat: 39.9334, lng: 32.8597 });
    expect(d).toBeGreaterThan(340_000);
    expect(d).toBeLessThan(360_000);
  });

  it("simetriktir", () => {
    const a = { lat: 40.8, lng: 29.4 };
    const b = { lat: 41.0, lng: 29.0 };
    expect(haversineMeters(a, b)).toBe(haversineMeters(b, a));
  });
});

describe("2-opt", () => {
  it("kesişen rotayı kısaltır", () => {
    // Bilinçli olarak çapraz sıralanmış dört nokta
    const crossed = [
      point("a", 40.90, 29.40),
      point("c", 40.92, 29.44),
      point("b", 40.90, 29.44),
      point("d", 40.92, 29.40),
    ];
    const before = routeDistance(DEPOT, crossed);
    const after = routeDistance(DEPOT, twoOpt(DEPOT, crossed));
    expect(after).toBeLessThan(before);
  });

  it("üç ve altı noktada dokunmaz", () => {
    const three = [point("a", 40.9, 29.4), point("b", 40.91, 29.41), point("c", 40.92, 29.42)];
    expect(twoOpt(DEPOT, three).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("hiçbir durağı kaybetmez", () => {
    const stops = Array.from({ length: 8 }, (_, i) =>
      point(`p${i}`, 40.9 + i * 0.01, 29.4 + ((i * 7) % 5) * 0.01),
    );
    const result = twoOpt(DEPOT, stops);
    expect(result).toHaveLength(8);
    expect(new Set(result.map((s) => s.id)).size).toBe(8);
  });
});

describe("planRoutes", () => {
  const passengers = Array.from({ length: 10 }, (_, i) =>
    point(`p${i}`, 40.85 + i * 0.01, 29.35 + (i % 3) * 0.02),
  );

  it("kapasiteyi aşmaz", () => {
    const result = planRoutes({
      depot: DEPOT,
      passengers,
      vehicles: [
        { id: "v1", label: "34ABC01", capacity: 4 },
        { id: "v2", label: "34XYZ02", capacity: 4 },
      ],
    });
    for (const route of result.routes) expect(route.stops.length).toBeLessThanOrEqual(4);
  });

  it("kapasite yetmezse kalanları yerleştirilmemiş olarak döner", () => {
    const result = planRoutes({
      depot: DEPOT,
      passengers,
      vehicles: [{ id: "v1", label: "34ABC01", capacity: 3 }],
    });
    expect(result.routes[0]!.stops).toHaveLength(3);
    expect(result.unassigned).toHaveLength(7);
  });

  it("kapasite yeterliyse herkes yerleşir", () => {
    const result = planRoutes({
      depot: DEPOT,
      passengers,
      vehicles: [
        { id: "v1", label: "A", capacity: 6 },
        { id: "v2", label: "B", capacity: 6 },
      ],
    });
    const placed = result.routes.reduce((sum, r) => sum + r.stops.length, 0);
    expect(placed).toBe(10);
    expect(result.unassigned).toHaveLength(0);
  });

  it("hiçbir yolcu iki rotada birden olmaz", () => {
    const result = planRoutes({
      depot: DEPOT,
      passengers,
      vehicles: [
        { id: "v1", label: "A", capacity: 5 },
        { id: "v2", label: "B", capacity: 5 },
      ],
    });
    const ids = result.routes.flatMap((r) => r.stops.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("durak sırası 1'den başlar ve artar", () => {
    const result = planRoutes({
      depot: DEPOT,
      passengers,
      vehicles: [{ id: "v1", label: "A", capacity: 10 }],
    });
    expect(result.routes[0]!.stops.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("araç yoksa herkes yerleştirilmemiş kalır", () => {
    const result = planRoutes({ depot: DEPOT, passengers, vehicles: [] });
    expect(result.routes).toHaveLength(0);
    expect(result.unassigned).toHaveLength(10);
  });

  it("kapasitesi sıfır olan araç kullanılmaz", () => {
    const result = planRoutes({
      depot: DEPOT,
      passengers: passengers.slice(0, 3),
      vehicles: [
        { id: "v0", label: "Bozuk", capacity: 0 },
        { id: "v1", label: "A", capacity: 5 },
      ],
    });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]!.vehicleId).toBe("v1");
  });

  it("toplam mesafe rotaların toplamına eşittir", () => {
    const result = planRoutes({
      depot: DEPOT,
      passengers,
      vehicles: [
        { id: "v1", label: "A", capacity: 5 },
        { id: "v2", label: "B", capacity: 5 },
      ],
    });
    const sum = result.routes.reduce((acc, r) => acc + r.distance, 0);
    expect(result.totalDistance).toBe(sum);
  });

  it("yolcu yoksa boş plan döner", () => {
    const result = planRoutes({
      depot: DEPOT,
      passengers: [],
      vehicles: [{ id: "v1", label: "A", capacity: 5 }],
    });
    expect(result.routes).toHaveLength(0);
    expect(result.totalDistance).toBe(0);
  });
});

import type { ReactNode } from "react";

export type MapPoint = {
  lat: number;
  lng: number;
  label: string;
  group: string;
  order: number;
};

const PALETTE = ["#0f766e", "#b45309", "#7c3aed", "#be123c", "#1d4ed8", "#4d7c0f"];

/**
 * Durakları koordinat düzleminde çizer.
 *
 * Dış harita servisi kullanmıyoruz: kiracının verisi üçüncü tarafa gitmiyor,
 * çevrimdışı çalışıyor ve testte kararlı. Gerçek harita gerektiğinde
 * her durak Google Maps bağlantısıyla açılabiliyor.
 */
export function StopMap({ points }: { points: readonly MapPoint[] }): ReactNode {
  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
        Haritada gösterilecek durak yok. Aktif bir rota planı gerekiyor.
      </div>
    );
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // Tek noktada bölme hatası olmasın diye taban aralık.
  const spanLat = Math.max(maxLat - minLat, 0.005);
  const spanLng = Math.max(maxLng - minLng, 0.005);
  const width = 800;
  const height = 520;
  const pad = 40;

  const x = (lng: number): number => pad + ((lng - minLng) / spanLng) * (width - pad * 2);
  // Enlem yukarı artar, SVG y aşağı artar.
  const y = (lat: number): number => height - pad - ((lat - minLat) / spanLat) * (height - pad * 2);

  const groups = [...new Set(points.map((p) => p.group))];
  const colorOf = (group: string): string => PALETTE[groups.indexOf(group) % PALETTE.length]!;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs">
        {groups.map((group) => (
          <span key={group} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colorOf(group) }}
            />
            {group}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[640px]">
          {groups.map((group) => {
            const line = points
              .filter((p) => p.group === group)
              .sort((a, b) => a.order - b.order);
            if (line.length < 2) return null;
            return (
              <polyline
                key={group}
                fill="none"
                stroke={colorOf(group)}
                strokeWidth={2}
                strokeOpacity={0.5}
                points={line.map((p) => `${x(p.lng)},${y(p.lat)}`).join(" ")}
              />
            );
          })}

          {points.map((p, i) => (
            <g key={`${p.group}-${p.order}-${i}`}>
              <circle cx={x(p.lng)} cy={y(p.lat)} r={7} fill={colorOf(p.group)} />
              <text
                x={x(p.lng)}
                y={y(p.lat) + 3.5}
                textAnchor="middle"
                fontSize={9}
                fill="#fff"
                fontWeight="600"
              >
                {p.order}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

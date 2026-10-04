import Link from "next/link";
import type { ReactNode } from "react";

/** Sayfa başlığı + açıklama + sağ üstte eylem alanı. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="text-sm text-neutral-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-neutral-200 bg-white ${className}`}>{children}</div>
  );
}

/** Yatay kaydırılabilir tablo — dar ekranda sayfa gövdesi kaymasın. */
export function Table({ head, children }: { head: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-max text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-4 py-2.5 ${className}`}>{children}</td>;
}

export function EmptyRow({ colSpan, text = "Kayıt yok." }: { colSpan: number; text?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-neutral-500">
        {text}
      </td>
    </tr>
  );
}

const TONE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
  mute: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function Badge({
  children,
  tone = "mute",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE | string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${TONE[tone] ?? TONE.mute}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-neutral-400">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-900";

export function Button({
  children,
  variant = "primary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-neutral-900 text-white hover:bg-neutral-800",
    ghost: "border border-neutral-300 hover:bg-neutral-50",
    danger: "border border-red-200 text-red-600 hover:bg-red-50",
  }[variant];
  return (
    <button
      {...rest}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${styles} ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

/** Sunucu tarafı filtre çubuğu — GET formu, durum URL'de kalır. */
export function FilterBar({ action, children }: { action: string; children: ReactNode }) {
  return (
    <form
      action={action}
      method="get"
      className="flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-white p-3"
    >
      {children}
      <Button type="submit" variant="ghost">
        Filtrele
      </Button>
    </form>
  );
}

export function Pagination({
  basePath,
  page,
  pageCount,
  query,
}: {
  basePath: string;
  page: number;
  pageCount: number;
  query: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;
  const href = (p: number): string => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
    params.set("sayfa", String(p));
    return `${basePath}?${params.toString()}`;
  };
  return (
    <div className="flex items-center justify-between text-xs text-neutral-600">
      <span>
        Sayfa {page} / {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="rounded-lg border border-neutral-300 px-3 py-1.5">
            Önceki
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link href={href(page + 1)} className="rounded-lg border border-neutral-300 px-3 py-1.5">
            Sonraki
          </Link>
        ) : null}
      </div>
    </div>
  );
}

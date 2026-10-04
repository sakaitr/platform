export function GraceBanner({ periodEnd }: { periodEnd: Date | null }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
      Aboneliğinizin dönemi
      {periodEnd ? ` ${periodEnd.toLocaleDateString("tr-TR")} tarihinde ` : " "}
      sona erdi. Ödemeniz işlenene kadar erişiminiz kısa süre daha açık kalacak.
    </div>
  );
}

import { Card } from "@/components/ui";
import { portalLogoutAction } from "../actions";

export default function ErisimYokPage() {
  return (
    <Card className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold">Hesabınız henüz bir firmaya bağlı değil</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Erişim tanımlanana kadar veri göremezsiniz. Yetkilinizle görüşün.
      </p>
      <form action={portalLogoutAction} className="mt-4">
        <button type="submit" className="text-sm text-neutral-600 underline">
          Çıkış yap
        </button>
      </form>
    </Card>
  );
}

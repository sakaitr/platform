"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { revertTripLogAction } from "@/modules/operasyon/cetele/actions";

/** Onayı geri alma nedeni zorunlu — sebebsiz geri alma izi bozar. */
export function RevertForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Onayı Geri Al
      </Button>
    );
  }

  return (
    <form action={revertTripLogAction} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input
        name="reason"
        required
        minLength={3}
        placeholder="Geri alma nedeni"
        className="w-40 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
      />
      <Button type="submit" variant="danger">
        Onayla
      </Button>
    </form>
  );
}

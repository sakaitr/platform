"use client";

import { useActionState, useTransition, type FormEvent } from "react";

/**
 * Sunucu eylemini `<form action>` yerine `onSubmit` ile çağırır.
 *
 * React 19, `<form action={...}>` tamamlanınca eylem hata dönse bile kontrolsüz (defaultValue'lu)
 * alanları sıfırlar: doğrulama hatasında kullanıcının yazdığı her şey silinir. `onSubmit` +
 * `preventDefault` bu otomatik sıfırlamayı atlar; alanlar hatada korunur, başarıda çağıran
 * isterse kendisi sıfırlar. Bedeli: bu formlar JavaScript yüklenmeden gönderilemez.
 */
export function useFormAction<S>(
  action: (state: S, formData: FormData) => Promise<S>,
  initial: S,
): { state: Awaited<S>; pending: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void } {
  const [state, dispatch, pending] = useActionState<S, FormData>(
    action as (state: Awaited<S>, formData: FormData) => Promise<S>,
    initial as Awaited<S>,
  );
  const [, startTransition] = useTransition();

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => {
      dispatch(data);
    });
  };

  return { state, pending, onSubmit };
}

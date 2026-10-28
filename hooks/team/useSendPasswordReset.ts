"use client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";

/**
 * Manda a um membro o link para ele definir uma nova senha
 * (`POST /api/v1/team/[user_id]/password-reset`). Não mexe na lista: nada nela
 * muda — a senha atual vale até a pessoa abrir o link.
 */
export function useSendPasswordReset() {
  const t = useT();
  return useMutation({
    mutationFn: async (userId: string) =>
      apiClient.post<{ data: { user_id: string; sent: true } }>(
        `/api/v1/team/${userId}/password-reset`,
        {},
      ),
    onError: (err) => showApiError(err),
    onSuccess: () => {
      toast.success(t("Link enviado."), {
        description: t("A pessoa recebe por e-mail o link para escolher uma nova senha."),
      });
    },
  });
}

"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface MembroDoTenant {
  user_id: string;
  email: string | null;
  role: string;
  accepted_at: string | null;
  revoked_at: string | null;
  last_sign_in_at: string | null;
  is_platform_admin: boolean;
  is_owner: boolean;
}

/** Membros de um tenant com o e-mail de login (`GET /api/v1/admin/tenants/[id]/members`). */
export function useTenantMembers(id: string) {
  return useQuery({
    queryKey: ["admin", "tenant", id, "members"] as const,
    queryFn: () =>
      apiClient.get<{ data: { members: MembroDoTenant[] } }>(`/api/v1/admin/tenants/${id}/members`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useChangeMemberEmail(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, email }: { userId: string; email: string }) =>
      apiClient.patch(`/api/v1/admin/tenants/${tenantId}/members/${userId}/email`, { email }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", tenantId, "members"] });
    },
  });
}

/** O admin da plataforma define a senha de um membro (emergência). */
export function useSetMemberPassword(tenantId: string) {
  return useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      apiClient.patch<{ data: { user_id: string; aviso_ao_dono: string } }>(
        `/api/v1/admin/tenants/${tenantId}/members/${userId}/password`,
        { password },
      ),
  });
}

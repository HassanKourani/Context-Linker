import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchAuthStatus,
  authSignInPassword,
  authSignUp,
  authSendCode,
  authVerifyCode,
  authSignOut,
  type AuthStatus,
} from "@/lib/api";

export function useAuthStatus() {
  return useQuery<AuthStatus>({
    queryKey: ["auth", "status"],
    queryFn: fetchAuthStatus,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

function invalidateAuthAndData(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["auth", "status"] });
  qc.invalidateQueries({ queryKey: ["teams"] });
  qc.invalidateQueries({ queryKey: ["graph"] });
}

export function useSignInPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authSignInPassword,
    onSuccess: () => invalidateAuthAndData(qc),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSignUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authSignUp,
    onSuccess: (data) => {
      if (data.requires_email_confirmation) {
        toast.success("Account created. Check your email to confirm.");
      } else {
        invalidateAuthAndData(qc);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSendCode() {
  return useMutation({
    mutationFn: authSendCode,
    onSuccess: (_d, vars) => toast.success(`Code sent to ${vars.email}`),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useVerifyCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authVerifyCode,
    onSuccess: () => invalidateAuthAndData(qc),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authSignOut,
    onSuccess: () => {
      invalidateAuthAndData(qc);
      toast.success("Signed out");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

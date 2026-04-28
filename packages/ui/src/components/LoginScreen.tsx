import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSignInPassword, useSignUp } from "@/hooks/useAuth";
import { useUIStore } from "@/stores/uiStore";

type Mode = "signin" | "signup";

export function LoginScreen() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === "signin";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signIn = useSignInPassword();
  const signUp = useSignUp();

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    signIn.mutate({ email, password }, { onSuccess: () => closeModal() });
  };

  const submitSignup = (e: React.FormEvent) => {
    e.preventDefault();
    signUp.mutate(
      { email, password },
      {
        onSuccess: (data) => {
          // If signup completes immediately (no email confirmation), close.
          // Otherwise leave the dialog open with the toast message.
          if (!data.requires_email_confirmation) closeModal();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            Required for cloud bundles, teams, and cross-machine sharing. Local
            bundles work without signing in.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-2 flex gap-1 text-xs">
          <Button
            size="sm"
            variant={mode === "signin" ? "default" : "ghost"}
            onClick={() => setMode("signin")}
          >
            Sign in
          </Button>
          <Button
            size="sm"
            variant={mode === "signup" ? "default" : "ghost"}
            onClick={() => setMode("signup")}
          >
            Sign up
          </Button>
        </div>

        {mode === "signin" && (
          <form onSubmit={submitPassword} className="space-y-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button
              type="submit"
              className="w-full"
              disabled={signIn.isPending}
            >
              {signIn.isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        )}

        {mode === "signup" && (
          <form onSubmit={submitSignup} className="space-y-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <Input
              type="password"
              placeholder="Password (min 6 chars)"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button
              type="submit"
              className="w-full"
              disabled={signUp.isPending}
            >
              {signUp.isPending ? "Creating..." : "Create account"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

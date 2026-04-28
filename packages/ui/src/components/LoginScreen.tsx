import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSignInPassword, useSignUp } from "@/hooks/useAuth";

type Mode = "signin" | "signup";

export function LoginScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signIn = useSignInPassword();
  const signUp = useSignUp();

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    signIn.mutate({ email, password });
  };

  const submitSignup = (e: React.FormEvent) => {
    e.preventDefault();
    signUp.mutate({ email, password });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <h1 className="mb-1 text-lg font-bold">ctx-link</h1>
        <p className="mb-6 text-xs text-muted-foreground">
          Sign in to access cloud bundles and teams.
        </p>

        <div className="mb-4 flex gap-1 text-xs">
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
            <Button type="submit" className="w-full" disabled={signIn.isPending}>
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
            <Button type="submit" className="w-full" disabled={signUp.isPending}>
              {signUp.isPending ? "Creating..." : "Create account"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

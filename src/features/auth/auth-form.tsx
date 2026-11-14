"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { signIn, signUp } from "@/client/auth-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Mode = "login" | "signup";

const TEXT: Record<
  Mode,
  { title: string; submit: string; switchText: string; switchHref: string; switchLink: string }
> = {
  login: {
    title: "Sign in",
    submit: "Sign in",
    switchText: "No account?",
    switchHref: "/signup",
    switchLink: "Create one",
  },
  signup: {
    title: "Create account",
    submit: "Create account",
    switchText: "Already have an account?",
    switchHref: "/login",
    switchLink: "Sign in",
  },
};

/** Where to go after signing in: the `next` query param if it is a local path, else home. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function AuthForm({ mode }: { mode: Mode }) {
  const text = TEXT[mode];
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const login = String(form.get("login") ?? "").trim();
    const password = String(form.get("password") ?? "");

    setPending(true);
    setError(null);
    try {
      await (mode === "login" ? signIn(login, password) : signUp(login, password));
      // Full navigation so the page guard sees the new session cookie.
      window.location.assign(nextPath());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPending(false);
    }
  }

  const inputClass =
    "w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Login
            <input
              name="login"
              required
              minLength={3}
              maxLength={30}
              autoComplete="username"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={inputClass}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {pending ? "…" : text.submit}
          </button>
          <p className="text-center text-sm text-muted-foreground">
            {text.switchText}{" "}
            <Link href={text.switchHref} className="underline">
              {text.switchLink}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

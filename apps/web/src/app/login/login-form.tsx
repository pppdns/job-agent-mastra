"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type LoginState, loginAction } from "./actions";

function NextField() {
  return <input type="hidden" name="next" value={useSearchParams().get("next") ?? "/"} />;
}

export function LoginForm({ withNext = false }: { withNext?: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Job Research Copilot</CardTitle>
        <CardDescription>Enter your password to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          {/* Fixed username so password managers save and fill this login (visually hidden,
              not `hidden`: some managers skip display:none fields). */}
          <input
            type="text"
            name="username"
            value="copilot"
            autoComplete="username"
            readOnly
            tabIndex={-1}
            aria-hidden
            className="sr-only"
          />
          {withNext ? <NextField /> : null}
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "login-error" : undefined}
          />
          {state.error ? (
            <p id="login-error" role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

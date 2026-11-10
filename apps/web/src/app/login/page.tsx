import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Job Research Copilot" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      {/* useSearchParams() needs a Suspense boundary under Cache Components. */}
      <Suspense fallback={<LoginForm />}>
        <LoginForm withNext />
      </Suspense>
    </main>
  );
}

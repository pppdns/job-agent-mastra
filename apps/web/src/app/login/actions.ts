"use server";

import { setTimeout as sleep } from "node:timers/promises";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createLoginThrottle,
  createSessionToken,
  loginConfig,
  passwordMatches,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  safeNextPath,
} from "@/server/session";

export interface LoginState {
  error?: string;
}

const throttle = createLoginThrottle();

export async function loginAction(_state: LoginState, form: FormData): Promise<LoginState> {
  const next = safeNextPath(form.get("next"));
  const config = loginConfig();
  if (!config) redirect(next);

  // Fly's edge sets Fly-Client-IP; locally every attempt shares one bucket.
  const client = (await headers()).get("fly-client-ip") ?? "local";
  const wait = throttle.blockedFor(client);
  if (wait > 0) {
    return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.` };
  }
  const password = form.get("password");
  if (typeof password !== "string" || !passwordMatches(config, password)) {
    throttle.fail(client);
    await sleep(1000);
    return { error: "Wrong password." };
  }
  throttle.reset(client);
  (await cookies()).set(SESSION_COOKIE, createSessionToken(config), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

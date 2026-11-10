import { type NextRequest, NextResponse } from "next/server";
import { loginConfig, SESSION_COOKIE, verifySessionToken } from "@/server/session";

/**
 * 1. With APP_PASSWORD set (the deployment), every request but `/login` and static assets needs
 *    a valid session cookie: pages redirect to `/login`, API routes get 401.
 * 2. `/` always opens a fresh chat; its thread is created on the first message.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const config = loginConfig();
  if (config && !verifySessionToken(config, request.cookies.get(SESSION_COOKIE)?.value)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  if (pathname === "/") {
    return NextResponse.redirect(new URL(`/c/${crypto.randomUUID()}`, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};

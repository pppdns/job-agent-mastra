import { type NextRequest, NextResponse } from "next/server";

/** `/` always opens a fresh chat; its thread is created on the first message. */
export function proxy(request: NextRequest) {
  return NextResponse.redirect(new URL(`/c/${crypto.randomUUID()}`, request.url));
}

export const config = { matcher: "/" };

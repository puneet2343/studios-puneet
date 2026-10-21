import { NextResponse } from "next/server";
import { COOKIE_NAME, checkCredentials, isAuthed, sessionToken } from "@/lib/auth";

export async function GET(request) {
  return Response.json({ authed: isAuthed(request) });
}

export async function POST(request) {
  const { username, password } = await request.json().catch(() => ({}));
  if (!checkCredentials(username, password)) {
    return Response.json({ error: "Wrong username or password" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, sessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}

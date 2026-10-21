import crypto from "node:crypto";

export const COOKIE_NAME = "media_session";

function credentials() {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  if (!username || !password) throw new Error("APP_USERNAME and APP_PASSWORD must be set in .env.local");
  return { username, password };
}

// The session cookie is an HMAC of the credentials, so changing either logs everyone out.
export function sessionToken() {
  const { username, password } = credentials();
  return crypto.createHmac("sha256", `${username}\n${password}`).update("media-session-v2").digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function checkCredentials(username, password) {
  const expected = credentials();
  // Evaluate both so the response time doesn't reveal which one was wrong.
  const userOk = safeEqual(String(username ?? "").trim().toLowerCase(), expected.username.toLowerCase());
  const passOk = safeEqual(password ?? "", expected.password);
  return userOk && passOk;
}

export function isAuthed(request) {
  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  return Boolean(cookie) && safeEqual(cookie, sessionToken());
}

export function unauthorized() {
  return Response.json({ error: "Not logged in" }, { status: 401 });
}

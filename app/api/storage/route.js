import { isAuthed, unauthorized } from "@/lib/auth";
import { alertText, checkStorage, isSubscribed, notifyAll, publicKey, subscribe, unsubscribe } from "@/lib/storage-alerts";

// GET ?endpoint=…            -> disk space, level, push key, whether this phone is subscribed
// POST { subscription }      -> turn alerts on for this phone
// POST { test: true }        -> send a test notification to every subscribed phone
// DELETE { endpoint }        -> turn alerts off for this phone
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  const [disk, key, subscribed] = await Promise.all([checkStorage(), publicKey(), isSubscribed(endpoint)]);
  return Response.json({ ...disk, publicKey: key, subscribed });
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  if (body.test) {
    const disk = await checkStorage();
    const text = disk.level === "ok" ? { title: "Storage alerts are on", body: "You'll get a notification here if the studio PC starts running out of space." } : alertText(disk.level, disk);
    const sent = await notifyAll({ ...text, url: "/", tag: "storage-test" });
    return Response.json({ sent });
  }
  try {
    await subscribe(body.subscription);
  } catch {
    return Response.json({ error: "This phone's notification details look wrong. Try again." }, { status: 400 });
  }
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  const { endpoint } = await request.json().catch(() => ({}));
  if (endpoint) await unsubscribe(endpoint);
  return Response.json({ ok: true });
}

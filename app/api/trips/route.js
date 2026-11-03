import { isAuthed, unauthorized } from "@/lib/auth";
import { tripSuggestions } from "@/lib/library";
import { TripError, createTrip, deleteTrip, listTrips, updateTrip } from "@/lib/trips";

// Trips (see lib/trips.js).
// GET                          -> { trips, suggestions } (suggestions: loose photos that look like a trip)
// POST { name, start, end }    -> create; matching photos move into its album -> { trip, moved }
// PATCH { id, name?, start?, end? } -> edit                                  -> { trip, moved }
// DELETE ?id=…                 -> forget the trip (its album and photos stay)
function failed(error) {
  if (error instanceof TripError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: `Something went wrong: ${error.message}` }, { status: 500 });
}

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const [trips, suggestions] = await Promise.all([listTrips(), tripSuggestions().catch(() => [])]);
  return Response.json({ trips, suggestions }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  try {
    return Response.json(await createTrip(await request.json().catch(() => ({}))), { status: 201 });
  } catch (error) {
    return failed(error);
  }
}

export async function PATCH(request) {
  if (!isAuthed(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    return Response.json(await updateTrip(body.id, body));
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  try {
    await deleteTrip(request.nextUrl.searchParams.get("id"));
    return Response.json({ ok: true });
  } catch (error) {
    return failed(error);
  }
}

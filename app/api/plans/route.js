import { isAuthed, unauthorized } from "@/lib/auth";
import { PlanError, createPlan, deletePlan, getPlan, listPlans, restorePlan, savePlan } from "@/lib/plans";

// Trip Planner.
// GET                      -> all trips (summaries for the list)
// GET ?id=…                -> one trip, in full
// POST { trip }            -> new trip            POST { restore: undo } -> undo a delete
// PUT ?id=… { trip, rev }  -> save (409 + the newer copy if another device saved first)
// DELETE ?id=…             -> delete (kept 3 days for Undo)
function failed(error) {
  if (error instanceof PlanError) return Response.json({ error: error.message, ...error.extra }, { status: error.status });
  return Response.json({ error: `Something went wrong: ${error.message}` }, { status: 500 });
}

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const id = request.nextUrl.searchParams.get("id");
  try {
    return Response.json(id ? { trip: await getPlan(id) } : { trips: await listPlans() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    if (body.restore) return Response.json({ trip: await restorePlan(body.restore) });
    return Response.json({ trip: await createPlan(body.trip) }, { status: 201 });
  } catch (error) {
    return failed(error);
  }
}

export async function PUT(request) {
  if (!isAuthed(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    return Response.json({ trip: await savePlan(request.nextUrl.searchParams.get("id"), body.trip, body.rev) });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  try {
    return Response.json(await deletePlan(request.nextUrl.searchParams.get("id")));
  } catch (error) {
    return failed(error);
  }
}

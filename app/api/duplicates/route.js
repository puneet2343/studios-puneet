import { isAuthed, unauthorized } from "@/lib/auth";
import { findDuplicates } from "@/lib/duplicates";

// GET -> groups of identical files anywhere in the library, with a suggested copy to keep
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  return Response.json(await findDuplicates());
}

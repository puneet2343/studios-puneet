import { createWriteStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { isAuthed, unauthorized } from "@/lib/auth";
import { serveFile } from "@/lib/serve-file";
import { albumDeleted, albumRenamed } from "@/lib/trips";
import { formatSize } from "@/lib/format";
import { UPLOAD_RESERVE } from "@/lib/storage-levels";
import {
  cleanName,
  cleanPath,
  diskSpace,
  ensureDir,
  exists,
  fileErrorResponse,
  forgetLibrarySize,
  freeName,
  librarySize,
  listMedia,
  mimeType,
  moveToTrash,
  relPath,
  renameFile,
  resolveDir,
  resolveName,
  tempPathFor,
} from "@/lib/media";

// Files and folders are addressed by their path inside the library, ?name=Goa Trip/clip.mp4.
// GET without ?name lists a folder (?dir=, empty for the top level).
function target(request) {
  const name = request.nextUrl.searchParams.get("name");
  const full = resolveName(name);
  return full ? { name: path.basename(full), full } : null;
}

function badName() {
  return Response.json({ error: "Invalid file name" }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "File not found" }, { status: 404 });
}

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  if (!request.nextUrl.searchParams.has("name")) {
    const dir = cleanPath(request.nextUrl.searchParams.get("dir") ?? "");
    if (dir === null) return badName();
    if (dir && !(await isFolder(resolveDir(dir)))) {
      return Response.json({ error: "Folder not found" }, { status: 404 });
    }
    const [listing, disk, media] = await Promise.all([listMedia(dir), diskSpace(), librarySize()]);
    return Response.json({ ...listing, dir, disk: { ...disk, media } });
  }

  const file = target(request);
  if (!file) return badName();
  let stat;
  try {
    stat = await fs.stat(file.full);
  } catch {
    return notFound();
  }
  if (!stat.isFile()) return notFound();

  const headers = {
    "Content-Type": mimeType(file.name),
    // Originals are never kept in the phone's cache: a library full of photos and videos
    // would make the app grow by gigabytes. (Downloads save a file on purpose, separately.)
    "Cache-Control": "private, no-store",
    "Last-Modified": stat.mtime.toUTCString(),
    "Content-Disposition": `${
      request.nextUrl.searchParams.has("download") ? "attachment" : "inline"
    }; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  };

  return serveFile(request, file.full, stat.size, headers);
}

// Upload: the raw file is the request body. It is streamed to a temp file and only
// renamed into place once complete, so a dropped connection never leaves half a video.
export async function PUT(request) {
  if (!isAuthed(request)) return unauthorized();
  const full = resolveName(request.nextUrl.searchParams.get("name"));
  if (!full) return badName();
  if (!request.body) return Response.json({ error: "Empty upload" }, { status: 400 });

  await ensureDir();
  const dir = path.dirname(full);
  const name = path.basename(full);
  // The folder may have been deleted from another device while this was queued.
  if (!(await isFolder(dir))) return Response.json({ error: "That folder no longer exists" }, { status: 404 });
  // Never fill the disk completely: Windows and DaVinci need room to work.
  const incoming = Number(request.headers.get("content-length")) || 0;
  const { free } = await diskSpace();
  if (incoming && incoming > free - UPLOAD_RESERVE) {
    return Response.json(
      { error: `Not enough space on the studio PC: this file is ${formatSize(incoming)} but only ${formatSize(Math.max(0, free - UPLOAD_RESERVE))} can be used.` },
      { status: 507 }
    );
  }
  const temp = tempPathFor(name, dir);
  try {
    await pipeline(Readable.fromWeb(request.body), createWriteStream(temp));
    const finalName = await freeName(name, dir);
    await fs.rename(temp, path.join(dir, finalName));
    forgetLibrarySize();
    return Response.json({ ok: true, name: finalName, path: relPath(path.join(dir, finalName)) }, { status: 201 });
  } catch (error) {
    await fs.rm(temp, { force: true });
    return Response.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
  }
}

// New folder: POST ?folder=Goa Trip/Beach
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const full = resolveName(request.nextUrl.searchParams.get("folder"));
  if (!full) {
    return Response.json({ error: "That name isn't allowed. Avoid symbols like / : * ? \" < > | and don't start with a dot." }, { status: 400 });
  }
  if (!(await isFolder(path.dirname(full)))) return Response.json({ error: "Parent folder not found" }, { status: 404 });
  if (await exists(full)) return Response.json({ error: "Something with that name already exists here" }, { status: 409 });
  await fs.mkdir(full);
  return Response.json({ ok: true, path: relPath(full) }, { status: 201 });
}

// Rename a file or folder: { newName }. Move it into another folder: { moveTo: "Goa Trip" }.
export async function PATCH(request) {
  if (!isAuthed(request)) return unauthorized();
  const file = target(request);
  if (!file) return badName();
  const body = await request.json().catch(() => ({}));
  if (!(await exists(file.full))) return notFound();

  let next;
  if ("moveTo" in body) {
    const dir = resolveDir(body.moveTo);
    if (!dir || !(await isFolder(dir))) return Response.json({ error: "Folder not found" }, { status: 404 });
    if (dir === file.full || dir.startsWith(file.full + path.sep)) {
      return Response.json({ error: "A folder can't be moved inside itself" }, { status: 400 });
    }
    if (dir === path.dirname(file.full)) return Response.json({ ok: true, path: relPath(file.full) });
    // Moving never overwrites: a clash becomes "clip (1).mp4".
    next = path.join(dir, await freeName(file.name, dir));
  } else {
    const newName = cleanName(body.newName);
    if (!newName) return badName();
    next = path.join(path.dirname(file.full), newName);
    const sameFile = next.toLowerCase() === file.full.toLowerCase();
    if (!sameFile && (await exists(next))) {
      return Response.json({ error: "Something with that name already exists here" }, { status: 409 });
    }
  }

  const wasFolder = (await fs.stat(file.full)).isDirectory();
  try {
    await renameFile(file.full, next);
  } catch (error) {
    return fileErrorResponse(error, "moveTo" in body ? "move" : "rename");
  }
  if (wasFolder) await albumRenamed(relPath(file.full), relPath(next)).catch(() => {});
  return Response.json({ ok: true, name: path.basename(next), path: relPath(next) });
}

export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  const file = target(request);
  if (!file) return badName();
  if (!(await exists(file.full))) return notFound();
  const wasFolder = (await fs.stat(file.full)).isDirectory();
  try {
    const trashId = await moveToTrash(file.full);
    if (wasFolder) await albumDeleted(relPath(file.full)).catch(() => {});
    return Response.json({ ok: true, trashId });
  } catch (error) {
    return fileErrorResponse(error, "delete");
  }
}

async function isFolder(full) {
  return Boolean(full) && (await fs.stat(full).catch(() => null))?.isDirectory() === true;
}

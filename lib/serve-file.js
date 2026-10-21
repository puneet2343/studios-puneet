import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

// Streams a file, honouring Range requests so videos can seek without downloading
// everything first. `headers` are added to every response.
export function serveFile(request, full, size, headers) {
  headers = { "Accept-Ranges": "bytes", ...headers };
  const range = request.headers.get("range");
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (match && size > 0) {
    let start = match[1] === "" ? size - Number(match[2]) : Number(match[1]);
    let end = match[1] !== "" && match[2] !== "" ? Number(match[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(Readable.toWeb(createReadStream(full, { start, end })), {
      status: 206,
      headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
    });
  }
  return new Response(Readable.toWeb(createReadStream(full)), { headers: { ...headers, "Content-Length": String(size) } });
}

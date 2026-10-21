"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { actionUrl } from "@/components/media/urls";

const defaultUrl = (file) => actionUrl(file.name);

const PARALLEL = 2;
const CHUNK = 8 * 1024 * 1024; // pieces of a resumable upload
const MAX_WAIT_S = 30;

class Cancelled extends Error {}
class Offline extends Error {}

// Same file (folder, name, size, date) -> same id, so picking it again later resumes it.
function uploadId(path, file) {
  const text = `${path}|${file.size}|${file.lastModified}`;
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x811c9dc5) >>> 0;
  }
  return `u${a.toString(36)}${b.toString(36)}${file.size.toString(36)}`.slice(0, 64);
}

// Waits `seconds`, or less if the phone comes back online.
function waitOrOnline(seconds, ctrl) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      ctrl.wake = null;
      resolve();
    };
    const timer = setTimeout(done, seconds * 1000);
    window.addEventListener("online", done);
    ctrl.wake = done;
  });
}

/**
 * Uploads files two at a time. XMLHttpRequest is used because fetch can't report
 * upload progress.
 *
 * With `pathFor(file)` (library uploads) each file goes up in 8 MB pieces and the PC
 * keeps what arrived: a dropped connection is retried automatically and carries on
 * from the last piece, and picking the same file again later resumes it too.
 * With only `urlFor(file)` (Instagram Export sources) the file is sent in one go.
 */
export default function useUploader({ onUploaded, urlFor = defaultUrl, pathFor = null }) {
  const [items, setItems] = useState([]);
  const [speed, setSpeed] = useState(0);
  const queue = useRef([]);
  const running = useRef(new Map()); // item id -> { xhr, cancelled, wake }
  const loadedBytes = useRef(0);
  const onUploadedRef = useRef(onUploaded);
  const urlForRef = useRef(urlFor);
  const pathForRef = useRef(pathFor);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
    urlForRef.current = urlFor;
    pathForRef.current = pathFor;
  }, [onUploaded, urlFor, pathFor]);

  const update = useCallback(
    (id, patch) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it))),
    []
  );

  // One XHR; resolves { status, body }, rejects Offline on network failure.
  const send = useCallback((ctrl, method, url, body, onProgress) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      ctrl.xhr = xhr;
      xhr.open(method, url);
      let last = 0;
      xhr.upload.onprogress = (e) => {
        loadedBytes.current += e.loaded - last;
        last = e.loaded;
        onProgress?.(e.loaded);
      };
      xhr.onload = () => {
        let parsed = {};
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch {}
        resolve({ status: xhr.status, body: parsed });
      };
      xhr.onerror = () => reject(new Offline());
      xhr.ontimeout = () => reject(new Offline());
      xhr.onabort = () => reject(new Cancelled());
      xhr.send(body);
    });
  }, []);

  const runSimple = useCallback(
    async (item, ctrl) => {
      const res = await send(ctrl, "PUT", item.url, item.file, (loaded) => update(item.id, { loaded }));
      if (res.status >= 200 && res.status < 300) {
        update(item.id, { status: "done", loaded: item.file.size, savedAs: res.body.name });
        onUploadedRef.current?.(res.body, item.file);
      } else update(item.id, { status: "error", error: res.body.error || `Failed (${res.status})` });
    },
    [send, update]
  );

  const runResumable = useCallback(
    async (item, ctrl) => {
      const { file } = item;
      const id = uploadId(item.path, file);
      ctrl.uploadId = id;
      let offset = null;
      let attempt = 0;
      for (;;) {
        if (ctrl.cancelled) throw new Cancelled();
        try {
          if (offset === null) {
            // Ask the PC how much it already has (0 for a new upload).
            const res = await send(ctrl, "POST", "/api/upload", JSON.stringify({ id, name: item.path, size: file.size }));
            if (res.status >= 500 && res.status !== 507) throw new Offline();
            if (res.status !== 200) return update(item.id, { status: "error", error: res.body.error || `Failed (${res.status})`, note: null });
            offset = res.body.offset;
            update(item.id, {
              loaded: offset,
              note: offset > 0 && attempt === 0 ? `Resuming from ${Math.round((offset / file.size) * 100)}%` : null,
            });
          }
          const end = Math.min(file.size, offset + CHUNK);
          const start = offset;
          const res = await send(ctrl, "PUT", `/api/upload?id=${id}&offset=${start}`, file.slice(start, end), (loaded) =>
            update(item.id, { loaded: start + loaded })
          );
          if (res.status === 409) {
            offset = res.body.offset; // the PC has a different amount: continue from there
            continue;
          }
          if (res.status >= 500 && res.status !== 507) throw new Offline();
          if (res.status >= 400) return update(item.id, { status: "error", error: res.body.error || `Failed (${res.status})`, note: null });
          offset = res.body.offset;
          if (attempt) update(item.id, { note: null });
          attempt = 0;
          if (res.body.done) {
            update(item.id, { status: "done", loaded: file.size, savedAs: res.body.name, note: null });
            onUploadedRef.current?.(res.body, file);
            return;
          }
        } catch (error) {
          if (error instanceof Cancelled || ctrl.cancelled) throw new Cancelled();
          // Connection dropped: wait a little longer each time, then pick up where the PC left off.
          attempt++;
          const wait = Math.min(MAX_WAIT_S, 2 ** attempt);
          update(item.id, { note: navigator.onLine === false ? "No connection · will resume" : `Connection lost · retrying in ${wait}s` });
          await waitOrOnline(wait, ctrl);
          offset = null;
        }
      }
    },
    [send, update]
  );

  const pump = useCallback(() => {
    while (running.current.size < PARALLEL && queue.current.length) {
      const item = queue.current.shift();
      const ctrl = { cancelled: false };
      running.current.set(item.id, ctrl);
      update(item.id, { status: "uploading" });
      const run = item.path ? runResumable(item, ctrl) : runSimple(item, ctrl);
      run
        .catch((error) => {
          if (error instanceof Cancelled) update(item.id, { status: "cancelled", note: null });
          else update(item.id, { status: "error", error: error instanceof Offline ? "Connection lost" : error.message, note: null });
        })
        .finally(() => {
          running.current.delete(item.id);
          pump();
        });
    }
  }, [runResumable, runSimple, update]);

  const enqueue = useCallback(
    (fileList) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;
      const added = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        // Fixed when queued, so switching folders mid-upload doesn't redirect it.
        ...(pathForRef.current ? { path: pathForRef.current(file) } : { url: urlForRef.current(file) }),
        loaded: 0,
        status: "waiting",
      }));
      queue.current.push(...added);
      setItems((list) => [...list, ...added]);
      pump();
    },
    [pump]
  );

  const cancel = useCallback(
    (id) => {
      const ctrl = running.current.get(id);
      if (ctrl) {
        ctrl.cancelled = true;
        ctrl.xhr?.abort();
        ctrl.wake?.();
        if (ctrl.uploadId) fetch(`/api/upload?id=${ctrl.uploadId}`, { method: "DELETE" }).catch(() => {});
        return;
      }
      queue.current = queue.current.filter((it) => it.id !== id);
      update(id, { status: "cancelled" });
    },
    [update]
  );

  const clearFinished = useCallback(
    () => setItems((list) => list.filter((it) => it.status === "uploading" || it.status === "waiting")),
    []
  );

  const active = items.some((it) => it.status === "uploading" || it.status === "waiting");

  // Smoothed transfer speed, sampled once a second while anything is uploading.
  useEffect(() => {
    if (!active) return;
    let previous = loadedBytes.current;
    const timer = setInterval(() => {
      const delta = loadedBytes.current - previous;
      previous = loadedBytes.current;
      setSpeed((s) => (s ? s * 0.7 + delta * 0.3 : delta));
    }, 1000);
    return () => {
      clearInterval(timer);
      setSpeed(0);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const warn = (e) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    // Also holds off the automatic app update until uploads finish (see AppShell).
    window.__psBusy = (window.__psBusy || 0) + 1;
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.__psBusy -= 1;
    };
  }, [active]);

  return { items, speed, active, enqueue, cancel, clearFinished };
}

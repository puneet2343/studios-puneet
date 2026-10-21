"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { actionUrl } from "@/components/media/urls";

const defaultUrl = (file) => actionUrl(file.name);

const PARALLEL = 2;

// Uploads files as raw request bodies (streamed to disk on the server), two at a time.
// XMLHttpRequest is used because fetch can't report upload progress.
export default function useUploader({ onUploaded, urlFor = defaultUrl }) {
  const [items, setItems] = useState([]);
  const [speed, setSpeed] = useState(0);
  const queue = useRef([]);
  const running = useRef(new Map());
  const loadedBytes = useRef(0);
  const onUploadedRef = useRef(onUploaded);
  const urlForRef = useRef(urlFor);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
    urlForRef.current = urlFor;
  }, [onUploaded, urlFor]);

  const update = useCallback(
    (id, patch) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it))),
    []
  );

  const pump = useCallback(() => {
    // Named so each finished upload can start the next one in the queue.
    function startNext() {
      while (running.current.size < PARALLEL && queue.current.length) {
        const item = queue.current.shift();
        const xhr = new XMLHttpRequest();
        running.current.set(item.id, xhr);
        let last = 0;
        update(item.id, { status: "uploading" });

        xhr.open("PUT", item.url);
        xhr.upload.onprogress = (e) => {
          loadedBytes.current += e.loaded - last;
          last = e.loaded;
          update(item.id, { loaded: e.loaded });
        };
        const finish = (patch) => {
          running.current.delete(item.id);
          update(item.id, patch);
          startNext();
        };
        xhr.onload = () => {
          let body = {};
          try {
            body = JSON.parse(xhr.responseText);
          } catch {}
          if (xhr.status >= 200 && xhr.status < 300) {
            finish({ status: "done", loaded: item.file.size, savedAs: body.name });
            onUploadedRef.current?.(body, item.file);
          } else {
            finish({ status: "error", error: body.error || `Failed (${xhr.status})` });
          }
        };
        xhr.onerror = () => finish({ status: "error", error: "Connection lost" });
        xhr.onabort = () => finish({ status: "cancelled" });
        xhr.send(item.file);
      }
    }
    startNext();
  }, [update]);

  const enqueue = useCallback(
    (fileList) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;
      const added = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        // Fixed when queued, so switching folders mid-upload doesn't redirect it.
        url: urlForRef.current(file),
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
      const xhr = running.current.get(id);
      if (xhr) return xhr.abort();
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

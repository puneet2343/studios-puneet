// Quick check of local face detection + recognition (scripts only; the app uses lib/ai.js).
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
const require = createRequire(import.meta.url);
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
// Node's fetch can't read file:// URLs; the face library loads its models that way.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url?.url ?? url);
  if (!u.startsWith("file://")) return realFetch(url, opts);
  const data = await readFile(fileURLToPath(u));
  return new Response(data, { status: 200, headers: { "Content-Type": u.endsWith(".json") ? "application/json" : "application/octet-stream" } });
};
const H = require(path.resolve("node_modules/@vladmandic/human/dist/human.node-wasm.js"));
const Human = H.Human || H.default;
const root = path.resolve("node_modules/@vladmandic/human/models");
const wasmDir = path.resolve("node_modules/@tensorflow/tfjs-backend-wasm/dist") + path.sep;
const human = new Human({
  backend: "wasm", wasmPath: "file://" + wasmDir.replaceAll("\\", "/"), modelBasePath: "file://" + root.replaceAll("\\", "/") + "/", debug: false,
  face: { enabled: true, detector: { rotation: true, maxDetected: 20, minConfidence: 0.5 }, mesh: { enabled: true }, iris: { enabled: false }, description: { enabled: true }, emotion: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } },
  body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false },
});
const t0 = Date.now();
await human.load(); await human.warmup();
console.log("models loaded:", Object.entries(human.models.models || human.models).filter(([, m]) => m).map(([k]) => k).join(","));
console.log("face engine ready in", (Date.now() - t0) / 1000, "s, backend", human.tf.getBackend());
const all = [];
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).rotate().resize(1024, 1024, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const tensor = human.tf.tensor4d(Float32Array.from(data), [1, info.height, info.width, 3], "float32");
  const t = Date.now(); const res = await human.detect(tensor); tensor.dispose();
  console.log(path.basename(f), "faces:", res.face.length, (Date.now() - t) + "ms", res.face.map((x) => x.score.toFixed(2)).join(","));
  for (const face of res.face) all.push({ f: path.basename(f), emb: face.embedding });
}
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
  const s = human.match.similarity(all[i].emb, all[j].emb);
  const a = all[i].emb, b = all[j].emb; let d = 0, na = 0, nb = 0; for (let k = 0; k < a.length; k++) { d += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; }
  const cos = d / Math.sqrt(na * nb);
  console.log(`${all[i].f} ~ ${all[j].f}: human ${s.toFixed(2)} cosine ${cos.toFixed(2)}`);
}

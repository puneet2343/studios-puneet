// Puneet Studios photo understanding, run as a separate low-priority process by lib/ai.js.
// Everything happens on this PC: the models are downloaded once into .ai-models and no
// photo ever leaves the computer. Files are only read, never changed.
//
// Talks over stdin/stdout, one JSON message per line:
//   in:  { id, cmd: "analyse", file }  -> out: { id, clip: base64 Float32[512], faces: [{ box, score, emb }] }
//   in:  { id, cmd: "text", q }        -> out: { id, clip: base64 Float32[512] }
//   in:  { id, cmd: "ping" }           -> out: { id, ok: true }
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env } from "@huggingface/transformers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// Use the image tool that comes with the AI library: loading the app's (newer) copy as well
// would put two different versions in one process, and they clash.
const sharp = require(path.join(ROOT, "node_modules/@huggingface/transformers/node_modules/sharp"));
sharp.concurrency(1);

// ----- Photo meaning (CLIP) -----
env.cacheDir = path.join(ROOT, ".ai-models");
const CLIP = "Xenova/clip-vit-base-patch32";
let clip = null;
async function loadClip() {
  if (!clip) {
    clip = Promise.all([
      AutoProcessor.from_pretrained(CLIP),
      AutoTokenizer.from_pretrained(CLIP),
      CLIPVisionModelWithProjection.from_pretrained(CLIP, { dtype: "q8" }),
      CLIPTextModelWithProjection.from_pretrained(CLIP, { dtype: "q8" }),
    ]).then(([processor, tokenizer, vision, text]) => ({ processor, tokenizer, vision, text }));
  }
  return clip;
}

// ----- Faces (Human: detection + recognition) -----
// Node's fetch can't read file:// URLs, which is how the face library loads its models.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url?.url ?? url);
  if (!u.startsWith("file://")) return realFetch(url, opts);
  const data = await readFile(fileURLToPath(u));
  return new Response(data, { status: 200, headers: { "Content-Type": u.endsWith(".json") ? "application/json" : "application/octet-stream" } });
};
let human = null;
async function loadHuman() {
  if (!human) {
    human = (async () => {
      const H = require(path.join(ROOT, "node_modules/@vladmandic/human/dist/human.node-wasm.js"));
      const Human = H.Human || H.default;
      const models = path.join(ROOT, "node_modules/@vladmandic/human/models").replaceAll("\\", "/");
      const wasm = path.join(ROOT, "node_modules/@tensorflow/tfjs-backend-wasm/dist").replaceAll("\\", "/");
      const h = new Human({
        backend: "wasm",
        wasmPath: `file://${wasm}/`,
        modelBasePath: `file://${models}/`,
        debug: false,
        face: {
          enabled: true,
          detector: { rotation: true, maxDetected: 30, minConfidence: 0.6, minSize: 40 },
          mesh: { enabled: true },
          iris: { enabled: false },
          description: { enabled: true },
          emotion: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        gesture: { enabled: false },
        segmentation: { enabled: false },
      });
      await h.load();
      await h.warmup();
      return h;
    })();
  }
  return human;
}

const b64 = (arr) => Buffer.from(new Float32Array(arr).buffer).toString("base64");
function normalize(v) {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  return Array.from(v, (x) => x / s);
}

async function analyse(file) {
  // One decode, two sizes: 1024 px for faces, and CLIP resizes to 224 itself.
  const { data, info } = await sharp(file, { failOn: "none" }).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const c = await loadClip();
  // The model's own image loader takes an encoded picture; a small JPEG is plenty (it uses 224 px).
  const jpeg = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).resize(448, 448, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer();
  const image = await RawImage.fromBlob(new Blob([jpeg], { type: "image/jpeg" }));
  const { image_embeds } = await c.vision(await c.processor(image));

  const h = await loadHuman();
  const tensor = h.tf.tensor4d(Float32Array.from(data), [1, info.height, info.width, 3], "float32");
  let faces = [];
  try {
    const res = await h.detect(tensor);
    faces = res.face
      .filter((f) => f.embedding?.length && f.score >= 0.6)
      .map((f) => ({
        box: [f.box[0] / info.width, f.box[1] / info.height, f.box[2] / info.width, f.box[3] / info.height].map((n) => Number(n.toFixed(4))),
        score: Number(f.score.toFixed(3)),
        emb: b64(f.embedding),
      }));
  } finally {
    h.tf.dispose(tensor);
  }
  return { clip: b64(normalize(image_embeds.data)), faces };
}

async function textEmbedding(q) {
  const c = await loadClip();
  const { text_embeds } = await c.text(c.tokenizer([q], { padding: true, truncation: true }));
  return { clip: b64(normalize(text_embeds.data)) };
}

const out = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const rl = readline.createInterface({ input: process.stdin });
// One job at a time, in order: keeps memory and CPU use low.
let chain = Promise.resolve();
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  chain = chain.then(async () => {
    try {
      if (msg.cmd === "analyse") out({ id: msg.id, ...(await analyse(msg.file)) });
      else if (msg.cmd === "text") out({ id: msg.id, ...(await textEmbedding(String(msg.q ?? "").slice(0, 200))) });
      else out({ id: msg.id, ok: true });
    } catch (error) {
      out({ id: msg.id, error: String(error?.message ?? error).slice(0, 300) });
    }
  });
});
rl.on("close", () => process.exit(0));
out({ ready: true });

import { AutoProcessor, AutoTokenizer, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, RawImage, env } from "@huggingface/transformers";
env.cacheDir = process.argv[2];
const id = "Xenova/clip-vit-base-patch32";
const t0 = Date.now();
const [processor, tokenizer, vision, text] = await Promise.all([
  AutoProcessor.from_pretrained(id), AutoTokenizer.from_pretrained(id),
  CLIPVisionModelWithProjection.from_pretrained(id, { dtype: "q8" }), CLIPTextModelWithProjection.from_pretrained(id, { dtype: "q8" }),
]);
console.log("models ready in", (Date.now() - t0) / 1000, "s");
const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s); return v.map((x) => x / s); };
const files = process.argv.slice(3);
const embs = [];
for (const f of files) { const t = Date.now(); const img = await RawImage.read(f); const { image_embeds } = await vision(await processor(img)); embs.push(norm(Array.from(image_embeds.data))); console.log("image", f.split(/[\/]/).pop(), (Date.now() - t), "ms"); }
const queries = ["a baby", "an old woman", "a cat", "a screenshot of text", "an airport", "night sky with the moon"];
const { text_embeds } = await text(tokenizer(queries, { padding: true, truncation: true }));
const dim = text_embeds.dims[1];
for (let q = 0; q < queries.length; q++) {
  const tv = norm(Array.from(text_embeds.data.slice(q * dim, (q + 1) * dim)));
  const scores = embs.map((e, i) => [e.reduce((s, x, k) => s + x * tv[k], 0), files[i].split(/[\/]/).pop()]).sort((a, b) => b[0] - a[0]);
  console.log(`"${queries[q]}" ->`, scores.slice(0, 2).map(([s, n]) => `${n} (${s.toFixed(3)})`).join(", "));
}

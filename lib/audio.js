import path from "node:path";
import { FFMPEG, probe, run } from "@/lib/ffmpeg";
import { cleanName, forgetLibrarySize, freeName, renameFile, tempPathFor } from "@/lib/media";

// For each kind of audio found inside videos: the file type that holds it as-is,
// so the sound is copied out bit-for-bit (no re-encoding, no quality loss).
const CONTAINERS = {
  aac: { ext: ".m4a", format: "ipod" },
  alac: { ext: ".m4a", format: "ipod" },
  mp3: { ext: ".mp3", format: "mp3" },
  flac: { ext: ".flac", format: "flac" },
  opus: { ext: ".opus", format: "opus" },
  vorbis: { ext: ".ogg", format: "ogg" },
  ac3: { ext: ".ac3", format: "ac3" },
  eac3: { ext: ".eac3", format: "eac3" },
};
const pcm = (codec) => codec?.startsWith("pcm_");

const fail = (userMessage) => Object.assign(new Error(userMessage), { userMessage });

// What the sound inside a video is, and which file type it will be saved as.
export async function audioInfo(full) {
  const info = await probe(full);
  const codec = info.audio?.codec;
  if (!codec) throw fail("This video has no sound to extract.");
  const target = CONTAINERS[codec] ?? (pcm(codec) ? { ext: ".wav", format: "wav" } : null);
  if (!target) throw fail(`This video's sound (${codec}) can't be saved on its own without re-encoding it.`);
  return { codec, ext: target.ext, sampleRate: info.audio.sampleRate, channels: info.audio.channels, bitrate: info.audio.bitrate };
}

/**
 * Saves a video's sound as "<baseName><.m4a/.mp3/.flac/.wav…>" in `dir` (default: next to the
 * video, named "<video> (audio)"). Returns the new file's full path, or throws { userMessage }.
 */
export async function extractAudio(full, { baseName, dir: targetDir } = {}) {
  const info = await probe(full);
  const codec = info.audio?.codec;
  if (!codec) throw fail("This video has no sound to extract.");
  const target = CONTAINERS[codec] ?? (pcm(codec) ? { ext: ".wav", format: "wav" } : null);
  if (!target) throw fail(`This video's sound (${codec}) can't be saved on its own without re-encoding it.`);

  const dir = targetDir ?? path.dirname(full);
  const base = path.basename(full, path.extname(full));
  const wanted = cleanName(`${(baseName ?? `${base} (audio)`).trim()}${target.ext}`);
  if (!wanted) throw fail("That name isn't allowed. Avoid symbols like / : * ? \" < > | and don't start with a dot.");
  const temp = tempPathFor(`${base}-audio${target.ext}`, dir);
  await run(
    FFMPEG,
    ["-v", "error", "-y", "-i", full, "-vn", "-map", "0:a:0", "-c:a", "copy", "-map_metadata", "0", ...(target.format === "ipod" ? ["-movflags", "+faststart"] : []), "-f", target.format, temp],
    { maxBuffer: 8 * 1024 * 1024 }
  );
  // Never overwrites: a name that's taken becomes "name (1).m4a".
  const out = path.join(dir, await freeName(wanted, dir));
  await renameFile(temp, out);
  forgetLibrarySize();
  return { full: out, codec, sampleRate: info.audio.sampleRate, channels: info.audio.channels };
}

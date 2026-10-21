import { promises as fs } from "node:fs";
import path from "node:path";
import exifReader from "exif-reader";
import sharp from "sharp";
import { FFPROBE, run } from "@/lib/ffmpeg";
import { fileKey, kindOf, relPath } from "@/lib/media";
import { readFavorites } from "@/lib/library";

const rate = (r) => {
  const [n, d] = String(r || "0/1").split("/").map(Number);
  return d ? n / d : n || 0;
};

// "+19.0760+072.8777/" (ISO 6709, how phones store GPS in videos) -> { lat, lon }
function parseIso6709(value) {
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(value || "");
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

async function videoProperties(full) {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_format", "-show_streams", "-of", "json", full], { maxBuffer: 16 * 1024 * 1024 });
  const info = JSON.parse(stdout);
  const tags = info.format?.tags ?? {};
  const v = info.streams?.find((s) => s.codec_type === "video");
  const a = info.streams?.find((s) => s.codec_type === "audio");
  const rotation = Number(v?.side_data_list?.find((d) => "rotation" in d)?.rotation ?? 0);
  const sideways = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;
  const transfer = v?.color_transfer;
  const location = parseIso6709(tags.location || tags["com.apple.quicktime.location.ISO6709"] || tags["location-eng"]);
  return {
    duration: Number(info.format?.duration) || 0,
    bitrate: Number(info.format?.bit_rate) || 0,
    container: info.format?.format_long_name,
    recorded: tags.creation_time || null,
    utcOffset: tags["com.samsung.android.utc_offset"] || null,
    device: [tags["com.android.manufacturer"] || tags["com.apple.quicktime.make"], tags["com.android.model"] || tags["com.apple.quicktime.model"]]
      .filter(Boolean)
      .join(" ") || null,
    androidVersion: tags["com.android.version"] || null,
    location,
    video: v && {
      codec: v.codec_name,
      codecName: v.codec_long_name,
      profile: v.profile,
      width: sideways ? v.height : v.width,
      height: sideways ? v.width : v.height,
      fps: rate(v.avg_frame_rate) || rate(v.r_frame_rate),
      captureFps: Number(tags["com.android.capture.fps"]) || null,
      variableFps: Math.abs(rate(v.avg_frame_rate) - rate(v.r_frame_rate)) > 0.5,
      bitrate: Number(v.bit_rate) || 0,
      pixFmt: v.pix_fmt,
      bitDepth: /12/.test(v.pix_fmt || "") ? 12 : /10/.test(v.pix_fmt || "") ? 10 : 8,
      hdr: transfer === "smpte2084" ? "HDR10 (PQ)" : transfer === "arib-std-b67" ? "HLG" : null,
      colorSpace: [v.color_primaries, v.color_space].filter(Boolean).join(" / ") || null,
      rotation,
      frames: Number(v.nb_frames) || null,
    },
    audio: a && {
      codec: a.codec_name,
      codecName: a.codec_long_name,
      sampleRate: Number(a.sample_rate) || 0,
      channels: a.channels,
      layout: a.channel_layout,
      bitrate: Number(a.bit_rate) || 0,
    },
  };
}

// Cameras store local time with no time zone; the reader hands it back as if it were UTC.
// Return it as a zone-less "YYYY-MM-DDTHH:MM:SS" so it's shown exactly as the camera wrote it.
const cameraTime = (d) => (d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 19) : d || null);

const BIT_DEPTHS = { uchar: 8, char: 8, ushort: 16, short: 16, uint: 32, int: 32, float: 32, double: 64 };

const dmsToDecimal = (dms, ref) => {
  if (!Array.isArray(dms)) return null;
  const value = dms[0] + dms[1] / 60 + dms[2] / 3600;
  return ref === "S" || ref === "W" ? -value : value;
};

async function imageProperties(full) {
  const meta = await sharp(full, { failOn: "none" }).metadata();
  let exif = null;
  try {
    exif = meta.exif ? exifReader(meta.exif) : null;
  } catch {}
  const img = exif?.Image ?? {};
  const photo = exif?.Photo ?? {};
  const gps = exif?.GPSInfo ?? {};
  const lat = dmsToDecimal(gps.GPSLatitude, gps.GPSLatitudeRef);
  const lon = dmsToDecimal(gps.GPSLongitude, gps.GPSLongitudeRef);
  const exposure = photo.ExposureTime;
  return {
    width: meta.autoOrient?.width ?? meta.width,
    height: meta.autoOrient?.height ?? meta.height,
    format: meta.format,
    space: meta.space,
    bitDepth: BIT_DEPTHS[meta.depth] ?? null,
    hasAlpha: meta.hasAlpha,
    taken: cameraTime(photo.DateTimeOriginal || img.DateTime),
    camera: [img.Make, img.Model].filter(Boolean).join(" ").trim() || null,
    lens: photo.LensModel || null,
    iso: photo.ISOSpeedRatings || photo.PhotographicSensitivity || null,
    shutter: exposure ? (exposure >= 1 ? `${exposure}s` : `1/${Math.round(1 / exposure)}s`) : null,
    aperture: photo.FNumber ? `f/${Number(photo.FNumber).toFixed(1)}` : null,
    focalLength: photo.FocalLength ? `${Math.round(photo.FocalLength)} mm` : null,
    focal35: photo.FocalLengthIn35mmFilm ? `${photo.FocalLengthIn35mmFilm} mm` : null,
    flash: photo.Flash !== undefined ? (photo.Flash & 1 ? "Fired" : "Off") : null,
    software: img.Software || null,
    location: lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
  };
}

export async function fileProperties(full) {
  const stat = await fs.stat(full);
  const name = path.basename(full);
  const kind = kindOf(name);
  const key = fileKey(stat);
  const rel = relPath(full);
  const favorites = await readFavorites();
  const base = {
    name,
    path: rel,
    folder: rel.includes("/") ? rel.split("/").slice(0, -1).join(" › ") : "Media",
    kind,
    extension: path.extname(name).slice(1).toUpperCase(),
    size: stat.size,
    modified: stat.mtimeMs,
    created: stat.birthtimeMs || null,
    favorite: Boolean(favorites[key]),
  };
  try {
    if (kind === "video" || kind === "audio") return { ...base, media: await videoProperties(full) };
    if (kind === "image") return { ...base, image: await imageProperties(full) };
  } catch {
    return { ...base, unreadable: true };
  }
  return base;
}

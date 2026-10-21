import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
export const run = promisify(execFile);

function parseRate(rate) {
  const [n, d] = String(rate || "0/1").split("/").map(Number);
  return d ? n / d : n || 0;
}

// Everything the app needs to know about a video, with width/height as displayed
// (rotation applied — phones store portrait video as rotated landscape).
export async function probe(full) {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-show_entries",
    "format=duration,bit_rate,size:format_tags=creation_time:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,bit_rate,color_transfer,color_primaries,sample_rate,channels:stream_side_data=rotation",
    "-of", "json",
    full,
  ]);
  const info = JSON.parse(stdout);
  const v = info.streams?.find((s) => s.codec_type === "video");
  const a = info.streams?.find((s) => s.codec_type === "audio");
  const rawRotation = Number(v?.side_data_list?.find((d) => "rotation" in d)?.rotation ?? 0);
  const rotation = Math.abs(rawRotation);
  const swap = rotation === 90 || rotation === 270;
  const transfer = v?.color_transfer;

  return {
    duration: Number(info.format?.duration) || 0,
    size: Number(info.format?.size) || 0,
    bitrate: Number(info.format?.bit_rate) || 0,
    creationTime: info.format?.tags?.creation_time || null,
    video: v && {
      codec: v.codec_name,
      profile: v.profile,
      width: swap ? v.height : v.width,
      height: swap ? v.width : v.height,
      fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate),
      // Phones often record variable frame rate; the two rates disagree when they do.
      vfr: Math.abs(parseRate(v.avg_frame_rate) - parseRate(v.r_frame_rate)) > 0.5,
      pixFmt: v.pix_fmt,
      tenBit: /10|12/.test(v.pix_fmt || ""),
      hdr: transfer === "smpte2084" ? "pq" : transfer === "arib-std-b67" ? "hlg" : null,
      bitrate: Number(v.bit_rate) || 0,
      rotation: rawRotation,
    },
    audio: a && {
      codec: a.codec_name,
      sampleRate: Number(a.sample_rate) || 0,
      channels: a.channels,
      bitrate: Number(a.bit_rate) || 0,
    },
  };
}

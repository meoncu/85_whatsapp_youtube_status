#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
WhatsApp YouTube / Shorts & Instagram Reels Status Video Downloader & 60s Splitter
Directory: C:\Cursor\85_whatsapp_youtube_status
"""

import sys
import os
import json
import math
import subprocess
import argparse
from datetime import datetime

# Ensure UTF-8 stdout/stderr on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def get_ffmpeg_binary():
    """Return path to ffmpeg executable via imageio_ffmpeg or system PATH."""
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        pass
    return "ffmpeg"


def format_mmss(seconds):
    seconds = max(0, int(round(seconds)))
    hrs = seconds // 3600
    mins = (seconds % 3600) // 60
    secs = seconds % 60
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def probe_duration(ffmpeg_exe, file_path):
    """Parse exact duration in seconds from ffmpeg -i stderr output."""
    try:
        proc = subprocess.run(
            [ffmpeg_exe, "-i", file_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        output = proc.stderr or ""
        for line in output.splitlines():
            if "Duration:" in line:
                # e.g. Duration: 00:02:15.48, start: 0.000000, bitrate: ...
                dur_part = line.split("Duration:")[1].split(",")[0].strip()
                parts = dur_part.split(":")
                if len(parts) == 3:
                    h = float(parts[0])
                    m = float(parts[1])
                    s = float(parts[2])
                    return h * 3600 + m * 60 + s
    except Exception:
        pass
    return 0.0


def process_youtube_video(url, output_dir, segment_seconds=59):
    """
    Download a YouTube / Shorts video and split into WhatsApp Status compatible
    MP4 segments (max 60s each, H.264 + AAC, yuv420p, faststart).
    """
    import yt_dlp

    os.makedirs(output_dir, exist_ok=True)
    ffmpeg_exe = get_ffmpeg_binary()
    raw_template = os.path.join(output_dir, "source_video.%(ext)s")
    merged_mp4 = os.path.join(output_dir, "source_video.mp4")

    url = url.strip().rstrip(".,;!?'\"")

    ydl_opts = {
        "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
        "outtmpl": raw_template,
        "merge_output_format": "mp4",
        "ffmpeg_location": ffmpeg_exe,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)

    # Locate downloaded source file
    source_file = merged_mp4
    if not os.path.exists(source_file):
        for fname in os.listdir(output_dir):
            if fname.startswith("source_video."):
                source_file = os.path.join(output_dir, fname)
                break

    if not os.path.exists(source_file):
        raise RuntimeError("İndirilen video dosyası bulunamadı.")

    extractor = (info.get("extractor") or "").lower()
    is_instagram = "instagram" in extractor or "instagram.com" in url.lower()
    platform = "INSTAGRAM" if is_instagram else "YOUTUBE"

    video_id = info.get("id") or "unknown"
    raw_title = (info.get("title") or "").strip()
    raw_desc = (info.get("description") or "").strip()

    # Instagram videolarında başlık genellikle jenerik ("Video by ...") gelir. Açıklamanın ilk satırı başlık olarak daha anlamlıdır.
    if is_instagram and (not raw_title or raw_title.lower().startswith("video by") or len(raw_title) < 5) and raw_desc:
        first_line = raw_desc.splitlines()[0].strip()
        if len(first_line) > 110:
            first_line = first_line[:107] + "..."
        title = first_line if first_line else raw_title
    else:
        title = raw_title or ("Instagram Video" if is_instagram else "YouTube Video")

    uploader = info.get("uploader") or info.get("channel") or ("Instagram Kullanıcısı" if is_instagram else "Bilinmeyen Kanal")
    webpage_url = info.get("webpage_url") or url
    thumbnail = info.get("thumbnail") or ""
    width = info.get("width") or 0
    height = info.get("height") or 0
    is_short = "/shorts/" in url.lower() or "/reel" in url.lower() or is_instagram or (height and width and height > width)

    duration = float(info.get("duration") or 0)
    probed = probe_duration(ffmpeg_exe, source_file)
    if probed > 0:
        duration = probed
    if duration <= 0:
        duration = 60.0

    source_size_bytes = os.path.getsize(source_file)
    source_size_mb = round(source_size_bytes / (1024 * 1024), 2)

    # Determine segment count (max segment_seconds per chunk, default 59s for safe 60s WhatsApp Status limit)
    # If duration <= 60.5 seconds, keep as 1 segment (trimmed to max 60s if needed)
    if duration <= 60.0:
        total_parts = 1
    else:
        total_parts = int(math.ceil(duration / float(segment_seconds)))

    parts = []
    for idx in range(total_parts):
        part_num = idx + 1
        start_sec = idx * segment_seconds
        if total_parts == 1:
            end_sec = min(duration, 60.0)
        else:
            end_sec = min(duration, (idx + 1) * segment_seconds)
        chunk_dur = max(1.0, end_sec - start_sec)

        part_filename = f"part_{part_num:02d}.mp4"
        part_filepath = os.path.join(output_dir, part_filename)

        # Re-encode each segment to H.264 + AAC yuv420p so WhatsApp Status plays every chunk cleanly
        cmd = [
            ffmpeg_exe,
            "-y",
            "-ss", f"{start_sec:.2f}",
            "-i", source_file,
            "-t", f"{chunk_dur:.2f}",
            "-vf", "scale='min(1080,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-ac", "2",
            "-movflags", "+faststart",
            part_filepath
        ]

        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace"
        )

        if proc.returncode != 0 or not os.path.exists(part_filepath):
            raise RuntimeError(f"FFmpeg bölümleme hatası (Bölüm {part_num}): {proc.stderr[-400:]}")

        actual_dur = probe_duration(ffmpeg_exe, part_filepath) or chunk_dur
        part_size_bytes = os.path.getsize(part_filepath)
        part_size_mb = round(part_size_bytes / (1024 * 1024), 2)

        parts.append({
            "partNumber": part_num,
            "totalParts": total_parts,
            "fileName": part_filename,
            "filePath": part_filepath,
            "startSec": round(start_sec, 1),
            "endSec": round(end_sec, 1),
            "startFormatted": format_mmss(start_sec),
            "endFormatted": format_mmss(end_sec),
            "durationSec": round(actual_dur, 1),
            "durationFormatted": format_mmss(actual_dur),
            "sizeBytes": part_size_bytes,
            "sizeMb": part_size_mb
        })

    total_parts_size_mb = round(sum(p["sizeMb"] for p in parts), 2)

    result = {
        "success": True,
        "platform": platform,
        "videoId": video_id,
        "title": title,
        "uploader": uploader,
        "url": url,
        "webpageUrl": webpage_url,
        "thumbnail": thumbnail,
        "isShort": bool(is_short),
        "width": width,
        "height": height,
        "totalDurationSec": round(duration, 1),
        "totalDurationFormatted": format_mmss(duration),
        "sourceSizeMb": source_size_mb,
        "totalPartsSizeMb": total_parts_size_mb,
        "segmentLengthSec": segment_seconds,
        "totalParts": total_parts,
        "parts": parts,
        "processedAt": datetime.now().isoformat()
    }
    return result


def main():
    parser = argparse.ArgumentParser(description="YouTube Status Downloader & Splitter")
    parser.add_argument("--url", required=True, help="YouTube or YouTube Shorts URL")
    parser.add_argument("--out", required=True, help="Output directory for job")
    parser.add_argument("--segment", type=int, default=59, help="Segment duration in seconds (default 59s for 60s WhatsApp Status limit)")
    args = parser.parse_args()

    try:
        res = process_youtube_video(args.url, args.out, args.segment)
        print("\n===JSON_OUTPUT_START===")
        print(json.dumps(res, ensure_ascii=False))
        print("===JSON_OUTPUT_END===")
        sys.exit(0)
    except Exception as exc:
        err_payload = {
            "success": False,
            "error": str(exc)
        }
        print("\n===JSON_OUTPUT_START===")
        print(json.dumps(err_payload, ensure_ascii=False))
        print("===JSON_OUTPUT_END===")
        sys.exit(1)


if __name__ == "__main__":
    main()

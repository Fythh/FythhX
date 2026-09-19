#!/usr/bin/env python3
"""
AUTO CUTTER V8.1 (NOISE GATE & PRECISION EDITION)
===================================================
- Solusi area datar -24dB s/d -28dB yang lolos di Filmora
- Menggunakan Filter Dynamic Noise Gate sebelum detection
- Akhiran konsonan (H/S) tetep aman & padat
"""

import subprocess
import sys
import os
import json
import argparse
import re
from pathlib import Path


def get_duration(input_path):
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(input_path)],
        capture_output=True, text=True
    )
    info = json.loads(probe.stdout)
    return float(info["format"]["duration"])


def detect_silence(input_path, total_duration, silence_db=-25, min_silence_duration=0.12):
    print(f"\n=======================================================")
    print(f"🎬 MEMULAI PROSES AUTO-CUT VIDEO V8.1")
    print(f"=======================================================\n")
    print(f"🔍 TAHAP 1: Analisis Audio + Dynamic Noise Gate OBS...")
    print(f"   [Info] Threshold Target  : {silence_db} dB")
    print(f"   [Info] Min Durasi Hening : {min_silence_duration} detik")

    # CHAIN FILTER BARU:
    # 1. agate = Bikin suara noise background OBS dibawah -26dB langsung DIENDEPKAN/MUTED
    # 2. silencedetect = Ngetes bagian hening yang udah dibersihin
    audio_filter = f"agate=threshold=0.04:range=0.01,silencedetect=noise={silence_db}dB:d={min_silence_duration}"

    cmd = [
        "ffmpeg", "-i", str(input_path),
        "-af", audio_filter,
        "-f", "null", "-"
    ]

    process = subprocess.Popen(cmd, stderr=subprocess.PIPE, text=True, universal_newlines=True)

    silence_starts = []
    silence_ends = []

    for line in process.stderr:
        start_match = re.search(r"silence_start: ([\d.]+)", line)
        if start_match: silence_starts.append(float(start_match.group(1)))

        end_match = re.search(r"silence_end: ([\d.]+)", line)
        if end_match: silence_ends.append(float(end_match.group(1)))

        time_match = re.search(r"time=(\d+):(\d+):([\d.]+)", line)
        if time_match and total_duration > 0:
            h, m, s = time_match.groups()
            current_time = int(h)*3600 + int(m)*60 + float(s)
            percent = min((current_time / total_duration) * 100, 100)
            sys.stdout.write(f"\r   => Progress Analisa: [{percent:.1f}%] - Membersihkan noise & deteksi...")
            sys.stdout.flush()

    process.wait()
    sys.stdout.write("\n")

    silences = list(zip(silence_starts, silence_ends))
    print(f"   ✅ Selesai! Berhasil nemu {len(silences)} titik ampas hening.")
    return silences


def get_keep_segments(silences, total_duration, padding=0.05):
    keep = []
    current_time = 0.0

    for s_start, s_end in silences:
        seg_end = s_start + padding
        if seg_end - current_time > 0.05:
            keep.append((current_time, seg_end))
        current_time = max(s_end - padding, seg_end)

    if total_duration - current_time > 0.05:
        keep.append((current_time, total_duration))

    return keep


def one_shot_render(input_path, segments, output_dir, prefix, kept_duration):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Fix bug nama file double _FINAL_CUT
    clean_prefix = re.sub(r'(_FINAL_CUT)+$', '', prefix)
    final_output = output_dir / f"{clean_prefix}_FINAL_CUT.mp4"
    list_file = output_dir / "catatan_potongan.txt"
    
    print(f"\n✂️  TAHAP 2: Menyiapkan Catatan Potongan...")
    
    safe_input_path = str(input_path.resolve()).replace('\\', '/')
    with open(list_file, "w", encoding="utf-8") as f:
        for start, end in segments:
            f.write(f"file '{safe_input_path}'\n")
            f.write(f"inpoint {start:.3f}\n")
            f.write(f"outpoint {end:.3f}\n")

    print(f"🚀 TAHAP 3: GPU Memotong & Menjahit Video...")
    
    cmd = [
        "ffmpeg", 
        "-hwaccel", "cuda",
        "-f", "concat", "-safe", "0",
        "-i", str(list_file),
        "-c:v", "hevc_nvenc",
        "-preset", "p2",
        "-b:v", "30M",
        "-maxrate", "30M",
        "-bufsize", "30M",
        "-c:a", "aac", "-b:a", "192k",
        "-y", str(final_output)
    ]
    
    process = subprocess.Popen(cmd, stderr=subprocess.PIPE, text=True, universal_newlines=True)
    
    for line in process.stderr:
        time_match = re.search(r"time=(\d+):(\d+):([\d.]+)", line)
        if time_match and kept_duration > 0:
            h, m, s = time_match.groups()
            current_time = int(h)*3600 + int(m)*60 + float(s)
            percent = min((current_time / kept_duration) * 100, 100)
            sys.stdout.write(f"\r   => Progress Render: [{percent:.1f}%] - GPU Menjahit...")
            sys.stdout.flush()

    process.wait()
    sys.stdout.write("\n")
    
    list_file.unlink(missing_ok=True) 
    return final_output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    # Settingan Pas Banget Buat Audio OBS Lu:
    parser.add_argument("--silence-db", type=float, default=-25)      # Tembak di -25dB karena noise floor lu di -26dB
    parser.add_argument("--min-silence", type=float, default=0.12)    # 120ms
    parser.add_argument("--padding", type=float, default=0.05)        # 50ms (Aman sentosa buat H/S)
    parser.add_argument("--output", type=str, default=None)
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"❌ ERROR: File video tidak ditemukan di {input_path}")
        sys.exit(1)

    output_dir = Path(args.output) if args.output else Path(input_path.stem + "_clips")
    
    total_duration = get_duration(input_path)
    silences = detect_silence(input_path, total_duration, args.silence_db, args.min_silence)
    
    if not silences:
        print("💡 Tidak ada jeda sunyi yang terdeteksi.")
        sys.exit(0)
        
    segments = get_keep_segments(silences, total_duration, args.padding)
    kept_duration = sum(e - s for s, e in segments)
    removed = total_duration - kept_duration
    
    final_file = one_shot_render(input_path, segments, output_dir, input_path.stem, kept_duration)
    
    print(f"\n=======================================================")
    print(f"🎉 SELESAI V8.1!")
    print(f"  ▶️ Durasi Awal      : {total_duration/60:.1f} menit")
    print(f"  ✂️ Ampas Dibuang    : {removed/60:.1f} menit")
    print(f"  🔥 Hasil Daging     : {kept_duration/60:.1f} menit")
    print(f"  📁 Tersimpan di     : {final_file}")
    print(f"=======================================================\n")


if __name__ == "__main__":
    main()
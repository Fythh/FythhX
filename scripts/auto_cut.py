#!/usr/bin/env python3
"""
AUTO CUTTER V7 (MASTER QUALITY 30Mbps + SUPER NGEBUT + BAHASA MANUSIA)
===================================================
- Bitrate dipaksa 30 Mbps (Kualitas mentahan/Master)
- Tampilan CMD sangat ramah untuk orang awam
- Render 1 kali jalan (One-Shot) biar GPU kerja maksimal tanpa loading berulang
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


def detect_silence(input_path, total_duration, silence_db=-30, min_silence_duration=0.2):
    print(f"\n=======================================================")
    print(f"🎬 MEMULAI PROSES AUTO-CUT VIDEO")
    print(f"=======================================================\n")
    print(f"🔍 TAHAP 1: AI Menganalisa Suara Video (Mencari bagian yang hening/tidak ada suara)...")
    print(f"   [Info] Video yang diproses : {input_path.name}")
    print(f"   [Info] Batas keheningan    : {min_silence_duration} detik")

    cmd = [
        "ffmpeg", "-i", str(input_path),
        "-af", f"silencedetect=noise={silence_db}dB:d={min_silence_duration}",
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
            sys.stdout.write(f"\r   => Progress Analisa: [{percent:.1f}%] - Sabar ya, lagi ngedengerin video...")
            sys.stdout.flush()

    process.wait()
    sys.stdout.write("\n")

    silences = list(zip(silence_starts, silence_ends))
    print(f"   ✅ Selesai! Ketemu {len(silences)} titik hening yang siap dibuang.")
    return silences


def get_keep_segments(silences, total_duration, padding=0.05):
    keep = []
    cursor = 0.0
    for s_start, s_end in silences:
        seg_start = cursor
        seg_end = s_start + padding
        if seg_end - seg_start > 0.1:
            keep.append((seg_start, seg_end))
        cursor = max(cursor, s_end - padding)
    if total_duration - cursor > 0.1:
        keep.append((cursor, total_duration))
    return keep


def one_shot_render(input_path, segments, output_dir, prefix, kept_duration):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    final_output = output_dir / f"{prefix}_FINAL_CUT.mp4"
    list_file = output_dir / "catatan_potongan.txt"
    
    print(f"\n✂️  TAHAP 2: Menyiapkan Catatan Potongan Untuk Mesin...")
    
    # Bikin file catatan (EDL) biar mesin gak bingung
    safe_input_path = str(input_path.resolve()).replace('\\', '/')
    with open(list_file, "w", encoding="utf-8") as f:
        for start, end in segments:
            f.write(f"file '{safe_input_path}'\n")
            f.write(f"inpoint {start:.3f}\n")
            f.write(f"outpoint {end:.3f}\n")

    print(f"🚀 TAHAP 3: GPU Memotong & Menjahit Video (Satu Kali Jalan)...")
    print(f"   [Info] Target Bitrate      : 30 Mbps (Kualitas Master Jernih)")
    print(f"   [Info] Menggunakan GPU     : NVIDIA NVENC (HEVC/H.265)")
    
    cmd = [
        "ffmpeg", 
        "-hwaccel", "cuda",          # Buka gerbang GPU untuk ngebaca video (Decoding)
        "-f", "concat", "-safe", "0",
        "-i", str(list_file),
        "-c:v", "hevc_nvenc",        # Buka gerbang GPU untuk nulis video (Encoding)
        "-preset", "p2",             # Preset cepat
        "-b:v", "30M",               # Paksa target bitrate ke 30 Mbps
        "-maxrate", "30M",           # Batas maksimal 30 Mbps
        "-bufsize", "30M",           # Buffer 30 Mbps biar stabil
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
            sys.stdout.write(f"\r   => Progress Render: [{percent:.1f}%] - GPU lagi ngebut menjahit potongan...")
            sys.stdout.flush()

    process.wait()
    sys.stdout.write("\n")
    
    # Hapus file catatan biar folder rapi
    list_file.unlink(missing_ok=True) 
    print(f"   ✅ Proses potong dan jahit selesai!")
    return final_output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--silence-db", type=float, default=-30)
    parser.add_argument("--min-silence", type=float, default=0.2)
    parser.add_argument("--padding", type=float, default=0.05)
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
        print("💡 Tidak ada jeda sunyi yang terdeteksi. Video tidak perlu dipotong.")
        sys.exit(0)
        
    segments = get_keep_segments(silences, total_duration, args.padding)
    kept_duration = sum(e - s for s, e in segments)
    removed = total_duration - kept_duration
    
    final_file = one_shot_render(input_path, segments, output_dir, input_path.stem, kept_duration)
    
    print(f"\n=======================================================")
    print(f"🎉 SEMUA PROSES BERHASIL! INI HASILNYA:")
    print(f"=======================================================")
    print(f"  ▶️ Durasi Awal Video      : {total_duration/60:.1f} menit")
    print(f"  ✂️ Bagian Ampas Dibuang   : {removed/60:.1f} menit ({removed/total_duration*100:.0f}% kebuang)")
    print(f"  🔥 Durasi Video Jadi (Daging): {kept_duration/60:.1f} menit")
    print(f"  📁 File Siap Edit Tersimpan di: {final_file}")
    print(f"=======================================================\n")


if __name__ == "__main__":
    main()
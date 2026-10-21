import sys
import json
import wave
import math
import traceback
from collections import defaultdict

def analyze_audio(wav_path):
    try:
        with wave.open(wav_path, 'rb') as wf:
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            n_frames = wf.getnframes()
            
            if sampwidth != 2:
                # We expect 16-bit PCM
                raise ValueError("Expected 16-bit PCM WAV")
                
            chunk_size = framerate # 1 second chunks
            features = []
            
            for i in range(0, n_frames, chunk_size):
                frames_to_read = min(chunk_size, n_frames - i)
                data = wf.readframes(frames_to_read)
                
                # Fast parse using memoryview or struct.
                # 16-bit audio -> 2 bytes per sample.
                import struct
                fmt = f"<{frames_to_read * n_channels}h"
                try:
                    samples = struct.unpack(fmt, data)
                except struct.error:
                    break
                    
                if not samples:
                    break
                    
                # Calculate RMS
                sum_squares = sum(s * s for s in samples)
                rms = math.sqrt(sum_squares / len(samples))
                
                # Convert to roughly decibels (0 to 100 scale for simplicity)
                # 32768 is max for 16-bit signed
                db = 20 * math.log10(max(rms, 1) / 32768) 
                
                # Peak
                peak = max(abs(s) for s in samples)
                peak_db = 20 * math.log10(max(peak, 1) / 32768)
                
                timestamp_sec = i / framerate
                
                features.append({
                    "time": round(timestamp_sec, 2),
                    "rms_db": round(db, 2),
                    "peak_db": round(peak_db, 2)
                })
                
        # Calculate derived features (sudden energy rises, silences)
        for idx, f in enumerate(features):
            prev_rms = features[idx-1]["rms_db"] if idx > 0 else -100
            # Difference in dB
            f["energy_rise"] = round(f["rms_db"] - prev_rms, 2)
            f["is_silence"] = f["rms_db"] < -40 # Below -40dB is typically silence/noise floor
            
        print(json.dumps({"ok": True, "features": features}))
        
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e), "traceback": traceback.format_exc()}))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "No input WAV file provided"}))
        sys.exit(1)
        
    analyze_audio(sys.argv[1])

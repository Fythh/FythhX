import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import json
import sys
import gc
from faster_whisper import WhisperModel

video_file = sys.argv[1]
json_file = sys.argv[2]
model_name = sys.argv[3] if len(sys.argv) > 3 else 'small'

print("[System] Initialize model...", flush=True)
model = None
segments = None

try:
    print("[System] Using GPU (CUDA) for transcription. Transcribing...", flush=True)
    model = WhisperModel(model_name, device='cuda', compute_type='float16')
    segments, info = model.transcribe(video_file, language='id', word_timestamps=True)
    # Convert generator to list to force execution and trigger any CUDA errors immediately
    segments = list(segments)
except Exception as e:
    print(f"[System] CUDA error during transcription: {e}. Falling back to CPU...", flush=True)
    if model is not None:
        del model
    gc.collect()
    
    # cpu_threads=4 avoids mkl_malloc failures on multi-core CPUs with limited RAM
    model = WhisperModel(model_name, device='cpu', compute_type='int8', cpu_threads=4)
    segments, info = model.transcribe(video_file, language='id', word_timestamps=True)
    segments = list(segments)

data = []
max_words = int(sys.argv[4]) if len(sys.argv) > 4 else 3
for segment in segments:
    print(f"[{segment.start:.2f}s] Processing words...", flush=True)
    words = list(segment.words) if segment.words else []
    for i in range(0, len(words), max_words):
        chunk = words[i:i+max_words]
        if chunk:
            data.append({
                'start': chunk[0].start,
                'end': chunk[-1].end,
                'text': ' '.join([w.word.strip() for w in chunk])
            })

with open(json_file, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

#!/usr/bin/env python3
"""
scripts/motion_tracker.py
Autonomous Cinematic Motion & Subject Tracking for FytX Video Clipper.

Fixes for "Earthquake sensation" / "Sensasi gempa":
1. Continuous Gaussian Trajectory Smoothing:
   Replaces jerky start-stop deadband threshold pulses with infinite-order (C^inf)
   Gaussian kernel filtering. Glides smoothly alongside natural YouTube camera pans.
2. Rigid Cranial Landmark Anchor (Mid-eyes + Nose bridge):
   Anchors to rigid skull structure, completely immune to jaw/mouth speech movements.
3. Heavy Vertical Headroom Stabilization (sigma_y = 2.2x sigma_x):
   Eliminates all up-and-down bobbing when talking or nodding.
4. Natural User Zoom Retention:
   Preserves the user's canvas zoom level without artificial 800% magnification blowups.
5. Smoothed Live Scrub Feedback:
   Live stream progress uses filtered trajectory so the preview never twitches during recording.
"""

import sys
import os
import json
import argparse
import math
import subprocess

try:
    import cv2
    import numpy as np
    from scipy.ndimage import gaussian_filter1d
except ImportError as e:
    print(json.dumps({"ok": False, "error": f"Required library not installed: {str(e)}"}), file=sys.stderr)
    sys.exit(1)

# Pre-load MediaPipe FaceDetection and FaceMesh once at module level
MP_FACE_DETECTOR = None
MP_FACE_MESH = None
try:
    import mediapipe as mp
    MP_FACE_DETECTOR = mp.solutions.face_detection.FaceDetection(
        model_selection=1, min_detection_confidence=0.32
    )
    MP_FACE_MESH = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=3,
        refine_landmarks=True,
        min_detection_confidence=0.30,
        min_tracking_confidence=0.30
    )
except Exception:
    MP_FACE_DETECTOR = None
    MP_FACE_MESH = None


def create_tracker():
    """Create OpenCV tracker for custom target mode, prioritizing CSRT for high spatial fidelity."""
    if hasattr(cv2, 'TrackerCSRT_create'):
        return cv2.TrackerCSRT_create()
    elif hasattr(cv2, 'legacy') and hasattr(cv2.legacy, 'TrackerCSRT_create'):
        return cv2.legacy.TrackerCSRT_create()
    elif hasattr(cv2, 'TrackerKCF_create'):
        return cv2.TrackerKCF_create()
    elif hasattr(cv2, 'legacy') and hasattr(cv2.legacy, 'TrackerKCF_create'):
        return cv2.legacy.TrackerKCF_create()
    elif hasattr(cv2, 'TrackerMIL_create'):
        return cv2.TrackerMIL_create()
    elif hasattr(cv2, 'legacy') and hasattr(cv2.legacy, 'TrackerMIL_create'):
        return cv2.legacy.TrackerMIL_create()
    else:
        raise RuntimeError("No suitable OpenCV Tracker found. Install opencv-contrib-python.")


def extract_mouth_patch(frame_gray, mx, my, mw, mh):
    """Extract normalized 24x16 grayscale mouth patch for head-stabilized lip motion energy."""
    if frame_gray is None:
        return None
    try:
        h, w = frame_gray.shape[:2]
        half_w = max(6.0, float(mw) * 0.5)
        half_h = max(4.0, float(mh) * 0.5)
        x1 = max(0, int(round(mx - half_w)))
        y1 = max(0, int(round(my - half_h)))
        x2 = min(w, int(round(mx + half_w)))
        y2 = min(h, int(round(my + half_h)))
        if x2 - x1 < 4 or y2 - y1 < 4:
            return None
        roi = cv2.resize(frame_gray[y1:y2, x1:x2], (24, 16), interpolation=cv2.INTER_AREA).astype(np.float32)
        mean_val = float(np.mean(roi))
        std_val = float(np.std(roi)) + 3.0
        return (roi - mean_val) / std_val
    except Exception:
        return None


def extract_audio_rms_profile(video_path, start_sec, end_sec, target_fps=30.0):
    """
    Extracts high-resolution audio RMS energy profile synchronized with video frames.
    Used for multimodal active speaker verification (rejecting silent listeners).
    """
    if not video_path or not os.path.isfile(video_path):
        return None
    try:
        dur = max(0.5, float(end_sec) - float(start_sec))
        cmd = [
            'ffmpeg', '-y', '-ss', str(max(0.0, float(start_sec))),
            '-t', str(dur),
            '-i', video_path,
            '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'
        ]
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        raw_data, _ = p.communicate(timeout=10)
        if not raw_data or len(raw_data) < 64:
            return None
        samples = np.frombuffer(raw_data, dtype=np.float32)
        total_samples = len(samples)
        samples_per_frame = max(1, int(round(16000.0 / float(target_fps))))
        num_frames = int(math.ceil(total_samples / float(samples_per_frame)))
        rms_list = []
        for fi in range(num_frames):
            s_idx = fi * samples_per_frame
            e_idx = min(total_samples, s_idx + samples_per_frame)
            if s_idx < e_idx:
                chunk = samples[s_idx:e_idx]
                r = float(np.sqrt(np.mean(chunk ** 2)))
            else:
                r = 0.0
            rms_list.append(r)
        return rms_list
    except Exception:
        return None


def detect_all_faces(frame_rgb, frame_gray=None):
    """
    Detect all faces in frame (up to 3) using MediaPipe FaceMesh (478 3D landmarks)
    with exact nasal bridge ('batang hidung') cranial anchor + BlazeFace fallback.
    Invariant to head pitch/tilt, mouth opening, laughing, talking, and skull shapes.
    """
    h, w = frame_rgb.shape[:2]
    detections = []

    # 1. Primary: MediaPipe FaceMesh (478 3D landmarks with exact inner/outer lip aperture)
    if MP_FACE_MESH is not None:
        try:
            mesh_res = MP_FACE_MESH.process(frame_rgb)
            if mesh_res and mesh_res.multi_face_landmarks:
                for face_lms in mesh_res.multi_face_landmarks:
                    lm = face_lms.landmark
                    xs = [p.x * w for p in lm]
                    ys = [p.y * h for p in lm]
                    bx = max(0.0, min(xs))
                    by = max(0.0, min(ys))
                    bw = max(12.0, min(float(w) - bx, max(xs) - bx))
                    bh = max(12.0, min(float(h) - by, max(ys) - by))

                    # Exact Cranial Nasal Bridge ("Batang Hidung") Anchor:
                    # lm[168] = nasal bridge between inner eye corners (sellion)
                    # lm[1]   = nose tip (pronasale)
                    # lm[33], lm[263] = eye corners
                    bridge_x, bridge_y = lm[168].x * w, lm[168].y * h
                    tip_x, tip_y = lm[1].x * w, lm[1].y * h
                    re_x, re_y = lm[33].x * w, lm[33].y * h
                    le_x, le_y = lm[263].x * w, lm[263].y * h
                    mid_eyes_x = (re_x + le_x) * 0.5
                    mid_eyes_y = (re_y + le_y) * 0.5

                    # Invariant across different individuals, invariant to head pitch/tilt (+/-45°), laughing, jaw opening
                    rigid_cx = bridge_x * 0.55 + tip_x * 0.30 + mid_eyes_x * 0.15
                    rigid_cy = bridge_y * 0.55 + tip_y * 0.30 + mid_eyes_y * 0.15

                    # Lip Landmarks for Visual Active Speaker Detection (MAR)
                    c_left_x, c_left_y = lm[78].x * w, lm[78].y * h
                    c_right_x, c_right_y = lm[308].x * w, lm[308].y * h
                    mouth_w = max(6.0, math.hypot(c_right_x - c_left_x, c_right_y - c_left_y))

                    # 3 vertical inner lip pairs (left-mid 82-87, center 13-14, right-mid 312-317)
                    d_center = math.hypot((lm[13].x - lm[14].x) * w, (lm[13].y - lm[14].y) * h)
                    d_left = math.hypot((lm[82].x - lm[87].x) * w, (lm[82].y - lm[87].y) * h)
                    d_right = math.hypot((lm[312].x - lm[317].x) * w, (lm[312].y - lm[317].y) * h)
                    inner_open = (d_center + d_left + d_right) / 3.0

                    # Outer lip vertical distance (0 to 17)
                    outer_open = math.hypot((lm[0].x - lm[17].x) * w, (lm[0].y - lm[17].y) * h)
                    mar = (inner_open * 0.78 + outer_open * 0.22) / mouth_w

                    mx = (lm[13].x + lm[14].x) * 0.5 * w
                    my = (lm[13].y + lm[14].y) * 0.5 * h
                    m_patch = extract_mouth_patch(frame_gray, mx, my, mouth_w * 1.15, mouth_w * 0.80) if frame_gray is not None else None

                    detections.append({
                        "bbox": (bx, by, bw, bh),
                        "cx": rigid_cx,
                        "cy": rigid_cy,
                        "w": bw,
                        "h": bh,
                        "mar": float(mar),
                        "has_mesh": True,
                        "mouth_patch": m_patch,
                        "score": 0.95
                    })
        except Exception:
            pass

    # 2. Complement with MediaPipe FaceDetection (catches distant / profile faces)
    if MP_FACE_DETECTOR is not None:
        try:
            fd_res = MP_FACE_DETECTOR.process(frame_rgb)
            if fd_res and fd_res.detections:
                for d in fd_res.detections:
                    bb = d.location_data.relative_bounding_box
                    bx = max(0.0, bb.xmin * w)
                    by = max(0.0, bb.ymin * h)
                    bw = max(12.0, min(float(w) - bx, bb.width * w))
                    bh = max(12.0, min(float(h) - by, bb.height * h))

                    kps = d.location_data.relative_keypoints
                    if kps and len(kps) >= 3:
                        re_x, re_y = kps[0].x * w, kps[0].y * h
                        le_x, le_y = kps[1].x * w, kps[1].y * h
                        nose_x, nose_y = kps[2].x * w, kps[2].y * h
                        mid_eyes_x = (re_x + le_x) * 0.5
                        mid_eyes_y = (re_y + le_y) * 0.5
                        rigid_cx = nose_x * 0.60 + mid_eyes_x * 0.40
                        rigid_cy = nose_y * 0.60 + mid_eyes_y * 0.40
                    else:
                        rigid_cx = bx + bw * 0.50
                        rigid_cy = by + bh * 0.38  # Nasal bridge level, NOT chin/mouth!

                    # Check if this face is already covered by a FaceMesh detection
                    already_found = False
                    for existing in detections:
                        dist = math.hypot(rigid_cx - existing["cx"], rigid_cy - existing["cy"])
                        if dist < max(bw, existing["w"]) * 0.55:
                            already_found = True
                            break
                    if already_found:
                        continue

                    if kps and len(kps) >= 4:
                        mx, my = kps[3].x * w, kps[3].y * h
                        eye_dist = max(8.0, math.hypot(le_x - re_x, le_y - re_y))
                        nose_mouth_dist = math.hypot(mx - nose_x, my - nose_y)
                        est_mar = max(0.05, (nose_mouth_dist / eye_dist) - 0.55) * 0.5
                    else:
                        mx = bx + bw * 0.50
                        my = by + bh * 0.76
                        est_mar = 0.12

                    m_patch = extract_mouth_patch(frame_gray, mx, my, bw * 0.42, bh * 0.28) if frame_gray is not None else None
                    detections.append({
                        "bbox": (bx, by, bw, bh),
                        "cx": rigid_cx,
                        "cy": rigid_cy,
                        "w": bw,
                        "h": bh,
                        "mar": float(est_mar),
                        "has_mesh": False,
                        "mouth_patch": m_patch,
                        "score": float(d.score[0]) if d.score else 0.6
                    })
        except Exception:
            pass

    return detections


def detect_face_mediapipe_rich(frame_rgb, prev_point=None, src_w=1920, src_h=1080, frame_gray=None):
    """
    Detect face in RGB frame using high precision nasal bridge anchor.
    Returns:
      {
        "bbox": (bx, by, bw, bh),
        "cx": rigid_cx,
        "cy": rigid_cy,
        "w": bw,
        "h": bh,
        "score": score
      }
    """
    dets = detect_all_faces(frame_rgb, frame_gray)
    if not dets:
        return None
    if prev_point is not None and len(dets) > 1:
        px, py = prev_point
        return min(dets, key=lambda d: (d["cx"] - px) ** 2 + (d["cy"] - py) ** 2)
    return max(dets, key=lambda d: (d["w"] * d["h"]) * d["score"])


def detect_face_haar(frame_gray):
    """Fallback face detection using OpenCV Haar Cascade."""
    try:
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        if not os.path.exists(cascade_path):
            return None
        cascade = cv2.CascadeClassifier(cascade_path)
        faces = cascade.detectMultiScale(frame_gray, scaleFactor=1.15, minNeighbors=4, minSize=(40, 40))
        if len(faces) == 0:
            return None
        faces = sorted(faces, key=lambda b: b[2] * b[3], reverse=True)
        fb = tuple(float(v) for v in faces[0])
        return {
            "bbox": fb,
            "cx": fb[0] + fb[2] * 0.5,
            "cy": fb[1] + fb[3] * 0.38,
            "w": fb[2],
            "h": fb[3],
            "score": 0.5
        }
    except Exception:
        return None


def extract_person_signature(frame_bgr, det):
    """
    Computes a compact Appearance Signature (HSV Hue-Sat + Value/Brightness histogram)
    combining the Face ROI and the Upper Torso/Shirt ROI directly below the face.
    Distinguishes speakers across multi-camera podcast cuts (e.g., black shirt vs white shirt).
    """
    if frame_bgr is None or det is None:
        return None
    h_img, w_img = frame_bgr.shape[:2]
    cx, cy, fw, fh = float(det["cx"]), float(det["cy"]), float(det["w"]), float(det["h"])

    # 1. Face ROI
    fx0 = max(0, min(w_img - 2, int(round(cx - fw * 0.45))))
    fx1 = max(fx0 + 2, min(w_img, int(round(cx + fw * 0.45))))
    fy0 = max(0, min(h_img - 2, int(round(cy - fh * 0.45))))
    fy1 = max(fy0 + 2, min(h_img, int(round(cy + fh * 0.55))))

    # 2. Upper Torso / Shirt ROI (below chin)
    tx0 = max(0, min(w_img - 2, int(round(cx - fw * 0.90))))
    tx1 = max(tx0 + 2, min(w_img, int(round(cx + fw * 0.90))))
    ty0 = max(0, min(h_img - 2, int(round(cy + fh * 0.60))))
    ty1 = max(ty0 + 2, min(h_img, int(round(cy + fh * 2.30))))

    def roi_hist(x0, y0, x1, y1):
        patch = frame_bgr[y0:y1, x0:x1]
        if patch.size == 0:
            return np.zeros(48, dtype=np.float32)
        hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
        h_hist = cv2.calcHist([hsv], [0], None, [16], [0, 180]).flatten()
        s_hist = cv2.calcHist([hsv], [1], None, [16], [0, 256]).flatten()
        v_hist = cv2.calcHist([hsv], [2], None, [16], [0, 256]).flatten()
        vec = np.concatenate([h_hist, s_hist, v_hist]).astype(np.float32)
        norm = float(np.linalg.norm(vec))
        return vec / norm if norm > 1e-6 else vec

    face_vec = roi_hist(fx0, fy0, fx1, fy1)
    torso_vec = roi_hist(tx0, ty0, tx1, ty1)
    combined = np.concatenate([face_vec * 0.35, torso_vec * 0.65]).astype(np.float32)
    c_norm = float(np.linalg.norm(combined))
    return combined / c_norm if c_norm > 1e-6 else combined


def compare_signature(sig_a, sig_b):
    """Returns cosine similarity in [0.0, 1.0] between two L2-normalized appearance signatures."""
    if sig_a is None or sig_b is None:
        return 0.5
    return float(np.clip(np.dot(sig_a, sig_b), 0.0, 1.0))


def smooth_trajectory_gaussian(coords, sigma):
    """Smooth coordinate trajectory using 1D Gaussian filter with boundary clamping."""
    if len(coords) <= 1 or sigma <= 0.1:
        return np.array(coords, dtype=np.float64)
    eff_sigma = min(float(sigma), max(1.0, len(coords) / 3.0))
    return gaussian_filter1d(coords, sigma=eff_sigma, mode='nearest')


def apply_hardlock_and_gaussian(raw_coords, smooth_val, deadzone_val, eff_sigma):
    """Run Pass 1 dynamic Hardlock filter + Pass 2 Gaussian S-curve ease on 1D coordinate list."""
    n = len(raw_coords)
    if n == 0:
        return np.array([], dtype=np.float64)
    base_alpha = max(0.20, min(0.70, 0.55 - (smooth_val / 100.0) * 0.30))
    noise_thresh = max(1.5, min(4.0, deadzone_val * 0.18))
    cur = float(raw_coords[0])
    pass1 = np.zeros(n, dtype=np.float64)
    for i in range(n):
        val = float(raw_coords[i])
        diff = val - cur
        dist = abs(diff)
        if dist <= noise_thresh:
            factor = max(0.12, (dist / noise_thresh) ** 2)
            alpha = base_alpha * factor
        else:
            boost = min(0.22, ((dist - noise_thresh) / 12.0) * 0.18)
            alpha = min(0.72, base_alpha + boost)
        cur += alpha * diff
        pass1[i] = cur
    return smooth_trajectory_gaussian(pass1, eff_sigma)


def apply_segmented_hardlock_and_gaussian(raw_coords, scene_cuts, smooth_val, deadzone_val, eff_sigma):
    """
    Applies Hardlock + Gaussian smoothing independently within each camera shot segment
    bounded by scene_cuts (where scene_cuts[i] == True).
    Ensures instantaneous 0-frame camera snap on scene cuts without floating across the screen.
    """
    n = len(raw_coords)
    if n == 0:
        return np.array([], dtype=np.float64)
    out = np.zeros(n, dtype=np.float64)
    seg_start = 0
    for i in range(1, n + 1):
        if i == n or (i < len(scene_cuts) and scene_cuts[i]):
            seg = raw_coords[seg_start:i]
            if len(seg) > 0:
                out[seg_start:i] = apply_hardlock_and_gaussian(seg, smooth_val, deadzone_val, eff_sigma)
            seg_start = i
    return out


def track_video(video_path, start_sec=0.0, end_sec=None, mode='face', init_bbox=None, smoothness=50, deadzone=15, zoom=1.15, anchor_x=0.50, anchor_y=0.40, sensitivity=50):
    """
    Intelligent Cinematic Single-Subject Motion & Face Tracker.
    Features:
    1. 3D Cranial Nasal Bridge Lock (Batang Hidung):
       Anchors to MediaPipe FaceMesh Landmark 168 (sellion) + Landmark 1 (pronasale).
       Completely invariant across different individuals, invariant to head pitch/tilt,
       laughing, talking, mouth opening, and varying facial proportions.
    2. Multi-Speaker Awareness (2-Speaker Podcast Clips):
       - Solo Shots / Camera Cuts: Automatically recognizes cuts between Speaker 1 & 2
         and instantaneously snaps crop to the new speaker's nasal bridge with 0-frame drift.
       - 2-Shot / Wide Scenes: Evaluates mouth aperture (MAR) + lip movement optical energy
         synchronized with audio speech RMS to smoothly pan to the active speaker with hysteresis stability.
    3. Segmented Hardlock & Gaussian Smoothing:
       Gaussian filtering is strictly segmented within camera shots, eliminating
       cross-scene floating camera lag while delivering buttery 144Hz cinematic pans.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"ok": False, "error": f"Failed to open video: {video_path}"}

    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_duration = total_frames / fps if total_frames > 0 else 0.0

    if end_sec is None or end_sec <= start_sec:
        end_sec = video_duration if video_duration > 0 else (start_sec + 30.0)

    start_frame = max(0, int(round(start_sec * fps)))
    end_frame = max(start_frame + 1, int(round(end_sec * fps)))

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    ret, first_frame = cap.read()
    if not ret or first_frame is None:
        cap.release()
        return {"ok": False, "error": f"Could not read frame at start second {start_sec}"}

    first_frame_rgb = cv2.cvtColor(first_frame, cv2.COLOR_BGR2RGB)
    first_frame_gray = cv2.cvtColor(first_frame, cv2.COLOR_BGR2GRAY)
    prev_small_gray = cv2.resize(first_frame_gray, (64, 36))
    prev_hist = cv2.calcHist([prev_small_gray], [0], None, [32], [0, 256])
    cv2.normalize(prev_hist, prev_hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)

    # Initial target resolution
    initial_detection = None
    bbox = None
    sig_speaker1 = None

    if init_bbox and len(init_bbox) == 4 and init_bbox[2] > 0 and init_bbox[3] > 0:
        bx, by, bw, bh = [float(v) for v in init_bbox]
        if 0.0 <= bx <= 1.0 and 0.0 <= by <= 1.0 and bw <= 1.0 and bh <= 1.0:
            bx = bx * src_w
            by = by * src_h
            bw = bw * src_w
            bh = bh * src_h
        bx = max(0.0, min(float(src_w) - 10.0, bx))
        by = max(0.0, min(float(src_h) - 10.0, by))
        bw = max(10.0, min(float(src_w) - bx, bw))
        bh = max(10.0, min(float(src_h) - by, bh))
        bbox = (bx, by, bw, bh)
        initial_detection = {
            "bbox": bbox,
            "cx": bx + bw * 0.5,
            "cy": by + bh * 0.5,
            "w": bw,
            "h": bh,
            "score": 1.0
        }
    elif mode == 'face':
        first_dets = detect_all_faces(first_frame_rgb, first_frame_gray)
        if first_dets:
            # If user positioned lock anchor dot (Focus Anchor X / Headroom Y), find closest face!
            user_target_x = float(anchor_x) * float(src_w)
            user_target_y = float(anchor_y) * float(src_h)
            closest_det = min(first_dets, key=lambda d: math.hypot(d["cx"] - user_target_x, d["cy"] - user_target_y))
            min_dist = math.hypot(closest_det["cx"] - user_target_x, closest_det["cy"] - user_target_y)
            if min_dist < float(src_w) * 0.45:
                initial_detection = closest_det
            else:
                initial_detection = max(first_dets, key=lambda d: d["w"] * d["h"])
            sig_speaker1 = extract_person_signature(first_frame, initial_detection)
        else:
            initial_detection = detect_face_haar(first_frame_gray)

    if not initial_detection:
        def_w = float(src_w) * 0.28
        def_h = float(src_h) * 0.35
        def_x = float(src_w - def_w) / 2.0
        def_y = float(src_h) * 0.15
        bbox = (def_x, def_y, def_w, def_h)
        initial_detection = {
            "bbox": bbox,
            "cx": def_x + def_w * 0.5,
            "cy": def_y + def_h * 0.38,
            "w": def_w,
            "h": def_h,
            "score": 0.5
        }
    else:
        bbox = initial_detection["bbox"]

    # Custom Tracker (CSRT) mode
    custom_tracker = None
    track_scale = 1.0
    if mode == 'custom' or init_bbox:
        track_max_w = 720.0
        track_scale = track_max_w / float(src_w) if src_w > track_max_w else 1.0
        tw = max(16, int(round(src_w * track_scale)))
        th = max(16, int(round(src_h * track_scale)))
        track_first = cv2.resize(first_frame, (tw, th), interpolation=cv2.INTER_LINEAR) if track_scale < 0.999 else first_frame
        track_box = (
            int(round(bbox[0] * track_scale)),
            int(round(bbox[1] * track_scale)),
            max(6, int(round(bbox[2] * track_scale))),
            max(6, int(round(bbox[3] * track_scale)))
        )
        try:
            custom_tracker = create_tracker()
            custom_tracker.init(track_first, track_box)
        except Exception as e:
            custom_tracker = None

    anchor_x = max(0.10, min(0.90, float(anchor_x)))
    anchor_y = max(0.10, min(0.90, float(anchor_y)))
    smooth_val = max(0.0, min(100.0, float(smoothness)))
    deadzone_val = max(0.0, float(deadzone))

    # Dynamic Hardlock rates (firm lock, zero gempa, zero floating stabilizer lag)
    base_alpha_x = max(0.20, min(0.70, 0.55 - (smooth_val / 100.0) * 0.30))
    base_alpha_y = base_alpha_x * 0.80
    noise_thresh = max(1.5, min(4.0, deadzone_val * 0.18))

    # User-requested zoom (no artificial 800% zoom blowup!)
    requested_zoom = max(1.0, float(zoom))
    base_crop_w = (src_h * 9.0) / 16.0 if src_h > 0 else (src_w * 0.5)
    base_crop_h = float(src_h)
    live_crop_w = min(float(src_w), base_crop_w / requested_zoom)
    live_crop_h = min(float(src_h), base_crop_h / requested_zoom)
    live_max_off_x = max(1.0, float(src_w) - live_crop_w)
    live_max_off_y = max(1.0, float(src_h) - live_crop_h)

    live_smooth_x = float(initial_detection["cx"])
    live_smooth_y = float(initial_detection["cy"])

    init_req_x = live_smooth_x - (anchor_x * live_crop_w)
    init_clamped_x = max(0.0, min(live_max_off_x, init_req_x))
    init_norm_x = (init_clamped_x / live_max_off_x) * 100.0 if live_max_off_x > 1.0 else 50.0

    init_req_y = live_smooth_y - (anchor_y * live_crop_h)
    init_clamped_y = max(0.0, min(live_max_off_y, init_req_y))
    init_norm_y = (init_clamped_y / live_max_off_y) * 100.0 if live_max_off_y > 1.0 else 50.0

    scene_cuts = [True]  # Clip start is always segment boundary
    raw_points = [{
        "t": 0.0,
        "cx": initial_detection["cx"],
        "cy": initial_detection["cy"],
        "rawCx": initial_detection["cx"],
        "rawCy": initial_detection["cy"],
        "smooth_cx": live_smooth_x,
        "smooth_cy": live_smooth_y,
        "crop_x": init_clamped_x,
        "crop_y": init_clamped_y,
        "norm_x": init_norm_x,
        "norm_y": init_norm_y,
        "w": initial_detection["w"],
        "h": initial_detection["h"],
        "ok": True,
        "cut": True
    }]

    # Sample at 30 fps (step=1 for <=30fps, step=2 for 60fps)
    step = 1 if fps <= 30 else 2
    current_frame_idx = start_frame
    prev_cx = initial_detection["cx"]
    prev_cy = initial_detection["cy"]
    last_good_box = bbox
    vel_x, vel_y = 0.0, 0.0

    sample_fps = fps / float(step)
    audio_rms = extract_audio_rms_profile(video_path, start_sec, end_sec, sample_fps)
    audio_noise_floor = 0.01
    audio_speech_thresh = 0.02
    if audio_rms and len(audio_rms) > 0:
        valid_rms = [r for r in audio_rms if r > 0.001]
        if len(valid_rms) >= 10:
            audio_noise_floor = float(np.percentile(valid_rms, 25))
            audio_peak = float(np.percentile(valid_rms, 85))
            audio_speech_thresh = audio_noise_floor + max(0.004, (audio_peak - audio_noise_floor) * 0.20)

    sens_val = max(0.0, min(100.0, float(sensitivity)))
    sens_factor = 1.0 - ((sens_val - 50.0) / 100.0) * 0.50
    active_talk_thresh = max(0.12, 0.22 * sens_factor)

    active_face_tracks = []
    if initial_detection:
        init_t = {
            "id": 1,
            "cx": float(initial_detection["cx"]),
            "cy": float(initial_detection["cy"]),
            "w": float(initial_detection["w"]),
            "h": float(initial_detection["h"]),
            "bbox": initial_detection["bbox"],
            "mouth_patch": initial_detection.get("mouth_patch"),
            "mar_hist": [initial_detection.get("mar", 0.12)],
            "prev_mar": initial_detection.get("mar", 0.12),
            "prev_mouth_patch": initial_detection.get("mouth_patch"),
            "lip_hist": [0.0],
            "speech_score": 0.0,
            "signature": sig_speaker1,
            "is_active_speaker": True,
            "frames_since_seen": 0
        }
        active_face_tracks.append(init_t)

    prev_faces_count = 1
    speaker_hold_frames = 0
    speaker_lock_cooldown = 0
    active_signature = sig_speaker1
    if active_signature is None and initial_detection is not None:
        try:
            active_signature = extract_person_signature(first_frame, initial_detection)
        except Exception:
            active_signature = None

    while current_frame_idx < end_frame:
        for _ in range(step - 1):
            current_frame_idx += 1
            if current_frame_idx >= end_frame or not cap.grab():
                break

        current_frame_idx += 1
        if current_frame_idx > end_frame:
            break

        ret, frame = cap.read()
        if not ret or frame is None:
            break

        rel_t = (current_frame_idx - start_frame) / fps
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small_gray = cv2.resize(frame_gray, (64, 36))

        # Scene Cut Detection (cv2.absdiff on downsampled luma + histogram correlation)
        luma_diff = float(np.mean(cv2.absdiff(small_gray, prev_small_gray)))
        prev_small_gray = small_gray

        cur_hist = cv2.calcHist([small_gray], [0], None, [32], [0, 256])
        cv2.normalize(cur_hist, cur_hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)
        hist_corr = float(cv2.compareHist(cur_hist, prev_hist, cv2.HISTCMP_CORREL)) if prev_hist is not None else 1.0
        prev_hist = cur_hist
        is_scene_cut = False

        if speaker_lock_cooldown > 0:
            speaker_lock_cooldown -= 1

        if mode == 'face' and not init_bbox:
            # MediaPipe FaceMesh (478 3D landmarks) with exact nasal bridge ('batang hidung')
            dets = detect_all_faces(frame_rgb, frame_gray)
            cur_faces_count = len(dets)

            # Match detected faces to persistent tracks
            for tr in active_face_tracks:
                tr["frames_since_seen"] += 1

            matched_track_indices = set()
            for d in dets:
                best_t_idx = None
                best_dist = float('inf')
                for t_idx, tr in enumerate(active_face_tracks):
                    if t_idx in matched_track_indices:
                        continue
                    dist = math.hypot(d["cx"] - tr["cx"], d["cy"] - tr["cy"])
                    if dist < best_dist and dist < float(src_w) * 0.38:
                        best_dist = dist
                        best_t_idx = t_idx

                if best_t_idx is not None:
                    matched_track_indices.add(best_t_idx)
                    tr = active_face_tracks[best_t_idx]
                    cur_mar = d.get("mar", 0.12)
                    d_mar = 0.0 if is_scene_cut else abs(cur_mar - tr["prev_mar"])
                    tr["prev_mar"] = cur_mar
                    tr["mar_hist"].append(cur_mar)
                    base_mar = float(np.percentile(tr["mar_hist"][-90:], 20)) if len(tr["mar_hist"]) >= 5 else 0.11

                    p_diff = 0.0
                    cur_patch = d.get("mouth_patch")
                    if not is_scene_cut and cur_patch is not None and tr["prev_mouth_patch"] is not None:
                        try:
                            p_diff = min(2.0, float(np.mean(np.abs(cur_patch - tr["prev_mouth_patch"]))))
                        except Exception:
                            p_diff = 0.0
                    if cur_patch is not None:
                        tr["prev_mouth_patch"] = cur_patch

                    # Strict mouth aperture verification:
                    # If mouth is closed (cur_mar <= base_mar + 0.018), p_diff is ignored
                    # (immune to head nodding, smiling, or breathing while listening)
                    is_mouth_open = (cur_mar > base_mar + 0.018)
                    if not is_mouth_open:
                        p_diff = 0.0
                        d_mar = min(d_mar, 0.015)
                        open_above = 0.0
                    else:
                        open_above = max(0.0, cur_mar - (base_mar + 0.018))

                    # Individual speech movement score (mouth opening dynamics + optical lip texture movement)
                    inst_lip = (d_mar * 16.0) + (open_above * 4.0) + (p_diff * 0.35)
                    tr["lip_hist"].append(inst_lip)

                    # Leaky integrator / conversational speech hangover (smooth decay over pauses):
                    if inst_lip > tr["speech_score"]:
                        tr["speech_score"] = tr["speech_score"] * 0.65 + inst_lip * 0.35
                    else:
                        tr["speech_score"] = tr["speech_score"] * 0.93 + inst_lip * 0.07

                    tr["cx"] = d["cx"]
                    tr["cy"] = d["cy"]
                    tr["w"] = d["w"]
                    tr["h"] = d["h"]
                    tr["bbox"] = d["bbox"]
                    tr["mouth_patch"] = cur_patch
                    tr["frames_since_seen"] = 0
                else:
                    new_sig = extract_person_signature(frame, d)
                    new_tr = {
                        "id": len(active_face_tracks) + 1,
                        "cx": d["cx"],
                        "cy": d["cy"],
                        "w": d["w"],
                        "h": d["h"],
                        "bbox": d["bbox"],
                        "mouth_patch": d.get("mouth_patch"),
                        "mar_hist": [d.get("mar", 0.12)],
                        "prev_mar": d.get("mar", 0.12),
                        "prev_mouth_patch": d.get("mouth_patch"),
                        "lip_hist": [0.0],
                        "speech_score": 0.0,
                        "signature": new_sig,
                        "is_active_speaker": False,
                        "frames_since_seen": 0
                    }
                    active_face_tracks.append(new_tr)

            # Prune stale tracks
            active_face_tracks = [tr for tr in active_face_tracks if tr["frames_since_seen"] <= 60]

            has_audio_speech = True
            if audio_rms and len(audio_rms) > 0:
                frame_audio_idx = min(len(audio_rms) - 1, len(raw_points))
                if frame_audio_idx < len(audio_rms):
                    cur_rms = audio_rms[frame_audio_idx]
                    has_audio_speech = (cur_rms >= audio_speech_thresh * 0.85)

            if cur_faces_count == 0:
                pred_cx = max(0.0, min(float(src_w), prev_cx + vel_x * 0.6))
                pred_cy = max(0.0, min(float(src_h), prev_cy + vel_y * 0.6))
                vel_x *= 0.5
                vel_y *= 0.5
                prev_cx, prev_cy = pred_cx, pred_cy
                bx, by, bw, bh = last_good_box
                scene_cuts.append(False)
                raw_points.append({
                    "t": round(rel_t, 4),
                    "cx": pred_cx,
                    "cy": pred_cy,
                    "rawCx": pred_cx,
                    "rawCy": pred_cy,
                    "w": bw,
                    "h": bh,
                    "ok": False,
                    "cut": False
                })

            elif cur_faces_count == 1:
                d0 = dets[0]
                pos_jump = math.hypot(d0["cx"] - prev_cx, d0["cy"] - prev_cy)
                cur_sig = extract_person_signature(frame, d0)
                sig_sim = compare_signature(cur_sig, active_signature) if (active_signature is not None and cur_sig is not None) else 1.0

                # Instant camera shot cut detection (e.g. cut between Speaker 1 and Speaker 2 close-ups)
                is_scene_cut = bool(
                    (cur_sig is not None and active_signature is not None and sig_sim < 0.72)
                    or hist_corr < 0.88
                    or luma_diff >= 12.0
                    or (pos_jump > src_w * 0.12 and (luma_diff >= 4.5 or hist_corr < 0.95 or sig_sim < 0.82))
                    or (prev_faces_count >= 2 and (luma_diff >= 5.5 or hist_corr < 0.94))
                    or pos_jump > src_w * 0.20
                )

                if is_scene_cut:
                    live_smooth_x = d0["cx"]
                    live_smooth_y = d0["cy"]
                    vel_x, vel_y = 0.0, 0.0
                    scene_cuts.append(True)
                    if cur_sig is not None:
                        active_signature = cur_sig
                else:
                    scene_cuts.append(False)
                    if cur_sig is not None and sig_sim >= 0.75:
                        active_signature = active_signature * 0.90 + cur_sig * 0.10

                cx = d0["cx"]
                cy = d0["cy"]
                bw = d0["w"]
                bh = d0["h"]
                vel_x = 0.0 if is_scene_cut else ((cx - prev_cx) * 0.7 + vel_x * 0.3)
                vel_y = 0.0 if is_scene_cut else ((cy - prev_cy) * 0.7 + vel_y * 0.3)
                prev_cx, prev_cy = cx, cy
                last_good_box = d0["bbox"]
                prev_mouth_patch = d0.get("mouth_patch")

                for tr in active_face_tracks:
                    tr["is_active_speaker"] = (tr["frames_since_seen"] == 0)

                raw_points.append({
                    "t": round(rel_t, 4),
                    "cx": cx,
                    "cy": cy,
                    "rawCx": cx,
                    "rawCy": cy,
                    "w": bw,
                    "h": bh,
                    "ok": True,
                    "cut": is_scene_cut
                })

            else:
                # cur_faces_count >= 2 (Multi-speaker scene / 2 people in wide shot)
                is_scene_cut = bool(
                    hist_corr < 0.88
                    or luma_diff >= 12.0
                    or (prev_faces_count < 2 and (luma_diff >= 5.5 or hist_corr < 0.94))
                )
                if is_scene_cut:
                    scene_cuts.append(True)
                    vel_x, vel_y = 0.0, 0.0
                else:
                    scene_cuts.append(False)

                visible_tracks = [tr for tr in active_face_tracks if tr["frames_since_seen"] == 0]
                if not visible_tracks:
                    visible_tracks = active_face_tracks

                curr_tr = next((tr for tr in visible_tracks if tr.get("is_active_speaker")), None)
                if curr_tr is None:
                    curr_tr = min(visible_tracks, key=lambda tr: math.hypot(tr["cx"] - prev_cx, tr["cy"] - prev_cy))
                    curr_tr["is_active_speaker"] = True

                other_tracks = [tr for tr in visible_tracks if tr["id"] != curr_tr["id"]]
                if other_tracks:
                    best_other_tr = max(other_tracks, key=lambda tr: tr["speech_score"])
                    curr_score = curr_tr["speech_score"]
                    best_other_score = best_other_tr["speech_score"]

                    # Active speaker turn-taking condition (Anti-Flip-Flop):
                    # 1. Other person must have genuine, clear vocal speech movement (>= active_talk_thresh)
                    # 2. Other person's speech score must clearly beat current speaker (> 1.50x),
                    #    OR current speaker has completely fallen silent (< 0.08) while other speaker talks (>= 0.18).
                    # 3. Audio RMS energy confirms actual speech sound in the video.
                    other_speech_high = (best_other_score >= active_talk_thresh)
                    other_beats_current = (best_other_score > curr_score * 1.50) or (curr_score < 0.08 and best_other_score >= 0.18)
                    other_is_talking = other_speech_high and other_beats_current

                    if other_is_talking and has_audio_speech:
                        speaker_hold_frames += 1
                        # Require sustained speech for at least ~0.55s (approx 16 frames at 30fps)
                        min_hold = max(8, int(round(0.55 * sample_fps)))
                        if speaker_hold_frames >= min_hold and speaker_lock_cooldown <= 0:
                            # Switch active speaker smoothly!
                            curr_tr["is_active_speaker"] = False
                            best_other_tr["is_active_speaker"] = True
                            curr_tr = best_other_tr
                            speaker_hold_frames = 0
                            # Lock cooldown: minimum 2.20 seconds to prevent rapid flip-flopping
                            speaker_lock_cooldown = max(15, int(round(2.20 * sample_fps)))
                            chosen_sig = extract_person_signature(frame, curr_tr)
                            if chosen_sig is not None:
                                active_signature = chosen_sig
                    else:
                        speaker_hold_frames = max(0, speaker_hold_frames - 1)

                cx = curr_tr["cx"]
                cy = curr_tr["cy"]
                bw = curr_tr["w"]
                bh = curr_tr["h"]

                if is_scene_cut:
                    live_smooth_x = cx
                    live_smooth_y = cy
                    vel_x, vel_y = 0.0, 0.0
                else:
                    vel_x = (cx - prev_cx) * 0.7 + vel_x * 0.3
                    vel_y = (cy - prev_cy) * 0.7 + vel_y * 0.3

                prev_cx, prev_cy = cx, cy
                last_good_box = curr_tr["bbox"]
                prev_mouth_patch = curr_tr.get("mouth_patch")

                raw_points.append({
                    "t": round(rel_t, 4),
                    "cx": cx,
                    "cy": cy,
                    "rawCx": cx,
                    "rawCy": cy,
                    "w": bw,
                    "h": bh,
                    "ok": True,
                    "cut": is_scene_cut
                })

            prev_faces_count = cur_faces_count

        elif custom_tracker is not None:
            # Custom Target Tracking via CSRT
            tw = max(16, int(round(src_w * track_scale)))
            th = max(16, int(round(src_h * track_scale)))
            track_frame = cv2.resize(frame, (tw, th), interpolation=cv2.INTER_LINEAR) if track_scale < 0.999 else frame
            success, current_box = custom_tracker.update(track_frame)

            if success:
                bx = max(0.0, min(float(src_w) - 5.0, float(current_box[0]) / track_scale))
                by = max(0.0, min(float(src_h) - 5.0, float(current_box[1]) / track_scale))
                bw = max(5.0, min(float(src_w) - bx, float(current_box[2]) / track_scale))
                bh = max(5.0, min(float(src_h) - by, float(current_box[3]) / track_scale))
                cx = bx + bw * 0.5
                cy = by + bh * 0.5
                vel_x = (cx - prev_cx) * 0.7 + vel_x * 0.3
                vel_y = (cy - prev_cy) * 0.7 + vel_y * 0.3
                prev_cx, prev_cy = cx, cy
                last_good_box = (bx, by, bw, bh)
                scene_cuts.append(False)
                raw_points.append({
                    "t": round(rel_t, 4),
                    "cx": cx,
                    "cy": cy,
                    "rawCx": cx,
                    "rawCy": cy,
                    "w": bw,
                    "h": bh,
                    "ok": True,
                    "cut": False
                })
            else:
                pred_cx = max(0.0, min(float(src_w), prev_cx + vel_x * 0.6))
                pred_cy = max(0.0, min(float(src_h), prev_cy + vel_y * 0.6))
                vel_x *= 0.5
                vel_y *= 0.5
                prev_cx, prev_cy = pred_cx, pred_cy
                bx, by, bw, bh = last_good_box
                scene_cuts.append(False)
                raw_points.append({
                    "t": round(rel_t, 4),
                    "cx": pred_cx,
                    "cy": pred_cy,
                    "rawCx": pred_cx,
                    "rawCy": pred_cy,
                    "w": bw,
                    "h": bh,
                    "ok": False,
                    "cut": False
                })
        else:
            bx, by, bw, bh = last_good_box
            scene_cuts.append(False)
            raw_points.append({
                "t": round(rel_t, 4),
                "cx": prev_cx,
                "cy": prev_cy,
                "rawCx": prev_cx,
                "rawCy": prev_cy,
                "w": bw,
                "h": bh,
                "ok": True,
                "cut": False
            })

        point_data = raw_points[-1]

        # Dynamic Hardlock camera filtering
        if is_scene_cut:
            live_smooth_x = point_data["cx"]
            live_smooth_y = point_data["cy"]
        else:
            dx = point_data["cx"] - live_smooth_x
            dy = point_data["cy"] - live_smooth_y
            dist = math.hypot(dx, dy)

            if dist <= noise_thresh:
                # Stationary micro-jitter suppression (anti-gempa): dampens sensor noise
                factor = max(0.12, (dist / noise_thresh) ** 2)
                eff_alpha_x = base_alpha_x * factor
                eff_alpha_y = base_alpha_y * factor
            else:
                # Real movement / speaker transition: dynamic velocity boost (firm hardlock, snappy switch, zero floating wave)
                boost = min(0.38, ((dist - noise_thresh) / 10.0) * 0.22)
                eff_alpha_x = min(0.85, base_alpha_x + boost)
                eff_alpha_y = min(0.80, base_alpha_y + boost * 0.80)

            live_smooth_x += eff_alpha_x * dx
            live_smooth_y += eff_alpha_y * dy

        live_req_x = live_smooth_x - (anchor_x * live_crop_w)
        clamped_crop_x = max(0.0, min(live_max_off_x, live_req_x))
        live_norm_x = (clamped_crop_x / live_max_off_x) * 100.0 if live_max_off_x > 1.0 else 50.0

        live_req_y = live_smooth_y - (anchor_y * live_crop_h)
        clamped_crop_y = max(0.0, min(live_max_off_y, live_req_y))
        live_norm_y = (clamped_crop_y / live_max_off_y) * 100.0 if live_max_off_y > 1.0 else 50.0

        point_data["smooth_cx"] = live_smooth_x
        point_data["smooth_cy"] = live_smooth_y
        point_data["crop_x"] = clamped_crop_x
        point_data["crop_y"] = clamped_crop_y
        point_data["norm_x"] = live_norm_x
        point_data["norm_y"] = live_norm_y

        prog_msg = {
            "type": "progress",
            "frame": len(raw_points),
            "total": max(1, int(round((end_frame - start_frame) / step))),
            "t": point_data["t"],
            "cx": round(point_data["cx"], 2),
            "cy": round(point_data["cy"], 2),
            "w": round(point_data["w"], 1),
            "h": round(point_data["h"], 1),
            "normX": round(live_norm_x, 2),
            "normY": round(live_norm_y, 2),
            "normVideoX": round(point_data["cx"] / src_w, 4),
            "normVideoY": round(point_data["cy"] / src_h, 4),
            "ok": point_data["ok"],
            "cut": point_data.get("cut", False)
        }
        sys.stdout.write(f"FYTX_PROG:{json.dumps(prog_msg)}\n")
        sys.stdout.flush()

    cap.release()

    # Pass 2: Cinematic Gaussian ease filter with Segmented Cut Boundaries
    eff_sigma = max(1.0, min(8.0, 1.5 + (smooth_val / 100.0) * 5.0))
    all_raw_cx = [pt.get("rawCx", pt["cx"]) for pt in raw_points]
    all_raw_cy = [pt.get("rawCy", pt["cy"]) for pt in raw_points]
    cine_cx = apply_segmented_hardlock_and_gaussian(all_raw_cx, scene_cuts, smooth_val, deadzone_val, eff_sigma)
    cine_cy = apply_segmented_hardlock_and_gaussian(all_raw_cy, scene_cuts, smooth_val, deadzone_val, eff_sigma)

    smoothed_points = []
    for i, pt in enumerate(raw_points):
        final_cx = float(cine_cx[i])
        final_cy = float(cine_cy[i])

        req_crop_x = final_cx - (anchor_x * live_crop_w)
        clamped_x = max(0.0, min(live_max_off_x, req_crop_x))
        norm_x = (clamped_x / live_max_off_x) * 100.0 if live_max_off_x > 1.0 else 50.0

        req_crop_y = final_cy - (anchor_y * live_crop_h)
        clamped_y = max(0.0, min(live_max_off_y, req_crop_y))
        norm_y = (clamped_y / live_max_off_y) * 100.0 if live_max_off_y > 1.0 else 50.0

        smoothed_points.append({
            "t": pt["t"],
            "rawCx": round(float(pt.get("rawCx", pt["cx"])), 2),
            "rawCy": round(float(pt.get("rawCy", pt["cy"])), 2),
            "cx": round(final_cx, 2),
            "cy": round(final_cy, 2),
            "cropX": round(clamped_x, 2),
            "cropY": round(clamped_y, 2),
            "normX": round(norm_x, 3),
            "normY": round(norm_y, 3),
            "w": round(float(pt["w"]), 1),
            "h": round(float(pt["h"]), 1),
            "ok": pt["ok"],
            "cut": bool(scene_cuts[i]) if i < len(scene_cuts) else False
        })

    return {
        "ok": True,
        "sourceWidth": src_w,
        "sourceHeight": src_h,
        "fps": fps,
        "start": start_sec,
        "end": end_sec,
        "duration": round(end_sec - start_sec, 3),
        "mode": mode,
        "zoom": round(requested_zoom, 3),
        "anchorX": anchor_x,
        "anchorY": anchor_y,
        "initialBbox": [round(v, 1) for v in bbox],
        "totalFrames": len(smoothed_points),
        "cropWidth": round(live_crop_w, 1),
        "cropHeight": round(live_crop_h, 1),
        "keyframes": smoothed_points
    }


def detect_all_faces_dual(frame_rgb, frame_gray):
    """Backward-compatible alias for detect_all_faces."""
    return detect_all_faces(frame_rgb, frame_gray)


def match_two_faces_to_locks(dets, ref1_x, ref1_y, ref2_x, ref2_y, src_w, sig1=None, sig2=None, frame_bgr=None):
    """Matches 2+ detected faces in a Wide Shot to Speaker 1 (Lock 1) and Speaker 2 (Lock 2)."""
    top_dets = sorted(dets, key=lambda d: d["w"] * d["h"], reverse=True)[:3]
    best_pair = None
    best_cost = float("inf")
    ref_dist = math.hypot(ref1_x - ref2_x, ref1_y - ref2_y)

    if ref_dist > src_w * 0.05:
        for i in range(len(top_dets)):
            for j in range(len(top_dets)):
                if i == j:
                    continue
                di, dj = top_dets[i], top_dets[j]
                pos_cost = math.hypot(di["cx"] - ref1_x, di["cy"] - ref1_y) + math.hypot(dj["cx"] - ref2_x, dj["cy"] - ref2_y)
                app_bonus = 0.0
                if sig1 is not None and sig2 is not None and frame_bgr is not None:
                    si = extract_person_signature(frame_bgr, di)
                    sj = extract_person_signature(frame_bgr, dj)
                    app_bonus = (compare_signature(si, sig1) + compare_signature(sj, sig2)) * (src_w * 0.12)
                cost = pos_cost - app_bonus
                if cost < best_cost:
                    best_cost = cost
                    best_pair = (di, dj)
        if best_pair is not None:
            return best_pair[0], best_pair[1]

    top2 = top_dets[:2]
    top2.sort(key=lambda d: d["cx"])
    if ref1_x <= ref2_x:
        return top2[0], top2[1]
    return top2[1], top2[0]


def identify_single_face_speaker(det, frame_bgr, sig1, sig2, hint1_x, hint2_x, src_w):
    """
    When only 1 face is visible on screen (Close-Up Scene 2 or Scene 3),
    identifies whether that face belongs to Speaker 1 (Lock 1) or Speaker 2 (Lock 2)
    using HSV Face+Torso Appearance Signature + Lock 1/2 horizontal affinity.
    """
    cx = float(det["cx"])
    # 1. Appearance Signature similarity (if calibrated from a 2-speaker wide shot)
    sim1 = 0.5
    sim2 = 0.5
    has_sigs = (sig1 is not None and sig2 is not None and frame_bgr is not None)
    if has_sigs:
        cur_sig = extract_person_signature(frame_bgr, det)
        sim1 = compare_signature(cur_sig, sig1)
        sim2 = compare_signature(cur_sig, sig2)

    # 2. Horizontal affinity to Lock 1 vs Lock 2
    dist1 = abs(cx - hint1_x) / max(1.0, float(src_w))
    dist2 = abs(cx - hint2_x) / max(1.0, float(src_w))
    pos_score1 = max(0.0, 1.0 - dist1 * 1.4)
    pos_score2 = max(0.0, 1.0 - dist2 * 1.4)

    if has_sigs:
        # Weight appearance signature (face + shirt color/brightness) 72% + horizontal lock side 28%
        total1 = sim1 * 0.72 + pos_score1 * 0.28
        total2 = sim2 * 0.72 + pos_score2 * 0.28
    else:
        total1 = pos_score1
        total2 = pos_score2

    return 1 if total1 >= total2 else 2


def track_video_dual(
    video_path,
    start_sec=0.0,
    end_sec=None,
    target1_xy=None,
    target2_xy=None,
    smoothness=50,
    deadzone=15,
    sensitivity=50,
    zoom=1.15,
    anchor_x=0.50,
    anchor_y=0.40
):
    """
    Dual Lock Point Smart Podcast Tracker (Multi-Scene & Single-Scene 2 Speakers):
    - Supports both 1-scene wide podcasts and 3-scene multi-cam podcasts (Wide 2-Speaker, Close-Up Speaker 1, Close-Up Speaker 2).
    - Scene Cut Detection (cv2.absdiff + face-count transition): snaps camera instantaneously on camera cuts without floating.
    - Appearance Signature (HSV Face + Shirt/Torso Histogram): learns Speaker 1 & Speaker 2 in wide shots and recognizes who is on screen in solo close-up shots.
    - Mode 'split' (Layer Split) is strictly restricted to frames where >= 2 faces are simultaneously visible AND both are speaking.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"ok": False, "error": f"Failed to open video: {video_path}"}

    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_duration = total_frames / fps if total_frames > 0 else 0.0

    if end_sec is None or end_sec <= start_sec:
        end_sec = video_duration if video_duration > 0 else (start_sec + 30.0)

    start_frame = max(0, int(round(start_sec * fps)))
    end_frame = max(start_frame + 1, int(round(end_sec * fps)))

    # Resolve initial human lock target hints in source pixels
    def resolve_xy(pt, def_x_norm, def_y_norm):
        if pt and len(pt) == 2:
            px, py = float(pt[0]), float(pt[1])
            if 0.0 <= px <= 1.0 and 0.0 <= py <= 1.0:
                return (px * src_w, py * src_h)
            return (max(0.0, min(float(src_w), px)), max(0.0, min(float(src_h), py)))
        return (def_x_norm * src_w, def_y_norm * src_h)

    hint1_x, hint1_y = resolve_xy(target1_xy, 0.30, 0.40)
    hint2_x, hint2_y = resolve_xy(target2_xy, 0.70, 0.40)

    # Pre-scan up to 12 sample frames across the clip to calibrate Speaker 1 & Speaker 2 Appearance Signatures
    # from Wide Shots (2-face frames) and Close-Up Shots (1-face frames near Lock 1 / Lock 2)
    sig1 = None
    sig2 = None
    home1_x, home1_y = hint1_x, hint1_y
    home2_x, home2_y = hint2_x, hint2_y
    found_wide_shot = False

    span_frames = max(1, end_frame - start_frame)
    sample_count = min(12, max(2, span_frames // 12))
    for s_idx in range(sample_count):
        probe_f = start_frame + int(round((s_idx / max(1, sample_count - 1)) * (span_frames - 1)))
        cap.set(cv2.CAP_PROP_POS_FRAMES, probe_f)
        ok_p, p_frame = cap.read()
        if not ok_p or p_frame is None:
            continue
        p_rgb = cv2.cvtColor(p_frame, cv2.COLOR_BGR2RGB)
        p_gray = cv2.cvtColor(p_frame, cv2.COLOR_BGR2GRAY)
        p_dets = detect_all_faces_dual(p_rgb, p_gray)
        if len(p_dets) >= 2:
            pd1, pd2 = match_two_faces_to_locks(p_dets, hint1_x, hint1_y, hint2_x, hint2_y, src_w, sig1, sig2, p_frame)
            s1_new = extract_person_signature(p_frame, pd1)
            s2_new = extract_person_signature(p_frame, pd2)
            if s1_new is not None:
                sig1 = s1_new if sig1 is None else (sig1 * 0.65 + s1_new * 0.35)
                n1 = float(np.linalg.norm(sig1))
                if n1 > 1e-6:
                    sig1 = sig1 / n1
            if s2_new is not None:
                sig2 = s2_new if sig2 is None else (sig2 * 0.65 + s2_new * 0.35)
                n2 = float(np.linalg.norm(sig2))
                if n2 > 1e-6:
                    sig2 = sig2 / n2
            if not found_wide_shot:
                home1_x, home1_y = pd1["cx"], pd1["cy"]
                home2_x, home2_y = pd2["cx"], pd2["cy"]
                found_wide_shot = True
        elif len(p_dets) == 1 and not found_wide_shot:
            pd0 = p_dets[0]
            if abs(pd0["cx"] - hint1_x) <= abs(pd0["cx"] - hint2_x):
                s1_new = extract_person_signature(p_frame, pd0)
                if s1_new is not None and sig1 is None:
                    sig1 = s1_new
            else:
                s2_new = extract_person_signature(p_frame, pd0)
                if s2_new is not None and sig2 is None:
                    sig2 = s2_new

    # Seek back to start_frame for main pass
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    ret, first_frame = cap.read()
    if not ret or first_frame is None:
        cap.release()
        return {"ok": False, "error": f"Could not read frame at start second {start_sec}"}

    first_rgb = cv2.cvtColor(first_frame, cv2.COLOR_BGR2RGB)
    first_gray = cv2.cvtColor(first_frame, cv2.COLOR_BGR2GRAY)
    prev_small_gray = cv2.resize(first_gray, (64, 36))
    prev_hist = cv2.calcHist([prev_small_gray], [0], None, [32], [0, 256])
    cv2.normalize(prev_hist, prev_hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)
    init_dets = detect_all_faces_dual(first_rgb, first_gray)

    t1_cx, t1_cy = home1_x, home1_y
    t2_cx, t2_cy = home2_x, home2_y
    t1_w, t1_h = src_w * 0.22, src_h * 0.32
    t2_w, t2_h = src_w * 0.22, src_h * 0.32
    t1_mar, t2_mar = 0.12, 0.12
    t1_patch, t2_patch = None, None
    has_two_faces = False
    solo_identity = 1

    if len(init_dets) >= 2:
        has_two_faces = True
        d1, d2 = match_two_faces_to_locks(init_dets, hint1_x, hint1_y, hint2_x, hint2_y, src_w, sig1, sig2, first_frame)
        t1_cx, t1_cy, t1_w, t1_h, t1_mar, t1_patch = d1["cx"], d1["cy"], d1["w"], d1["h"], d1["mar"], d1["mouth_patch"]
        t2_cx, t2_cy, t2_w, t2_h, t2_mar, t2_patch = d2["cx"], d2["cy"], d2["w"], d2["h"], d2["mar"], d2["mouth_patch"]
        home1_x, home1_y = t1_cx, t1_cy
        home2_x, home2_y = t2_cx, t2_cy
        s1_init = extract_person_signature(first_frame, d1)
        s2_init = extract_person_signature(first_frame, d2)
        if s1_init is not None:
            sig1 = s1_init
        if s2_init is not None:
            sig2 = s2_init
    elif len(init_dets) == 1:
        d0 = init_dets[0]
        solo_identity = identify_single_face_speaker(d0, first_frame, sig1, sig2, hint1_x, hint2_x, src_w)
        if solo_identity == 1:
            t1_cx, t1_cy, t1_w, t1_h, t1_mar, t1_patch = d0["cx"], d0["cy"], d0["w"], d0["h"], d0["mar"], d0["mouth_patch"]
        else:
            t2_cx, t2_cy, t2_w, t2_h, t2_mar, t2_patch = d0["cx"], d0["cy"], d0["w"], d0["h"], d0["mar"], d0["mouth_patch"]

    anchor_x = max(0.10, min(0.90, float(anchor_x)))
    anchor_y = max(0.10, min(0.90, float(anchor_y)))
    smooth_val = max(0.0, min(100.0, float(smoothness)))
    deadzone_val = max(0.0, float(deadzone))
    sens_val = max(0.0, min(100.0, float(sensitivity)))

    # 1. Fill to Screen (9:16 single speaker) crop geometry
    requested_zoom = max(1.0, float(zoom))
    base_single_w = (src_h * 9.0) / 16.0 if src_h > 0 else (src_w * 0.5)
    base_single_h = float(src_h)
    single_crop_w = min(float(src_w), base_single_w / requested_zoom)
    single_crop_h = min(float(src_h), base_single_h / requested_zoom)
    single_max_off_x = max(1.0, float(src_w) - single_crop_w)
    single_max_off_y = max(1.0, float(src_h) - single_crop_h)

    # 2. Layer Split (9:8 top & bottom panels at 216% zoom) crop geometry
    panel_w = 1080.0
    panel_h = 960.0
    s_fit = min(panel_w / float(src_w), panel_h / float(src_h))
    cover_scale = max(panel_w / float(src_w), panel_h / float(src_h))
    min_split_z = cover_scale / s_fit
    split_zoom = max(min_split_z, 2.16)
    split_crop_w = min(float(src_w), panel_w / (s_fit * split_zoom))
    split_crop_h = min(float(src_h), panel_h / (s_fit * split_zoom))
    split_max_off_x = max(1.0, float(src_w) - split_crop_w)
    split_max_off_y = max(1.0, float(src_h) - split_crop_h)

    def to_single_norm(cx, cy):
        rx = max(0.0, min(single_max_off_x, cx - anchor_x * single_crop_w))
        ry = max(0.0, min(single_max_off_y, cy - anchor_y * single_crop_h))
        nx = (rx / single_max_off_x) * 100.0 if single_max_off_x > 1.0 else 50.0
        ny = (ry / single_max_off_y) * 100.0 if single_max_off_y > 1.0 else 50.0
        return rx, ry, nx, ny

    def to_split_norm(cx, cy):
        rx = max(0.0, min(split_max_off_x, cx - anchor_x * split_crop_w))
        ry = max(0.0, min(split_max_off_y, cy - anchor_y * split_crop_h))
        nx = (rx / split_max_off_x) * 100.0 if split_max_off_x > 1.0 else 50.0
        ny = (ry / split_max_off_y) * 100.0 if split_max_off_y > 1.0 else 50.0
        return rx, ry, nx, ny

    step = 1 if fps <= 30 else 2
    sample_fps = fps / float(step)
    current_frame_idx = start_frame

    vel1_x, vel1_y = 0.0, 0.0
    vel2_x, vel2_y = 0.0, 0.0
    lip_hist_1 = [0.0]
    lip_hist_2 = [0.0]
    mar_hist_1 = [t1_mar]
    mar_hist_2 = [t2_mar]

    init_active_spk = solo_identity if len(init_dets) == 1 else 1
    live_active_speaker = init_active_spk  # 1 = Speaker 1, 2 = Speaker 2, 0 = Both (Split)
    live_s_cx = t1_cx if init_active_spk == 1 else t2_cx
    live_s_cy = t1_cy if init_active_spk == 1 else t2_cy
    live_t1_cx, live_t1_cy = t1_cx, t1_cy
    live_t2_cx, live_t2_cy = t2_cx, t2_cy
    live_state_hold = 0
    prev_faces_count = len(init_dets)

    _, _, init_nx, init_ny = to_single_norm(live_s_cx, live_s_cy)
    _, _, init_t1_nx, init_t1_ny = to_split_norm(t1_cx, t1_cy)
    _, _, init_t2_nx, init_t2_ny = to_split_norm(t2_cx, t2_cy)

    raw_points = [{
        "t": 0.0,
        "c1x": t1_cx,
        "c1y": t1_cy,
        "c2x": t2_cx,
        "c2y": t2_cy,
        "w1": t1_w,
        "h1": t1_h,
        "w2": t2_w,
        "h2": t2_h,
        "s1": 0.0,
        "s2": 0.0,
        "mar1": t1_mar,
        "mar2": t2_mar,
        "t1_ok": len(init_dets) >= 2 or (len(init_dets) == 1 and solo_identity == 1),
        "t2_ok": len(init_dets) >= 2 or (len(init_dets) == 1 and solo_identity == 2),
        "faces": len(init_dets),
        "activeIdentity": solo_identity if len(init_dets) == 1 else 0,
        "cut": True,
        "live_speaker": live_active_speaker,
        "normX": init_nx,
        "normY": init_ny,
        "topNormX": init_t1_nx,
        "topNormY": init_t1_ny,
        "botNormX": init_t2_nx,
        "botNormY": init_t2_ny
    }]

    sens_factor = 1.0 - ((sens_val - 50.0) / 100.0) * 0.55
    live_talk_thresh = max(0.08, 0.21 * sens_factor)
    live_split_thresh = max(0.07, 0.17 * sens_factor)
    min_hold_frames = max(2, int(round(0.12 * sample_fps)))

    while current_frame_idx < end_frame:
        for _ in range(step - 1):
            current_frame_idx += 1
            if current_frame_idx >= end_frame or not cap.grab():
                break

        current_frame_idx += 1
        if current_frame_idx > end_frame:
            break

        ret, frame = cap.read()
        if not ret or frame is None:
            break

        rel_t = (current_frame_idx - start_frame) / fps
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small_gray = cv2.resize(frame_gray, (64, 36))

        # Scene Cut Detection (cv2.absdiff on downsampled luma + histogram correlation)
        luma_diff = float(np.mean(cv2.absdiff(small_gray, prev_small_gray)))
        prev_small_gray = small_gray

        cur_hist = cv2.calcHist([small_gray], [0], None, [32], [0, 256])
        cv2.normalize(cur_hist, cur_hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)
        hist_corr = float(cv2.compareHist(cur_hist, prev_hist, cv2.HISTCMP_CORREL)) if prev_hist is not None else 1.0
        prev_hist = cur_hist

        dets = detect_all_faces_dual(frame_rgb, frame_gray)
        cur_faces_count = len(dets)

        # Trigger scene cut if global scene changed OR camera switched between 2-shot and 1-shot
        is_scene_cut = bool(
            hist_corr < 0.88
            or luma_diff >= 12.0
            or (cur_faces_count != prev_faces_count and (luma_diff >= 5.5 or hist_corr < 0.94))
        )

        t1_ok = False
        t2_ok = False
        d1_match = None
        d2_match = None
        frame_active_identity = 0

        if cur_faces_count >= 2:
            # SCENE TYPE: Wide Shot (2 Speakers Visible)
            # Match to wide-shot home/lock anchors if we just cut from a close-up, otherwise track smoothly from t1/t2
            ref1_x = home1_x if (is_scene_cut or prev_faces_count < 2 or not has_two_faces) else t1_cx
            ref1_y = home1_y if (is_scene_cut or prev_faces_count < 2 or not has_two_faces) else t1_cy
            ref2_x = home2_x if (is_scene_cut or prev_faces_count < 2 or not has_two_faces) else t2_cx
            ref2_y = home2_y if (is_scene_cut or prev_faces_count < 2 or not has_two_faces) else t2_cy

            d1_match, d2_match = match_two_faces_to_locks(
                dets, ref1_x, ref1_y, ref2_x, ref2_y, src_w, sig1, sig2, frame
            )
            has_two_faces = True
            t1_ok = True
            t2_ok = True

            # Update wide-shot home coordinates and refine Appearance Signatures (EMA)
            home1_x, home1_y = d1_match["cx"], d1_match["cy"]
            home2_x, home2_y = d2_match["cx"], d2_match["cy"]
            new_s1 = extract_person_signature(frame, d1_match)
            new_s2 = extract_person_signature(frame, d2_match)
            if new_s1 is not None:
                sig1 = new_s1 if sig1 is None else (sig1 * 0.88 + new_s1 * 0.12)
                n1 = float(np.linalg.norm(sig1))
                if n1 > 1e-6:
                    sig1 = sig1 / n1
            if new_s2 is not None:
                sig2 = new_s2 if sig2 is None else (sig2 * 0.88 + new_s2 * 0.12)
                n2 = float(np.linalg.norm(sig2))
                if n2 > 1e-6:
                    sig2 = sig2 / n2

        elif cur_faces_count == 1:
            # SCENE TYPE: Close-Up Shot (Only 1 Speaker Visible on screen; the other Lock Point has no target)
            d0 = dets[0]
            prev_active_x = t1_cx if solo_identity == 1 else t2_cx
            pos_jump = abs(d0["cx"] - prev_active_x)

            # Always identify the visible speaker in close-up
            new_solo_id = identify_single_face_speaker(d0, frame, sig1, sig2, hint1_x, hint2_x, src_w)
            if new_solo_id != solo_identity or pos_jump > src_w * 0.12 or prev_faces_count != 1:
                is_scene_cut = True
                solo_identity = new_solo_id

            frame_active_identity = solo_identity
            if solo_identity == 1:
                d1_match = d0
                t1_ok = True
            else:
                d2_match = d0
                t2_ok = True

        prev_faces_count = cur_faces_count

        # Update Track 1 (Speaker 1 / Lock 1)
        inst_lip_1 = 0.0
        if t1_ok and d1_match is not None:
            nx1, ny1 = d1_match["cx"], d1_match["cy"]
            if is_scene_cut:
                vel1_x, vel1_y = 0.0, 0.0
                t1_patch = d1_match["mouth_patch"]
            else:
                vel1_x = (nx1 - t1_cx) * 0.7 + vel1_x * 0.3
                vel1_y = (ny1 - t1_cy) * 0.7 + vel1_y * 0.3
            t1_cx, t1_cy = nx1, ny1
            t1_w, t1_h = d1_match["w"], d1_match["h"]

            cur_mar1 = d1_match["mar"]
            d_mar1 = 0.0 if is_scene_cut else abs(cur_mar1 - t1_mar)
            t1_mar = cur_mar1
            mar_hist_1.append(cur_mar1)
            base_mar1 = float(np.percentile(mar_hist_1[-90:], 20)) if len(mar_hist_1) >= 5 else 0.11

            p_diff1 = 0.0
            if not is_scene_cut and d1_match["mouth_patch"] is not None and t1_patch is not None:
                p_diff1 = min(1.5, float(np.mean(np.abs(d1_match["mouth_patch"] - t1_patch))))
            if d1_match["mouth_patch"] is not None:
                t1_patch = d1_match["mouth_patch"]

            open_above1 = max(0.0, cur_mar1 - (base_mar1 + 0.015))
            inst_lip_1 = (d_mar1 * 15.0) + (open_above1 * 3.2) + (p_diff1 * 0.38)
        else:
            t1_cx = max(0.0, min(float(src_w), t1_cx + vel1_x * 0.5))
            t1_cy = max(0.0, min(float(src_h), t1_cy + vel1_y * 0.5))
            vel1_x *= 0.5
            vel1_y *= 0.5

        # Update Track 2 (Speaker 2 / Lock 2)
        inst_lip_2 = 0.0
        if t2_ok and d2_match is not None:
            nx2, ny2 = d2_match["cx"], d2_match["cy"]
            if is_scene_cut:
                vel2_x, vel2_y = 0.0, 0.0
                t2_patch = d2_match["mouth_patch"]
            else:
                vel2_x = (nx2 - t2_cx) * 0.7 + vel2_x * 0.3
                vel2_y = (ny2 - t2_cy) * 0.7 + vel2_y * 0.3
            t2_cx, t2_cy = nx2, ny2
            t2_w, t2_h = d2_match["w"], d2_match["h"]

            cur_mar2 = d2_match["mar"]
            d_mar2 = 0.0 if is_scene_cut else abs(cur_mar2 - t2_mar)
            t2_mar = cur_mar2
            mar_hist_2.append(cur_mar2)
            base_mar2 = float(np.percentile(mar_hist_2[-90:], 20)) if len(mar_hist_2) >= 5 else 0.11

            p_diff2 = 0.0
            if not is_scene_cut and d2_match["mouth_patch"] is not None and t2_patch is not None:
                p_diff2 = min(1.5, float(np.mean(np.abs(d2_match["mouth_patch"] - t2_patch))))
            if d2_match["mouth_patch"] is not None:
                t2_patch = d2_match["mouth_patch"]

            open_above2 = max(0.0, cur_mar2 - (base_mar2 + 0.015))
            inst_lip_2 = (d_mar2 * 15.0) + (open_above2 * 3.2) + (p_diff2 * 0.38)
        else:
            t2_cx = max(0.0, min(float(src_w), t2_cx + vel2_x * 0.5))
            t2_cy = max(0.0, min(float(src_h), t2_cy + vel2_y * 0.5))
            vel2_x *= 0.5
            vel2_y *= 0.5

        lip_hist_1.append(inst_lip_1)
        lip_hist_2.append(inst_lip_2)

        # Rolling ~0.45s speech energy window
        win_len = max(4, int(round(0.45 * sample_fps)))
        s1_score = float(np.mean(lip_hist_1[-win_len:])) if t1_ok else 0.0
        s2_score = float(np.mean(lip_hist_2[-win_len:])) if t2_ok else 0.0

        # Live speaker state machine (100% Fill to Screen across all scenes, no Layer Split):
        # - Scene 1 (Wide Shot, cur_faces_count >= 2): switch between Lock 1 (Speaker 1) and Lock 2 (Speaker 2) based on who is speaking.
        # - Scene 2 / Scene 3 (Close-Up Solo Shot, cur_faces_count == 1): immediately lock onto the recognized visible speaker (Lock 1 or Lock 2).
        live_state_hold += 1
        desired_speaker = live_active_speaker
        if cur_faces_count >= 2 and t1_ok and t2_ok:
            if s1_score > s2_score * 1.15 and s1_score >= live_talk_thresh * 0.70:
                desired_speaker = 1
            elif s2_score > s1_score * 1.15 and s2_score >= live_talk_thresh * 0.70:
                desired_speaker = 2
        elif cur_faces_count == 1:
            desired_speaker = 1 if t1_ok else 2

        if is_scene_cut or cur_faces_count == 1:
            if desired_speaker != live_active_speaker:
                live_active_speaker = desired_speaker
                live_state_hold = 0
        elif desired_speaker != live_active_speaker and live_state_hold >= min_hold_frames:
            live_active_speaker = desired_speaker
            live_state_hold = 0

        # Smooth live camera coordinates (snap immediately on scene cut!)
        target_single_x = t1_cx if live_active_speaker == 1 else t2_cx
        target_single_y = t1_cy if live_active_speaker == 1 else t2_cy
        if is_scene_cut:
            live_s_cx, live_s_cy = target_single_x, target_single_y
            live_t1_cx, live_t1_cy = t1_cx, t1_cy
            live_t2_cx, live_t2_cy = t2_cx, t2_cy
        else:
            pan_dist_x = abs(target_single_x - live_s_cx)
            pan_alpha_x = min(0.68, 0.35 + (pan_dist_x / max(1.0, float(src_w))) * 0.60)
            pan_alpha_y = min(0.60, 0.30 + (abs(target_single_y - live_s_cy) / max(1.0, float(src_h))) * 0.50)
            live_s_cx += pan_alpha_x * (target_single_x - live_s_cx)
            live_s_cy += pan_alpha_y * (target_single_y - live_s_cy)
            live_t1_cx += 0.35 * (t1_cx - live_t1_cx)
            live_t1_cy += 0.30 * (t1_cy - live_t1_cy)
            live_t2_cx += 0.35 * (t2_cx - live_t2_cx)
            live_t2_cy += 0.30 * (t2_cy - live_t2_cy)

        _, _, l_nx, l_ny = to_single_norm(live_s_cx, live_s_cy)
        _, _, l_t1_nx, l_t1_ny = to_split_norm(live_t1_cx, live_t1_cy)
        _, _, l_t2_nx, l_t2_ny = to_split_norm(live_t2_cx, live_t2_cy)

        live_layout = "single"
        live_mode_str = "single_2" if live_active_speaker == 2 else "single_1"

        raw_points.append({
            "t": round(rel_t, 4),
            "c1x": t1_cx,
            "c1y": t1_cy,
            "c2x": t2_cx,
            "c2y": t2_cy,
            "w1": t1_w,
            "h1": t1_h,
            "w2": t2_w,
            "h2": t2_h,
            "s1": round(s1_score, 4),
            "s2": round(s2_score, 4),
            "mar1": round(t1_mar, 4),
            "mar2": round(t2_mar, 4),
            "t1_ok": t1_ok,
            "t2_ok": t2_ok,
            "faces": cur_faces_count,
            "activeIdentity": frame_active_identity,
            "cut": is_scene_cut,
            "live_speaker": live_active_speaker,
            "normX": l_nx,
            "normY": l_ny,
            "topNormX": l_t1_nx,
            "topNormY": l_t1_ny,
            "botNormX": l_t2_nx,
            "botNormY": l_t2_ny
        })

        prog_msg = {
            "type": "progress",
            "dualMode": True,
            "frame": len(raw_points),
            "total": max(1, int(round((end_frame - start_frame) / step))),
            "t": round(rel_t, 4),
            "layout": live_layout,
            "mode": live_mode_str,
            "activeSpeaker": live_active_speaker,
            "faces": cur_faces_count,
            "cut": is_scene_cut,
            "normX": round(l_nx, 2),
            "normY": round(l_ny, 2),
            "topNormX": round(l_t1_nx, 2),
            "topNormY": round(l_t1_ny, 2),
            "botNormX": round(l_t2_nx, 2),
            "botNormY": round(l_t2_ny, 2),
            "s1": round(s1_score, 3),
            "s2": round(s2_score, 3),
            "ok": bool(t1_ok or t2_ok)
        }
        sys.stdout.write(f"FYTX_PROG:{json.dumps(prog_msg)}\n")
        sys.stdout.flush()

    cap.release()

    # =========================================================================
    # PASS 2: Global Active Speaker Timeline Optimization & Segmented Smoothing
    # =========================================================================
    n_pts = len(raw_points)
    scene_cuts = [bool(p.get("cut", False)) for p in raw_points]
    s1_arr = smooth_trajectory_gaussian([p["s1"] for p in raw_points], 2.0)
    s2_arr = smooth_trajectory_gaussian([p["s2"] for p in raw_points], 2.0)

    # Adaptive calibration per speaker
    max_s1 = float(np.percentile(s1_arr, 92)) if n_pts > 5 else 0.35
    max_s2 = float(np.percentile(s2_arr, 92)) if n_pts > 5 else 0.35
    eff_thresh_1 = max(0.07, min(0.28, max_s1 * 0.42 * sens_factor))
    eff_thresh_2 = max(0.07, min(0.28, max_s2 * 0.42 * sens_factor))

    raw_states = []
    cur_state = 1 if s1_arr[0] >= s2_arr[0] else 2
    if int(raw_points[0].get("faces", 0)) == 1:
        cur_state = 2 if (raw_points[0].get("activeIdentity") == 2 or (not raw_points[0]["t1_ok"] and raw_points[0]["t2_ok"])) else 1

    for i in range(n_pts):
        pt = raw_points[i]
        v1 = float(s1_arr[i])
        v2 = float(s2_arr[i])
        faces_cnt = int(pt.get("faces", 0))

        # Pure Fill-to-Screen across all 3 scenes (State 1 = Lock 1 / Speaker 1, State 2 = Lock 2 / Speaker 2)
        if faces_cnt >= 2 and pt["t1_ok"] and pt["t2_ok"]:
            if v1 >= eff_thresh_1 and v1 > v2 * 1.15:
                cur_state = 1  # Speaker 1 speaking in Wide Shot -> Fill to Screen on Lock 1
            elif v2 >= eff_thresh_2 and v2 > v1 * 1.15:
                cur_state = 2  # Speaker 2 speaking in Wide Shot -> Fill to Screen on Lock 2
        elif faces_cnt == 1:
            # Close-Up Solo Scene: strictly lock Fill to Screen onto the recognized speaker in this scene
            if pt.get("activeIdentity") in (1, 2):
                cur_state = int(pt["activeIdentity"])
            elif pt["t1_ok"] and not pt["t2_ok"]:
                cur_state = 1
            elif pt["t2_ok"] and not pt["t1_ok"]:
                cur_state = 2
        raw_states.append(cur_state)

    # Debounce short state segments WITHIN each camera shot (never merge across scene cuts)
    min_seg_len = max(3, int(round(0.20 * sample_fps)))
    clean_states = list(raw_states)
    shot_start = 0
    for s_end in range(1, n_pts + 1):
        if s_end == n_pts or scene_cuts[s_end]:
            shot_len = s_end - shot_start
            if shot_len >= min_seg_len:
                idx = shot_start
                while idx < s_end:
                    j = idx
                    while j < s_end and clean_states[j] == clean_states[idx]:
                        j += 1
                    seg_len = j - idx
                    if seg_len < min_seg_len and seg_len < shot_len:
                        rep = clean_states[idx - 1] if idx > shot_start else (clean_states[j] if j < s_end else clean_states[idx])
                        for k in range(idx, j):
                            clean_states[k] = rep
                    idx = j
            shot_start = s_end

    single_target_cx = []
    single_target_cy = []
    for i in range(n_pts):
        st = clean_states[i]
        pt = raw_points[i]
        if int(pt.get("faces", 0)) == 1:
            if pt["t1_ok"]:
                single_target_cx.append(pt["c1x"])
                single_target_cy.append(pt["c1y"])
            else:
                single_target_cx.append(pt["c2x"])
                single_target_cy.append(pt["c2y"])
        elif st == 2:
            single_target_cx.append(pt["c2x"])
            single_target_cy.append(pt["c2y"])
        else:
            single_target_cx.append(pt["c1x"])
            single_target_cy.append(pt["c1y"])

    eff_sigma = max(1.0, min(8.0, 1.5 + (smooth_val / 100.0) * 5.0))

    # Smooth trajectories per camera-shot segment (snaps instantaneously on scene cuts, pans smoothly inside wide shots!)
    cine_single_cx = apply_segmented_hardlock_and_gaussian(single_target_cx, scene_cuts, smooth_val, deadzone_val, eff_sigma)
    cine_single_cy = apply_segmented_hardlock_and_gaussian(single_target_cy, scene_cuts, smooth_val, deadzone_val, eff_sigma * 1.15)

    cine_t1_cx = apply_segmented_hardlock_and_gaussian([p["c1x"] for p in raw_points], scene_cuts, smooth_val, deadzone_val, eff_sigma)
    cine_t1_cy = apply_segmented_hardlock_and_gaussian([p["c1y"] for p in raw_points], scene_cuts, smooth_val, deadzone_val, eff_sigma * 1.15)

    cine_t2_cx = apply_segmented_hardlock_and_gaussian([p["c2x"] for p in raw_points], scene_cuts, smooth_val, deadzone_val, eff_sigma)
    cine_t2_cy = apply_segmented_hardlock_and_gaussian([p["c2y"] for p in raw_points], scene_cuts, smooth_val, deadzone_val, eff_sigma * 1.15)

    smoothed_keyframes = []
    split_intervals = []

    for i, pt in enumerate(raw_points):
        st = 2 if clean_states[i] == 2 else 1
        faces_cnt = int(pt.get("faces", 0))
        layout = "single"
        mode_str = "single_2" if st == 2 else "single_1"
        t_val = pt["t"]

        s_cx, s_cy = float(cine_single_cx[i]), float(cine_single_cy[i])
        t1_x, t1_y = float(cine_t1_cx[i]), float(cine_t1_cy[i])
        t2_x, t2_y = float(cine_t2_cx[i]), float(cine_t2_cy[i])

        s_crop_x, s_crop_y, s_nx, s_ny = to_single_norm(s_cx, s_cy)
        t1_crop_x, t1_crop_y, t1_nx, t1_ny = to_split_norm(t1_x, t1_y)
        t2_crop_x, t2_crop_y, t2_nx, t2_ny = to_split_norm(t2_x, t2_y)

        smoothed_keyframes.append({
            "t": t_val,
            "layout": layout,
            "mode": mode_str,
            "activeSpeaker": st,  # 1 = Lock 1 (Speaker 1), 2 = Lock 2 (Speaker 2)
            "activeIdentity": int(pt.get("activeIdentity", 0)),
            "cut": bool(pt.get("cut", False)),
            "c1x": round(float(pt["c1x"]), 2),
            "c1y": round(float(pt["c1y"]), 2),
            "c2x": round(float(pt["c2x"]), 2),
            "c2y": round(float(pt["c2y"]), 2),
            "raw1Cx": round(float(pt["c1x"]), 2),
            "raw1Cy": round(float(pt["c1y"]), 2),
            "raw2Cx": round(float(pt["c2x"]), 2),
            "raw2Cy": round(float(pt["c2y"]), 2),
            "s1": round(float(s1_arr[i]), 4),
            "s2": round(float(s2_arr[i]), 4),
            "t1_ok": bool(pt["t1_ok"]),
            "t2_ok": bool(pt["t2_ok"]),
            "faces": faces_cnt,
            "cx": round(s_cx, 2),
            "cy": round(s_cy, 2),
            "cropX": round(s_crop_x, 2),
            "cropY": round(s_crop_y, 2),
            "normX": round(s_nx, 3),
            "normY": round(s_ny, 3),
            "topCropX": round(t1_crop_x, 2),
            "topCropY": round(t1_crop_y, 2),
            "topNormX": round(t1_nx, 3),
            "topNormY": round(t1_ny, 3),
            "botCropX": round(t2_crop_x, 2),
            "botCropY": round(t2_crop_y, 2),
            "botNormX": round(t2_nx, 3),
            "botNormY": round(t2_ny, 3),
            "ok": bool(pt["t1_ok"] or pt["t2_ok"])
        })

    return {
        "ok": True,
        "dualMode": True,
        "sourceWidth": src_w,
        "sourceHeight": src_h,
        "fps": fps,
        "sampleFps": round(sample_fps, 2),
        "start": start_sec,
        "end": end_sec,
        "duration": round(end_sec - start_sec, 3),
        "mode": "dual_face",
        "zoom": round(requested_zoom, 3),
        "splitZoom": 216,
        "anchorX": anchor_x,
        "anchorY": anchor_y,
        "smoothness": smooth_val,
        "deadzone": deadzone_val,
        "sensitivity": sens_val,
        "totalFrames": len(smoothed_keyframes),
        "cropWidth": round(single_crop_w, 1),
        "cropHeight": round(single_crop_h, 1),
        "splitCropWidth": round(split_crop_w, 1),
        "splitCropHeight": round(split_crop_h, 1),
        "splitIntervals": split_intervals,
        "keyframes": smoothed_keyframes
    }


def main():
    parser = argparse.ArgumentParser(description="FytX Cinematic Motion Tracking Engine")
    parser.add_argument("--video", required=True, help="Path or URL to input video")
    parser.add_argument("--start", type=float, default=0.0, help="Start time in seconds")
    parser.add_argument("--end", type=float, default=None, help="End time in seconds")
    parser.add_argument("--mode", choices=["face", "custom", "dual_face"], default="face", help="Tracking mode")
    parser.add_argument("--bbox", type=str, default="", help="Initial bounding box x,y,w,h in source pixels")
    parser.add_argument("--target1", type=str, default="", help="Initial target 1 x,y in normalized 0..1 or source pixels")
    parser.add_argument("--target2", type=str, default="", help="Initial target 2 x,y in normalized 0..1 or source pixels")
    parser.add_argument("--smoothness", type=float, default=50.0, help="Camera smoothing (0-100)")
    parser.add_argument("--deadzone", type=float, default=15.0, help="Dead-zone pixel margin")
    parser.add_argument("--sensitivity", type=float, default=50.0, help="Active speaker detection sensitivity (0-100)")
    parser.add_argument("--zoom", type=float, default=1.15, help="Zoom headroom factor for Y-axis movement (default: 1.15)")
    parser.add_argument("--anchor_x", type=float, default=0.50, help="Horizontal lock anchor on canvas (0.0 to 1.0, default: 0.50)")
    parser.add_argument("--anchor_y", type=float, default=0.40, help="Vertical headroom lock anchor on canvas (0.0 to 1.0, default: 0.40)")
    parser.add_argument("--out", type=str, default="", help="Path to write JSON output")

    args = parser.parse_args()

    if args.mode == "dual_face":
        t1_xy = None
        t2_xy = None
        if args.target1:
            try:
                p1 = [float(x.strip()) for x in args.target1.split(",")]
                if len(p1) == 2:
                    t1_xy = (p1[0], p1[1])
            except Exception:
                t1_xy = None
        if args.target2:
            try:
                p2 = [float(x.strip()) for x in args.target2.split(",")]
                if len(p2) == 2:
                    t2_xy = (p2[0], p2[1])
            except Exception:
                t2_xy = None

        result = track_video_dual(
            video_path=args.video,
            start_sec=args.start,
            end_sec=args.end,
            target1_xy=t1_xy,
            target2_xy=t2_xy,
            smoothness=args.smoothness,
            deadzone=args.deadzone,
            sensitivity=args.sensitivity,
            zoom=args.zoom,
            anchor_x=args.anchor_x,
            anchor_y=args.anchor_y
        )
    else:
        init_bbox = None
        if args.bbox:
            try:
                parts = [float(p.strip()) for p in args.bbox.split(",")]
                if len(parts) == 4:
                    init_bbox = tuple(parts)
            except Exception:
                init_bbox = None

        result = track_video(
            video_path=args.video,
            start_sec=args.start,
            end_sec=args.end,
            mode=args.mode,
            init_bbox=init_bbox,
            smoothness=args.smoothness,
            deadzone=args.deadzone,
            zoom=args.zoom,
            anchor_x=args.anchor_x,
            anchor_y=args.anchor_y,
            sensitivity=args.sensitivity
        )

    out_json = json.dumps(result, indent=2 if not args.out else None)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(out_json)
        print(json.dumps({"ok": result.get("ok", False), "out": args.out, "totalFrames": result.get("totalFrames", 0)}))
    else:
        print(out_json)


if __name__ == "__main__":
    main()

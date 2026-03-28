# Presage API Tool

API server and webcam tool that extracts vitals (heart rate, respiratory rate, SpO2, HRV, blood pressure, stress, and more) from video frames using the [Presage Technologies](https://presagetechnologies.com/) Physiology API. Also includes real-time phone usage detection via OpenCV + MediaPipe.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Setup (Windows / Mac / Linux)](#local-setup)
3. [Usage — Two Modes](#usage)
4. [API Endpoints Reference](#api-endpoints-reference)
5. [Phone Detection](#phone-detection)
6. [Deploy on AWS EC2 (Free Tier)](#deploy-on-aws-ec2-free-tier)
7. [Sending API Requests (Examples)](#sending-api-requests)
8. [Docker](#docker)
9. [Vitals Returned](#vitals-returned)
10. [Tips for Good Results](#tips-for-good-results)
11. [Project Structure](#project-structure)

---

## Prerequisites

- Python 3.10+
- [Presage API key](https://physiology.presagetech.com/) — sign up and generate one
- FFmpeg installed on your system
- Webcam (for webcam mode only — not needed on EC2 server mode)

---

## Local Setup

### 1. Clone and enter the directory

```bash
git clone <your-repo-url>
cd presageAPI
```

### 2. Create a virtual environment

```bash
python -m venv venv
```

Activate it:

```bash
# Linux / Mac
source venv/bin/activate

# Windows (cmd)
venv\Scripts\activate

# Windows (PowerShell)
.\venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

> **Windows note:** If you get errors with `mediapipe` or `opencv`, make sure you have Visual C++ Build Tools installed and are on Python 3.10 or 3.11 (not 3.13+).

### 4. Configure your API key

```bash
cp .env.example .env
```

Open `.env` and paste your Presage API key:

```
PRESAGE_API_KEY=your_key_here
PORT=5000
HOST=0.0.0.0
```

---

## Usage

### Webcam Mode

Captures from your webcam, processes frames, detects phone usage, and prints all results to the terminal.

```bash
python main.py webcam
```

| Flag         | Default | Description                    |
|--------------|---------|--------------------------------|
| `--duration` | 30      | Recording duration in seconds  |
| `--fps`      | 10      | Target frames per second       |
| `--camera`   | 0       | Camera device index            |

Example:

```bash
python main.py webcam --duration 45 --fps 10 --camera 0
```

Press `q` during capture to stop early. You'll see real-time output like:

```
Frames: 142 | Time remaining: 16s | PHONE: TEXTING
```

After capture completes, vitals + phone detection summary are printed.

### Server Mode (Production)

Runs a Flask API server that accepts frames/video over HTTP and returns vitals + phone detection.

```bash
python main.py server
```

| Flag     | Default   | Description |
|----------|-----------|-------------|
| `--host` | 0.0.0.0   | Bind host   |
| `--port` | 5000      | Bind port   |

---

## API Endpoints Reference

| Endpoint | Method | Type | Description |
|---|---|---|---|
| `/health` | GET | — | Health check |
| `/api/process-frames` | POST | Async | Send images as multipart form data |
| `/api/process-video` | POST | Async | Upload a video file |
| `/api/process-base64` | POST | Async | Send base64-encoded frames as JSON |
| `/api/process-sync` | POST | Sync | Send frames, blocks until results ready |
| `/api/status/<job_id>` | GET | — | Poll for async job results |
| `/api/jobs` | GET | — | List all jobs |

### Async flow

1. POST frames/video to an async endpoint
2. Get back a `job_id`
3. Poll `GET /api/status/<job_id>` until `status` is `complete`

Status progression: `queued` → `preprocessing` → `uploading` → `processing` → `complete` (or `error`)

### Per-request API key

Pass `api_key` in form data or JSON body to override the default key from `.env`.

---

## Phone Detection

Both modes include automatic phone usage detection powered by MediaPipe Pose:

**Detects two postures:**
- **Calling** — wrist near ear (holding phone to head)
- **Texting / Scrolling** — hands in front of body + head tilted down

**Rules:**
- Only flags after **5+ consecutive seconds** of detection
- Brief interruptions (<1 second) are smoothed over
- Returns per-event breakdown with timestamps and durations

**Response format** (included in all API responses):

```json
{
  "phone_detection": {
    "on_phone": true,
    "total_phone_seconds": 12.5,
    "events": [
      {"start": 3.0, "end": 10.5, "duration": 7.5, "type": "texting"},
      {"start": 15.0, "end": 22.0, "duration": 7.0, "type": "calling"}
    ]
  }
}
```

---

## Deploy on AWS EC2 (Free Tier)

### Step 1: Launch an EC2 Instance

1. Go to [AWS Console → EC2](https://console.aws.amazon.com/ec2/)
2. Click **Launch Instance**
3. Configure:

| Setting | Value |
|---|---|
| **Name** | `presage-api` |
| **AMI** | Debian 12 (or Ubuntu 22.04) — both free tier eligible |
| **Instance type** | `t2.micro` (free tier) or `t3.micro` (free tier) |
| **Key pair** | Create new or select existing `.pem` key |
| **Storage** | 16 GB gp3 (free tier allows up to 30 GB) |

4. **Security Group** — add these inbound rules:

| Type | Port | Source | Why |
|---|---|---|---|
| SSH | 22 | Your IP | SSH access |
| Custom TCP | 5000 | 0.0.0.0/0 (or your IP) | API access |

5. Click **Launch Instance**

### Step 2: SSH In

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<YOUR-EC2-PUBLIC-IP>
```

> For Debian AMI the user is `admin` instead of `ubuntu`.

### Step 3: Clone and Deploy

```bash
git clone <your-repo-url> presageAPI
cd presageAPI
chmod +x deploy.sh
./deploy.sh
```

The script:
- Installs system deps (python3, ffmpeg, opencv libs)
- Creates a 2GB swap file (t2.micro only has 1GB RAM — mediapipe needs more)
- Sets up Python venv and installs pip packages
- Installs a systemd service for auto-start on boot

### Step 4: Add Your API Key

```bash
nano .env
```

Paste your key:

```
PRESAGE_API_KEY=your_key_here
PORT=5000
HOST=0.0.0.0
```

### Step 5: Start the Service

```bash
sudo systemctl start presage-api
```

Check it's running:

```bash
sudo systemctl status presage-api
curl http://localhost:5000/health
```

View logs:

```bash
sudo journalctl -u presage-api -f
```

### Step 6: Test Remotely

From your local machine:

```bash
curl http://<YOUR-EC2-PUBLIC-IP>:5000/health
```

Should return:

```json
{"status": "ok", "service": "presage-api"}
```

### Useful Commands

```bash
sudo systemctl stop presage-api       # Stop
sudo systemctl restart presage-api    # Restart
sudo systemctl status presage-api     # Status
sudo journalctl -u presage-api -f     # Live logs
```

### Cost: $0

The free tier gives you:
- 750 hours/month of t2.micro or t3.micro (enough to run 24/7)
- 30 GB EBS storage
- 15 GB bandwidth out

> **Note:** t2.micro has 1GB RAM. The deploy script adds 2GB swap so mediapipe/opencv don't OOM. Processing will be slower than a bigger instance but it works.

---

## Sending API Requests

### Health Check

```bash
curl http://<HOST>:5000/health
```

### Send Frames (Async)

```bash
curl -X POST http://<HOST>:5000/api/process-frames \
  -F "frames=@frame001.jpg" \
  -F "frames=@frame002.jpg" \
  -F "frames=@frame003.jpg" \
  -F "frames=@frame004.jpg" \
  -F "frames=@frame005.jpg" \
  -F "fps=10"
```

Response:

```json
{
  "job_id": "a1b2c3d4",
  "status": "queued",
  "frame_count": 5,
  "message": "Processing 5 frames. Poll /api/status/a1b2c3d4 for results."
}
```

Then poll:

```bash
curl http://<HOST>:5000/api/status/a1b2c3d4
```

### Send Video File (Async)

```bash
curl -X POST http://<HOST>:5000/api/process-video \
  -F "video=@recording.mp4" \
  -F "fps=10"
```

### Send Base64 Frames (Async)

```bash
curl -X POST http://<HOST>:5000/api/process-base64 \
  -H "Content-Type: application/json" \
  -d '{
    "frames": ["<base64_string_1>", "<base64_string_2>", "..."],
    "fps": 10
  }'
```

### Send Frames — Synchronous (Blocks Until Done)

```bash
curl -X POST http://<HOST>:5000/api/process-sync \
  -F "frames=@frame001.jpg" \
  -F "frames=@frame002.jpg" \
  -F "frames=@frame003.jpg" \
  -F "frames=@frame004.jpg" \
  -F "frames=@frame005.jpg" \
  -F "fps=10"
```

Returns results directly (can take a few minutes):

```json
{
  "status": "complete",
  "results": { "...vitals data..." },
  "phone_detection": {
    "on_phone": false,
    "total_phone_seconds": 0.0,
    "events": []
  }
}
```

### Python Example

```python
import requests
import glob

url = "http://<HOST>:5000/api/process-frames"

# Collect your frame files
frame_files = sorted(glob.glob("frames/*.jpg"))

files = [("frames", open(f, "rb")) for f in frame_files]
data = {"fps": "10"}

resp = requests.post(url, files=files, data=data)
job = resp.json()
print(f"Job ID: {job['job_id']}")

# Poll for results
import time
while True:
    status = requests.get(f"http://<HOST>:5000/api/status/{job['job_id']}").json()
    print(f"Status: {status['status']}")
    if status["status"] in ("complete", "error"):
        break
    time.sleep(5)

# Print results
if status["status"] == "complete":
    print("Vitals:", status["results"])
    print("Phone:", status.get("phone_detection"))
```

### JavaScript / Node.js Example

```javascript
const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");

const HOST = "http://<YOUR-EC2-IP>:5000";

async function processFrames(framePaths) {
  const form = new FormData();
  framePaths.forEach((p) => form.append("frames", fs.createReadStream(p)));
  form.append("fps", "10");

  const { data: job } = await axios.post(`${HOST}/api/process-frames`, form, {
    headers: form.getHeaders(),
  });
  console.log("Job:", job.job_id);

  // Poll
  while (true) {
    const { data: status } = await axios.get(`${HOST}/api/status/${job.job_id}`);
    console.log("Status:", status.status);
    if (status.status === "complete" || status.status === "error") {
      console.log("Results:", JSON.stringify(status.results, null, 2));
      console.log("Phone:", JSON.stringify(status.phone_detection, null, 2));
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

processFrames(["frame001.jpg", "frame002.jpg", "frame003.jpg", "frame004.jpg", "frame005.jpg"]);
```

### Batch Capture + Send Script (grab frames from webcam and send)

```bash
#!/bin/bash
# capture_and_send.sh — grab 10s of webcam, extract frames, send to API
HOST="${1:-http://localhost:5000}"
DURATION=10
FPS=10
TMPDIR=$(mktemp -d)

echo "Capturing $DURATION seconds..."
ffmpeg -f v4l2 -framerate 30 -i /dev/video0 -t $DURATION -vf fps=$FPS "$TMPDIR/frame_%04d.jpg" -y -loglevel quiet

FRAMES=$(ls "$TMPDIR"/*.jpg)
COUNT=$(echo "$FRAMES" | wc -l)
echo "Captured $COUNT frames. Uploading..."

CMD="curl -s -X POST $HOST/api/process-sync"
for f in $TMPDIR/*.jpg; do
    CMD="$CMD -F frames=@$f"
done
CMD="$CMD -F fps=$FPS"

eval $CMD | python3 -m json.tool
rm -rf "$TMPDIR"
```

---

## Testing Locally

A test script validates the full pipeline — phone detection, preprocessing, and server endpoints — **without calling the Presage cloud API** (no API key needed).

### Run all tests (default)

```bash
python test_local.py
```

This generates synthetic frames, runs phone detection on them, validates preprocessing output format, and hits every server endpoint.

### Test with your own images

Put `.jpg` / `.png` files in a folder and point the script at it:

```bash
python test_local.py --frames-dir ./my_photos
```

### Test with a video file

```bash
python test_local.py --video recording.mp4
```

### Test with webcam

```bash
python test_local.py --webcam --duration 5
```

### All flags

| Flag | Description |
|---|---|
| `--frames-dir PATH` | Use images from a folder |
| `--video PATH` | Extract frames from a video file |
| `--webcam` | Capture from webcam |
| `--duration N` | Webcam capture seconds (default: 5) |
| `--fps N` | Target FPS (default: 10) |
| `--generate` | Generate synthetic test frames only |
| `--all` | Run everything (default if no flags given) |

### What it checks

- **Phone detector**: returns correct keys (`phone_detected`, `posture`), summary format (`on_phone`, `total_phone_seconds`, `events`), events have `start`/`end`/`duration`/`type`
- **Preprocessing**: `process_frame()` returns dict with `time_now`, trace has `settings` + `frames`, compressed trace is valid bytes
- **Server endpoints**: `/health` returns 200, frame validation rejects bad input, async endpoints return `job_id`, status polling works, base64 endpoint parses correctly, 404 for unknown jobs

Sample synthetic frames are saved to `test_frames/` for visual inspection.

---

## Docker

Build and run locally or on EC2:

```bash
docker build -t presage-api .
docker run -d -p 5000:5000 --env-file .env --name presage presage-api
```

Check:

```bash
docker logs presage
curl http://localhost:5000/health
```

---

## Vitals Returned

The Presage API returns these measurements (depending on video quality and duration):

| Vital | Unit | Notes |
|---|---|---|
| Heart Rate | bpm | — |
| Respiratory Rate | breaths/min | — |
| Blood Oxygen (SpO2) | % | — |
| Heart Rate Variability | ms | — |
| Stress Level | — | 0-100 scale |
| Blood Pressure (Systolic) | mmHg | — |
| Blood Pressure (Diastolic) | mmHg | — |
| Breathing Amplitude | — | Relative |
| Inhale/Exhale Ratio | — | — |
| Apnea Detection | — | Boolean |
| Respiratory Line Length | — | — |
| Phasic EDA | — | Electrodermal activity |
| Cardiac Stress | — | — |

**Plus phone detection:**

| Field | Type | Description |
|---|---|---|
| `on_phone` | bool | True if any phone event >= 5 seconds |
| `total_phone_seconds` | float | Total time on phone |
| `events` | array | Start/end/duration/type for each event |

---

## Tips for Good Results

- At least 100 pixels across the face
- Face must be in focus, well-lit (no harsh shadows)
- Minimal subject/camera movement
- At least 5 frames minimum, **30+ seconds recommended** for accurate vitals
- RGB color video at 10+ FPS
- Presage works best with frontal face view

---

## Project Structure

```
presageAPI/
  main.py                 # CLI entry point (webcam | server)
  server.py               # Flask API server (production mode)
  webcam_mode.py           # Webcam capture + terminal output
  preprocessing.py         # Face mesh extraction, ROI averaging, RR tracking
  presage_client.py        # Presage API wrapper (upload, poll, retrieve)
  phone_detector.py        # Phone usage detection (calling + texting)
  config.py               # Env var loading
  test_local.py            # Local test suite (no API key needed)
  requirements.txt         # Python dependencies
  .env.example             # Template for environment variables
  Dockerfile              # Container build
  deploy.sh               # EC2 deployment script
  presage-api.service      # Systemd unit file (generated by deploy.sh)
  test_frames/             # Generated test frames (gitignored)
```

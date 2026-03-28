# Presage API Tool

API server and webcam tool that extracts vitals (heart rate, respiratory rate, SpO2, HRV, etc.) from video frames using the [Presage Technologies](https://presagetechnologies.com/) Physiology API.

## Prerequisites

- Python 3.10+
- [Presage API key](https://physiology.presagetech.com/) (sign up and generate one)
- FFmpeg installed on your system
- Webcam (for webcam mode only)

## Setup

### 1. Clone and enter the directory

```bash
cd presageAPI
```

### 2. Create a virtual environment

```bash
python -m venv venv
```

Activate it:

```bash
# Linux/Mac
source venv/bin/activate

# Windows
venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure your API key

```bash
cp .env.example .env
```

Open `.env` and paste your Presage API key:

```
PRESAGE_API_KEY=your_key_here
```

## Usage

### Webcam Mode

Captures from your webcam, processes frames, and prints vitals to the terminal.

```bash
python main.py webcam
```

Options:

| Flag         | Default | Description                    |
|--------------|---------|--------------------------------|
| `--duration` | 30      | Recording duration in seconds  |
| `--fps`      | 10      | Target frames per second       |
| `--camera`   | 0       | Camera device index            |

Example:

```bash
python main.py webcam --duration 45 --fps 10 --camera 0
```

Press `q` during capture to stop early.

### Server Mode (Production)

Runs a Flask API server that accepts frames/video over HTTP and returns vitals.

```bash
python main.py server
```

Options:

| Flag     | Default   | Description |
|----------|-----------|-------------|
| `--host` | 0.0.0.0   | Bind host   |
| `--port` | 5000      | Bind port   |

#### API Endpoints

**POST /api/process-frames** (async)

Send multiple images as multipart form data:

```bash
curl -X POST http://localhost:5000/api/process-frames \
  -F "frames=@frame1.jpg" \
  -F "frames=@frame2.jpg" \
  -F "frames=@frame3.jpg" \
  -F "fps=10"
```

Returns a `job_id` to poll for results.

**POST /api/process-video** (async)

Upload a video file:

```bash
curl -X POST http://localhost:5000/api/process-video \
  -F "video=@recording.mp4" \
  -F "fps=10"
```

**POST /api/process-base64** (async)

Send base64-encoded frames as JSON:

```bash
curl -X POST http://localhost:5000/api/process-base64 \
  -H "Content-Type: application/json" \
  -d '{"frames": ["<base64_img_1>", "<base64_img_2>"], "fps": 10}'
```

**POST /api/process-sync** (blocking)

Same as process-frames but waits and returns results directly:

```bash
curl -X POST http://localhost:5000/api/process-sync \
  -F "frames=@frame1.jpg" \
  -F "frames=@frame2.jpg" \
  -F "fps=10"
```

**GET /api/status/\<job_id\>**

Poll for async job results:

```bash
curl http://localhost:5000/api/status/abc12345
```

Response when complete:

```json
{
  "job_id": "abc12345",
  "status": "complete",
  "results": { ... }
}
```

Status values: `queued` → `preprocessing` → `uploading` → `processing` → `complete` (or `error`)

**GET /api/jobs** — List all jobs

**GET /health** — Health check

#### Per-request API key

You can pass `api_key` in form data or JSON body to override the default key from `.env`.

## Deploy on EC2 (Debian)

### Quick setup

SSH into your EC2 instance, clone the repo, then:

```bash
cd presageAPI
chmod +x deploy.sh
./deploy.sh
```

Edit `.env` with your API key:

```bash
nano .env
```

Start the server:

```bash
source venv/bin/activate
python main.py server
```

### Production with gunicorn

```bash
source venv/bin/activate
gunicorn --bind 0.0.0.0:5000 --workers 2 --threads 4 --timeout 600 server:app
```

### Run as a systemd service (auto-start on boot)

Edit `presage-api.service` if your user or paths differ, then:

```bash
sudo cp presage-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable presage-api
sudo systemctl start presage-api
```

Check status:

```bash
sudo systemctl status presage-api
```

### EC2 Security Group

Make sure port 5000 is open in your EC2 security group inbound rules (or whichever port you use).

### Docker (alternative)

```bash
docker build -t presage-api .
docker run -d -p 5000:5000 --env-file .env presage-api
```

## Vitals Returned

The Presage API returns these measurements (depending on video quality and duration):

- Heart Rate (bpm)
- Respiratory Rate (breaths/min)
- Blood Oxygen / SpO2 (%)
- Heart Rate Variability (ms)
- Stress Level
- Blood Pressure (systolic/diastolic)
- Breathing Amplitude
- Inhale/Exhale Ratio
- Apnea Detection
- Respiratory Line Length
- Phasic EDA
- Cardiac Stress

## Requirements for Good Results

- At least 100 pixels across the face
- Face must be in focus
- Good lighting (not too dark or bright)
- Minimal subject/camera motion
- At least 5 frames (30+ seconds of video recommended)
- RGB color video, 10+ FPS

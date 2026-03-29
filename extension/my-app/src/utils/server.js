import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());

/** Allow extension + Vite dev to POST from another origin (5173 → 3000). */
function corsTts(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

if (!ELEVENLABS_API_KEY) {
  console.warn(
    "[server] ELEVENLABS_API_KEY missing — /tts disabled (face detection still works via Vite)",
  );
}

app.options("/tts", corsTts);
app.post("/tts", corsTts, async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(503).json({ error: "TTS not configured (set ELEVENLABS_API_KEY)" });
    }
    const text = req.body?.text;
    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    const voice_settings = req.body?.voice_settings ?? {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
    };

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "TTS failed" });
  }
});

app.use(express.static("public"));

app.listen(3000, () => {
  console.log("[server] http://localhost:3000 — POST /tts for ElevenLabs TTS");
  if (ELEVENLABS_API_KEY) {
    console.log("[server] ELEVENLABS_API_KEY loaded (ElevenLabs /tts enabled)");
  } else {
    console.warn(
      "[server] No ELEVENLABS_API_KEY — POST /tts returns 503. Add it to .env in the project root.",
    );
  }
});
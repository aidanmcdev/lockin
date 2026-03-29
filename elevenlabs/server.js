import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

if (!ELEVENLABS_API_KEY) {
  throw new Error("ELEVENLABS_API_KEY missing in .env");
}

app.post("/tts", async (req, res) => {
  try {
    const text = req.body?.text;
    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

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
  console.log("Open http://localhost:3000");
});
import { NextRequest, NextResponse } from "next/server";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

type ElevenLabsVoiceSettings = {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
};

function withCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  try {
    if (!ELEVENLABS_API_KEY) {
      return withCors(
        NextResponse.json(
          { error: "TTS not configured (missing ELEVENLABS_API_KEY)" },
          { status: 503 },
        ),
      );
    }

    const body = (await req.json().catch(() => null)) as
      | { text?: unknown; voice_settings?: unknown }
      | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return withCors(NextResponse.json({ error: "Missing text" }, { status: 400 }));
    }

    const voice_settings: ElevenLabsVoiceSettings =
      typeof body?.voice_settings === "object" && body.voice_settings !== null
        ? (body.voice_settings as ElevenLabsVoiceSettings)
        : {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          };

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings,
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return withCors(
        NextResponse.json(
          { error: "ElevenLabs error", detail: errText.slice(0, 2000) },
          { status: response.status },
        ),
      );
    }

    const audio = await response.arrayBuffer();
    return withCors(
      new NextResponse(audio, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
        },
      }),
    );
  } catch (error) {
    console.error("TTS error:", error);
    return withCors(NextResponse.json({ error: "TTS failed" }, { status: 500 }));
  }
}


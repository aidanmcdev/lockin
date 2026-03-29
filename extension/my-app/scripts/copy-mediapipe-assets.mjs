/**
 * Copies MediaPipe WASM from node_modules and downloads the BlazeFace model into /public
 * so the extension CSP (script-src 'self') can load everything without CDN URLs.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const wasmSrc = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm")
const wasmDest = path.join(root, "public/mediapipe-wasm")
const modelDir = path.join(root, "public/mediapipe-models")
const modelName = "blaze_face_short_range.tflite"
const modelDest = path.join(modelDir, modelName)
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"

if (!fs.existsSync(wasmSrc)) {
  console.warn(
    "[copy-mediapipe-assets] Skip: install @mediapipe/tasks-vision first (pnpm install).",
  )
  process.exit(0)
}

fs.mkdirSync(path.dirname(wasmDest), { recursive: true })
fs.cpSync(wasmSrc, wasmDest, { recursive: true })
console.log("[copy-mediapipe-assets] Copied WASM → public/mediapipe-wasm")

if (!fs.existsSync(modelDest)) {
  fs.mkdirSync(modelDir, { recursive: true })
  console.log("[copy-mediapipe-assets] Downloading BlazeFace model…")
  const res = await fetch(modelUrl)
  if (!res.ok) throw new Error(`Model fetch failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(modelDest, buf)
  console.log("[copy-mediapipe-assets] Saved model → public/mediapipe-models/" + modelName)
} else {
  console.log("[copy-mediapipe-assets] Model already present, skipping download.")
}

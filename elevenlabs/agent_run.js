import 'dotenv/config';
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "fs";

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// This function gets called when your app detects distraction
async function speakFocusMessage(text) {
  const audioStream = await client.textToSpeech.convert(
    "JBFqnCBsd6RMkjVDRZzb", // voice id
    {
      text: text,
    }
  );

  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  fs.writeFileSync("focus.mp3", buffer);

  console.log("Spoke:", text);
}

const focusMessages = [
  "Let’s refocus. What’s the next step?",
  "Stay with the task. You’ve got this.",
  "Looks like you’re drifting—come back to it.",
  "Let’s lock back in.",
  "Focus up. One step at a time.",
  "Back to work. Start small.",
  "Don’t break momentum—keep going.",
  "Stay on track. What’s next?",
  "You’re close. Keep pushing.",
  "Return to the task in front of you.",
  "Let’s get back into flow.",
  "You don’t need to switch—keep going.",
  "Stay with it. One more step.",
  "Focus. Do the next small action.",
  "Let’s keep the momentum going.",
  "Come back to your main goal.",
  "You’re getting distracted—refocus.",
  "Keep your attention here.",
  "Back on task. Right now.",
  "Stay disciplined—what’s next?",
  "Let’s not lose focus now.",
  "Keep working. Don’t drift.",
  "Bring your attention back.",
  "Stay locked in.",
  "Focus mode. Continue.",
  "Don’t switch tasks—finish this first.",
  "You’re doing fine. Stay on it.",
  "Let’s keep moving forward.",
  "Stay consistent. Keep going.",
  "Focus. Just one more step.",
  "Let’s keep working together.",
  "You’re capable—stay with it.",
  "Bring it back. Focus here.",
  "No distractions—continue.",
  "Stay engaged with your task.",
  "Keep your head in the game.",
  "Return to what matters right now.",
  "Stay productive—what’s next?",
  "Let’s not lose the flow.",
  "Focus—don’t overthink it.",
  "Stay steady. Keep working.",
  "Come back to your task now.",
  "Don’t drift—stay here.",
  "Keep your attention on this.",
  "Stay aligned with your goal.",
  "You’re off track—bring it back.",
  "Let’s keep it simple. Continue.",
  "Stay present. Keep working.",
  "Focus on the next action only.",
  "Let’s finish what you started.",
  "Stay in control. Keep going.",
  "You’re slipping—refocus now.",
  "Stay committed to this task.",
  "Let’s make progress—continue.",
  "Keep your attention locked in.",
  "Back to the task. No distractions.",
  "Stay sharp. Keep working.",
  "Let’s get back into rhythm.",
  "Focus. Execute the next step.",
  "Stay on mission. Continue."
];

function getRandomMessage() {
  const index = Math.floor(Math.random() * focusMessages.length);
  return focusMessages[index];
}

// Example trigger (simulate distraction)

setTimeout(() => {
  speakFocusMessage(getRandomMessage());
}, 1000);
# Voice-to-Command Frontend

React + Vite frontend for the voice-controlled project assistant. Uses the browser's
built-in Web Speech API for speech-to-text and speech-to-text-reply — completely free,
no API key, works in Chrome or Edge.

## Setup

1. Make sure the **backend** is running first (see `../backend/README.md`), on
   `http://localhost:4000`.

2. Install dependencies:
   ```
   npm install
   ```

3. Run the dev server:
   ```
   npm run dev
   ```
   Open the printed URL (usually `http://localhost:5173`) in **Chrome or Edge**
   (Web Speech API isn't supported in Firefox/Safari).

## How to use it

1. Tap the orange mic button and speak a command, e.g.:
   *"Create a snag for the master bathroom ceiling and assign it to the false-ceiling contractor"*
2. The app sends the transcript to the backend, which figures out the intent,
   extracts details, and resolves them against the mock project data.
3. For create/assign/update actions, a confirmation ticket appears — tap **Confirm**
   to actually commit it (or **Cancel** to discard).
4. For search/status questions, results appear immediately and are read aloud.
5. The **Site log** panel at the bottom always reflects the live task data —
   watch a new task appear there right after you confirm one by voice.

You can also just click the example command chips instead of speaking, useful for
quick testing or if your mic isn't cooperating.

## Files

- `src/App.jsx` — main app logic and state
- `src/useSpeechRecognition.js` — Web Speech API wrapper (STT + TTS)
- `src/api.js` — calls to the backend API
- `src/components/` — MicButton, ConfirmationTicket, ClarificationCard, TaskList
- `src/index.css` — design system (job-site/punch-list visual language)

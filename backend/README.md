# Voice-to-Command Backend (Project Assistant)

Backend for the "talk to your project" voice assistant. Takes a spoken transcript,
figures out what action to take (create task, assign task, search tasks, update status),
resolves fuzzy references (e.g. "false-ceiling contractor") to real database records,
asks for confirmation before making changes, and executes the action.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Get a FREE Groq API key (no credit card needed):
   - Go to https://console.groq.com/keys
   - Sign up and create a key

3. Create your `.env` file:
   ```
   cp .env.example .env
   ```
   Then open `.env` and paste your key:
   ```
   GROQ_API_KEY=gsk_your_real_key_here
   PORT=4000
   ```

4. Run the server:
   ```
   node server.js
   ```
   It will auto-create `app.db` (SQLite) with seed data on first run.
   Server runs at http://localhost:4000

Note: uses a plain JSON file (`app.json`) as the database — no native compilation
required, so `npm install` works cleanly on Windows without Visual Studio Build Tools.

## Files

- `db.js` — JSON file store + seed data (projects, contractors, tasks). Auto-creates `app.json` on first run.
- `tools.js` — the fixed set of intents the AI can choose from (function-calling schemas)
- `aiClient.js` — calls Groq LLM to interpret transcript → intent + extracted fields
- `resolve.js` — fuzzy-matches free text (e.g. "false-ceiling contractor") to real DB records
- `executor.js` — actually creates/updates records in the database
- `server.js` — Express API tying it all together

## API Endpoints

- `POST /api/voice-command` — body: `{ "transcript": "..." }`
  Returns one of:
  - `{ type: "confirmation_needed", pendingAction, summary }` — for create/assign/update actions
  - `{ type: "search_results", results, message }` — for search (executes immediately, read-only)
  - `{ type: "clarification_needed", message, candidates }` — if something couldn't be matched confidently
  - `{ type: "error", message }`

- `POST /api/confirm` — body: `{ "pendingAction": {...} }` (the object returned above)
  Executes the action and returns `{ type: "executed", task, message }`

- `GET /api/tasks` — list all tasks (for the UI's live task list)
- `GET /api/contractors` — list all contractors
- `GET /api/projects` — list all projects

## Example test (after adding your API key)

```bash
curl -X POST http://localhost:4000/api/voice-command \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Create a snag for the master bathroom ceiling and assign it to the false-ceiling contractor"}'
```

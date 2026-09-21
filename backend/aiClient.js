const Groq = require('groq-sdk');
const tools = require('./tools');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
async function translateText(text, from, to) {
  if (!text || !text.trim()) return text;
  const langNames = { en: 'English', hi: 'Hindi' };
  const targetName = langNames[to] || to;
  const completion = await groq.chat.completions.create({
    model: 'openai/gpt-oss-20b',
    messages: [
      {
        role: 'system',
        content: `Translate the user's message into ${targetName}. Reply with ONLY the translation - no notes, no quotes, no explanation. Keep numbers, names, and proper nouns as-is where translating them wouldn't make sense.`
      },
      { role: 'user', content: text }
    ],
    temperature: 0.2
  });
  return completion.choices[0].message.content.trim();
}
async function answerFromData(transcript, data) {
  const completion = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content: 'Answer the user\'s question using ONLY the JSON data given and never mention the id key and its value if asked for details mention other things properly but not the id of anything. If they asked about one specific detail (a deadline, budget, status, cost, etc.), answer with just that detail in one short sentence. If they asked for a general overview, give a brief summary of the key points.Always provide answers in english and reply for cost or any money related answer in india ruppees and for date answer in (date-(if its 1 then say first, if ts 2 then say second of and other also like that then the month),month-the word as january,february and other months,year- the number of year) format of indian standard. Never invent information not present in the data also never mention the image file name. Keep it under 40 words.'
      },
      { role: 'user', content: `Question: "${transcript}"\n\nData: ${JSON.stringify(data)}` }
    ],
    temperature: 0.2
  });
  return completion.choices[0].message.content.trim();
}

function buildSystemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the intent-understanding layer for a construction/interior-design
project management app. You receive a transcript of something a site manager or
architect SPOKE ALOUD. Your only job is to pick the single best matching tool
from the tools provided, and fill in its fields based on what was said.

Today's date is ${today}.

Rules:
- Always call exactly one tool. Never respond with plain text.
- Only fill a field if it was actually mentioned or clearly implied. Leave optional fields out if unsure.
- Do not invent contractor names, project names, or details that weren't said.
- Keep extracted text close to the user's actual words (don't paraphrase locations/descriptions heavily).
- Any field asking for a date (deadlines, assigned dates) must be converted to an ISO date
  (YYYY-MM-DD), using today's date above as the reference point for relative expressions
  like "next Friday", "in two weeks", "by the 20th", or "tomorrow". If no date was mentioned,
  leave that field null - never guess a date.`;
}

/**
 * Takes a raw transcript string, returns the chosen intent + extracted fields.
 * Returns: { intent: string, args: object } or { intent: null, args: null } if nothing matched.
 */
async function interpretCommand(transcript) {
  const completion = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b', // free tier, strong tool-calling support
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: transcript }
    ],
    tools,
    tool_choice: 'required',
    temperature: 0.1
  });

  const message = completion.choices[0].message;
  const toolCall = message.tool_calls && message.tool_calls[0];

  if (!toolCall) {
    return { intent: null, args: null };
  }

  let args = {};
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    args = {};
  }

  return { intent: toolCall.function.name, args };
}

/**
 * Generates a short, friendly natural-language response given what happened.
 * Kept simple/templated with an LLM polish pass - cheap and reliable.
 */
async function generateResponse(summary) {
  const completion = await groq.chat.completions.create({
    model: 'openai/gpt-oss-20b', // small/fast model is enough for this
    messages: [
      {
        role: 'system',
        content:
          'You write a single short, natural, friendly sentence confirming what just happened in a project management app. No emojis, no fluff, max 25 words.'
      },
      { role: 'user', content: JSON.stringify(summary) }
    ],
    temperature: 0.4
  });

  return completion.choices[0].message.content.trim();
}

module.exports = { interpretCommand, generateResponse,translateText,answerFromData };

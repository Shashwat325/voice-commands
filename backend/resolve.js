const Fuse = require('fuse.js');
const { data, taskWithJoins, getLastTaskId, getLastContractorId, getLastProjectId } = require('./db');
const PRONOUN_PATTERN = /^(its|that|this|that task|this task|the task)$/i;
const CONTRACTOR_PRONOUNS = /^(him|her|them|the contractor|that contractor|this contractor|their)$/i;
function resolveViaPronoun(hint) {
  if (!hint || !PRONOUN_PATTERN.test(hint.trim())) return null;
  const lastId = getLastTaskId();
  if (!lastId) return null;
  const last = data.tasks.find(t => t.id === lastId);
  return last ? taskWithJoins(last) : null;
}
function resolveContractorViaPronoun(hint) {
  if (!hint || !CONTRACTOR_PRONOUNS.test(hint.trim())) return null;
  const lastId = getLastContractorId();
  if (!lastId) return null;
  const last = data.contractors.find(c => c.id === lastId);
  return last ? last : null;
}

// Words that add no identifying signal ("false-ceiling CONTRACTOR", "the plumbing TEAM").
// Stripping these before matching massively improves match quality, since fuzzy
// libraries penalize length mismatches between a short field value and a longer phrase.
const FILLER_WORDS = /\b(the|a|an|contractor|team|person|guy|company|vendor|crew|people|folks|work|works)\b/gi;

function cleanHint(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(FILLER_WORDS, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Two-stage match against a list of items using given text fields:
// 1) Direct substring match on cleaned text (handles "false-ceiling contractor" -> "false-ceiling")
// 2) Fuzzy fallback for typos/partial phrasing Fuse can still catch
function twoStageMatch(hint, items, keys) {
  if (!hint) return { match: null, candidates: [] };

  const cleaned = cleanHint(hint);
  if (!cleaned) return { match: null, candidates: [] };

  const directMatches = items.filter(item =>
    keys.some(key => {
      const value = (item[key] || '').toLowerCase();
      if (!value) return false;
      return cleaned.includes(value) || value.includes(cleaned);
    })
  );

  if (directMatches.length === 1) {
    return { match: directMatches[0], candidates: directMatches };
  }
  if (directMatches.length > 1) {
    // multiple direct matches - ambiguous, let the user pick
    return { match: null, candidates: directMatches.slice(0, 3) };
  }

  // Fallback: fuzzy search on the cleaned hint
  const fuse = new Fuse(items, { keys, threshold: 0.4, includeScore: true, ignoreLocation: true });
  const results = fuse.search(cleaned);

  if (results.length === 0) return { match: null, candidates: [] };

  if (results.length === 1) {
    return { match: results[0].item, candidates: results.map(r => r.item) };
  }

  // If the runner-up is nearly as good a match, this is genuinely ambiguous -
  // don't silently guess, especially dangerous for delete/assign actions.
  const [best, secondBest] = results;
  const isClearWinner = best.score < 0.3 && secondBest.score - best.score > 0.15;

  if (isClearWinner) {
    return { match: best.item, candidates: results.map(r => r.item) };
  }

  return { match: null, candidates: results.slice(0, 3).map(r => r.item) };
}

function resolveContractor(hint) {
  const pronounMatch = resolveContractorViaPronoun(hint);
  if (pronounMatch) return { match: pronounMatch, candidates: [pronounMatch] };
  return twoStageMatch(hint, data.contractors, ['name', 'trade']);
}

const PROJECT_PRONOUN_PATTERN = /^(its|this|that|this project(s)|this project|that project|the project)$/i;

function resolveProject(hint) {
  const usingLast = () => {
    const lastId = getLastProjectId();
    const last = lastId ? data.projects.find(p => p.id === lastId) : null;
    return last || data.projects[0] || null;
  };

  if (!hint) return usingLast();
  if (PROJECT_PRONOUN_PATTERN.test(hint.trim())) return usingLast();

  const { match } = twoStageMatch(hint, data.projects, ['name']);
  return match || usingLast();
}

function resolveTask(hint) {
  const pronounMatch = resolveViaPronoun(hint);
  if (pronounMatch) return { match: pronounMatch, candidates: [pronounMatch] };

  const tasksJoined = data.tasks.map(taskWithJoins);
  return twoStageMatch(hint, tasksJoined, ['description', 'location']);
}

// Stricter variant for destructive/high-stakes actions (delete, assign).
// Only returns a match when it's a genuinely close, unambiguous match -
// refuses to guess when the reference is vague or matches loosely.
function resolveTaskStrict(hint) {
  const pronounMatch = resolveViaPronoun(hint);
  if (pronounMatch) return { match: pronounMatch, candidates: [pronounMatch] };

  if (!hint) return { match: null, candidates: [] };

  const cleaned = cleanHint(hint);
  if (!cleaned) return { match: null, candidates: [] };

  const tasksJoined = data.tasks.map(taskWithJoins);

  const directMatches = tasksJoined.filter(t => {
    const desc = (t.description || '').toLowerCase();
    const loc = (t.location || '').toLowerCase();
    return (
      (desc && (cleaned.includes(desc) || desc.includes(cleaned))) ||
      (loc && (cleaned.includes(loc) || loc.includes(cleaned)))
    );
  });

  if (directMatches.length === 1) {
    return { match: directMatches[0], candidates: directMatches };
  }

  // Zero or multiple matches - genuinely ambiguous, refuse to guess.
  return { match: null, candidates: directMatches.slice(0, 3) };
}

// Locations aren't a separate table - they're just the unique location
// strings already used on tasks. We fuzzy-match against whatever's actually
// in use, optionally scoped to one project.
function resolveLocation(hint, projectId) {
  if (!hint) return { match: null, candidates: [] };

  let scope = data.tasks;
  if (projectId) scope = scope.filter(t => t.project_id === projectId);
  const taskLocNames = scope.map(t => t.location).filter(Boolean);

  let directLocs = data.locations;
  if (projectId) directLocs = directLocs.filter(l => l.project_id === projectId);
  const directLocNames = directLocs.map(l => l.name);

  const uniqueLocations = [...new Set([...taskLocNames, ...directLocNames])];
  if (uniqueLocations.length === 0) return { match: null, candidates: [] };

  const cleaned = cleanHint(hint);

  const direct = uniqueLocations.filter(loc => {
    const l = loc.toLowerCase();
    return cleaned.includes(l) || l.includes(cleaned);
  });
  if (direct.length === 1) return { match: direct[0], candidates: direct };
  if (direct.length > 1) return { match: null, candidates: direct.slice(0, 3) };

  const fuse = new Fuse(
    uniqueLocations.map(l => ({ name: l })),
    { keys: ['name'], threshold: 0.4, includeScore: true, ignoreLocation: true }
  );
  const results = fuse.search(cleaned);
  if (results.length === 0) return { match: null, candidates: [] };
  if (results.length === 1) return { match: results[0].item.name, candidates: [results[0].item.name] };

  const [best, secondBest] = results;
  if (best.score < 0.3 && secondBest.score - best.score > 0.15) {
    return { match: best.item.name, candidates: results.map(r => r.item.name) };
  }
  return { match: null, candidates: results.slice(0, 3).map(r => r.item.name) };
}

module.exports = { resolveContractor, resolveProject, resolveTask, resolveTaskStrict, resolveLocation };

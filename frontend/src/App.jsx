import { useState, useEffect, useCallback, useRef } from 'react';
import MicButton from './components/MicButton';
import ConfirmationTicket from './components/ConfirmationTicket';
import ClarificationCard from './components/ClarificationCard';
import TaskList from './components/TaskList';
import ContractorList from './components/ContractorList';
import ProjectList from './components/ProjectList';
import DetailsCard from './components/DetailsCard';
import SummaryListCard from './components/SummaryListCard';
import { sendVoiceCommand, confirmAction, fetchTasks, fetchContractors, fetchProjects, uploadImageToCloudinary, saveImage, translateText } from './api';
import { useSpeechRecognition, speak } from './useSpeechRecognition';

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function twoDigitsToWords(n) {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return TENS[tens] + (ones ? ' ' + ONES[ones] : '');
}

function threeDigitsToWords(n) {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  let str = '';
  if (hundred) str += ONES[hundred] + ' hundred';
  if (rest) str += (str ? ' ' : '') + twoDigitsToWords(rest);
  return str;
}

// Indian numbering: crore (1,00,00,000) / lakh (1,00,000) / thousand, not
// the Western million/billion grouping - matches how amounts are spoken here.
function numberToIndianWords(num) {
  num = Math.round(num);
  if (num === 0) return 'zero';
  const negative = num < 0;
  num = Math.abs(num);

  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const rest = num;

  const parts = [];
  if (crore) parts.push(threeDigitsToWords(crore) + ' crore');
  if (lakh) parts.push(threeDigitsToWords(lakh) + ' lakh');
  if (thousand) parts.push(threeDigitsToWords(thousand) + ' thousand');
  if (rest) parts.push(threeDigitsToWords(rest));

  return (negative ? 'minus ' : '') + parts.join(' ');
}

// Finds every number in a spoken line and swaps it for words, so the speech
// engine says "three lakh twenty thousand" instead of reading digit-by-digit.
function numbersToSpeech(text) {
  // Strip thousands-separator commas between digits first - handles both
  // Western (3,100,000) and Indian (3,10,000) grouping the same way, since
  // we just discard the commas rather than trying to parse the grouping.
  const noCommas = text.replace(/(\d),(?=\d)/g, '$1');
  return noCommas.replace(/-?\d+(?:\.\d+)?/g, match => {
    const num = parseFloat(match);
    if (isNaN(num)) return match;
    if (Number.isInteger(num)) return numberToIndianWords(num);
    const [intPart, decPart] = match.split('.');
    return `${numberToIndianWords(parseInt(intPart, 10))} point ${decPart.split('').map(d => ONES[+d] || 'zero').join(' ')}`;
  });
}
const CONFIRM_WORDS = /\b(confirm|yes|yeah|yep|sure|go ahead|do it|correct|affirmative)\b/i;
const CANCEL_WORDS = /\b(cancel|no|nope|stop|negative)\b/i;

async function uploadAndSaveImage(file, ownerType, ownerId, label, refreshCallback) {
  const url = await uploadImageToCloudinary(file);
  await saveImage(ownerType, ownerId, url, label);
  if (refreshCallback) refreshCallback();
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function money(n) {
  return `₹${(n ?? 0).toLocaleString()}`;
}

function shortDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

// Mirrors the backend's executor.js logic so cards that don't get a
// precomputed flag (e.g. location_details) can still show it.
function isOverBudget(estimated, spent) {
  return (estimated || 0) > 0 && (spent || 0) > estimated;
}
function isPastDeadline(deadline, status) {
  if (!deadline || status === 'done') return false;
  return new Date(deadline).getTime() < Date.now();
}

const MODE_HINTS = {
  off: 'Tap to enable always-listening mode',
  passive: 'Listening for “Hey BuildMate” …',
  awaiting_command: 'Go ahead, I\u2019m listening — no need to repeat the wake word',
  processing: 'Thinking…',
  confirming: 'Say “confirm” or “cancel”'
};

export default function App() {
  const [mode, setModeState] = useState('off');
  const [lastTranscript, setLastTranscript] = useState('');
  const [response, setResponse] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [language, setLanguage] = useState('en-IN');
  const [tasks, setTasks] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activeTab, setActiveTab] = useState('tasks');
  const [highlightId, setHighlightId] = useState(null);
  const PROJECT_LEVEL_ACTIONS = ['create_project', 'set_project_budget', 'set_project_description', 'set_project_deadline'];

  const modeRef = useRef('off');
  const setMode = m => {
    modeRef.current = m;
    setModeState(m);
  };

  const responseRef = useRef(null);
  useEffect(() => {
    responseRef.current = response;
  }, [response]);

  const loadTasks = useCallback(async () => {
    const data = await fetchTasks();
    setTasks(data);
  }, []);

  useEffect(() => {
    loadTasks();
    fetchContractors().then(setContractors);
    fetchProjects().then(setProjects);
  }, [loadTasks]);

  const { isListening, interimText, error, supported, start, stop, pauseForSpeech, resumeAfterSpeech } =
    useSpeechRecognition({ onFinalTranscript: text => handleFinalTranscriptRef.current(text) });

  // Pauses the mic, speaks a line, then resumes listening in the given mode.
  const speakThen = useCallback(
    async (text, nextMode) => {
      pauseForSpeech();
      let spokenText = text;
      let voiceLang = 'en-IN';
      if (language === 'hi-IN') {
        spokenText = await translateText(text, 'en', 'hi');
        voiceLang = 'hi-IN';
      } else {
        spokenText = numbersToSpeech(text);
      }
      await speak(spokenText, voiceLang);
      if (nextMode) setMode(nextMode);
      resumeAfterSpeech();
    },
    [pauseForSpeech, resumeAfterSpeech, language]
  );

  const handleConfirm = useCallback(
    async pendingActionOverride => {
      const action = pendingActionOverride || responseRef.current?.pendingAction;
      if (!action) return;
      setConfirmLoading(true);
      try {
        const result = await confirmAction(action);
        setResponse(result);
        if (result.task) {
          if (PROJECT_LEVEL_ACTIONS.includes(action.type)) {
            fetchProjects().then(setProjects);
          } else {
            setHighlightId(result.task.id);
            await loadTasks();
            setTimeout(() => setHighlightId(null), 3000);
          }
        }
        await speakThen(result.message || 'Done.', 'passive');
      } catch (e) {
        setResponse({ type: 'error', message: 'Could not complete that action.' });
        await speakThen('Sorry, something went wrong completing that.', 'passive');
      } finally {
        setConfirmLoading(false);
      }
    },
    [loadTasks, speakThen]
  );

  const handleCancel = useCallback(async () => {
    setResponse(null);
    setLastTranscript('');
    await speakThen('Cancelled.', 'passive');
  }, [speakThen]);

  const runCommand = useCallback(
    async text => {
      setLastTranscript(text); // show what they actually said, untranslated
      setResponse(null);
      setMode('processing');
      try {
        const commandText = language === 'hi-IN' ? await translateText(text, 'hi', 'en') : text;
        const result = await sendVoiceCommand(commandText); // backend always gets English

        setResponse(result); // displayed text stays English, exactly as backend sent it

        if (result.type === 'confirmation_needed') {
          await speakThen(`${result.summary} Say confirm, or cancel.`, 'confirming');
        } else if (result.type === 'error' || result.type === 'clarification_needed') {
          await speakThen(result.message, 'passive');
        } else if (result.message) {
          await speakThen(result.message, 'passive');
        } else {
          setMode('passive');
        }
      } catch (e) {
        setResponse({ type: 'error', message: 'Could not reach the server. Is the backend running?' });
        await speakThen('I could not reach the server.', 'passive');
      }
    },
    [speakThen, language]
  );

  const handleFinalTranscript = useCallback(
    text => {
      const currentMode = modeRef.current;

      if (currentMode === 'confirming') {
        const t = text.toLowerCase();
        if (CONFIRM_WORDS.test(t)) {
          handleConfirm();
        } else if (CANCEL_WORDS.test(t)) {
          handleCancel();
        } else {
          speakThen("Sorry, I didn't catch that. Say confirm, or cancel.", 'confirming');
        }
        return;
      }

      if (currentMode === 'processing') return; // already mid-request, ignore

      if (currentMode === 'awaiting_command') {
        runCommand(text);
        return;
      }

      // Default 'passive' - only react if the wake word is present.


      runCommand(text);

    },
    [handleConfirm, handleCancel, runCommand, speakThen]
  );

  // Ref indirection so useSpeechRecognition's onFinalTranscript always calls
  // the latest version without needing to reconstruct the recognition engine.
  const handleFinalTranscriptRef = useRef(handleFinalTranscript);
  handleFinalTranscriptRef.current = handleFinalTranscript;

  const toggleVoiceMode = () => {
    if (mode === 'off') {
      setMode('passive');
      start();
    } else {
      setMode('off');
      stop();
    }
  };

  const runExample = text => {
    const { remainder } = parseWakeWord(text);
    runCommand(remainder || text);
  };

  // ---------- Build props for whichever result card should render ----------
  const renderResultCard = () => {
    if (!response) return null;

    switch (response.type) {
      case 'image_upload_prompt':
        return (
          <div className="details-card">
            <p className="details-card__title">{response.ownerName}</p>
            <p className="details-card__subtitle">Choose a picture to upload</p>
            <input
              type="file"
              accept="image/*"
              onChange={async e => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                  await uploadAndSaveImage(file, 'project', project.id, null, () => runCommand(`open project ${project.name}`));
                } catch (err) {
                  alert(`Upload failed: ${err.message}`);
                }
              }}
            />
          </div>
        );
      case 'confirmation_needed':
        return (
          <ConfirmationTicket
            summary={response.summary}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            pending={confirmLoading}
          />
        );

      case 'clarification_needed':
        return <ClarificationCard message={response.message} candidates={response.candidates} />;
      case 'project_details': {
        const { project, summary, locations, deadlinePassed, images } = response.details;
        return (
          <>
            <div style={{ marginTop: 12 }}>
              <input
                type="file"
                accept="image/*"
                onChange={async e => {
                  const file = e.target.files[0];
                  if (!file) return;
                  await uploadAndSaveImage(file, 'project', project.id, null, () => runCommand(`open project ${project.name}`));
                }}
              />
            </div>
            <DetailsCard
              title={project.name}
              images={images}
              subtitle={project.description || 'No description yet'}
              stats={[{ label: 'Total tasks', value: summary.total },
              { label: 'Open', value: summary.counts.open },
              { label: 'In progress', value: summary.counts.in_progress },
              { label: 'Done', value: summary.counts.done },
              { label: '% Complete', value: `${summary.percentComplete}%` },
              { label: 'Budget', value: money(project.estimated_cost) },
              { label: 'Spent', value: money(summary.spentTotal) },
              { label: 'Task spend', value: money(summary.spentTotal) },
              { label: 'Other spend', value: money(response.details.overheadSpend) },
              { label: 'Total spent', value: money(response.details.totalSpent) },
              ...(project.completion_deadline
                ? [{ label: 'Deadline', value: shortDate(project.completion_deadline) }]
                : [])
              ]}
              note={
                [
                  summary.overBudget ? '⚠️ Over budget — running at a loss.' : null,
                  deadlinePassed ? '⚠️ Deadline has passed and the project isn\u2019t finished.' : null,
                  summary.overdueTasks?.length
                    ? `${summary.overdueTasks.length} task${summary.overdueTasks.length > 1 ? 's are' : ' is'} overdue.`
                    : null
                ]
                  .filter(Boolean)
                  .join(' · ') || null
              }
            />
            {locations.length > 0 && (
              <SummaryListCard
                title="Locations in this project"
                items={locations.map(l => ({
                  title: l.location,
                  subtitle: `${l.percentComplete}%`,
                  meta: `${l.open} open · ${l.inProgress} in progress · ${l.done} done · est ${money(l.estimatedCost)} · spent ${money(l.spentCost)}${l.overBudget ? ' · ⚠️ over budget' : ''}${l.overdueTasks ? ` · ${l.overdueTasks} overdue` : ''}`
                }))}
              />
            )}
          </>
        );
      }
      case 'executed':
        return <div className="result-line result-line--success">{response.message}</div>;

      case 'error':
        return <div className="result-line result-line--error">{response.message}</div>;

      case 'search_results':
        return (
          <div className="search-results">
            <p className="result-line">{response.message}</p>
            <TaskList tasks={response.results} />
          </div>
        );

      case 'progress_report': {
        const t = response.task;
        const overBudget = isOverBudget(t.estimated_cost, t.spent_cost);
        const overdue = isPastDeadline(t.completion_deadline, t.status);
        return (
          <DetailsCard
            title={t.description}
            subtitle={[t.project_name, t.location].filter(Boolean).join(' · ')}
            stats={[
              { label: 'Status', value: t.status.replace('_', ' ') },
              { label: 'Assigned to', value: t.assignee_name || 'Unassigned' },
              { label: 'Estimated', value: money(t.estimated_cost) },
              { label: 'Spent', value: money(t.spent_cost) },
              ...(t.assigned_date ? [{ label: 'Assigned date', value: shortDate(t.assigned_date) }] : []),
              ...(t.completion_deadline ? [{ label: 'Deadline', value: shortDate(t.completion_deadline) }] : []),
              { label: 'Created', value: formatDate(t.created_at) },
              { label: 'Last updated', value: formatDate(t.updated_at) },
              ...(t.completed_at ? [{ label: 'Completed', value: formatDate(t.completed_at) }] : []),
              ...(t.notes ? [{ label: 'Notes', value: t.notes }] : []),
            ]}
            note={
              [
                overBudget ? '⚠️ Over budget — running at a loss.' : null,
                overdue ? '⚠️ Deadline has passed and this task isn\u2019t done.' : null
              ]
                .filter(Boolean)
                .join(' · ') || null
            }
          />
        );
      }

      case 'progress_summary': {
        const s = response.summary;
        return (
          <DetailsCard
            title={response.projectName || 'All Projects'}
            stats={[
              { label: 'Total tasks', value: s.total },
              { label: 'Open', value: s.counts.open },
              { label: 'In progress', value: s.counts.in_progress },
              { label: 'Done', value: s.counts.done },
              { label: '% Complete', value: `${s.percentComplete}%` },
              { label: 'Estimated', value: money(s.estimatedTotal) },
              { label: 'Spent', value: money(s.spentTotal) }
            ]}
            note={
              [
                s.openLocations.length ? `Still open: ${s.openLocations.join(', ')}` : null,
                s.completedLocations.length ? `Completed: ${s.completedLocations.join(', ')}` : null,
                s.overBudget ? '⚠️ Over budget overall.' : null,
                s.overdueTasks?.length
                  ? `${s.overdueTasks.length} task${s.overdueTasks.length > 1 ? 's are' : ' is'} overdue.`
                  : null
              ]
                .filter(Boolean)
                .join(' · ') || 'No locations logged yet.'
            }
          />
        );
      }

      case 'contractor_details': {
        const d = response.details;
        return (
          <DetailsCard
            title={d.contractor.name}
            subtitle={d.contractor.trade}
            stats={[
              { label: 'Total tasks', value: d.totalTasks },
              { label: 'Open', value: d.open },
              { label: 'In progress', value: d.inProgress },
              { label: 'Done', value: d.done },
              { label: 'Contract amount', value: d.contractAmount != null ? money(d.contractAmount) : '—' },
              { label: 'Contract period', value: d.contractPeriod || '—' },
              { label: 'Assigned task value', value: money(d.taskCostTotal) },
              { label: 'Spent on tasks', value: money(d.taskSpentTotal) }
            ]}
          />
        );
      }

      case 'project_list':
        return (
          <SummaryListCard
            title="All projects"
            items={response.summary.map(p => ({
              title: p.name,
              subtitle: `${p.percentComplete}%`,
              meta: `${p.totalTasks} tasks · budget ${money(p.estimatedCost)} · spent ${money(p.spentCost)}${p.overBudget ? ' · ⚠️ over budget' : ''}${p.deadlinePassed ? ' · ⚠️ deadline passed' : ''}`
            }))}
          />
        );
      case 'location_list':
        return (
          <SummaryListCard
            title={`Locations in ${response.projectName}`}
            items={response.locations.map(l => ({
              title: l.location,
              subtitle: `${l.percentComplete}%`,
              meta: `${l.total} issues · ${l.open} open · ${l.inProgress} in progress · ${l.done} done · est ${money(l.estimatedCost)} · spent ${money(l.spentCost)}${l.overBudget ? ' · ⚠️ over budget' : ''}${l.overdueTasks ? ` · ${l.overdueTasks} overdue` : ''}`
            }))}
          />
        );
      case 'contractor_list':
        return (
          <SummaryListCard
            title="All contractors"
            items={response.summary.map(c => ({
              title: c.name,
              subtitle: c.trade,
              meta: `${c.open} open · ${c.inProgress} in progress · ${c.done} done`
            }))}
          />
        );

      case 'location_details': {
        const d = response.details;
        const overBudget = isOverBudget(d.estimatedTotal, d.spentTotal);
        const overdueCount = (d.tasks || []).filter(t => isPastDeadline(t.completion_deadline, t.status)).length;
        return (
          <>
            {d.locationId && (
              <div style={{ marginTop: 12 }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    await uploadAndSaveImage(file, 'location', d.locationId, null, () => runCommand(`give me details on ${d.location}`));
                  }}
                />
              </div>
            )}
            <DetailsCard
              title={d.location}
              images={d.images}
              stats={[
                { label: 'Total issues', value: d.totalIssues },
                { label: 'Open', value: d.open },
                { label: 'In progress', value: d.inProgress },
                { label: 'Done', value: d.done },
                { label: 'Estimated', value: money(d.estimatedTotal) },
                { label: 'Spent', value: money(d.spentTotal) }
              ]}
              note={
                [
                  overBudget ? '⚠️ Over budget — running at a loss.' : null,
                  overdueCount ? `${overdueCount} task${overdueCount > 1 ? 's' : ''} overdue.` : null
                ]
                  .filter(Boolean)
                  .join(' · ') || null
              }
              tasks={d.tasks}
            />
          </>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <p className="app__eyebrow">Voice-to-Command · Project Assistant</p>
        <h1 className="app__title">Talk to your project.</h1>
      </header>

      <section className="voice-panel">
        <MicButton mode={mode} disabled={!supported} onClick={toggleVoiceMode} />
        <p className="voice-panel__hint">
          {!supported ? 'Voice input needs Chrome or Edge.' : error ? `Mic error: ${error}` : MODE_HINTS[mode]}
        </p>

        {mode !== 'off' && <p className="wake-word-reminder">Wake word: “Hey BuildMate”</p>}

        {(interimText || lastTranscript) && <p className="transcript">“{interimText || lastTranscript}”</p>}

        {mode === 'processing' && <p className="status-line">Thinking…</p>}

        {renderResultCard()}
      </section>

      <section className="log-panel">
        <div className="tab-bar">
          <button
            className={`tab-btn ${activeTab === 'tasks' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('tasks')}
          >
            Site log
          </button>
          <button
            className={`tab-btn ${activeTab === 'contractors' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('contractors')}
          >
            Contractors
          </button>
          <button
            className={`tab-btn ${activeTab === 'projects' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('projects')}
          >
            Projects
          </button>
        </div>

        {activeTab === 'tasks' && <TaskList tasks={tasks} highlightId={highlightId} />}
        {activeTab === 'contractors' && <ContractorList contractors={contractors} tasks={tasks} />}
        {activeTab === 'projects' && <ProjectList projects={projects} tasks={tasks} />}
      </section>
    </div>
  );
}
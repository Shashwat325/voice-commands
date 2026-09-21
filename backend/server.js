require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { interpretCommand, generateResponse, translateText, answerFromData } = require('./aiClient');
const {
  resolveContractor,
  resolveProject,
  resolveTask,
  resolveTaskStrict,
  resolveLocation
} = require('./resolve');
const executor = require('./executor');

const { isPastDeadline, isOverBudget } = executor;

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const app = express();
app.use(cors());
app.use(express.json());

const VALID_STATUSES = ['open', 'in_progress', 'done'];

function normalizeStatus(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes('progress')) return 'in_progress';
  if (t.includes('done') || t.includes('complete') || t.includes('finish')) return 'done';
  if (t.includes('open') || t.includes('reopen')) return 'open';
  return VALID_STATUSES.includes(t) ? t : null;
}
function buildContractorSummaryMessage(details) {
  const c = details.contractor;
  const contractLine = details.contractAmount != null
    ? `Their contract is for ${details.contractAmount}ruppees, ${details.contractPeriod ? `, over ${details.contractPeriod}` : ''}. `
    : '';
  return `${c.name} (${c.trade}) has ${details.totalTasks} tasks — ${details.open} open, ${details.inProgress} in progress, ${details.done} done. ${contractLine}Total value of assigned tasks: ${details.taskCostTotal}, with ${details.taskSpentTotal} spent so far.`;
}
function buildProjectSummaryMessage(details) {
  const { project, description, summary, deadlinePassed, totalSpent, overBudget } = details;
  const budget = project.estimated_cost || 0;
  let line = `${project.name} is ${description} , its  ${summary.percentComplete} percent complete, with ${summary.total} tasks total — ${summary.counts.open} open, ${summary.counts.in_progress} in progress, and ${summary.counts.done} done. Budget is ${budget} ruppees, and ${totalSpent}ruppees has been spent so far.`;
  if (budget > 0) {
    const diff = Math.abs(budget - totalSpent);
    line += totalSpent > budget
      ? ` That's a loss of ${diff} ruppees against the budget.`
      : ` That's ${diff} ruppees under budget, effectively a surplus.`;
  }
  // ...keep the deadline/overdue lines unchanged below
  if (project.completion_deadline) {
    if (deadlinePassed) {
      const diffDays = Math.floor((Date.now() - new Date(project.completion_deadline).getTime()) / (1000 * 60 * 60 * 24));
      let lateness;
      if (diffDays < 30) {
        lateness = `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
      } else if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        const remDays = diffDays % 30;
        lateness = `${months} month${months !== 1 ? 's' : ''} and ${remDays} day${remDays !== 1 ? 's' : ''}`;
      } else {
        const years = Math.floor(diffDays / 365);
        const remMonths = Math.floor((diffDays % 365) / 30);
        lateness = `${years} year${years !== 1 ? 's' : ''} and ${remMonths} month${remMonths !== 1 ? 's' : ''}`;
      }
      line += ` Its completion deadline of ${formatDate(project.completion_deadline)} has passed — it's running ${lateness} late.`;
    } else {
      line += ` Completion deadline: ${formatDate(project.completion_deadline)}.`;
    }
  }
  if (summary.overdueTasks && summary.overdueTasks.length) {
    line += ` ${summary.overdueTasks.length} task${summary.overdueTasks.length > 1 ? 's are' : ' is'} past its deadline and still not done.`;
  }
  return line;
}
function buildTaskSummaryMessage(task) {
  const status = task.status.replace('_', ' ');
  const estimatedCost = task.estimated_cost ?? 0;
  const spentCost = task.spent_cost ?? 0;
  const createdAt = task.created_at ? formatDate(task.created_at) : 'unknown';
  let line = `Task "${task.description}"${task.location ? ` at ${task.location}` : ''} is currently ${status}. Estimated cost: ${estimatedCost}. Spent so far: ${spentCost}.`;
  if (isOverBudget(estimatedCost, spentCost)) {
    line += ` That's over the estimate, so this task is running at a loss.`;
  }
  if (task.created_at) {
    line += ` Created on ${formatDate(task.created_at)}.`;
  }
  if (task.completion_deadline) {
    line += isPastDeadline(task.completion_deadline, task.status)
      ? ` Its deadline of ${formatDate(task.completion_deadline)} has passed and it still isn't done.`
      : ` Deadline: ${formatDate(task.completion_deadline)}.`;
  }
  if (task.assigned_date) {
    line += ` Assigned on ${formatDate(task.assigned_date)}.`;
  }
  if (task.notes) {
    line += ` Note: ${task.notes}.`;
  }
  return line;
}
app.post('/api/translate', async (req, res) => {
  const { text, from, to } = req.body;
  if (!text || !to) return res.status(400).json({ error: 'text and to are required' });
  try {
    const translated = await translateText(text, from, to);
    res.json({ translated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Translation failed' });
  }
});
app.post('/api/images', async (req, res) => {
  const { owner_type, owner_id, url, label } = req.body;
  if (!owner_type || !owner_id || !url) {
    return res.status(400).json({ error: 'owner_type, owner_id, and url are required' });
  }
  if (!['project', 'location'].includes(owner_type)) {
    return res.status(400).json({ error: 'owner_type must be "project" or "location"' });
  }
  try {
    const image = db.addImage(owner_type, owner_id, url, label || null);
    await db.save();
    res.json(image);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save image' });
  }
});
// ---------- MAIN VOICE COMMAND ENDPOINT ----------
app.post('/api/voice-command', async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  try {
    const { intent, args } = await interpretCommand(transcript);
    console.log(intent, args);
    if (!intent) {
      return res.json({
        type: 'error',
        message: "I couldn't understand that as a command. Try rephrasing."
      });
    }
    if (intent === 'set_task_location') {
      const taskResult = resolveTaskStrict(args.task_reference);

      if (!taskResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: `I couldn't find a task matching "${args.task_reference}".`,
          candidates: taskResult.candidates
        });
      }

      const pendingAction = {
        type: 'set_task_location',
        task: taskResult.match,
        location: args.location
      };

      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Set the location of "${taskResult.match.description}" to "${args.location}".`
      });
    }

    if (intent === 'upload_image') {
      const project = resolveProject(args.project_name);
      db.setLastProjectId(project.id);

      if (args.location_reference) {
        const locationResult = resolveLocation(args.location_reference, project.id);
        const locationName = locationResult.match || args.location_reference.trim();
        const location = db.findOrCreateLocation(project.id, locationName);
        await db.save(); // persist the location now, since the image will reference its id
        return res.json({
          type: 'image_upload_prompt',
          ownerType: 'location',
          ownerId: location.id,
          ownerName: `${locationName} (${project.name})`,
          label: args.label || null,
          message: `Go ahead and choose a picture for ${locationName}.`
        });
      }

      return res.json({
        type: 'image_upload_prompt',
        ownerType: 'project',
        ownerId: project.id,
        ownerName: project.name,
        label: args.label || null,
        message: `Go ahead and choose a picture for ${project.name}.`
      });
    }
    // ---------- CREATE TASK ----------
    if (intent === 'create_task') {
      const project = resolveProject(args.project_name);
      //const projrct=resolveProject(args.project_name);
      if (args.project_name) db.setLastProjectId(project.id);
      const contractorResult = resolveContractor(args.assignee_hint);

      if (args.assignee_hint && !contractorResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: contractorResult.candidates.length
            ? `I found a few possible matches for "${args.assignee_hint}". Which did you mean?`
            : `I couldn't find a contractor matching "${args.assignee_hint}".`,
          candidates: contractorResult.candidates
        });
      }

      const estimatedCost = typeof args.estimated_cost === 'number' ? args.estimated_cost : null;

      const pendingAction = {
        type: 'create_task',
        description: args.description,
        location: args.location || null,
        project,
        notes: args.notes || null,
        contractor: contractorResult.match || null,
        estimated_cost: estimatedCost,
        assigned_date: args.assigned_date || null,
        completion_deadline: args.completion_deadline || null
      };

      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Create a task "${args.description}"${args.location ? ` at ${args.location}` : ''
          } in ${project.name}${contractorResult.match ? `, assigned to ${contractorResult.match.name}` : ''
          }${estimatedCost !== null ? `, estimated cost ${estimatedCost}` : ''}${args.completion_deadline ? `, due ${formatDate(args.completion_deadline)}` : ''}.`
      });
    }
    if (intent === 'rename_project') {
      const project = resolveProject(args.project_name);
      const pendingAction = { type: 'rename_project', project, new_name: args.new_name };
      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Rename "${project.name}" to "${args.new_name}".`
      });
    }
    if (intent === 'set_task_notes') {
      const taskResult = resolveTaskStrict(args.task_reference);
      if (!taskResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: `I couldn't find a task matching "${args.task_reference}".`,
          candidates: taskResult.candidates
        });
      }
      const pendingAction = { type: 'set_task_notes', task: taskResult.match, notes: args.notes };
      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Add note to "${taskResult.match.description}": "${args.notes}".`
      });
    }
    if (intent === 'add_location') {
      const project = resolveProject(args.project_name);
      const existing = resolveLocation(args.location_name, project.id);
      if (existing.match) {
        return res.json({ type: 'error', message: `"${existing.match}" already exists as a location in ${project.name}.` });
      }
      const pendingAction = {
        type: 'add_location',
        project,
        location_name: args.location_name.trim(),
        estimated_cost: typeof args.estimated_cost === 'number' ? args.estimated_cost : null
      };
      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Add "${args.location_name}" as a location in ${project.name}${typeof args.estimated_cost === 'number' ? ` with a budget of ${args.estimated_cost}` : ''}.`
      });
    }
    if (intent === 'create_project') {
      const estimatedCost = typeof args.estimated_cost === 'number' ? args.estimated_cost : null;
      const pendingAction = {
        type: 'create_project',
        name: args.project_name,
        estimated_cost: estimatedCost,
        description: args.description || null,
        completion_deadline: args.completion_deadline || null
      };
      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Create a new project named "${args.project_name}"${estimatedCost !== null ? ` with a budget of ${estimatedCost}` : ''}${args.completion_deadline ? `, due ${formatDate(args.completion_deadline)}` : ''}.`
      });
    }
    // ---------- ASSIGN TASK ----------
    if (intent === 'assign_task') {
      const taskResult = resolveTaskStrict(args.task_reference);
      const contractorResult = resolveContractor(args.assignee_hint);

      if (!taskResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: taskResult.candidates.length
            ? `Which task did you mean by "${args.task_reference}"?`
            : `I couldn't find a task matching "${args.task_reference}".`,
          candidates: taskResult.candidates
        });
      }
      if (!contractorResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: `I couldn't confidently match a contractor for "${args.assignee_hint}".`,
          candidates: contractorResult.candidates
        });
      }

      const pendingAction = {
        type: 'assign_task',
        task: taskResult.match,
        contractor: contractorResult.match,
        assigned_date: args.assigned_date || null
      };

      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Assign "${taskResult.match.description}" to ${contractorResult.match.name}${args.assigned_date ? `, starting ${formatDate(args.assigned_date)}` : ''}.`
      });
    }

    // ---------- DELETE TASK ----------
    if (intent === 'delete_task') {
      const taskResult = resolveTaskStrict(args.task_reference);

      if (!taskResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: taskResult.candidates.length
            ? `A few tasks could match "${args.task_reference}" - which one did you mean?`
            : `I couldn't find a task matching "${args.task_reference}".`,
          candidates: taskResult.candidates
        });
      }

      const pendingAction = { type: 'delete_task', task: taskResult.match };

      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Delete the task "${taskResult.match.description}"${taskResult.match.assignee_name ? ` (assigned to ${taskResult.match.assignee_name})` : ''
          }. This can't be undone.`
      });
    }

    // ---------- UPDATE STATUS ----------
    if (intent === 'update_status') {
      const taskResult = resolveTaskStrict(args.task_reference);
      const newStatus = normalizeStatus(args.new_status);

      if (!taskResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: `I couldn't find a task matching "${args.task_reference}".`,
          candidates: taskResult.candidates
        });
      }
      if (!newStatus) {
        return res.json({
          type: 'error',
          message: `I didn't catch what status to set it to.`
        });
      }

      const pendingAction = {
        type: 'update_status',
        task: taskResult.match,
        new_status: newStatus
      };

      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Mark "${taskResult.match.description}" as ${newStatus.replace('_', ' ')}.`
      });
    }

    // ---------- PROGRESS REPORT (read-only, execute immediately) ----------
    if (intent === 'get_progress_report') {
      if (args.task_reference) {
        const taskResult = resolveTask(args.task_reference);
        if (!taskResult.match) {
          return res.json({
            type: 'clarification_needed',
            message: `I couldn't find a task matching "${args.task_reference}".`,
            candidates: taskResult.candidates
          });
        }
        db.setLastTaskId(taskResult.match.id);
        const message = await answerFromData(transcript, taskResult.match);
        return res.json({ type: 'progress_report', task: taskResult.match, message });
      }

      // A specific project was named - give the SAME rich view as open_project,
      // regardless of which tool the AI happened to pick for this phrasing.
      if (args.project_name || db.getLastProjectId()) {
        const project = resolveProject(args.project_name);
        db.setLastProjectId(project.id);
        const details = executor.getProjectFullDetails(project.id);
        const message = await answerFromData(transcript, details);
        return res.json({ type: 'project_details', details, message });
      }

      // No project named at all - a genuine "everything" summary.
      const summary = executor.getProgressSummary({});
      const message = await generateResponse({ action: 'progress_summary', summary, projectName: 'all projects' });
      return res.json({ type: 'progress_summary', summary, projectName: null, message });
    }
    if (intent === 'log_project_expense') {
      const project = resolveProject(args.project_name);
      const pendingAction = { type: 'log_project_expense', project, amount: args.amount };
      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Log ${args.amount} spent on project "${project.name}".`
      });
    }
    if (intent === 'get_undecided_items') {
      if (args.task_reference) {
        const taskResult = resolveTaskStrict(args.task_reference);
        if (!taskResult.match) {
          return res.json({
            type: 'clarification_needed',
            message: `I couldn't find a task matching "${args.task_reference}".`,
            candidates: taskResult.candidates
          });
        }
        db.setLastTaskId(taskResult.match.id);
        const items = executor.getTaskUndecidedItems(taskResult.match);
        const message = items.length
          ? `For "${taskResult.match.description}": ${items.join(', ')}.`
          : `Everything's decided for "${taskResult.match.description}" - location, contractor, cost, and deadline are all set.`;
        return res.json({ type: 'undecided_items', scope: 'task', task: taskResult.match, items, message });
      }

      const project = resolveProject(args.project_name);
      db.setLastProjectId(project.id);
      const items = executor.getProjectUndecidedItems(project);
      const message = items.length
        ? `For "${project.name}": ${items.join('; ')}.`
        : `Everything's decided for "${project.name}" - budget, deadline, and all task assignments are set.`;
      return res.json({ type: 'undecided_items', scope: 'project', project, items, message });
    }

    // ---------- LIST PROJECTS (read-only, execute immediately) ----------
    if (intent === 'list_projects') {
      const summary = executor.listProjectsSummary();
      const message = await generateResponse({ action: 'project_list', summary });
      return res.json({ type: 'project_list', summary, message });
    }

    // ---------- CONTRACTOR DETAILS (read-only, execute immediately) ----------
    if (intent === 'get_contractor_details') {
      if (args.contractor_reference) {
        const contractorResult = resolveContractor(args.contractor_reference);
        if (!contractorResult.match) {
          return res.json({
            type: 'clarification_needed',
            message: `I couldn't find a contractor matching "${args.contractor_reference}".`,
            candidates: contractorResult.candidates
          });
        }
        const details = executor.getContractorDetails(contractorResult.match.id);
        db.setLastContractorId(contractorResult.match.id);  // add this line/
        const message = await answerFromData(transcript, details);
        return res.json({ type: 'contractor_details', details, message });
      }

      const summary = executor.listContractorsSummary();
      const message = await generateResponse({ action: 'contractor_list', summary });
      return res.json({ type: 'contractor_list', summary, message });
    }
    if (intent === 'list_locations') {
      const project = resolveProject(args.project_name);
      db.setLastProjectId(project.id);
      const locations = executor.getProjectLocationsBreakdown(project.id);
      if (locations.length === 1) {
        db.setLastLocationId(locations[0].location);
      }
      const message = locations.length
        ? `${project.name} has ${locations.length} location${locations.length > 1 ? 's' : ''}: ${locations.map(l => l.location).join(', ')}.`
        : `${project.name} doesn't have any locations yet.`;
      return res.json({ type: 'location_list', projectName: project.name, locations, message });
    }
    // ---------- LOCATION DETAILS (read-only, execute immediately) ----------
    if (intent === 'get_location_details') {
      let locationName = args.location_reference;
      let projectScope = args.project_name ? resolveProject(args.project_name) : null;

      // If a task reference is given at all, prefer deriving the location from
      // the task - even if location_reference also got filled in (the AI
      // sometimes duplicates a pronoun into both fields).
      if (args.task_reference) {
        const taskResult = resolveTask(args.task_reference);
        if (!taskResult.match) {
          return res.json({
            type: 'clarification_needed',
            message: `I couldn't find a task matching "${args.task_reference}".`,
            candidates: taskResult.candidates
          });
        }
        if (!taskResult.match.location) {
          return res.json({
            type: 'error',
            message: `"${taskResult.match.description}" doesn't have a location set yet.`
          });
        }
        locationName = taskResult.match.location;
        projectScope = { id: taskResult.match.project_id, name: taskResult.match.project_name };
        db.setLastTaskId(taskResult.match.id);
      }
      if (!locationName && !args.task_reference) {
        locationName = db.getLastLocationId();
      }

      if (projectScope) db.setLastProjectId(projectScope.id);
      const locationResult = resolveLocation(locationName, projectScope ? projectScope.id : null);

      if (!locationResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: locationResult.candidates.length
            ? `Did you mean: ${locationResult.candidates.join(', ')}?`
            : `I couldn't find a location matching "${locationName}".`,
          candidates: locationResult.candidates.map(name => ({ id: name, name }))
        });
      }

      db.setLastLocationId(locationResult.match);
      const details = executor.getLocationDetails(locationResult.match, projectScope ? projectScope.id : null);
      const message = await answerFromData(transcript, details);
      return res.json({ type: 'location_details', details, message });
    }

    // ---------- SEARCH TASKS (read-only, execute immediately, no confirmation) ----------
    if (intent === 'search_tasks') {
      const contractorResult = resolveContractor(args.assignee_hint);
      const project = resolveProject(args.project_name) 
      const status = normalizeStatus(args.status);
      const location = args.location || null;
      const created_on = args.assigned_on || null;
      const deadline = args.completion_deadline || null;
      const results = await executor.executeSearchTasks({
        status,
        contractorId: contractorResult.match ? contractorResult.match.id : null,
        projectId: project ? project.id : null,
        location: args.location || null,
        created_on: args.assigned_on || null,
        completion_deadline: args.completion_deadline || null
      });
      if (results.length === 1) {
        db.setLastTaskId(results[0].id);
      }
      const message = await generateResponse({
        action: 'search_results',
        count: results.length,
        filters: args
      });

      return res.json({ type: 'search_results', results, message });
    }
    // ---------- LOG EXPENSE ----------
    if (intent === 'log_expense') {
      const taskResult = resolveTaskStrict(args.task_reference);
      if (!taskResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: taskResult.candidates.length
            ? `Which task did you mean by "${args.task_reference}"?`
            : `I couldn't find a task matching "${args.task_reference}".`,
          candidates: taskResult.candidates
        });
      }
      if (typeof args.amount !== 'number') {
        return res.json({ type: 'error', message: `I didn't catch the amount spent.` });
      }
      const pendingAction = { type: 'log_expense', task: taskResult.match, amount: args.amount };
      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Log ${args.amount} spent on "${taskResult.match.description}" (currently ${taskResult.match.spent_cost || 0} spent).`
      });
    }

    // ---------- SET TASK DEADLINE ----------
    if (intent === 'set_task_deadline') {
      const taskResult = resolveTaskStrict(args.task_reference);
      if (!taskResult.match) {
        return res.json({
          type: 'clarification_needed',
          message: `I couldn't find a task matching "${args.task_reference}".`,
          candidates: taskResult.candidates
        });
      }
      const pendingAction = {
        type: 'set_task_deadline',
        task: taskResult.match,
        completion_deadline: args.completion_deadline
      };
      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Set the deadline for "${taskResult.match.description}" to ${formatDate(args.completion_deadline)}.`
      });
    }

    // ---------- SET PROJECT DEADLINE ----------
    if (intent === 'set_project_deadline') {
      const project = resolveProject(args.project_name);
      const pendingAction = { type: 'set_project_deadline', project, completion_deadline: args.completion_deadline };
      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Set the completion deadline for "${project.name}" to ${formatDate(args.completion_deadline)}.`
      });
    }

    if (intent === 'set_project_budget') {
      const project = resolveProject(args.project_name);
      //db.setLastProjectId(project.id);
      const prendingAction = { type: 'set_project_budget', project, amount: args.amount };
      return res.json({
        type: 'confirmation_needed',
        pendingAction: prendingAction,
        summary: `Set the budget for "${project.name}" to ${args.amount}.`
      });
    }
    if (intent === 'open_project') {
      const project = resolveProject(args.project_name);
      db.setLastProjectId(project.id);
      const details = executor.getProjectFullDetails(project.id);
      const message = await answerFromData(transcript, details);
      return res.json({ type: 'project_details', details, message });
    }
    if (intent === 'set_project_description') {
      const project = resolveProject(args.project_name);
      const pendingAction = { type: 'set_project_description', project, description: args.description };
      return res.json({
        type: 'confirmation_needed',
        pendingAction,
        summary: `Set the description for "${project.name}" to: "${args.description}".`
      });
    }
    return res.json({ type: 'error', message: 'Unrecognized intent.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong processing that command.' });
  }
});

// ---------- CONFIRM & EXECUTE A PENDING ACTION ----------
app.post('/api/confirm', async (req, res) => {
  const { pendingAction } = req.body;
  if (!pendingAction || !pendingAction.type) {
    return res.status(400).json({ error: 'pendingAction is required' });
  }

  try {
    let result, summaryForMessage;

    if (pendingAction.type === 'create_task') {
      result = await executor.executeCreateTask(pendingAction);
      db.setLastTaskId(result.id);
      if (pendingAction.contractor) db.setLastContractorId(pendingAction.contractor.id);  // add this
      if (pendingAction.project) db.setLastProjectId(pendingAction.project.id);  // add this
      summaryForMessage = { action: 'created', task: result };
    } else if (pendingAction.type === 'assign_task') {
      result = await executor.executeAssignTask(pendingAction);
      db.setLastTaskId(result.id);
      db.setLastContractorId(pendingAction.contractor.id);  // Update last contractor ID
      db.setLastProjectId(pendingAction.task.project_id);  // Update last project ID
      summaryForMessage = { action: 'assigned', task: result };
    } else if (pendingAction.type === 'update_status') {
      result = executor.executeUpdateStatus(pendingAction);
      db.setLastTaskId(result.id);
      summaryForMessage = { action: 'status_updated', task: result };
    } else if (pendingAction.type === 'delete_task') {
      result = await executor.executeDeleteTask(pendingAction);
      summaryForMessage = { action: 'deleted', task: result };
    } else if (pendingAction.type === 'create_project') {
      result = await executor.executeCreateProject(pendingAction.name, pendingAction.estimated_cost, pendingAction.description, pendingAction.completion_deadline);
      db.setLastProjectId(result.id);
      summaryForMessage = { action: 'created_project', project: result };
    } else if (pendingAction.type === 'set_project_description') {
      result = await executor.executeSetProjectDescription(pendingAction.project, pendingAction.description);
      db.setLastProjectId(result.id);
      summaryForMessage = { action: 'description_set', project: result };
    } else if (pendingAction.type === 'set_task_location') {
      result = await executor.executeSetTaskLocation(pendingAction);
      db.setLastTaskId(result.id);
      summaryForMessage = { action: 'location_set', task: result };
    } else if (pendingAction.type === 'set_project_budget') {
      result = await executor.executeSetProjectBudget(pendingAction.project, pendingAction.amount);
      db.setLastProjectId(result.id);
      summaryForMessage = { action: 'budget_set', project: result };
    } else if (pendingAction.type === 'log_expense') {
      result = await executor.executeLogExpense(pendingAction);
      db.setLastTaskId(result.id);
      summaryForMessage = { action: 'expense_logged', task: result };
    } else if (pendingAction.type === 'set_task_deadline') {
      result = await executor.executeSetTaskDeadline(pendingAction);
      db.setLastTaskId(result.id);
      summaryForMessage = { action: 'task_deadline_set', task: result };
    } else if (pendingAction.type === 'set_project_deadline') {
      result = await executor.executeSetProjectDeadline(pendingAction.project, pendingAction.completion_deadline);
      db.setLastProjectId(result.id);
      summaryForMessage = { action: 'project_deadline_set', project: result };
    } else if (pendingAction.type === 'log_project_expense') {
      result = await executor.executeLogProjectExpense(pendingAction.project, pendingAction.amount);
      db.setLastProjectId(result.id);
      summaryForMessage = { action: 'project_expense_logged', project: result };
    } else if (pendingAction.type === 'set_task_notes') {
      result = await executor.executeSetTaskNotes(pendingAction);
      db.setLastTaskId(result.id);
      summaryForMessage = { action: 'notes_set', task: result };
    } else if (pendingAction.type === 'rename_project') {
      result = await executor.executeRenameProject(pendingAction.project, pendingAction.new_name);
      db.setLastProjectId(result.id);
      summaryForMessage = { action: 'project_renamed', project: result };
    } else if (pendingAction.type === 'add_location') {
      result = db.findOrCreateLocation(pendingAction.project.id, pendingAction.location_name);
      if (pendingAction.estimated_cost !== null) result.estimated_cost = pendingAction.estimated_cost;
      await db.save();
      db.setLastProjectId(pendingAction.project.id);
      summaryForMessage = { action: 'location_added', location: result };
    }

    else {
      return res.status(400).json({ error: 'Unknown action type' });
    }

    const message = await generateResponse(summaryForMessage);
    return res.json({ type: 'executed', task: result, message });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to execute action.' });
  }
});

// ---------- SUPPORTING READ ENDPOINTS (for the UI) ----------
app.get('/api/tasks', (req, res) => {
  res.json(db.allTasksWithJoins());
});

app.get('/api/contractors', (req, res) => {
  res.json(db.data.contractors);
});

app.get('/api/projects', (req, res) => {
  res.json(db.data.projects);
});

const PORT = process.env.PORT || 4000;
db.init().then(() => {
  app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to connect to the database:', err);
  process.exit(1);
});
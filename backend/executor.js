const { data, save, newId, taskWithJoins } = require('./db');

// A deadline only counts as "passed" once it's actually over, and only
// matters for work that isn't done yet - a finished task/project is never overdue.
function isPastDeadline(deadline, status) {
  if (!deadline || status === 'done') return false;
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return false;
  // Deadlines are day-granularity (YYYY-MM-DD) - compare against end of that day
  // so something due "today" isn't flagged overdue until tomorrow.
  d.setHours(23, 59, 59, 999);
  return d.getTime() < Date.now();
}

// Over budget = actually overspent, not just "spent something". A task/project
// with no estimate set (0) isn't flagged - there's nothing to compare against.
function isOverBudget(estimated, spent) {
  return (estimated || 0) > 0 && (spent || 0) > estimated;
}
async function executeRenameProject(project, newName) {
  const p = data.projects.find(pr => pr.id === project.id);
  if (!p) throw new Error('Project not found');
  p.name = newName;
  await save();
  return p;
}
async function executeCreateTask(resolved) {
  const now = new Date().toISOString();
  const task = {
    id: newId('task'),
    project_id: resolved.project.id,
    description: resolved.description,
    location: resolved.location || null,
    status: 'open',
    assigned_to: resolved.contractor ? resolved.contractor.id : null,
    estimated_cost: typeof resolved.estimated_cost === 'number' ? resolved.estimated_cost : 0,
    spent_cost: 0,
    assigned_date: resolved.assigned_date || null,
    completion_deadline: resolved.completion_deadline || null,
    created_at: now,
    notes:resolved.notes||null,
    updated_at: now,
    completed_at: null
  };
  data.tasks.push(task);
  await save();
  return taskWithJoins(task);
}
async function executeCreateProject(name, estimatedCost, description, completionDeadline) {
  const project = {
    id: newId('proj'),
    name,
    description: description || '',
    estimated_cost: typeof estimatedCost === 'number' ? estimatedCost : 0,
    spent_cost: 0,
    completion_deadline: completionDeadline || null
  };
  data.projects.push(project);
  await save();
  return project;
}
function getProjectLocationsBreakdown(projectId) {
  const tasks = data.tasks.filter(t => t.project_id === projectId);
  const taskLocNames = tasks.map(t => t.location).filter(Boolean);
  const directLocNames = data.locations.filter(l => l.project_id === projectId).map(l => l.name);
  const locations = [...new Set([...taskLocNames, ...directLocNames])];

  return locations.map(loc => {
    const atLoc = tasks.filter(t => t.location === loc);
    const open = atLoc.filter(t => t.status === 'open').length;
    const inProgress = atLoc.filter(t => t.status === 'in_progress').length;
    const done = atLoc.filter(t => t.status === 'done').length;
    const taskEstimated = atLoc.reduce((s, t) => s + (t.estimated_cost || 0), 0);
    const taskSpent = atLoc.reduce((s, t) => s + (t.spent_cost || 0), 0);
    const record = data.locations.find(
      l => l.project_id === projectId && l.name.toLowerCase() === loc.toLowerCase()
    );
    const directEstimated = record ? (record.estimated_cost || 0) : 0;
    const directSpent = record ? (record.spent_cost || 0) : 0;
    return {
      location: loc,
      total: atLoc.length,
      open, inProgress, done,
      percentComplete: atLoc.length ? Math.round((done / atLoc.length) * 100) : 0,
      estimatedCost: taskEstimated + directEstimated,
      spentCost: taskSpent + directSpent,
      overBudget: isOverBudget(taskEstimated + directEstimated, taskSpent + directSpent),
      overdueTasks: atLoc.filter(t => isPastDeadline(t.completion_deadline, t.status)).length
    };
  });
}

function getProjectFullDetails(projectId) {
  const project = data.projects.find(p => p.id === projectId);
  console.log(project);
  if (!project) return null;
  const summary = getProgressSummary({ projectId });
  const images = data.images.filter(img => img.owner_type === 'project' && img.owner_id === projectId);
  const description=project.description;
  const locations = getProjectLocationsBreakdown(projectId);
  const overheadSpend = project.spent_cost || 0;
  const totalSpent = summary.spentTotal + overheadSpend;
  const deadlinePassed = isPastDeadline(project.completion_deadline, summary.percentComplete === 100 ? 'done' : 'open');
  const overBudget = isOverBudget(project.estimated_cost, totalSpent);
  return { project,images, description, summary, locations, deadlinePassed, overheadSpend, totalSpent, overBudget };
}
async function executeSetTaskNotes(resolved) {
  const task = data.tasks.find(t => t.id === resolved.task.id);
  if (!task) throw new Error('Task not found');
  task.notes = resolved.notes;
  task.updated_at = new Date().toISOString();
  await save();
  return taskWithJoins(task);
}
async function executeSetProjectDescription(project, description) {
  const p = data.projects.find(pr => pr.id === project.id);
  if (!p) throw new Error('Project not found');
  p.description = description;
  await save();
  return p;
}
async function executeAssignTask(resolved) {
  const task = data.tasks.find(t => t.id === resolved.task.id);
  if (!task) throw new Error('Task not found');
  task.assigned_to = resolved.contractor.id;
  if (resolved.assigned_date) task.assigned_date = resolved.assigned_date;
  await save();
  return taskWithJoins(task);
}

async function executeUpdateStatus(resolved) {
  const task = data.tasks.find(t => t.id === resolved.task.id);
  if (!task) throw new Error('Task not found');
  task.status = resolved.new_status;
  task.updated_at = new Date().toISOString();
  task.completed_at = resolved.new_status === 'done' ? new Date().toISOString() : null;
  await save();
  return taskWithJoins(task);
}

function executeSearchTasks(filters) {
  let results = data.tasks.map(taskWithJoins);

  if (filters.status) {
    results = results.filter(t => t.status === filters.status);
  }
  if (filters.contractorId) {
    results = results.filter(t => t.assigned_to === filters.contractorId);
  }
  if (filters.projectId) {
    results = results.filter(t => t.project_id === filters.projectId);
  }
  if (filters.location) {
    const loc = filters.location.toLowerCase();
    results = results.filter(
      t =>
        (t.location && t.location.toLowerCase().includes(loc)) ||
        (t.description && t.description.toLowerCase().includes(loc))
    );
  }
  if (filters.created_on) {
    const createdDate = new Date(filters.created_on);
    if (!isNaN(createdDate.getTime())) {
      results = results.filter(t => {
        const taskCreatedDate = new Date(t.created_at);
        return (
          taskCreatedDate.getFullYear() === createdDate.getFullYear() &&
          taskCreatedDate.getMonth() === createdDate.getMonth() &&
          taskCreatedDate.getDate() === createdDate.getDate()
        );
      });
    }
  }
  if (filters.completion_deadline) {
    const deadlineDate = new Date(filters.completion_deadline);
    if (!isNaN(deadlineDate.getTime())) {
      results = results.filter(t => {
        const taskDeadline = new Date(t.completion_deadline);
        return (
          taskDeadline.getFullYear() === deadlineDate.getFullYear() &&
          taskDeadline.getMonth() === deadlineDate.getMonth() &&
          taskDeadline.getDate() === deadlineDate.getDate()
        );
      });
    }
  }

  return results;
}

async function executeDeleteTask(resolved) {
  const idx = data.tasks.findIndex(t => t.id === resolved.task.id);
  if (idx === -1) throw new Error('Task not found');
  const [removed] = data.tasks.splice(idx, 1);
  await save();
  return taskWithJoins(removed);
}

function getProgressSummary(filters = {}) {
  let list = data.tasks;
  if (filters.projectId) {
    list = list.filter(t => t.project_id === filters.projectId);
  }

  const counts = { open: 0, in_progress: 0, done: 0 };
  list.forEach(t => {
    counts[t.status] = (counts[t.status] || 0) + 1;
  });

  const estimatedTotal = list.reduce((s, t) => s + (t.estimated_cost || 0), 0);
  const spentTotal = list.reduce((s, t) => s + (t.spent_cost || 0), 0);
  const percentComplete = list.length ? Math.round((counts.done / list.length) * 100) : 0;

  const allLocations = [...new Set(list.map(t => t.location).filter(Boolean))];
  const openLocationSet = new Set(list.filter(t => t.status !== 'done').map(t => t.location).filter(Boolean));
  const completedLocations = allLocations.filter(loc => !openLocationSet.has(loc));
  const openLocations = allLocations.filter(loc => openLocationSet.has(loc));

  const overdueTasks = list.filter(t => isPastDeadline(t.completion_deadline, t.status)).map(taskWithJoins);

  return {
    total: list.length,
    counts,
    estimatedTotal,
    spentTotal,
    percentComplete,
    openLocations,
    completedLocations,
    overBudget: isOverBudget(estimatedTotal, spentTotal),
    overdueTasks
  };
}

function getContractorDetails(contractorId) {
  const contractor = data.contractors.find(c => c.id === contractorId);
  if (!contractor) return null;

  const theirTasks = data.tasks.filter(t => t.assigned_to === contractorId).map(taskWithJoins);
  const open = theirTasks.filter(t => t.status === 'open').length;
  const inProgress = theirTasks.filter(t => t.status === 'in_progress').length;
  const done = theirTasks.filter(t => t.status === 'done').length;

  const taskCostTotal = theirTasks.reduce((s, t) => s + (t.estimated_cost || 0), 0);
  const taskSpentTotal = theirTasks.reduce((s, t) => s + (t.spent_cost || 0), 0);

  return {
    contractor,
    totalTasks: theirTasks.length,
    open,
    inProgress,
    done,
    tasks: theirTasks,
    contractAmount: contractor.contract_amount ?? null,
    contractPeriod: contractor.contract_period ?? null,
    taskCostTotal,
    taskSpentTotal
  };
}

function listContractorsSummary() {
  return data.contractors.map(c => {
    const theirTasks = data.tasks.filter(t => t.assigned_to === c.id);
    return {
      id: c.id,
      name: c.name,
      trade: c.trade,
      totalTasks: theirTasks.length,
      open: theirTasks.filter(t => t.status === 'open').length,
      inProgress: theirTasks.filter(t => t.status === 'in_progress').length,
      done: theirTasks.filter(t => t.status === 'done').length
    };
  });
}

function listProjectsSummary() {
  return data.projects.map(p => {
    const summary = getProgressSummary({ projectId: p.id });
    return {
      id: p.id,
      name: p.name,
      description: p.description || '',
      totalTasks: summary.total,
      imageUrl: p.image_url || null,
      percentComplete: summary.percentComplete,
      estimatedCost: p.estimated_cost || 0,
      spentCost: summary.spentTotal,
      overBudget: isOverBudget(p.estimated_cost, summary.spentTotal),
      completionDeadline: p.completion_deadline || null,
      deadlinePassed: isPastDeadline(p.completion_deadline, summary.percentComplete === 100 ? 'done' : 'open')
    };
  });
}

function getLocationDetails(locationName, projectId) {
  let scope = data.tasks;
  if (projectId) scope = scope.filter(t => t.project_id === projectId);
  const matching = scope
    .filter(t => (t.location || '').toLowerCase() === locationName.toLowerCase())
    .map(taskWithJoins);

  const open = matching.filter(t => t.status === 'open').length;
  const inProgress = matching.filter(t => t.status === 'in_progress').length;
  const done = matching.filter(t => t.status === 'done').length;
  const taskEstimated = matching.reduce((s, t) => s + (t.estimated_cost || 0), 0);
  const taskSpent = matching.reduce((s, t) => s + (t.spent_cost || 0), 0);

  // record must be defined before anything below uses it
  const record = data.locations.find(
    l => (!projectId || l.project_id === projectId) && l.name.toLowerCase() === locationName.toLowerCase()
  );
  const directEstimated = record ? (record.estimated_cost || 0) : 0;
  const directSpent = record ? (record.spent_cost || 0) : 0;
  const estimatedTotal = taskEstimated + directEstimated;
  const spentTotal = taskSpent + directSpent;
  const images = record ? data.images.filter(img => img.owner_type === 'location' && img.owner_id === record.id) : [];

  return {
    location: locationName,
    locationId: record ? record.id : null,
    totalIssues: matching.length,
    open,
    inProgress,
    done,
    estimatedTotal,
    spentTotal,
    directEstimated,
    directSpent,
    overBudget: isOverBudget(estimatedTotal, spentTotal),
    overdueTasks: matching.filter(t => isPastDeadline(t.completion_deadline, t.status)).length,
    tasks: matching,
    images
  };
}
async function executeSetTaskLocation(resolved) {
  const task = data.tasks.find(t => t.id === resolved.task.id);
  if (!task) throw new Error('Task not found');
  task.location = resolved.location;
  task.updated_at = new Date().toISOString();
  await save();
  return taskWithJoins(task);
}
async function executeSetProjectBudget(project, amount) {
  const p = data.projects.find(pr => pr.id === project.id);
  if (!p) throw new Error('Project not found');
  p.estimated_cost = amount;
  await save();
  return p;
}
function executeLogExpense(resolved) {
  const task = data.tasks.find(t => t.id === resolved.task.id);
  if (!task) throw new Error('Task not found');
  task.spent_cost = (task.spent_cost || 0) + resolved.amount;
  task.updated_at = new Date().toISOString();
  save();
  return taskWithJoins(task);
}
async function executeSetTaskDeadline(resolved) {
  const task = data.tasks.find(t => t.id === resolved.task.id);
  if (!task) throw new Error('Task not found');
  task.completion_deadline = resolved.completion_deadline;
  task.updated_at = new Date().toISOString();
  await save();
  return taskWithJoins(task);
}
function executeSetProjectDeadline(project, completionDeadline) {
  const p = data.projects.find(pr => pr.id === project.id);
  if (!p) throw new Error('Project not found');
  p.completion_deadline = completionDeadline;
  save();
  return p;
}
async function executeLogProjectExpense(project, amount) {
  const p = data.projects.find(pr => pr.id === project.id);
  if (!p) throw new Error('Project not found');
  p.spent_cost = (p.spent_cost || 0) + amount;
  await save();
  return p;
}
function getTaskUndecidedItems(task) {
  const items = [];
  if (!task.location) items.push('no location has been set');
  if (!task.assigned_to) items.push('no contractor has been assigned');
  if (!task.estimated_cost) items.push('no estimated cost has been set');
  if (!task.completion_deadline) items.push('no completion deadline has been set');
  if (!task.assigned_date) items.push('no assigned date has been set');
  if (!task.notes) items.push('no additional notes have been added');
  return items;
}

function getProjectUndecidedItems(project) {
  const items = [];
  if (!project.estimated_cost) items.push('no overall budget has been set');
  if (!project.completion_deadline) items.push('no completion deadline has been set');
  if (!project.description) items.push('no description has been added');

  const unassigned = data.tasks.filter(t => t.project_id === project.id && !t.assigned_to).length;
  if (unassigned > 0) items.push(`${unassigned} task${unassigned > 1 ? 's have' : ' has'} no contractor assigned`);

  const noDeadline = data.tasks.filter(t => t.project_id === project.id && !t.completion_deadline).length;
  if (noDeadline > 0) items.push(`${noDeadline} task${noDeadline > 1 ? 's have' : ' has'} no deadline set`);

  return items;
}
module.exports = {
  executeCreateTask,
  executeAssignTask,
  executeUpdateStatus,
  executeSearchTasks,
  executeDeleteTask,
  getProgressSummary,
  getContractorDetails,
  listContractorsSummary,
  listProjectsSummary,
  getLocationDetails,
  executeCreateProject,
  executeSetProjectDescription,
  getProjectFullDetails,
  getProjectLocationsBreakdown,
  executeSetTaskLocation,
  executeSetProjectBudget,
  executeLogExpense,
  executeSetTaskDeadline,
  executeSetProjectDeadline,
  isPastDeadline,
  isOverBudget,
  executeSetTaskNotes,
  executeRenameProject,
  getProjectUndecidedItems,
  getTaskUndecidedItems,
  executeLogProjectExpense
};
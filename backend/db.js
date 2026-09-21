require('dotenv').config();
const { Pool } = require('pg');
const { types } = require('pg');
types.setTypeParser(1700, val => val === null ? null : parseFloat(val)); // numeric
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false } // required for Supabase
});

function newId(prefix) {
  return prefix + '-' + crypto.randomUUID().slice(0, 8);
}

// Same in-memory shape as before - executor.js/resolve.js keep reading
// data.tasks / data.projects / data.contractors synchronously, unchanged.
const data = { projects: [], contractors: [], tasks: [], locations: [], images: [] };

// Must be awaited once at startup (see server.js note below) before the
// server starts handling requests, since Postgres reads are async.
async function init() {
  const [{ rows: projects }, { rows: contractors }, { rows: tasks }, { rows: locations }, { rows: images }] = await Promise.all([
    pool.query('SELECT * FROM projects'),
    pool.query('SELECT * FROM contractors'),
    pool.query('SELECT * FROM tasks ORDER BY created_at DESC'),
    pool.query('SELECT * FROM locations'),
    pool.query('SELECT * FROM images ORDER BY created_at')
  ]);
  data.projects = projects;
  data.contractors = contractors;
  data.tasks = tasks;
  data.locations = locations;
  data.images = images;
}

// Same call signature as before (executor.js calls save() after mutating
// `data` in place, no changes needed there) - but this now pushes every
// row back to Postgres. It's a full upsert rather than a targeted update,
// which is fine at this data size but not the most efficient approach -
// worth revisiting with per-mutation queries once the data grows.
async function save() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of data.projects) {
      await client.query(
        `insert into projects (id, name, description, estimated_cost, spent_cost, completion_deadline, image_url)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (id) do update set
       name=$2, description=$3, estimated_cost=$4, spent_cost=$5, completion_deadline=$6, image_url=$7`,
        [p.id, p.name, p.description, p.estimated_cost, p.spent_cost, p.completion_deadline, p.image_url || null]
      );
    }

    for (const c of data.contractors) {
      await client.query(
        `insert into contractors (id, name, trade, contract_amount, contract_period)
         values ($1,$2,$3,$4,$5)
         on conflict (id) do update set
           name=$2, trade=$3, contract_amount=$4, contract_period=$5`,
        [c.id, c.name, c.trade, c.contract_amount, c.contract_period]
      );
    }
    for (const img of data.images) {
      await client.query(
        `insert into images (id, owner_type, owner_id, url, label, created_at)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (id) do update set
       owner_type=$2, owner_id=$3, url=$4, label=$5`,
        [img.id, img.owner_type, img.owner_id, img.url, img.label, img.created_at]
      );
    }
    for (const t of data.tasks) {
      await client.query(
        `insert into tasks (id, project_id, description, location, status, assigned_to,
                             estimated_cost, spent_cost, assigned_date, completion_deadline,
                             created_at, updated_at, completed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (id) do update set
           project_id=$2, description=$3, location=$4, status=$5, assigned_to=$6,
           estimated_cost=$7, spent_cost=$8, assigned_date=$9, completion_deadline=$10,
           updated_at=$12, completed_at=$13`,
        [t.id, t.project_id, t.description, t.location, t.status, t.assigned_to,
        t.estimated_cost, t.spent_cost, t.assigned_date, t.completion_deadline,
        t.created_at, t.updated_at, t.completed_at]
      );
    }
    for (const l of data.locations) {
      await client.query(
        `insert into locations (id, project_id, name, estimated_cost, spent_cost)
     values ($1,$2,$3,$4,$5)
     on conflict (id) do update set
       name=$3, estimated_cost=$4, spent_cost=$5`,
        [l.id, l.project_id, l.name, l.estimated_cost, l.spent_cost]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
function findOrCreateLocation(projectId, name) {
  let loc = data.locations.find(
    l => l.project_id === projectId && l.name.toLowerCase() === name.toLowerCase()
  );
  if (!loc) {
    loc = { id: newId('loc'), project_id: projectId, name, estimated_cost: 0, spent_cost: 0 };
    data.locations.push(loc);
  }
  return loc;
}
function addImage(ownerType, ownerId, url, label) {
  const image = {
    id: newId('img'),
    owner_type: ownerType,
    owner_id: ownerId,
    url,
    label: label || null,
    created_at: new Date().toISOString()
  };
  data.images.push(image);
  return image;
}

// ---------- Joined view helpers (unchanged - pure in-memory lookups) ----------
function taskWithJoins(task) {
  if (!task) return null;
  const contractor = data.contractors.find(c => c.id === task.assigned_to);
  const project = data.projects.find(p => p.id === task.project_id);
  return {
    ...task,
    assignee_name: contractor ? contractor.name : null,
    project_name: project ? project.name : null
  };
}

function allTasksWithJoins() {
  return [...data.tasks]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(taskWithJoins);
}

let lastTaskId = null;
function setLastTaskId(id) { lastTaskId = id; }
function getLastTaskId() { return lastTaskId; }
let lastLocationId=null;
function setLastLocationId(id){lastLocationId=id};
function getLastLocationId(){return lastLocationId};
let lastContractorId = null;
function setLastContractorId(id) { lastContractorId = id; }
function getLastContractorId() { return lastContractorId; }

let lastProjectId = null;
function setLastProjectId(id) { lastProjectId = id; }
function getLastProjectId() { return lastProjectId; }

module.exports = {
  data, init, save, newId, taskWithJoins, allTasksWithJoins,
  setLastTaskId, getLastTaskId, setLastContractorId, getLastContractorId,
  setLastProjectId, getLastProjectId, findOrCreateLocation, addImage,setLastLocationId,getLastLocationId
};
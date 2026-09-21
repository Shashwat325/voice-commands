const BASE_URL = 'http://localhost:4000'||'https://voice-commands.onrender.com';
const CLOUDINARY_CLOUD_NAME = 'daf5k1guv';  // from Cloudinary dashboard
const CLOUDINARY_UPLOAD_PRESET = 'voice commands';  // the unsigned preset you created

export async function uploadImageToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: formData
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Cloudinary upload failed');
  }
  return data.secure_url;
}
export async function translateText(text, from, to) {
  const res = await fetch(`${BASE_URL}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, from, to })
  });
  const data = await res.json();
  return data.translated;
}
export async function setProjectImage(projectId, imageUrl) {
  const res = await fetch(`${BASE_URL}/api/projects/${projectId}/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl })
  });
  return res.json();
}
export async function saveImage(ownerType, ownerId, url, label) {
  const res = await fetch(`${BASE_URL}/api/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_type: ownerType, owner_id: ownerId, url, label })
  });
  return res.json();
}
export async function sendVoiceCommand(transcript) {
  const res = await fetch(`${BASE_URL}/api/voice-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript })
  });
  return res.json();
}

export async function confirmAction(pendingAction) {
  const res = await fetch(`${BASE_URL}/api/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pendingAction })
  });
  return res.json();
}

export async function fetchTasks() {
  const res = await fetch(`${BASE_URL}/api/tasks`);
  return res.json();
}

export async function fetchContractors() {
  const res = await fetch(`${BASE_URL}/api/contractors`);
  return res.json();
}

export async function fetchProjects() {
  const res = await fetch(`${BASE_URL}/api/projects`);
  return res.json();
}

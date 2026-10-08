const API_BASE = "/api";

export async function searchProspect(query: string) {
  const res = await fetch(`${API_BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

export async function getCases() {
  const res = await fetch(`${API_BASE}/cases`);
  if (!res.ok) throw new Error("Failed to fetch cases");
  return res.json();
}

export async function getCase(id: number) {
  const res = await fetch(`${API_BASE}/cases/${id}`);
  if (!res.ok) throw new Error("Failed to fetch case");
  return res.json();
}

export async function updateCaseStage(id: number, stage: string) {
  const res = await fetch(`${API_BASE}/cases/${id}/stage`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage }),
  });
  if (!res.ok) throw new Error("Failed to update stage");
  return res.json();
}

export async function deleteCase(id: number) {
  const res = await fetch(`${API_BASE}/cases/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete case");
  return res.json();
}

export async function generatePitch(caseId: number, tone: string, notes: string) {
  const res = await fetch(`${API_BASE}/pitch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId, tone, notes }),
  });
  if (!res.ok) throw new Error("Pitch generation failed");
  return res.json();
}

export async function savePitch(pitch: {
  caseId: number;
  subject: string;
  body: string;
  tone: string;
  notes: string;
}) {
  const res = await fetch(`${API_BASE}/pitch`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pitch),
  });
  if (!res.ok) throw new Error("Failed to save pitch");
  return res.json();
}

export async function getStats() {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function searchOrganization(query: string) {
  const res = await fetch(`${API_BASE}/org`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Organization search failed (${res.status})`);
  }
  return res.json();
}

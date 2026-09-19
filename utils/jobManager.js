// utils/jobManager.js
// Simple in‑memory job manager for Heatmap Clipper

const jobs = new Map();

module.exports = {
  set: (id, job) => jobs.set(id, job),
  get: (id) => jobs.get(id),
  delete: (id) => jobs.delete(id),
  all: () => Array.from(jobs.values()),
};

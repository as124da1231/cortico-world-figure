const MiB = 1024 * 1024;

// Shared by the panel's uploader and the receiving World.
export const FIGURE_IMPORT = Object.freeze({
  zip: 32 * MiB,
  folder: 512 * MiB,
  files: 20000,
  file: 4 * MiB,
  chunk: 2 * MiB,
  batch: 8 * MiB,
  // The legacy single-request folder format also includes path and length records.
  bundle: 40 * MiB,
});

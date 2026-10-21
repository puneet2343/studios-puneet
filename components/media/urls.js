const q = (path) => `name=${encodeURIComponent(path)}`;
const at = (file) => file.path ?? file.name;

// "Goa Trip" + "clip.mp4" -> "Goa Trip/clip.mp4"; "" is the top level.
export const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);

// `key` changes whenever the file's content does, so these URLs are cached forever by the browser.
export const thumbUrl = (file) => `/api/thumb?${q(at(file))}&k=${file.key}`;
export const fileUrl = (file) => `/api/files?${q(at(file))}&v=${file.key}`;
export const downloadUrl = (file) => `/api/files?${q(at(file))}&download=1`;
export const actionUrl = (path) => `/api/files?${q(path)}`;
// A folder (with subfolders), or several files, as one ZIP download.
export const zipUrl = (dir) => `/api/zip?dir=${encodeURIComponent(dir)}`;
export const zipFilesUrl = (paths) => `/api/zip?${paths.map((p) => `p=${encodeURIComponent(p)}`).join("&")}`;

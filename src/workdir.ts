import fs from 'node:fs';
import path from 'node:path';

// --- Types ---

export interface WorkdirInfo {
  path: string;
}

// --- Internal Helpers ---

function skillsDir(workdir: string): string {
  return path.join(workdir, '.claude', 'skills');
}

export function getSkillsDir(workdir: string): string {
  return skillsDir(workdir);
}

function uploadsDir(workdir: string): string {
  return path.join(workdir, 'uploads');
}

function copyDirContents(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirContents(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      if (!fs.existsSync(destPath)) {
        fs.symlinkSync(fs.readlinkSync(srcPath), destPath);
      }
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// --- Public API ---

/**
 * Initialize a workdir with the runtime directory structure.
 * Idempotent: does not overwrite existing files.
 */
export function initWorkdir(workdir: string): WorkdirInfo {
  fs.mkdirSync(skillsDir(workdir), { recursive: true });
  fs.mkdirSync(uploadsDir(workdir), { recursive: true });
  return { path: workdir };
}

/**
 * Initialize a workdir from a role template, then ensure the standard workdir
 * files exist. Existing files are preserved so employee-local edits survive
 * repeated fork/register operations.
 */
export function initWorkdirFromTemplate(
  workdir: string,
  templateDir: string,
): WorkdirInfo {
  if (fs.existsSync(templateDir)) {
    copyDirContents(templateDir, workdir);
  }
  return initWorkdir(workdir);
}

/**
 * Load workdir info when the runtime directory exists.
 * Returns null if the workdir is not initialized.
 */
export function loadWorkdir(workdir: string): WorkdirInfo | null {
  if (!fs.existsSync(skillsDir(workdir)) && !fs.existsSync(uploadsDir(workdir))) {
    return null;
  }
  return { path: workdir };
}

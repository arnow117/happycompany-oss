/**
 * DingTalk utility functions for file handling.
 *
 * Extracted from dingtalk.ts to keep the channel adapter under 800 lines.
 */

import http from 'node:http';
import https from 'node:https';
import { logger } from './logger.js';

// -- Constants --

const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** File extensions that can be read as plain text. */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.csv', '.json', '.md', '.log',
  '.ts', '.js', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.html', '.css', '.scss', '.less', '.sql', '.sh', '.bash',
  '.gitignore', '.dockerignore', '.editorconfig',
]);

/**
 * Get the lowercased file extension from a filename, including the dot.
 * Returns null if no extension found.
 */
function getExtension(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return null;
  }
  return fileName.slice(lastDot).toLowerCase();
}

// -- Public exports --

/**
 * Extract text content from a downloaded file buffer.
 *
 * For text-based files (.txt, .csv, .json, .md, .log, etc.): reads as UTF-8.
 * For binary files (.xlsx, .xls, .docx, .pdf, etc.): returns a placeholder.
 */
export function extractFileText(
  buffer: Buffer,
  fileName: string,
): string {
  const ext = getExtension(fileName);
  if (ext && TEXT_EXTENSIONS.has(ext)) {
    return buffer.toString('utf-8');
  }
  return `[binary file: ${fileName}]`;
}

/**
 * Download a file buffer by DingTalk download code.
 *
 * Two-step process:
 * 1. POST to /v1.0/robot/messageFiles/download to get a temporary URL
 * 2. GET the temporary URL to download the actual file bytes
 */
export async function downloadByCode(
  downloadCode: string,
  token: string,
  robotCode: string,
): Promise<Buffer | null> {
  try {
    // Step 1: Get temporary download URL
    const downloadUrlResp = await new Promise<{ downloadUrl?: string }>(
      (resolve, reject) => {
        const body = JSON.stringify({ downloadCode, robotCode });
        const req = https.request(
          {
            hostname: 'api.dingtalk.com',
            path: '/v1.0/robot/messageFiles/download',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-acs-dingtalk-access-token': token,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              const buf = Buffer.concat(chunks);
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                try { resolve(JSON.parse(buf.toString('utf8'))); } catch { reject(new Error('Invalid JSON')); }
              } else {
                reject(new Error(`Download URL API failed (${res.statusCode})`));
              }
            });
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      },
    );

    const downloadUrl = downloadUrlResp?.downloadUrl;
    if (!downloadUrl) throw new Error('No downloadUrl in response');

    // Step 2: Download the file
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const urlObj = new URL(downloadUrl);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      const req = protocol.request(
        { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: 'GET' },
        (res) => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`File download HTTP failed (${res.statusCode})`));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_FILE_SIZE) {
              res.destroy(new Error('File exceeds MAX_FILE_SIZE'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });

    return buffer.length > 0 ? buffer : null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, 'Failed to download DingTalk file');
    return null;
  }
}

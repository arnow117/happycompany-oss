import fs from 'node:fs';
import path from 'node:path';
import type { Archiver } from 'archiver';

// archiver v7 exports named classes (ZipArchive, etc.) in ESM.
// @types/archiver still uses the legacy `export =` pattern, so we cast through unknown.
interface ZipArchiveConstructor {
  new (options?: { zlib?: { level?: number } }): Archiver;
}
const ZipArchivePromise = (import('archiver') as Promise<unknown>).then(
  (m: unknown) => (m as { ZipArchive: ZipArchiveConstructor }).ZipArchive,
);

export class TenantExporter {
  async exportTenant(tenantDir: string): Promise<Buffer> {
    const tenantName = path.basename(tenantDir);
    const ZipArchive = await ZipArchivePromise;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive: Archiver = new ZipArchive({ zlib: { level: 9 } });

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      // Metadata
      archive.append(
        JSON.stringify(
          {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            tenantName,
          },
          null,
          2,
        ),
        { name: 'tenant-export.json' },
      );

      // Walk directory and add files
      this.walkDir(tenantDir, tenantDir, archive);
      archive.finalize();
    });
  }

  private walkDir(dir: string, baseDir: string, archive: Archiver): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(fullPath, baseDir, archive);
      } else {
        const relativePath = path.relative(baseDir, fullPath);
        archive.file(fullPath, { name: relativePath });
      }
    }
  }
}

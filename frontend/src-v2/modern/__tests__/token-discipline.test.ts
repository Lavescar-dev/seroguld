/**
 * Token disiplin guard'ı (Faz 0 — görsel sadakat sözleşmesi otomatik-fail maddeleri).
 *
 * modern/** altında:
 *  - tokens.css / tailwind.config.js dışında hardcoded hex rengi YASAK
 *  - radius ölçeği yalnız 8/12/16/20px (rounded-sg-* veya rounded-lg/xl/2xl); keyfi rounded-[Npx] YASAK
 *  - sahte kontrol kalıntıları (Ctrl K arama, Sparkles marka ikonu, hardcoded şehir) YASAK
 */
/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src-v2');
const SCAN_DIRS = ['modern', 'components/ModernAppShell.tsx'];
const ALLOWED_RADIUS_PX = new Set(['8', '12', '16', '20']);

// Faz 2 kapsamı: modül ekranları (Alış/Depolama/Log/Customers/Office) bu turda
// bilinçli olarak dışarıda bırakıldı; token/radius ratchet'i Faz 2'de genişletilecek.
const PHASE2_PREFIX = join('modern', 'modules') + '/';

function collectFiles(entry: string): string[] {
  const abs = join(SRC_ROOT, entry);
  const stat = statSync(abs);
  if (stat.isFile()) return [abs];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const child = join(abs, name);
    const childStat = statSync(child);
    if (childStat.isDirectory()) out.push(...collectFiles(relative(SRC_ROOT, child)));
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(child);
  }
  return out;
}

const allFiles = SCAN_DIRS.flatMap(collectFiles);
const inScopeFiles = allFiles.filter((file) => !relative(SRC_ROOT, file).startsWith(PHASE2_PREFIX));

describe('modern UI token disiplini', () => {
  it('hardcoded hex renk yok (Faz 0+1 kapsamı)', () => {
    const offenders: string[] = [];
    for (const file of inScopeFiles) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line: string, idx: number) => {
        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) {
          offenders.push(`${relative(SRC_ROOT, file)}:${idx + 1} ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('ölçek dışı radius yok (yalnız 8/12/16/20px; Faz 0+1 kapsamı)', () => {
    const offenders: string[] = [];
    for (const file of inScopeFiles) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line: string, idx: number) => {
        for (const match of line.matchAll(/rounded-\[(\d+)px\]/g)) {
          if (!ALLOWED_RADIUS_PX.has(match[1])) {
            offenders.push(`${relative(SRC_ROOT, file)}:${idx + 1} rounded-[${match[1]}px]`);
          }
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('sahte kontrol / marka kalıntısı yok', () => {
    const banned = [/Ctrl K/, /Sparkles/, /København/];
    const offenders: string[] = [];
    for (const file of allFiles) {
      const rel = relative(SRC_ROOT, file);
      if (rel.endsWith('UiVariantSettingsCards.tsx')) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line: string, idx: number) => {
        for (const pattern of banned) {
          if (pattern.test(line)) offenders.push(`${rel}:${idx + 1} ${pattern}`);
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

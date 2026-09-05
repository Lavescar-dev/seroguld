import { describe, expect, it } from 'vitest';

import { sanitizePreviewHtml } from '../WooCommercePage';

describe('sanitizePreviewHtml (M3 — yayın önizlemesi allowlist sanitize)', () => {
  it('script/iframe/event handler/javascript: URI tamamen düşürür', () => {
    const dirty =
      '<p onclick="steal()">merhaba</p><script>window.steal=1</script>' +
      '<iframe src="https://evil.example"></iframe><a href="javascript:alert(1)">tık</a>';
    const clean = sanitizePreviewHtml(dirty);

    expect(clean).not.toContain('script');
    expect(clean).not.toContain('iframe');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('merhaba');
  });

  it('izinli tipografi etiketlerini korur (h3/ul/table) — ölü prose sınıflarının yerine', () => {
    const html = '<h3>Başlık</h3><ul><li>madde</li></ul><table><tr><td>hücre</td></tr></table>';
    const clean = sanitizePreviewHtml(html);

    expect(clean).toContain('<h3>Başlık</h3>');
    expect(clean).toContain('<ul>');
    expect(clean).toContain('<li>madde</li>');
    expect(clean).toContain('<table>');
  });

  it('a href yalnız http(s) için korunur ve rel/target ekler; style attr düşer', () => {
    const clean = sanitizePreviewHtml(
      '<a href="https://seroguld.dk/x">site</a><a href="/relative">rel</a><p style="position:fixed">stil</p>',
    );

    expect(clean).toContain('href="https://seroguld.dk/x"');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
    expect(clean).not.toContain('/relative"');
    expect(clean).toContain('rel</a>'); // izinli olmayan href: metin korunur, bağlantı özniteliği yok
    expect(clean).not.toContain('style=');
  });

  it('boş/ham olmayan girdi için boş döner', () => {
    expect(sanitizePreviewHtml('')).toBe('');
    expect(sanitizePreviewHtml('   ')).toBe('');
  });
});

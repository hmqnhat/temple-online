#!/usr/bin/env python3
"""Offline importer for the CTC Guanyin 100-stick pages.

Reads pages already saved as <number>.html in a directory (never fetches, never
executes anything from them) and writes the original-text ledger. Every page must
parse completely; a missing or malformed page aborts instead of being filled in.
Usage: import-fortunes.py PAGES_DIR OUT.json ACCESS_DATE(YYYY-MM-DD)
"""
import html, json, re, sys
from pathlib import Path

CN_DIGITS = '零一二三四五六七八九'
RANKS = {'上籤': 'upper', '中籤': 'middle', '下籤': 'lower'}
EDITION = {
    'collectionId': 'ctc-guanyin-100',
    'edition': 'CTC Guanyin published reference edition',
    'publisher': '華人廟宇委員會 (Chinese Temples Committee, Hong Kong)',
    'sourceIndex': 'https://www.ctc.org.hk/chim-search/',
}

def cn(n):
    if n == 100:
        return '一百'
    t, o = divmod(n, 10)
    return ('' if t == 0 else '十' if t == 1 else CN_DIGITS[t] + '十') + ('' if o == 0 else CN_DIGITS[o])

def clean(fragment):
    text = re.sub(r'<br\s*/?>', '', fragment)
    return html.unescape(re.sub(r'<[^>]+>', '', text)).strip()

def spans(block):
    return [clean(s) for s in re.findall(r'<span>(.*?)</span>', block, flags=re.S) if clean(s)]

def parse(number, page):
    m = re.search(r'<div class="txt-grp txt-grp1">(.*?)</div>\s*</div>', page, flags=re.S)
    g2 = re.search(r'<div class="txt-grp txt-grp2">(.*?)</div>\s*</div>\s*<div class="txt-grp txt-grp3">', page, flags=re.S)
    g3 = re.search(r'<div class="txt-meaning">(.*?)</div>(.*?)</div>\s*</div>\s*</div>', page, flags=re.S)
    if not (m and g2 and g3):
        raise ValueError(f'{number}: unexpected page structure')
    head = spans(m.group(1))
    if len(head) != 4 or head[0] != f'第{cn(number)}籤' or head[1] not in RANKS:
        raise ValueError(f'{number}: header mismatch {head}')
    poem = [l for l in spans(g2.group(1))]
    gloss = spans(g3.group(2))
    if len(poem) != 4 or len(gloss) != 4 or clean(g3.group(1)) != '解曰':
        raise ValueError(f'{number}: poem/gloss line count {len(poem)}/{len(gloss)}')
    return {
        'number': number, 'rankOriginal': head[1], 'rank': RANKS[head[1]], 'personKind': head[2],
        'storyTitleOriginal': head[3], 'originalLanguage': 'zh-Hant',
        'originalPoem': poem, 'originalGloss': gloss,
        'sourceUrl': f'https://www.ctc.org.hk/chim/觀音籤-第{cn(number)}籤/',
    }

def main(pages, out, accessed):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', accessed):
        raise SystemExit('access date must be YYYY-MM-DD')
    records = []
    for n in range(1, 101):
        path = Path(pages) / f'{n}.html'
        if path.stat().st_size > 2_000_000:
            raise SystemExit(f'{n}: page too large')
        records.append({**parse(n, path.read_text(encoding='utf8')), 'accessedAt': accessed,
                        'verification': 'captured_from_publisher_page'})
    counts = {r: sum(1 for x in records if x['rank'] == r) for r in ('upper', 'middle', 'lower')}
    data = {**EDITION, 'recordCount': len(records), 'rankCounts': counts,
            'reuseNote': 'Redistribution permission NOT confirmed. Only poem and short traditional gloss captured; '
                         'modern commentary on the pages is not copied.', 'records': records}
    Path(out).write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
    print(len(records), counts)

if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])

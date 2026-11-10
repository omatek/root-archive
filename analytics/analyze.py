"""Validated descriptive summaries and standalone SVG. No classifier claims."""
import argparse
import json
import math
from collections import Counter, defaultdict
from html import escape
from pathlib import Path
from statistics import mean

from events import load


def summarize(events):
    codes = Counter(str(e['status']) for e in events)
    labels = Counter(e['simulation_label'] for e in events)
    per_minute = Counter(e['timestamp'][:16] + 'Z' for e in events)
    groups = defaultdict(list)
    for event in events:
        groups[event['classification']].append(event['duration_ms'])
    durations = sorted(e['duration_ms'] for e in events)
    return {
        'provenance': 'synthetic', 'records': len(events), 'invalid_records': 0,
        'status_counts': dict(sorted(codes.items())), 'scenario_counts': dict(sorted(labels.items())),
        'classification_counts': dict(sorted(Counter(e['classification'] for e in events).items())),
        'auth_counts': dict(sorted(Counter(e['auth'] for e in events).items())),
        'file_validation_counts': dict(sorted(Counter(e['file_validation'] for e in events).items())),
        'requests_per_minute': dict(sorted(per_minute.items())),
        'peak_requests_per_minute': max(per_minute.values()),
        'mean_duration_by_class_ms': {k: round(mean(v), 3) for k, v in sorted(groups.items())},
        'p95_duration_ms': durations[math.ceil(len(durations) * 0.95) - 1],
        'limitations': 'Generated scenario relationships and class mix; no measured production behavior or detection accuracy.',
    }


def chart(counts, title):
    width, row, height = 780, 30, 75 + len(counts) * 30
    pieces = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" role="img">',
              f'<title>{escape(title)}</title>', '<rect width="100%" height="100%" fill="white"/>',
              f'<text x="15" y="25" font-family="sans-serif" font-size="17">{escape(title)}</text>']
    scale = 400 / max(counts.values(), default=1)
    for i, (label, value) in enumerate(counts.items()):
        y = 45 + i * row
        pieces += [f'<text x="15" y="{y + 16}" font-family="sans-serif" font-size="13">{escape(str(label))}</text>',
                   f'<rect x="240" y="{y}" width="{value * scale:.2f}" height="22" fill="#176b87"/>',
                   f'<text x="{245 + value * scale:.2f}" y="{y + 16}" font-family="sans-serif" font-size="13">{value}</text>']
    return '\n'.join(pieces + ['</svg>'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset')
    parser.add_argument('--output', default='analytics/output/report')
    args = parser.parse_args()
    try:
        summary = summarize(load(args.dataset))
    except (ValueError, OSError) as error:
        parser.error(str(error))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'summary.json').write_text(json.dumps(summary, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    for key, title in [('status_counts', 'Synthetic HTTP status distribution'),
                       ('scenario_counts', 'Synthetic scenario distribution'),
                       ('requests_per_minute', 'Synthetic requests per minute')]:
        (output / f'{key}.svg').write_text(chart(summary[key], title), encoding='utf-8')
    print(json.dumps({'records': summary['records'], 'provenance': summary['provenance']}))

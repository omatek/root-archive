"""Deterministic scenario-based synthetic data; never sends requests."""
import argparse
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from events import validate

# status, auth, authorization, Turnstile, file validation, size, classification
PROFILES = {
    'normal': (201, 'verified', 'allowed', 'passed', 'passed', 'medium', 'normal'),
    'missing_auth': (401, 'missing', 'not_checked', 'not_checked', 'not_checked', 'small', 'suspicious'),
    'invalid_token': (401, 'invalid', 'not_checked', 'not_checked', 'not_checked', 'small', 'suspicious'),
    'unauthorized_domain': (403, 'verified', 'rejected', 'not_checked', 'not_checked', 'small', 'suspicious'),
    'turnstile_rejected': (403, 'verified', 'allowed', 'failed', 'passed', 'medium', 'suspicious'),
    'malformed_multipart': (415, 'verified', 'allowed', 'not_checked', 'not_checked', 'small', 'suspicious'),
    'invalid_metadata': (400, 'verified', 'allowed', 'not_checked', 'not_checked', 'small', 'suspicious'),
    'unsupported_file': (400, 'verified', 'allowed', 'not_checked', 'failed', 'medium', 'suspicious'),
    'oversized_upload': (413, 'verified', 'allowed', 'not_checked', 'oversized', 'oversized', 'suspicious'),
    # Duplicate IDs are catalog-policy scenarios, not an existing Worker endpoint.
    'duplicate_id': (400, 'verified', 'allowed', 'not_checked', 'not_checked', 'small', 'suspicious'),
    'suspicious_input': (400, 'verified', 'allowed', 'not_checked', 'not_checked', 'small', 'suspicious'),
    'request_burst': (201, 'verified', 'allowed', 'passed', 'passed', 'medium', 'suspicious'),
    'dependency_failure': (503, 'verified', 'allowed', 'passed', 'passed', 'medium', 'dependency_failure'),
}


def generate(count=200, seed=42, normal_ratio=0.7, scenario_weights=None):
    if not 1 <= count <= 1_000_000:
        raise ValueError('count must be between 1 and 1000000')
    if not math.isfinite(normal_ratio) or not 0 <= normal_ratio <= 1:
        raise ValueError('normal_ratio must be between 0 and 1')
    weights = scenario_weights if scenario_weights is not None else {
        label: 1 for label in PROFILES if label != 'normal'}
    if not isinstance(weights, dict) or not weights or any(
        key == 'normal' or key not in PROFILES or type(value) not in (int, float)
        or not math.isfinite(value) or value < 0 for key, value in weights.items()
    ) or not math.isfinite(sum(weights.values())) or sum(weights.values()) <= 0:
        raise ValueError('scenario_weights must contain known non-normal labels and finite nonnegative weights')
    rng = random.Random(seed)
    normal_count = round(count * normal_ratio)
    labels = ['normal'] * normal_count + rng.choices(
        list(weights), weights=list(weights.values()), k=count - normal_count)
    rng.shuffle(labels)
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    events = []
    for i, label in enumerate(labels):
        status, auth, authz, turnstile, file_check, size, classification = PROFILES[label]
        route = 'submit'
        if label in ('normal', 'missing_auth', 'invalid_token', 'unauthorized_domain') and rng.random() < 0.25:
            route, turnstile, file_check, size = 'auth_verify', 'not_checked', 'not_checked', 'none'
            if label == 'normal':
                status = 200
        # Normal sequence spans time; burst records cluster within one minute.
        elapsed = (i % 30) * 0.1 if label == 'request_burst' else i * 10
        duration = (15000 + rng.uniform(0, 1000) if label == 'dependency_failure'
                    else rng.uniform(5, 50) if status >= 400
                    else rng.lognormvariate(5.8 if route == 'submit' else 3.8, 0.4))
        event = {
            'schema_version': 1, 'event_id': f'synthetic-{i:08d}',
            'timestamp': (base + timedelta(seconds=elapsed)).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'route': route, 'method': 'POST', 'status': status, 'request_size': size,
            'duration_ms': round(duration, 3), 'auth': auth, 'authorization': authz,
            'turnstile': turnstile, 'file_validation': file_check, 'classification': classification,
            'source_environment': 'offline_simulation', 'provenance': 'synthetic', 'simulation_label': label,
        }
        events.append(validate(event))
    return sorted(events, key=lambda e: (e['timestamp'], e['event_id']))


def write(events, output):
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(e, sort_keys=True, allow_nan=False) + '\n' for e in events), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count', type=int, default=200)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--normal-ratio', type=float, default=0.7)
    parser.add_argument('--scenario-weights', type=json.loads, help='JSON mapping of non-normal label to weight')
    parser.add_argument('--output', default='analytics/output/events.jsonl')
    args = parser.parse_args()
    try:
        write(generate(args.count, args.seed, args.normal_ratio, args.scenario_weights), args.output)
    except ValueError as error:
        parser.error(str(error))

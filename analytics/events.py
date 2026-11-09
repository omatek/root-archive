"""Offline schema validation. No production ingestion or network operations."""
import json
import math
import re
from datetime import datetime
from pathlib import Path

SCHEMA = json.loads(Path(__file__).with_name('schema.json').read_text())


def validate(event):
    """Validate this fixed flat schema, not arbitrary JSON Schema documents."""
    if not isinstance(event, dict) or set(event) != set(SCHEMA['required']):
        raise ValueError('missing or unknown fields')
    for key, rule in SCHEMA['properties'].items():
        value = event[key]
        kind = rule['type']
        valid_type = ((kind == 'string' and isinstance(value, str))
                      or (kind == 'integer' and type(value) is int)
                      or (kind == 'number' and type(value) in (int, float)
                          and math.isfinite(value)))
        if not valid_type:
            raise ValueError(f'{key}: invalid type')
        if 'const' in rule and value != rule['const']:
            raise ValueError(f'{key}: invalid constant')
        if 'enum' in rule and value not in rule['enum']:
            raise ValueError(f'{key}: invalid enumeration')
        if 'pattern' in rule and re.fullmatch(rule['pattern'], value) is None:
            raise ValueError(f'{key}: invalid pattern')
        if 'minimum' in rule and not rule['minimum'] <= value <= rule['maximum']:
            raise ValueError(f'{key}: out of range')
    if re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', event['timestamp']) is None:
        raise ValueError('timestamp: expected UTC milliseconds')
    try:
        datetime.fromisoformat(event['timestamp'].replace('Z', '+00:00'))
    except ValueError as error:
        raise ValueError('timestamp: invalid date') from error
    if event['auth'] != 'verified' and event['authorization'] != 'not_checked':
        raise ValueError('authorization requires verified authentication')
    if event['authorization'] != 'allowed' and any(
        event[k] != 'not_checked' for k in ('turnstile', 'file_validation')
    ):
        raise ValueError('submission validation requires authorization')
    if event['route'] == 'auth_verify' and any(
        event[k] != 'not_checked' for k in ('turnstile', 'file_validation')
    ):
        raise ValueError('auth_verify cannot validate uploads')
    if event['status'] in (200, 201) and (
        event['auth'] != 'verified' or event['authorization'] != 'allowed'
    ):
        raise ValueError('success requires an authorized identity')
    return event


def load(path):
    events, seen = [], set()
    with Path(path).open(encoding='utf-8') as source:
        for line_number, line in enumerate(source, 1):
            try:
                event = validate(json.loads(line))
                if event['event_id'] in seen:
                    raise ValueError('duplicate event_id')
                seen.add(event['event_id'])
                events.append(event)
            except (ValueError, TypeError) as error:
                raise ValueError(f'line {line_number}: {error}') from error
    if not events:
        raise ValueError('empty dataset')
    return events

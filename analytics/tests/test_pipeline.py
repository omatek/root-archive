import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from events import load, validate
from generate import PROFILES, generate, write
from analyze import chart, summarize


class PipelineTests(unittest.TestCase):
    def test_reproducible_and_configurable(self):
        self.assertEqual(generate(seed=19), generate(seed=19))
        self.assertNotEqual(generate(seed=19), generate(seed=20))
        data = generate(count=100, normal_ratio=0.8)
        self.assertEqual(sum(e['simulation_label'] == 'normal' for e in data), 80)
        self.assertEqual(len({e['event_id'] for e in data}), 100)
        self.assertTrue(all(validate(e) for e in data))
        self.assertTrue(all(e['provenance'] == 'synthetic' for e in data))

    def test_every_scenario_and_stage_order(self):
        for label, profile in PROFILES.items():
            data = (generate(count=30, normal_ratio=1) if label == 'normal' else
                    generate(count=30, normal_ratio=0, scenario_weights={label: 1}))
            for event in data:
                self.assertEqual(event['simulation_label'], label)
                self.assertEqual(event['classification'], profile[-1])
                validate(event)
        burst = generate(count=30, normal_ratio=0, scenario_weights={'request_burst': 1})
        self.assertEqual(summarize(burst)['peak_requests_per_minute'], 30)

    def test_reject_invalid_parameters(self):
        for kwargs in [{'count': 0}, {'count': 1000001}, {'normal_ratio': -0.1},
                       {'normal_ratio': math.nan}, {'scenario_weights': {}},
                       {'scenario_weights': {'unknown': 1}}, {'scenario_weights': {'normal': 1}},
                       {'scenario_weights': {'missing_auth': -1}},
                       {'scenario_weights': {'missing_auth': 0}},
                       {'scenario_weights': {'missing_auth': True}}]:
            with self.assertRaises(ValueError):
                generate(**kwargs)

    def test_fail_closed_schema_and_privacy(self):
        event = generate(1, normal_ratio=1)[0]
        for patch in [{'duration_ms': math.nan}, {'duration_ms': -1}, {'status': True},
                      {'email': 'forbidden'}, {'provenance': 'production'},
                      {'timestamp': '2026-02-30T00:00:00.000Z'}, {'auth': 'missing'},
                      {'simulation_label': 'unknown'}, {'event_id': 'real-user-id'},
                      {'schema_version': 2}]:
            with self.assertRaises(ValueError):
                validate({**event, **patch})
        del event['duration_ms']
        with self.assertRaises(ValueError):
            validate(event)

    def test_preprocessing_and_summary(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'events.jsonl'
            data = generate(count=50)
            write(data, path)
            self.assertEqual(load(path), data)
            summary = summarize(load(path))
            self.assertEqual(summary['records'], 50)
            self.assertEqual(sum(summary['status_counts'].values()), 50)
            self.assertEqual(sum(summary['requests_per_minute'].values()), 50)
            self.assertIn('&lt;', chart({'<synthetic>': 2}, '<title>'))
            for content in ['', '{}\n', 'bad JSON\n', json.dumps(data[0]) + '\n' + json.dumps(data[0]) + '\n']:
                path.write_text(content)
                with self.assertRaises(ValueError):
                    load(path)


if __name__ == '__main__':
    unittest.main()

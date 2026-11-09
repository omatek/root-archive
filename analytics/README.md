# Security Analytics: offline synthetic foundation

No production telemetry, student records, uploaded files, credentials, IPs, or
network requests are used. This dataset is generated, not observed traffic.
All work runs with the Python 3.11+ standard library.

```sh
python3 analytics/generate.py --seed 42 --count 200 --normal-ratio 0.7 --output analytics/output/events.jsonl
python3 analytics/analyze.py analytics/output/events.jsonl --output analytics/output/report
python3 -m unittest discover -s analytics/tests -v
```

The analyzer writes `summary.json` and standalone SVG plots for HTTP status,
scenario distribution, and requests per minute. Generated files are ignored.
Use the same commands, Python version, and parameters to reproduce a run.
The `reproduce` test compares records for identical seeds; tests exercise every
scenario, invalid parameters, schema rejection, duplicate IDs, and summaries.

## Data dictionary and provenance

`schema.json` is the versioned JSON Schema and field dictionary. `events.py`
validates this fixed flat schema with no package dependencies, then enforces
authorization/validation stage ordering. It is not a general JSON Schema engine.
Unknown fields and non-synthetic provenance are rejected. `event_id` is a
generated event ordinal, not an identifier for a person or session.

| Fields | Meaning / origin |
| --- | --- |
| `schema_version`, `source_environment`, `provenance` | Constants: 1, offline_simulation, synthetic |
| `event_id`, `timestamp` | Generated ID and UTC time; fixed start 2026-01-01 |
| `route`, `method`, `status`, `request_size` | Scenario-derived categories; sizes contain no file data |
| `duration_ms` | Generated timing, not latency measured from a Worker |
| `auth`, `authorization`, `turnstile`, `file_validation` | Scenario-derived pipeline stages; not real token verdicts |
| `classification`, `simulation_label` | Generated ground truth; never usable as detection features |

Request sizes mean: none = authorization-only request; small = illustrative
metadata or early rejection; medium = illustrative allowed-size file; oversized
= exceeds the 25 MiB multipart-body ceiling. They are categories, not measured
byte counts. HTTP outcomes model current code except where explicitly marked
as planned scenarios.

## Generation and controlled scenarios

Normal events are successful submissions or authorization checks. Missing or
invalid authentication stops later stages. Domain rejection precedes file and
Turnstile validation. File validation precedes Turnstile, matching current code.
Dependencies fail after validated uploads in the dependency-failure profile.
Normal durations use a lognormal distribution; early failures are shorter;
dependency failures approximate a timeout. These are assumptions, not fitted
distributions. Normal activity spans ten-second intervals. Burst records cluster
within a single minute without sending any traffic.

`--normal-ratio` controls the exact rounded normal count. The remainder is
sampled by configurable non-normal weights, for example:

```sh
python3 analytics/generate.py --seed 7 --count 100 --normal-ratio 0.5 --scenario-weights '{"missing_auth":2,"oversized_upload":1}'
```

Scenarios: missing authentication; invalid/expired mock-token category; wrong
domain; failed Turnstile; malformed content type; invalid metadata; unsupported
file; oversized upload; duplicate ID; suspicious input; bounded synthetic burst;
and upstream failure. No token strings or attack payloads are generated. The
duplicate-ID case models future catalog-policy validation, not an existing
Worker duplicate check. Suspicious-input labels describe generated invalid
metadata, not a claim that the application detects arbitrary malicious text.
The malformed profile models HTTP 415 for a wrong multipart content type;
malformed multipart parsing can separately return 400 in the application.

This is a dataset simulation, not executed mock attacks. Existing Worker tests
exercise only HTTP rejection boundaries. Actual signed-token, Turnstile, R2,
GitHub-failure and storage-cleanup experiments remain backlog work and require
local mocks/workerd. Staging tests need owner approval and test-only accounts.
Never target external systems, production, or real sessions.

## Preprocessing and analysis

Loading rejects missing/extra fields, invalid types, nonfinite durations, unknown
enums, bad dates, and duplicate event IDs. It fails with a line number instead
of silently imputing or deleting invalid records. Valid records retain UTC
times and are aggregated by minute. Summaries compare classes, statuses, auth
outcomes, file-validation outcomes, mean durations, p95, and peak frequency.
Classification is not implemented. There are no precision/recall/F1 claims.

Next experiment: define observable-feature rules without labels/provenance,
reserve separate seeds and distributions for evaluation, and compare precision,
recall, F1, confusion matrices, and false-positive rates. Label-derived fields
must not be inputs. Rules evaluated only on their design generator are subject
to circular evaluation, even with a held-out seed.

## Future telemetry boundary

Worker status, route, duration, auth/file-validation outcome, storage/moderation
results and dependency failures could become observed attributes. Current code
does not emit this schema. Cloudflare observability is configured, but live
logging contents, access, sampling and retention have not been inspected.

Before real collection: review existing Cloudflare logging first, obtain owner
and applicable privacy/ethics approval, agree a retention period and restricted
access, exclude tokens/emails/headers/content/raw IPs, and ensure logging failure
cannot block submissions. Use a separate private sink, never public resource
R2. Do not mix simulated ground truth into real records. University ethics/IP
and legal obligations require human review; coursework does not resolve them.

## Coursework report outline

1. Research question and observable data sources.
2. Schema/dictionary and provenance.
3. Synthetic scenario assumptions and exact reproduction command/version.
4. Validation/preprocessing and excluded records.
5. Descriptive plots and findings supported by saved outputs.
6. Controlled experiment method and optional detection evaluation.
7. Privacy, limitations, threats to validity and future work.

For each finding record: question, seed/configuration, input hash, command,
measured output, interpretation, and limitation. Do not fill findings with
invented numbers. Supply assignment requirements and rubric before finalizing
the coursework report. Synthetic class mix and stage rules are deliberately
constructed; neither class prevalence nor real-world detection follows from them.

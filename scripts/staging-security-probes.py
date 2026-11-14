"""Read-only hosted staging probes. No real credentials or login sessions are used.

Run from the repository root: python3 scripts/staging-security-probes.py
Evidence excludes cookies, assertions, redirect queries and protected response bodies.
"""
import base64
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import ssl
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
ADMIN = "https://admin.archive.rootamman.com"
API = "https://api-staging.rootamman.com"
WORKER = "root-archive-moderation-staging.omar-khldooon33.workers.dev"
# The only enumerated deployed version, using Wrangler's eight-character prefix.
VERSION = "bb9e96b3-" + WORKER
SUBMISSION = "726f6f74-6172-4368-8000-000000000001"
REVISION = "726f6f74-6172-4368-9000-000000000001"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(
    NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context())
)


def probe(case):
    host, path, method, mode = case
    headers = {"User-Agent": "root-archive-authorized-staging-acceptance/1.0"}
    if mode == "forged-assertion":
        # Deliberately invalid signature, generated in memory and never retained.
        encode = lambda v: base64.urlsafe_b64encode(json.dumps(v).encode()).rstrip(b"=").decode()
        now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
        headers["Cf-Access-Jwt-Assertion"] = ".".join([
            encode({"alg": "RS256", "typ": "JWT"}),
            encode({"iss": "https://rootamman.cloudflareaccess.com", "aud": [
                "0003d8d8ba905005bfed05fc441631de07c91985c3e2baab528bdb4bbb7ac5be"
            ], "iat": now, "exp": now + 60, "sub": "synthetic-probe", "email": "synthetic@example.invalid"}),
            "c3ludGhldGljLWludmFsaWQtc2lnbmF0dXJl",
        ])
    if mode == "browser-preflight":
        headers.update({"Origin": ADMIN, "Access-Control-Request-Method": "POST",
                        "Access-Control-Request-Headers": "content-type,x-requested-with"})
    result = dict(host=host, path=path, method=method, mode=mode)
    try:
        try:
            response = OPENER.open(urllib.request.Request(
                host + path, method=method, headers=headers), timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            result["status"] = response.status
            result["headers"] = {k: response.headers[k] for k in [
                "Content-Type", "Cache-Control", "CF-Cache-Status", "CF-Ray", "Server"
            ] if k in response.headers}
            location = response.headers.get("Location")
            if location:
                parsed = urllib.parse.urlsplit(location)
                result["redirect"] = dict(origin=f"{parsed.scheme}://{parsed.netloc}", path=parsed.path)
            try:
                cert = response.fp.raw._sock.getpeercert()
                result["presented_tls_certificate"] = {
                    k: cert.get(k) for k in ["subject", "issuer", "subjectAltName", "notBefore", "notAfter"]
                }
            except (AttributeError, OSError):
                result["presented_tls_certificate"] = "not accessible through client response"
            body = response.read(1024 * 1024)
            result["body_bytes"] = len(body)
            result["body_sha256"] = hashlib.sha256(body).hexdigest()
            result["worker_404"] = body == b'{"success":false,"error":"Endpoint not found."}'
            if host == API and path == "/resources" and response.status == 200:
                catalog = json.loads(body)
                result["catalog_count"] = len(catalog.get("resources", []))
                result["next_cursor_present"] = catalog.get("next_cursor") is not None
    except Exception as error:
        result["transport_error"] = str(error)[:350]
    return result


def main():
    assets = ["/" + str(p.relative_to(ROOT / "admin"))
              for p in sorted((ROOT / "admin").rglob("*")) if p.is_file()]
    paths = ["/", *assets, "/admin/api/session", "/admin/api/submissions",
             f"/admin/api/submissions/{SUBMISSION}/files/{REVISION}", "/unknown-security-probe"]
    cases = [(host, path, method, "anonymous") for host in [ADMIN, API]
             for path in paths for method in ["GET", "HEAD"]]
    cases += [(host, "/admin/api/session", "GET", "forged-assertion") for host in [ADMIN, API]]
    cases += [(host, "/admin/api/session", "OPTIONS", "browser-preflight") for host in [ADMIN, API]]
    cases += [(API, "/resources", "GET", "anonymous")]
    cases += [(API, f"/download/{SUBMISSION}", method, "anonymous") for method in ["GET", "HEAD"]]
    # An exact version URL probe does not create or enable a preview.
    cases += [("https://" + host, path, method, "anonymous") for host in [WORKER, VERSION]
              for path in ["/", "/js/admin.mjs", "/admin/api/session"] for method in ["GET", "HEAD"]]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(probe, cases))
    certificates = {}
    for result in results:
        certificate = result.pop("presented_tls_certificate", None)
        if isinstance(certificate, dict):
            certificates[result["host"]] = certificate
    evidence = {
        "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "kind": "actual hosted read-only HTTP requests; TLS verification enabled; redirects disabled",
        "deployed_version": "bb9e96b3-e789-47b0-aa92-16168fe80db4",
        "credentials": "No real cookies, PINs, JWTs or API credentials used",
        "version_host_basis": "sole enumerated version ID and installed Wrangler 4.156.0 eight-character prefix rule",
        "presented_tls_certificates": certificates,
        "results": results,
        "limitations": [
            "Gateway redirects do not exercise independent Worker JWT rejection branches.",
            "TLS interception exposes the managed proxy certificate, not the origin edge certificate.",
            "Proxy CONNECT denial is not evidence that the deployed alternate host is disabled.",
        ],
    }
    destination = ROOT / "docs/staging-security-resume-http.json"
    destination.write_text(json.dumps(evidence, indent=2) + "\n")
    from collections import Counter
    print(json.dumps({"requests": len(results), "statuses": dict(Counter(
        str(r.get("status", "transport-error")) for r in results)), "evidence": str(destination)}))


if __name__ == "__main__":
    main()

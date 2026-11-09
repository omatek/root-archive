"""Bounded loopback-only latency probe. Never targets production."""
import argparse
import ipaddress
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def local_url(value):
    url = urllib.parse.urlsplit(value)
    try:
        is_local = url.hostname == 'localhost' or ipaddress.ip_address(url.hostname).is_loopback
    except ValueError:
        is_local = False
    if (url.scheme not in ('http', 'https') or not is_local or url.username or url.password
            or url.query or url.fragment or url.port == 0):
        raise ValueError('only loopback HTTP(S) URLs without credentials, query, or fragment are allowed')
    return value


class LocalRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        local_url(newurl)
        # Record local redirects as 3xx without issuing extra requests per sample.
        return None


def probe(url, method='GET', origin=None, timeout=2):
    local_url(url)
    if method not in ('GET', 'POST', 'OPTIONS'):
        raise ValueError('unsupported method')
    if origin:
        local_url(origin)
    if not math.isfinite(timeout) or not 0 < timeout <= 10:
        raise ValueError('timeout must be > 0 and <= 10 seconds')
    # Loopback requests must stay local, even when an outbound proxy is configured.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), LocalRedirect())
    request = urllib.request.Request(url, method=method, headers={'Origin': origin} if origin else {})
    start = time.perf_counter()
    try:
        try:
            response = opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read(1024 * 1024 + 1)
            result = {'status': response.code, 'bytes_read': min(len(content), 1024 * 1024),
                      'truncated': len(content) > 1024 * 1024, 'error': None}
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        result = {'status': None, 'bytes_read': 0, 'truncated': False, 'error': type(error).__name__}
    result['duration_ms'] = round((time.perf_counter() - start) * 1000, 3)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', type=local_url)
    parser.add_argument('--method', choices=['GET', 'POST', 'OPTIONS'], default='GET')
    parser.add_argument('--origin', type=local_url)
    parser.add_argument('--count', type=int, default=5)
    parser.add_argument('--interval', type=float, default=0.2)
    parser.add_argument('--output', default='work/latency.json')
    args = parser.parse_args()
    if not 1 <= args.count <= 20 or not math.isfinite(args.interval) or not 0.2 <= args.interval <= 5:
        parser.error('count must be 1..20 and interval 0.2..5 seconds')
    results = []
    try:
        for i in range(args.count):
            if i:
                time.sleep(args.interval)
            results.append(probe(args.url, args.method, args.origin))
    except ValueError as error:
        parser.error(str(error))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'environment': 'local', 'url': args.url,
                                 'method': args.method, 'results': results}, indent=2) + '\n')
    print(f'{len(results)} local samples written to {output}')

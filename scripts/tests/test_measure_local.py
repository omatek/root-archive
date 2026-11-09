import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from measure_local import local_url, probe


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ('/redirect', '/local-redirect'):
            self.send_response(302)
            self.send_header('Location', 'https://example.invalid/' if self.path == '/redirect' else '/')
        else:
            self.send_response(503 if self.path == '/error' else 200)
        self.end_headers()
        self.wfile.write(b'local fixture')

    def log_message(self, *args):
        pass


class ProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_success_and_failure_statuses(self):
        self.assertEqual(probe(self.url)['status'], 200)
        result = probe(self.url + '/error')
        self.assertEqual(result['status'], 503)
        self.assertGreaterEqual(result['duration_ms'], 0)
        self.assertEqual(result['bytes_read'], len(b'local fixture'))

    def test_public_private_and_credential_urls_are_rejected(self):
        for value in ['https://example.invalid/', 'http://10.0.0.1/', 'file:///etc/passwd',
                      'http://127.0.0.1.attacker.invalid/', 'http://user:pass@localhost/',
                      'http://localhost/?token=secret', 'http://localhost/#secret']:
            with self.assertRaises(ValueError):
                local_url(value)
        self.assertEqual(local_url('http://[::1]:8000/'), 'http://[::1]:8000/')

    def test_redirect_cannot_escape_loopback(self):
        with self.assertRaises(ValueError):
            probe(self.url + '/redirect')
        self.assertEqual(probe(self.url + '/local-redirect')['status'], 302)


if __name__ == '__main__':
    unittest.main()

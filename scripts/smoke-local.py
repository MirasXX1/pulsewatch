#!/usr/bin/env python3
"""Check running UI, proxy, favicon, assets, real monitoring/history and cleanup.
Only monitors created by this script are deleted. No browser or fabricated production data.
"""
import json
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

UI = 'http://127.0.0.1:3000'
BASE = UI + '/api/sites'
DIRECT = 'http://127.0.0.1:8080/api/sites'
REPORT = Path(__file__).resolve().parent.parent / '.local/verification/smoke.json'
report = {'startedAt': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'passed': [], 'failures': []}
created_ids = set()


def request(url, method='GET', body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(url, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        response = urlopen(req, timeout=20)
    except HTTPError as error:
        response = error
    except (URLError, TimeoutError, OSError) as error:
        raise RuntimeError(f'Cannot reach {url}: {error}') from error
    with response:
        raw = response.read()
        headers = dict(response.headers.items())
        result = json.loads(raw) if raw and 'application/json' in response.headers.get('Content-Type', '') else raw
        return response.code, result, headers


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def passed(message):
    report['passed'].append(message)
    print('PASS:', message, flush=True)


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons, self.assets = [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link' and attrs.get('rel') == 'icon':
            self.icons.append(attrs.get('href'))
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.assets.append((attrs.get('href'), 'text/css'))
        if tag == 'script' and attrs.get('src'):
            self.assets.append((attrs['src'], 'javascript'))


def wait_history(monitor_id, previous_count, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        status, detail, _ = request(f'{BASE}/{monitor_id}')
        require(status == 200, 'Cannot read monitor details through the frontend proxy')
        if detail['totalChecks'] > previous_count:
            status, checks, _ = request(f'{BASE}/{monitor_id}/checks')
            require(status == 200 and checks, 'Check count increased without accessible saved history')
            return detail, checks
        time.sleep(1)
    raise RuntimeError(f'No new saved check within {seconds} seconds')


try:
    status, html, _ = request(UI)
    require(status == 200, 'Frontend did not return HTTP 200')
    page = PageAssets()
    page.feed(html.decode())
    require(len(page.icons) == 1 and page.icons[0].startswith('/icon.svg'), 'Missing or conflicting PulseWatch favicon links')
    status, image, headers = request(urljoin(UI, page.icons[0]))
    require(status == 200 and 'image/svg+xml' in headers.get('Content-Type', ''), 'Favicon URL did not return SVG')
    svg = ET.fromstring(image)
    require(any(element.get('fill') == '#132C26' for element in svg.iter()), 'Favicon dark background is missing')
    require(any(element.get('stroke') == '#7EE3AD' for element in svg.iter()), 'Favicon green pulse is missing')
    require(bool(page.assets), 'No frontend scripts/styles found in HTML')
    for asset, expected_type in page.assets:
        status, _, headers = request(urljoin(UI, asset))
        require(status == 200 and expected_type in headers.get('Content-Type', ''), f'Broken frontend asset: {asset}')
    passed(f'Frontend HTML, one PulseWatch SVG favicon, {len(page.assets)} live JS/CSS assets')

    status, direct_sites, _ = request(DIRECT)
    require(status == 200 and isinstance(direct_sites, list), 'Direct backend API is unavailable')
    status, sites, _ = request(BASE)
    require(status == 200 and isinstance(sites, list), 'Frontend API proxy is unavailable')
    passed('Direct backend and frontend /api proxy both return monitor lists')

    for unsafe in ['http://127.0.0.1', 'http://[::1]', 'http://169.254.169.254', 'http://192.168.1.1', 'file:///etc/passwd']:
        status, result, _ = request(BASE, 'POST', {'name': 'PulseWatch rejected-target test', 'url': unsafe})
        if status == 201 and isinstance(result, dict):
            created_ids.add(result['id'])
        require(status == 400, f'API did not reject unsafe URL: {unsafe}')
    passed('Loopback IPv4/IPv6, metadata, private IP and unsupported scheme are rejected')

    status, created, _ = request(BASE, 'POST', {'name': 'PulseWatch smoke check', 'url': 'https://example.com'})
    require(status == 201 and isinstance(created, dict), 'Cannot create monitor')
    monitor_id = created['id']
    created_ids.add(monitor_id)
    detail, checks = wait_history(monitor_id, 0, 35)
    result = checks[0]
    require(result['status'] in ('UP', 'DOWN'), 'Unexpected saved status')
    require(result['durationMs'] >= 0 and bool(result['checkedAt']), 'Missing check timing')
    require('httpCode' in result and 'error' in result, 'Missing HTTP/error fields')
    expected_rate = detail['successfulChecks'] / detail['totalChecks'] * 100
    require(abs(detail['successRate'] - expected_rate) < 0.0001, 'Incorrect share of successful saved checks')
    status, _, _ = request(f'{UI}/sites/{monitor_id}')
    require(status == 200, 'Monitor detail page is unavailable')
    passed(f'Creation, automatic initial check, saved history, success share and detail page (real result: {result["status"]})')

    previous = detail['totalChecks']
    status, _, _ = request(f'{BASE}/{monitor_id}/check', 'POST')
    require(status in (202, 409), 'Manual check was not accepted or marked already running')
    detail, _ = wait_history(monitor_id, previous, 35)
    passed('Manual check finishes and saves a new result')

    print('Waiting for the independent 60-second scheduler (up to 90 seconds)…', flush=True)
    detail, _ = wait_history(monitor_id, detail['totalChecks'], 90)
    passed('Recurring scheduler saves another check without a button press')
    report['status'] = 'passed'
except Exception as error:
    report['status'] = 'failed'
    report['failures'].append(str(error))
    print('FAIL:', error, file=sys.stderr, flush=True)
finally:
    for monitor_id in created_ids:
        try:
            status, _, _ = request(f'{BASE}/{monitor_id}', 'DELETE')
            require(status == 204, f'Could not delete temporary monitor {monitor_id}')
            status, _, _ = request(f'{BASE}/{monitor_id}')
            require(status == 404, f'Deleted temporary monitor {monitor_id} remains accessible')
            status, _, _ = request(f'{BASE}/{monitor_id}/checks')
            require(status == 404, f'Deleted monitor {monitor_id} history remains accessible')
            passed(f'Temporary monitor {monitor_id} deleted; other monitors untouched')
        except Exception as error:
            report['status'] = 'failed'
            report['failures'].append(str(error))
            print('FAIL:', error, file=sys.stderr, flush=True)
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print('Report:', REPORT, flush=True)

sys.exit(0 if report['status'] == 'passed' else 1)

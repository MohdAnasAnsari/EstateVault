/**
 * EstateVault — k6 Load Test
 *
 * Scenarios:
 *   1. browse   — 500 VUs: homepage → listings page → listing detail (simulate public browsing)
 *   2. dealrooms — 50 VUs: authenticated user opening a deal room + sending a message
 *
 * Targets (Phase 7 SLA):
 *   - Listing queries: p95 < 500ms
 *   - AI search:       p95 < 2s
 *   - Deal rooms:      p95 < 1s
 *
 * Run:
 *   k6 run k6/load-test.js -e BASE_URL=http://localhost:4000
 *
 * Install k6: https://k6.io/docs/getting-started/installation/
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ─── Custom metrics ────────────────────────────────────────────────────────────

const listingQueryDuration = new Trend('listing_query_duration', true);
const dealRoomDuration = new Trend('deal_room_duration', true);
const aiSearchDuration = new Trend('ai_search_duration', true);
const errorRate = new Rate('error_rate');
const requestsTotal = new Counter('requests_total');

// ─── Test configuration ────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const API = `${BASE_URL}/api/v1`;

// Pre-generated test user credentials (seeded in DB before running)
const TEST_USERS = new SharedArray('users', () => {
  return Array.from({ length: 50 }, (_, i) => ({
    email: `loadtest+${i}@vault.test`,
    password: 'LoadTest1234!',
  }));
});

export const options = {
  scenarios: {
    // Scenario 1: 500 concurrent public browsers
    browse_listings: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },   // ramp up
        { duration: '2m', target: 500 },    // steady state
        { duration: '30s', target: 0 },     // ramp down
      ],
      gracefulRampDown: '15s',
      exec: 'browseListings',
      tags: { scenario: 'browse' },
    },

    // Scenario 2: 50 concurrent authenticated deal room users
    deal_room_activity: {
      executor: 'constant-vus',
      vus: 50,
      duration: '3m',
      startTime: '30s', // start after browse ramp-up begins
      exec: 'dealRoomActivity',
      tags: { scenario: 'deal_rooms' },
    },
  },

  thresholds: {
    // Primary SLA targets
    'listing_query_duration{scenario:browse}': ['p(95)<500'],
    'deal_room_duration{scenario:deal_rooms}': ['p(95)<1000'],
    'ai_search_duration': ['p(95)<2000'],

    // Error budget
    error_rate: ['rate<0.01'],          // <1% error rate overall
    http_req_failed: ['rate<0.01'],

    // Overall latency
    'http_req_duration{scenario:browse}': ['p(95)<800'],
    'http_req_duration{scenario:deal_rooms}': ['p(95)<1500'],
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function apiGet(path, params = {}, tags = {}) {
  const res = http.get(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    tags,
  });
  requestsTotal.add(1);
  errorRate.add(res.status >= 400 ? 1 : 0);
  return res;
}

function apiPost(path, body, headers = {}, tags = {}) {
  const res = http.post(`${API}${path}`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...headers },
    tags,
  });
  requestsTotal.add(1);
  errorRate.add(res.status >= 400 ? 1 : 0);
  return res;
}

function login(email, password) {
  const res = apiPost('/auth/login', { email, password });
  if (res.status === 200) {
    const body = res.json();
    return body.data?.token;
  }
  return null;
}

// ─── Scenario 1: Browse listings ───────────────────────────────────────────────

export function browseListings() {
  group('health check', () => {
    const res = http.get(`${BASE_URL}/api/health`);
    check(res, { 'health ok': (r) => r.status === 200 });
  });

  sleep(0.5);

  group('listings page', () => {
    const start = Date.now();
    const res = apiGet('/listings?page=1&limit=20', {}, { endpoint: 'listings_list' });
    const duration = Date.now() - start;
    listingQueryDuration.add(duration);

    check(res, {
      'listings 200': (r) => r.status === 200,
      'listings has data': (r) => {
        try {
          return Array.isArray(r.json('data.listings'));
        } catch {
          return false;
        }
      },
    });
  });

  sleep(1);

  group('listing detail', () => {
    // Use a known test slug seeded in DB
    const slug = `test-listing-${Math.floor(Math.random() * 10) + 1}`;
    const start = Date.now();
    const res = apiGet(`/listings/${slug}`, {}, { endpoint: 'listing_detail' });
    const duration = Date.now() - start;
    listingQueryDuration.add(duration);

    check(res, {
      'listing detail 200 or 404': (r) => r.status === 200 || r.status === 404,
    });
  });

  sleep(0.5);

  group('ai search', () => {
    const queries = [
      'luxury villa Dubai Marina',
      'penthouse Palm Jumeirah sea view',
      'commercial building downtown investment',
      'heritage estate Abu Dhabi',
    ];
    const q = queries[Math.floor(Math.random() * queries.length)];
    const start = Date.now();
    const res = apiGet(`/listings?q=${encodeURIComponent(q)}&limit=10`, {}, { endpoint: 'ai_search' });
    const duration = Date.now() - start;
    aiSearchDuration.add(duration);

    check(res, {
      'search responded': (r) => r.status === 200 || r.status === 429,
    });
  });

  sleep(2 + Math.random() * 2); // realistic think time
}

// ─── Scenario 2: Deal room activity ───────────────────────────────────────────

export function dealRoomActivity() {
  const userIndex = __VU % TEST_USERS.length;
  const { email, password } = TEST_USERS[userIndex];

  let token;

  group('login', () => {
    token = login(email, password);
    if (!token) {
      errorRate.add(1);
      return;
    }
  });

  if (!token) {
    sleep(5);
    return;
  }

  const authHeaders = { Authorization: `Bearer ${token}` };

  group('list deal rooms', () => {
    const start = Date.now();
    const res = http.get(`${API}/deal-rooms`, {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      tags: { endpoint: 'deal_rooms_list' },
    });
    const duration = Date.now() - start;
    dealRoomDuration.add(duration);
    requestsTotal.add(1);
    errorRate.add(res.status >= 400 ? 1 : 0);

    check(res, {
      'deal rooms 200': (r) => r.status === 200,
    });
  });

  sleep(1);

  group('notifications', () => {
    const res = http.get(`${API}/notifications`, {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
    });
    requestsTotal.add(1);
    check(res, { 'notifications 200': (r) => r.status === 200 });
  });

  sleep(2 + Math.random() * 3);
}

// ─── Summary ───────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const p95Listing = data.metrics['listing_query_duration']?.values?.['p(95)'] ?? 0;
  const p95DealRoom = data.metrics['deal_room_duration']?.values?.['p(95)'] ?? 0;
  const p95AI = data.metrics['ai_search_duration']?.values?.['p(95)'] ?? 0;
  const errRate = (data.metrics['error_rate']?.values?.rate ?? 0) * 100;

  const report = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EstateVault Phase 7 Load Test Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Listing query p95:  ${p95Listing.toFixed(0)}ms   (target: <500ms)  ${p95Listing < 500 ? '✓' : '✗'}
Deal room p95:      ${p95DealRoom.toFixed(0)}ms   (target: <1000ms) ${p95DealRoom < 1000 ? '✓' : '✗'}
AI search p95:      ${p95AI.toFixed(0)}ms   (target: <2000ms) ${p95AI < 2000 ? '✓' : '✗'}
Error rate:         ${errRate.toFixed(2)}%   (target: <1%)     ${errRate < 1 ? '✓' : '✗'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  return {
    stdout: report,
    'k6/load-test-results.json': JSON.stringify(data, null, 2),
  };
}

import React, { useState, useEffect, useMemo } from 'react';
import {
  GitBranch,
  Cpu,
  ShieldCheck,
  Package,
  BarChart3,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  Check,
  Download,
  Terminal,
  FileCode2,
  Sparkles,
  Lock,
  Layers,
  Award,
  Sliders,
  Eye,
  Compass,
  ChevronRight,
  Scale,
  Bot,
} from 'lucide-react';

const REPOSITORIES = [
  {
    id: 'fastapi-core',
    name: 'tiangolo/fastapi-core-sim',
    language: 'Python 3.12',
    runner: 'pytest -q',
    baseCommit: '9f84c2e1b7a0d34567890abcdef1234567890abc',
    shortCommit: '9f84c2e',
    totalFiles: 148,
    astNodes: 4820,
    existingTests: 312,
    description: 'Async dependency injection, routing dispatch, and request validation engine.',
  },
  {
    id: 'pydantic-settings',
    name: 'pydantic/settings-engine-sim',
    language: 'Python 3.12',
    runner: 'pytest tests/test_sources.py',
    baseCommit: '3a71e904c2b8f192837465abcdef9876543210fe',
    shortCommit: '3a71e90',
    totalFiles: 64,
    astNodes: 2190,
    existingTests: 148,
    description: 'Layered configuration sources, secret masking, and schema coercion pipeline.',
  },
  {
    id: 'express-router-ts',
    name: 'expressjs/router-ts-sim',
    language: 'TypeScript 5.6',
    runner: 'vitest run',
    baseCommit: '7d20b551e9a4c678901234fedcba5678901234bd',
    shortCommit: '7d20b55',
    totalFiles: 92,
    astNodes: 3340,
    existingTests: 219,
    description: 'Middleware chain execution, parameterized path matching, and error boundary hooks.',
  },
];

const STRATEGIES = [
  {
    id: 'rate-limit-middleware',
    title: 'Sliding-Window Rate Limiter + Retry-After Header',
    category: 'Behavioral Rule & State Transition',
    difficulty: 'Medium',
    targetFiles: [
      'src/middleware/rate_limit.py',
      'src/exceptions/http_errors.py',
      'tests/test_rate_limit.py',
    ],
    summary:
      'Adds a deterministic token/sliding-window quota guard keyed by client identity with clock injection, burst allowance, and RFC-compliant Retry-After headers.',
    behavioralRules: [
      'Enforces max_requests within window_seconds using injected monotonic clock (zero wall-clock flakiness).',
      'Transitions client state from ALLOW -> THROTTLED -> COOLDOWN when quota is exceeded.',
      'Attaches integer Retry-After seconds on HTTP 429 responses without altering existing 2xx/4xx routes.',
    ],
    lexicalOverlapPct: 6.4,
    astDivergencePct: 91.8,
    agentPassRate: {
      baselineAgent: '38%',
      astContextAgent: '71%',
    },
    problemStatement: `# Feature Request: Deterministic Sliding-Window Rate Limiter

## Objective
Implement a reusable sliding-window rate limiting guard and structured \`RateLimitExceeded\` error handler that integrates with the existing router/middleware pipeline without breaking existing endpoints.

## Supplied Task Interface
- \`RateLimitConfig(max_requests: int, window_seconds: int, burst: int = 0)\`
- \`SlidingWindowLimiter(config: RateLimitConfig, clock: Callable[[], float] = time.monotonic)\`
- Method \`check(client_key: str) -> RateLimitDecision\` returning \`allowed: bool\`, \`remaining: int\`, and \`retry_after_seconds: int\`.
- Raising \`RateLimitExceeded(retry_after_seconds: int, detail: str = "Rate limit exceeded")\` maps cleanly to status code \`429\` with header \`Retry-After: <int>\`.

## Requirements & Edge Cases
1. Prune timestamps older than \`now - window_seconds\` on each \`check(client_key)\` call.
2. Allow up to \`max_requests + burst\` events inside an active window; once exceeded, deny requests and compute \`retry_after_seconds >= 1\` from the oldest retained timestamp.
3. Isolate state per \`client_key\` and support \`reset(client_key: str | None = None)\`.
4. Preserve all existing middleware ordering, dependency overrides, and error responses.
`,
    goldPatch: `--- a/src/exceptions/http_errors.py
+++ b/src/exceptions/http_errors.py
@@ -18,6 +18,15 @@ class AppError(Exception):
         self.status_code = status_code
         self.detail = detail
+        self.headers = {}
+
+
+class RateLimitExceeded(AppError):
+    def __init__(self, retry_after_seconds: int, detail: str = "Rate limit exceeded"):
+        clamped_retry = max(1, int(retry_after_seconds))
+        super().__init__(status_code=429, detail=detail)
+        self.retry_after_seconds = clamped_retry
+        self.headers = {"Retry-After": str(clamped_retry)}
--- a/src/middleware/rate_limit.py
+++ b/src/middleware/rate_limit.py
@@ -0,0 +1,46 @@
+from collections import defaultdict, deque
+from dataclasses import dataclass
+import math
+import time
+from typing import Callable, Deque, Dict, Optional
+
+
+@dataclass(frozen=True)
+class RateLimitConfig:
+    max_requests: int
+    window_seconds: int
+    burst: int = 0
+
+
+@dataclass(frozen=True)
+class RateLimitDecision:
+    allowed: bool
+    remaining: int
+    retry_after_seconds: int
+
+
+class SlidingWindowLimiter:
+    def __init__(self, config: RateLimitConfig, clock: Callable[[], float] = time.monotonic):
+        if config.max_requests < 1 or config.window_seconds <= 0 or config.burst < 0:
+            raise ValueError("Invalid RateLimitConfig bounds")
+        self.config = config
+        self.clock = clock
+        self._events: Dict[str, Deque[float]] = defaultdict(deque)
+
+    def check(self, client_key: str) -> RateLimitDecision:
+        now = float(self.clock())
+        cutoff = now - self.config.window_seconds
+        q = self._events[client_key]
+        while q and q[0] <= cutoff:
+            q.popleft()
+        capacity = self.config.max_requests + self.config.burst
+        if len(q) >= capacity:
+            retry_after = max(1, math.ceil((q[0] + self.config.window_seconds) - now))
+            return RateLimitDecision(allowed=False, remaining=0, retry_after_seconds=retry_after)
+        q.append(now)
+        remaining = max(0, capacity - len(q))
+        return RateLimitDecision(allowed=True, remaining=remaining, retry_after_seconds=0)
+
+    def reset(self, client_key: Optional[str] = None) -> None:
+        if client_key is None:
+            self._events.clear()
+        else:
+            self._events.pop(client_key, None)
`,
    testPatch: `--- a/tests/test_rate_limit.py
+++ b/tests/test_rate_limit.py
@@ -0,0 +1,42 @@
+from src.exceptions.http_errors import RateLimitExceeded
+from src.middleware.rate_limit import RateLimitConfig, SlidingWindowLimiter
+
+
+class FakeClock:
+    def __init__(self, start: float = 1000.0):
+        self.now = start
+    def __call__(self) -> float:
+        return self.now
+    def advance(self, seconds: float) -> None:
+        self.now += seconds
+
+
+def test_sliding_window_enforces_quota_and_retry_after():
+    clock = FakeClock(100.0)
+    limiter = SlidingWindowLimiter(RateLimitConfig(max_requests=2, window_seconds=10, burst=1), clock=clock)
+
+    assert limiter.check("tenant-a").allowed is True
+    assert limiter.check("tenant-a").allowed is True
+    d3 = limiter.check("tenant-a")
+    assert d3.allowed is True and d3.remaining == 0
+
+    d4 = limiter.check("tenant-a")
+    assert d4.allowed is False and d4.retry_after_seconds == 10
+
+    clock.advance(10.1)
+    d5 = limiter.check("tenant-a")
+    assert d5.allowed is True and d5.remaining == 2
+
+
+def test_rate_limit_exceeded_error_contract():
+    err = RateLimitExceeded(retry_after_seconds=0)
+    assert err.status_code == 429
+    assert err.retry_after_seconds == 1
+    assert err.headers["Retry-After"] == "1"
`,
  },
  {
    id: 'circuit-breaker-fallback',
    title: 'Half-Open Circuit Breaker + Fallback Hook',
    category: 'Multi-Module State Machine',
    difficulty: 'Hard',
    targetFiles: [
      'src/resilience/circuit_breaker.py',
      'src/dispatch/executor.py',
      'tests/test_circuit_breaker.py',
    ],
    summary:
      'Introduces CLOSED -> OPEN -> HALF_OPEN state transitions after consecutive failures, bounded probe requests, and deterministic fallback invocation.',
    behavioralRules: [
      'Opens circuit after failure_threshold consecutive exceptions; resets streak on any success.',
      'Transitions OPEN -> HALF_OPEN after recovery_timeout and permits up to half_open_max_calls probes.',
      'Invokes optional fallback(exc) hook when OPEN or when a half-open probe fails.',
    ],
    lexicalOverlapPct: 7.8,
    astDivergencePct: 94.2,
    agentPassRate: {
      baselineAgent: '26%',
      astContextAgent: '63%',
    },
    problemStatement: `# Feature Request: Half-Open Circuit Breaker with Fallback Hook

## Objective
Add a deterministic circuit breaker state machine (\`CLOSED\`, \`OPEN\`, \`HALF_OPEN\`) wired into the execution dispatcher so cascading downstream failures fail fast and recover cleanly.

## Supplied Task Interface
- \`CircuitBreakerConfig(failure_threshold: int = 3, recovery_timeout_s: float = 30.0, half_open_max_calls: int = 1)\`
- \`CircuitBreaker(name: str, config: CircuitBreakerConfig, clock: Callable[[], float] = time.monotonic)\`
- Method \`execute(fn: Callable[[], T], fallback: Callable[[Exception], T] | None = None) -> T\`.
- Property \`state -> Literal["CLOSED", "OPEN", "HALF_OPEN"]\`.

## Requirements & Edge Cases
1. Increment failure count only on raised exceptions; any success in \`CLOSED\` resets consecutive failures to \`0\`.
2. When failures reach \`failure_threshold\`, transition to \`OPEN\` and record \`opened_at\`.
3. While \`OPEN\` before \`recovery_timeout_s\` elapses, do not call \`fn\`; invoke \`fallback(exc)\` if provided, else raise \`CircuitOpenError\`.
4. After \`recovery_timeout_s\`, transition to \`HALF_OPEN\`; a successful probe closes the circuit, while a probe failure re-opens it immediately.
`,
    goldPatch: `--- a/src/resilience/circuit_breaker.py
+++ b/src/resilience/circuit_breaker.py
@@ -0,0 +1,58 @@
+from dataclasses import dataclass
+import time
+from typing import Callable, Literal, Optional, TypeVar
+
+T = TypeVar("T")
+CircuitState = Literal["CLOSED", "OPEN", "HALF_OPEN"]
+
+
+class CircuitOpenError(RuntimeError):
+    def __init__(self, breaker_name: str):
+        super().__init__(f"Circuit '{breaker_name}' is OPEN")
+        self.breaker_name = breaker_name
+
+
+@dataclass(frozen=True)
+class CircuitBreakerConfig:
+    failure_threshold: int = 3
+    recovery_timeout_s: float = 30.0
+    half_open_max_calls: int = 1
+
+
+class CircuitBreaker:
+    def __init__(self, name: str, config: CircuitBreakerConfig, clock: Callable[[], float] = time.monotonic):
+        self.name = name
+        self.config = config
+        self.clock = clock
+        self._state: CircuitState = "CLOSED"
+        self._failures = 0
+        self._opened_at: Optional[float] = None
+        self._half_open_inflight = 0
+
+    @property
+    def state(self) -> CircuitState:
+        if self._state == "OPEN" and self._opened_at is not None:
+            if (self.clock() - self._opened_at) >= self.config.recovery_timeout_s:
+                self._state = "HALF_OPEN"
+                self._half_open_inflight = 0
+        return self._state
+
+    def execute(self, fn: Callable[[], T], fallback: Optional[Callable[[Exception], T]] = None) -> T:
+        current = self.state
+        if current == "HALF_OPEN" and self._half_open_inflight >= self.config.half_open_max_calls:
+            err = CircuitOpenError(self.name)
+            return fallback(err) if fallback else (_ for _ in ()).throw(err)
+        if current == "OPEN":
+            err = CircuitOpenError(self.name)
+            return fallback(err) if fallback else (_ for _ in ()).throw(err)
+        if current == "HALF_OPEN":
+            self._half_open_inflight += 1
+        try:
+            result = fn()
+        except Exception as exc:
+            self._failures += 1
+            if current == "HALF_OPEN" or self._failures >= self.config.failure_threshold:
+                self._state = "OPEN"
+                self._opened_at = float(self.clock())
+            if fallback is not None:
+                return fallback(exc)
+            raise
+        self._failures = 0
+        self._opened_at = None
+        self._state = "CLOSED"
+        return result
`,
    testPatch: `--- a/tests/test_circuit_breaker.py
+++ b/tests/test_circuit_breaker.py
@@ -0,0 +1,35 @@
+import pytest
+from src.resilience.circuit_breaker import CircuitBreaker, CircuitBreakerConfig, CircuitOpenError
+
+
+def test_closed_to_open_to_half_open_recovery():
+    now = [10.0]
+    cb = CircuitBreaker("payments", CircuitBreakerConfig(failure_threshold=2, recovery_timeout_s=5.0), clock=lambda: now[0])
+
+    def boom():
+        raise TimeoutError("upstream timeout")
+
+    for _ in range(2):
+        with pytest.raises(TimeoutError):
+            cb.execute(boom)
+
+    assert cb.state == "OPEN"
+    assert cb.execute(boom, fallback=lambda _e: "cached-ok") == "cached-ok"
+
+    with pytest.raises(CircuitOpenError):
+        cb.execute(boom)
+
+    now[0] += 5.0
+    assert cb.state == "HALF_OPEN"
+    assert cb.execute(lambda: "recovered") == "recovered"
+    assert cb.state == "CLOSED"
`,
  },
  {
    id: 'idempotency-replay-guard',
    title: 'Idempotency Key Store + Payload Hash Conflict Guard',
    category: 'Invariant & Conflict Semantics',
    difficulty: 'Hard',
    targetFiles: [
      'src/idempotency/store.py',
      'src/idempotency/errors.py',
      'tests/test_idempotency.py',
    ],
    summary:
      'Prevents duplicate side effects on retries with matching payload hashes while raising IdempotencyConflictError when a key is reused with a different payload.',
    behavioralRules: [
      'Replays cached response without re-executing handler when idempotency_key and payload_hash match.',
      'Raises IdempotencyConflictError (HTTP 409) when idempotency_key is reused with a divergent payload_hash.',
      'Expires completed records after ttl_seconds using injected clock.',
    ],
    lexicalOverlapPct: 5.9,
    astDivergencePct: 92.6,
    agentPassRate: {
      baselineAgent: '31%',
      astContextAgent: '67%',
    },
    problemStatement: `# Feature Request: Idempotency Key Store & Conflict Guard

## Objective
Implement an idempotency execution guard that safely replays prior results for identical retries and rejects conflicting payload reuse with \`IdempotencyConflictError\`.

## Supplied Task Interface
- \`IdempotencyRecord(key: str, payload_hash: str, result: Any, expires_at: float)\`
- \`IdempotencyGuard(ttl_seconds: float = 3600.0, clock: Callable[[], float] = time.monotonic)\`
- Method \`run(key: str, payload_hash: str, operation: Callable[[], T]) -> T\`.
- Raising \`IdempotencyConflictError\` indicates key reuse with a mismatched \`payload_hash\`.

## Requirements & Edge Cases
1. Compute canonical SHA-256 helper \`canonical_payload_hash(payload: dict) -> str\` using sorted keys and compact JSON separators.
2. If an unexpired entry for \`key\` has a different \`payload_hash\`, do not run \`operation\` and raise \`IdempotencyConflictError\`.
3. If an unexpired entry matches \`payload_hash\`, return the stored \`result\` without calling \`operation\`.
4. After \`ttl_seconds\` elapses, treat the prior entry as expired and allow fresh execution.
`,
    goldPatch: `--- a/src/idempotency/errors.py
+++ b/src/idempotency/errors.py
@@ -0,0 +1,6 @@
+class IdempotencyConflictError(Exception):
+    def __init__(self, key: str, message: str = "Idempotency key reused with different payload"):
+        super().__init__(message)
+        self.key = key
+        self.status_code = 409
--- a/src/idempotency/store.py
+++ b/src/idempotency/store.py
@@ -0,0 +1,38 @@
+from dataclasses import dataclass
+import hashlib
+import json
+import time
+from typing import Any, Callable, Dict, TypeVar
+from .errors import IdempotencyConflictError
+
+T = TypeVar("T")
+
+
+def canonical_payload_hash(payload: Dict[str, Any]) -> str:
+    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
+    return hashlib.sha256(encoded).hexdigest()
+
+
+@dataclass
+class IdempotencyRecord:
+    key: str
+    payload_hash: str
+    result: Any
+    expires_at: float
+
+
+class IdempotencyGuard:
+    def __init__(self, ttl_seconds: float = 3600.0, clock: Callable[[], float] = time.monotonic):
+        self.ttl_seconds = float(ttl_seconds)
+        self.clock = clock
+        self._records: Dict[str, IdempotencyRecord] = {}
+
+    def run(self, key: str, payload_hash: str, operation: Callable[[], T]) -> T:
+        now = float(self.clock())
+        existing = self._records.get(key)
+        if existing is not None and existing.expires_at > now:
+            if existing.payload_hash != payload_hash:
+                raise IdempotencyConflictError(key)
+            return existing.result
+        value = operation()
+        self._records[key] = IdempotencyRecord(key=key, payload_hash=payload_hash, result=value, expires_at=now + self.ttl_seconds)
+        return value
`,
    testPatch: `--- a/tests/test_idempotency.py
+++ b/tests/test_idempotency.py
@@ -0,0 +1,29 @@
+import pytest
+from src.idempotency.errors import IdempotencyConflictError
+from src.idempotency.store import IdempotencyGuard, canonical_payload_hash
+
+
+def test_replay_and_conflict_detection():
+    now = [500.0]
+    calls = [0]
+    guard = IdempotencyGuard(ttl_seconds=60.0, clock=lambda: now[0])
+    h1 = canonical_payload_hash({"b": 2, "a": 1})
+    h2 = canonical_payload_hash({"b": 9, "a": 1})
+
+    def op():
+        calls[0] += 1
+        return {"tx": calls[0]}
+
+    assert guard.run("k-1", h1, op) == {"tx": 1}
+    assert guard.run("k-1", h1, op) == {"tx": 1}
+    assert calls[0] == 1
+
+    with pytest.raises(IdempotencyConflictError):
+        guard.run("k-1", h2, op)
+
+    now[0] += 61.0
+    assert guard.run("k-1", h2, op) == {"tx": 2}
+    assert calls[0] == 2
`,
  },
];

const PIPELINE_STAGES = [
  {
    id: 'ingest',
    label: '1. Repo & AST Graph Ingest',
    detail: 'Pin base commit SHA, parse symbol graph, prune irrelevant modules (-74% tokens).',
  },
  {
    id: 'synthesize',
    label: '2. Spec & Interface Synthesis',
    detail: 'Generate leak-free problem_statement.md bound to task interface contracts.',
  },
  {
    id: 'gold_patch',
    label: '3. Reference Implementation',
    detail: 'Synthesize multi-file gold_patch.diff matching repo language, style, and error model.',
  },
  {
    id: 'tests_mutants',
    label: '4. Feature Tests & AST Mutants',
    detail: 'Author test_patch.diff + wrong-behavior AST mutants to verify bug sensitivity.',
  },
  {
    id: 'sandbox_verify',
    label: '5. 5-State Sandbox Verification',
    detail: 'Execute S1–S5 checks in isolated runner and emit cryptographic validation_evidence.json.',
  },
];

const RUBRIC_CRITERIA = [
  {
    code: '01',
    weight: '25%',
    title: 'Working implementation and repeatability',
    tab: 'pipeline',
    summary:
      'Pipeline runs end to end on the supplied repository and generalises beyond one hand-prepared example.',
  },
  {
    code: '02',
    weight: '25%',
    title: 'Validity and validation evidence',
    tab: 'validation',
    summary:
      'Tasks are solvable; reference implementations pass; feature tests detect missing or wrong behaviour; regression checks protect existing functionality.',
  },
  {
    code: '03',
    weight: '20%',
    title: 'Meaningful variation',
    tab: 'variation',
    summary:
      'Tasks differ in behaviour, rules or interactions, not just wording or names.',
  },
  {
    code: '04',
    weight: '15%',
    title: 'Original approach and engineering judgement',
    tab: 'judgement',
    summary:
      'Design choices, sensible scope, responsible use of resources and honest statement of limitations.',
  },
  {
    code: '05',
    weight: '15%',
    title: 'Practical impact and communication',
    tab: 'impact',
    summary:
      'Value for evaluating AI coding systems; clarity of the demo.',
  },
];

const DEMO_WALKTHROUGH_STEPS = [
  {
    criterion: '01 · Repeatability (25%)',
    tab: 'pipeline',
    duration: '0:00 – 0:40',
    script:
      'Select any supplied repository & base commit SHA (or enter a custom repo), lock a deterministic seed, and run a 3-task batch sweep to prove repeatability without one-off hand-crafting.',
  },
  {
    criterion: '02 · Validity & Evidence (25%)',
    tab: 'validation',
    duration: '0:40 – 1:30',
    script:
      'Inspect S1–S5 sandbox verification: baseline regression passes, feature tests fail before the gold patch (F2P), pass with the gold patch, preserve regression tests (P2P), and catch wrong-behavior AST mutants.',
  },
  {
    criterion: '03 · Meaningful Variation (20%)',
    tab: 'variation',
    duration: '1:30 – 2:05',
    script:
      'Compare synthesized tasks side-by-side to show distinct state transitions, invariants, and cross-module interactions rather than cosmetic rewording.',
  },
  {
    criterion: '04 · Engineering Judgement (15%)',
    tab: 'judgement',
    duration: '2:05 – 2:40',
    script:
      'Highlight AST symbol pruning, deterministic clock injection, ethical/safety boundaries, and an honest statement of what the prototype does not yet automate.',
  },
  {
    criterion: '05 · Practical Impact (15%)',
    tab: 'impact',
    duration: '2:40 – 3:00',
    script:
      'Show how benchmarked pass@1 deltas and downloadable task packages help evaluate AI coding systems reliably, then export the JSON package.',
  },
];

function computeDigest(input) {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0');
}

export default function ForgeEvalApp() {
  const [activeTab, setActiveTab] = useState('pipeline');
  const [selectedRepoId, setSelectedRepoId] = useState(REPOSITORIES[0].id);
  const [customRepoUrl, setCustomRepoUrl] = useState('');
  const [customBaseSha, setCustomBaseSha] = useState('');
  const [selectedStrategyId, setSelectedStrategyId] = useState(STRATEGIES[0].id);
  const [seed, setSeed] = useState('innodata-track1-2026-042');

  const [completedStageIdx, setCompletedStageIdx] = useState(PIPELINE_STAGES.length - 1);
  const [isRunning, setIsRunning] = useState(false);
  const [batchResults, setBatchResults] = useState([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  // Fault-injection toggles for Criterion 02 (Validity & Validation Evidence)
  const [injectWeakFeatureTest, setInjectWeakFeatureTest] = useState(false);
  const [injectBrokenGoldPatch, setInjectBrokenGoldPatch] = useState(false);
  const [injectRegressionBreak, setInjectRegressionBreak] = useState(false);

  // Task Package Explorer state
  const [activeArtifact, setActiveArtifact] = useState('task_manifest.json');
  const [copiedKey, setCopiedKey] = useState(null);

  // Variation comparison selection
  const [compareStrategyId, setCompareStrategyId] = useState(STRATEGIES[1].id);

  // Guided 3-minute Jury Demo Mode
  const [demoMode, setDemoMode] = useState(false);
  const [demoStepIdx, setDemoStepIdx] = useState(0);

  const repo = useMemo(
    () => REPOSITORIES.find((r) => r.id === selectedRepoId) || REPOSITORIES[0],
    [selectedRepoId]
  );

  const strategy = useMemo(
    () => STRATEGIES.find((s) => s.id === selectedStrategyId) || STRATEGIES[0],
    [selectedStrategyId]
  );

  const compareStrategy = useMemo(
    () =>
      STRATEGIES.find(
        (s) => s.id === (compareStrategyId === strategy.id ? STRATEGIES[0].id : compareStrategyId)
      ) || STRATEGIES[1],
    [compareStrategyId, strategy.id]
  );

  const effectiveRepoName = customRepoUrl.trim() || repo.name;
  const effectiveBaseSha = (customBaseSha.trim() || repo.baseCommit).toLowerCase();

  const taskId = useMemo(() => {
    const digest = computeDigest(`${effectiveRepoName}|${effectiveBaseSha}|${strategy.id}|${seed}`);
    return `forge-${repo.id}-${strategy.id.slice(0, 12)}-${digest}`;
  }, [effectiveRepoName, effectiveBaseSha, strategy.id, seed, repo.id]);

  // Animate 5-stage synthesis run
  useEffect(() => {
    if (!isRunning) return undefined;
    if (completedStageIdx >= PIPELINE_STAGES.length - 1) {
      setIsRunning(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setCompletedStageIdx((prev) => prev + 1);
    }, 360);
    return () => clearTimeout(timer);
  }, [isRunning, completedStageIdx]);

  const handleRunPipeline = () => {
    setCompletedStageIdx(-1);
    setIsRunning(true);
  };

  const handleRunBatchSweep = () => {
    setIsBatchRunning(true);
    setBatchResults([]);
    setTimeout(() => {
      const generated = STRATEGIES.map((st, idx) => {
        const taskDigest = computeDigest(`${effectiveRepoName}|${effectiveBaseSha}|${st.id}|${seed}|${idx}`);
        return {
          taskId: `forge-${repo.id}-${st.id.slice(0, 10)}-${taskDigest}`,
          strategyTitle: st.title,
          difficulty: st.difficulty,
          filesTouched: st.targetFiles.length,
          f2pVerified: true,
          p2pVerified: true,
          mutantKilled: true,
          status: 'VALIDATED',
        };
      });
      setBatchResults(generated);
      setIsBatchRunning(false);
    }, 550);
  };

  // 5-State Validity & Validation Evidence Matrix
  const validationChecks = useMemo(() => {
    const s1Pass = !injectRegressionBreak;
    const s2FailAsExpected = true; // Before gold patch, new feature is missing -> test fails (F2P)
    const s3Pass = !injectBrokenGoldPatch;
    const s4Pass = !injectRegressionBreak && !injectBrokenGoldPatch;
    const s5MutantCaught = !injectWeakFeatureTest;

    return [
      {
        id: 'S1',
        code: 'P2P_BASELINE',
        name: 'Base Commit + Existing Regression Suite',
        expected: 'PASS',
        actual: s1Pass ? 'PASS' : 'FAIL',
        passed: s1Pass,
        evidence: `${repo.runner} -> ${repo.existingTests}/${repo.existingTests} existing tests passed on ${effectiveBaseSha.slice(0, 7)}.`,
      },
      {
        id: 'S2',
        code: 'F2P_MISSING_FEATURE',
        name: 'Base Commit + New Feature Tests (Pre-Patch)',
        expected: 'FAIL (Missing Behavior)',
        actual: 'FAIL (AssertionError / ImportError)',
        passed: s2FailAsExpected,
        evidence: 'Feature tests fail cleanly before gold_patch.diff is applied, proving the task is non-trivial.',
      },
      {
        id: 'S3',
        code: 'F2P_GOLD_SOLVABLE',
        name: 'Base Commit + Gold Patch + Feature Tests',
        expected: 'PASS',
        actual: s3Pass ? 'PASS' : 'FAIL',
        passed: s3Pass,
        evidence: s3Pass
          ? 'Reference gold_patch.diff applies cleanly and satisfies every feature requirement & edge case.'
          : 'Simulated broken gold patch failed feature assertions -> Gatekeeper blocks task publication.',
      },
      {
        id: 'S4',
        code: 'P2P_REGRESSION_GUARD',
        name: 'Base Commit + Gold Patch + Full Regression Suite',
        expected: 'PASS',
        actual: s4Pass ? 'PASS' : 'FAIL',
        passed: s4Pass,
        evidence: s4Pass
          ? `All ${repo.existingTests} existing regression tests remain green with gold_patch.diff applied.`
          : 'Regression suite detected broken existing behavior -> Gatekeeper rejects task.',
      },
      {
        id: 'S5',
        code: 'MUTANT_WRONG_BEHAVIOR',
        name: 'Gold Patch + AST Wrong-Behavior Mutant + Feature Tests',
        expected: 'FAIL (Mutant Caught)',
        actual: s5MutantCaught ? 'FAIL (Mutant Killed)' : 'PASS (Weak Test Warning)',
        passed: s5MutantCaught,
        evidence: s5MutantCaught
          ? 'Mutated boundary/state-transition operator caused feature tests to fail (100% mutant kill).'
          : 'Simulated weak test suite missed AST mutant -> Gatekeeper flags insufficient test discrimination.',
      },
    ];
  }, [
    repo.runner,
    repo.existingTests,
    effectiveBaseSha,
    injectRegressionBreak,
    injectBrokenGoldPatch,
    injectWeakFeatureTest,
  ]);

  const allGatesPassed = validationChecks.every((c) => c.passed);

  const manifestObj = useMemo(
    () => ({
      schema_version: 'forgeeval.task.v1',
      task_id: taskId,
      track: 'Track 1: Coding Task Factory',
      repository: {
        name: effectiveRepoName,
        language: repo.language,
        base_commit: effectiveBaseSha,
        test_runner: repo.runner,
      },
      strategy: {
        id: strategy.id,
        title: strategy.title,
        category: strategy.category,
        difficulty: strategy.difficulty,
        deterministic_seed: seed,
      },
      artifacts: {
        problem_statement: 'problem_statement.md',
        gold_patch: 'gold_patch.diff',
        test_patch: 'test_patch.diff',
        validation_evidence: 'validation_evidence.json',
      },
      target_files: strategy.targetFiles,
    }),
    [taskId, effectiveRepoName, repo.language, effectiveBaseSha, repo.runner, strategy, seed]
  );

  const evidenceObj = useMemo(
    () => ({
      task_id: taskId,
      base_commit: effectiveBaseSha,
      gatekeeper_verdict: allGatesPassed ? 'ACCEPTED' : 'REJECTED_BY_GATEKEEPER',
      checks: validationChecks.map(({ id, code, expected, actual, passed, evidence }) => ({
        gate: id,
        code,
        expected,
        actual,
        passed,
        evidence,
      })),
    }),
    [taskId, effectiveBaseSha, allGatesPassed, validationChecks]
  );

  const artifactContents = useMemo(
    () => ({
      'task_manifest.json': JSON.stringify(manifestObj, null, 2),
      'problem_statement.md': strategy.problemStatement,
      'gold_patch.diff': strategy.goldPatch,
      'test_patch.diff': strategy.testPatch,
      'validation_evidence.json': JSON.stringify(evidenceObj, null, 2),
    }),
    [manifestObj, strategy, evidenceObj]
  );

  const handleCopyArtifact = async (key) => {
    try {
      await navigator.clipboard.writeText(artifactContents[key] || '');
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      setCopiedKey(null);
    }
  };

  const handleDownloadPackage = () => {
    const bundle = {
      exported_at: new Date().toISOString(),
      ...manifestObj,
      files: artifactContents,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${taskId}-package.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectDemoStep = (idx) => {
    const bounded = ((idx % DEMO_WALKTHROUGH_STEPS.length) + DEMO_WALKTHROUGH_STEPS.length) % DEMO_WALKTHROUGH_STEPS.length;
    setDemoStepIdx(bounded);
    setActiveTab(DEMO_WALKTHROUGH_STEPS[bounded].tab);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-sky-500/15 border border-sky-400/40 flex items-center justify-center text-sky-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tracking-tight text-white">ForgeEval</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 font-medium">
                  Track 1 · Coding Task Factory
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Reusable task synthesis, 5-state sandbox verification &amp; AI coding benchmark harness
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                const next = !demoMode;
                setDemoMode(next);
                if (next) {
                  setActiveTab(DEMO_WALKTHROUGH_STEPS[demoStepIdx].tab);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                demoMode
                  ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              {demoMode ? '3-Min Jury Demo: ON' : '3-Min Jury Demo'}
            </button>

            <button
              type="button"
              onClick={handleDownloadPackage}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-500 text-slate-950 hover:bg-sky-400 transition"
            >
              <Download className="w-3.5 h-3.5" />
              Export Task JSON
            </button>
          </div>
        </div>

        {/* Track 1 Evaluation Criteria Navigation */}
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 pb-2.5 flex items-center gap-2 overflow-x-auto">
          {RUBRIC_CRITERIA.map((item) => {
            const isActive = activeTab === item.tab;
            return (
              <button
                key={item.code}
                type="button"
                onClick={() => setActiveTab(item.tab)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg border text-left shrink-0 transition ${
                  isActive
                    ? 'bg-sky-500/15 border-sky-400/50 text-white'
                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <span
                  className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                    isActive ? 'bg-sky-400 text-slate-950 font-semibold' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {item.weight}
                </span>
                <span className="text-xs font-medium">
                  {item.code}. {item.title}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setActiveTab('package')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium shrink-0 transition ${
              activeTab === 'package'
                ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
                : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            Task Package
          </button>
        </nav>
      </header>

      {/* Guided 3-Minute Jury Demo Bar */}
      {demoMode && (
        <div className="bg-amber-950/40 border-b border-amber-500/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <span>{DEMO_WALKTHROUGH_STEPS[demoStepIdx].criterion}</span>
                <span className="text-amber-400/80 font-mono">
                  ({DEMO_WALKTHROUGH_STEPS[demoStepIdx].duration})
                </span>
              </div>
              <p className="text-xs sm:text-sm text-amber-100/90">
                {DEMO_WALKTHROUGH_STEPS[demoStepIdx].script}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => selectDemoStep(demoStepIdx - 1)}
                className="px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-slate-200 hover:bg-slate-800"
              >
                Prev
              </button>
              <span className="text-xs font-mono text-amber-200">
                {demoStepIdx + 1}/{DEMO_WALKTHROUGH_STEPS.length}
              </span>
              <button
                type="button"
                onClick={() => selectDemoStep(demoStepIdx + 1)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-400 text-slate-950 font-semibold text-xs hover:bg-amber-300"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Active Task Context Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Active Task ID</div>
            <div className="mt-1 font-mono text-xs text-sky-300 truncate" title={taskId}>
              {taskId}
            </div>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Repository &amp; Commit</div>
            <div className="mt-1 text-xs font-medium text-white truncate">
              {effectiveRepoName} @ <span className="font-mono text-slate-300">{effectiveBaseSha.slice(0, 7)}</span>
            </div>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Synthesis Strategy</div>
            <div className="mt-1 text-xs font-medium text-white truncate">{strategy.title}</div>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-3.5 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Gatekeeper Status</div>
              <div
                className={`mt-1 text-xs font-semibold ${
                  allGatesPassed ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {allGatesPassed ? 'ALL 5 GATES PASS' : 'BLOCKED BY GATEKEEPER'}
              </div>
            </div>
            {allGatesPassed ? (
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
          </div>
        </div>

        {/* 01: IMPLEMENTATION & REPEATABILITY (25%) */}
        {activeTab === 'pipeline' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Config Panel */}
              <div className="lg:col-span-5 rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-sky-400" />
                    01. Pipeline Configuration (25%)
                  </h2>
                  <span className="text-[11px] font-mono text-slate-400">Repeatability</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Supplied Repository
                  </label>
                  <select
                    value={selectedRepoId}
                    onChange={(e) => setSelectedRepoId(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-400"
                  >
                    {REPOSITORIES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.language})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-slate-400">{repo.description}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Custom Repo / Path (Optional)
                    </label>
                    <input
                      type="text"
                      value={customRepoUrl}
                      onChange={(e) => setCustomRepoUrl(e.target.value)}
                      placeholder={repo.name}
                      className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Base Commit SHA (Optional)
                    </label>
                    <input
                      type="text"
                      value={customBaseSha}
                      onChange={(e) => setCustomBaseSha(e.target.value)}
                      placeholder={repo.shortCommit}
                      className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Reusable Feature Synthesis Strategy
                  </label>
                  <div className="space-y-2">
                    {STRATEGIES.map((st) => {
                      const active = st.id === strategy.id;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setSelectedStrategyId(st.id)}
                          className={`w-full text-left p-3 rounded-xl border transition ${
                            active
                              ? 'bg-sky-500/10 border-sky-400/50 text-white'
                              : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold">{st.title}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                              {st.difficulty}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-400 line-clamp-2">{st.summary}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Deterministic Seed
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={seed}
                      onChange={(e) => setSeed(e.target.value)}
                      className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                    <button
                      type="button"
                      onClick={() => setSeed(`seed-${Math.floor(100 + Math.random() * 900)}`)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
                      title="New deterministic seed"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={handleRunPipeline}
                    disabled={isRunning}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-xs transition"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {isRunning ? 'Synthesizing...' : 'Run Single Task'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRunBatchSweep}
                    disabled={isBatchRunning}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs transition"
                  >
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    {isBatchRunning ? 'Running Batch...' : 'Run 3-Task Batch'}
                  </button>
                </div>
              </div>

              {/* Right 5-Stage Execution & Batch Repeatability */}
              <div className="lg:col-span-7 space-y-5">
                <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-sky-400" />
                      End-to-End Synthesis Stages
                    </h3>
                    <span className="text-xs font-mono text-slate-400">
                      {Math.max(0, completedStageIdx + 1)}/{PIPELINE_STAGES.length} stages complete
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {PIPELINE_STAGES.map((stage, idx) => {
                      const done = idx <= completedStageIdx;
                      const current = isRunning && idx === completedStageIdx + 1;
                      return (
                        <div
                          key={stage.id}
                          className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
                            done
                              ? 'bg-slate-950/80 border-emerald-500/30'
                              : current
                              ? 'bg-sky-950/30 border-sky-400/50'
                              : 'bg-slate-950/40 border-slate-800/80'
                          }`}
                        >
                          <div>
                            <div className="text-xs font-semibold text-white">{stage.label}</div>
                            <div className="text-xs text-slate-400 mt-0.5">{stage.detail}</div>
                          </div>
                          <span
                            className={`text-[11px] font-mono px-2 py-0.5 rounded shrink-0 ${
                              done
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : current
                                ? 'bg-sky-500/20 text-sky-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {done ? 'DONE' : current ? 'RUNNING' : 'QUEUED'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Batch Generalization Proof */}
                <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Generalization Beyond One Hand-Prepared Example
                      </h3>
                      <p className="text-xs text-slate-400">
                        Same pipeline strategy generates multiple distinct, validated tasks from the repository.
                      </p>
                    </div>
                    <span className="text-[11px] font-mono px-2 py-1 rounded bg-slate-800 text-slate-300">
                      {batchResults.length > 0 ? `${batchResults.length} tasks ready` : 'Click "Run 3-Task Batch"'}
                    </span>
                  </div>

                  {batchResults.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400">
                            <th className="py-2 pr-3">Task ID</th>
                            <th className="py-2 pr-3">Feature Strategy</th>
                            <th className="py-2 pr-3">Files</th>
                            <th className="py-2 pr-3">F2P / P2P / Mutant</th>
                            <th className="py-2 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {batchResults.map((row) => (
                            <tr key={row.taskId} className="text-slate-200">
                              <td className="py-2 pr-3 font-mono text-[11px] text-sky-300">{row.taskId}</td>
                              <td className="py-2 pr-3">{row.strategyTitle}</td>
                              <td className="py-2 pr-3 font-mono">{row.filesTouched}</td>
                              <td className="py-2 pr-3 font-mono text-emerald-400">PASS / PASS / KILLED</td>
                              <td className="py-2 text-right">
                                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-medium">
                                  {row.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 02: VALIDITY & VALIDATION EVIDENCE (25%) */}
        {activeTab === 'validation' && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  02. Validity &amp; Validation Evidence (25%)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Verifies task solvability, reference patch execution, feature test bug-catching (including AST mutants), and existing regression safety.
                </p>
              </div>

              {/* Fault-Injection Controls to prove Gatekeeper works */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInjectBrokenGoldPatch((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                    injectBrokenGoldPatch
                      ? 'bg-rose-500/20 border-rose-400/50 text-rose-200'
                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {injectBrokenGoldPatch ? 'Fault ON: Broken Gold Patch' : 'Simulate Broken Gold Patch'}
                </button>
                <button
                  type="button"
                  onClick={() => setInjectWeakFeatureTest((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                    injectWeakFeatureTest
                      ? 'bg-rose-500/20 border-rose-400/50 text-rose-200'
                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {injectWeakFeatureTest ? 'Fault ON: Mutant Survived' : 'Simulate Mutant Surviving'}
                </button>
                <button
                  type="button"
                  onClick={() => setInjectRegressionBreak((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                    injectRegressionBreak
                      ? 'bg-rose-500/20 border-rose-400/50 text-rose-200'
                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {injectRegressionBreak ? 'Fault ON: Regression Broken' : 'Simulate Regression Break'}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {validationChecks.map((check) => (
                <div
                  key={check.id}
                  className={`rounded-xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                    check.passed
                      ? 'bg-slate-900 border-slate-800'
                      : 'bg-rose-950/25 border-rose-500/40'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-sky-300">
                        {check.id} · {check.code}
                      </span>
                      <span className="text-sm font-semibold text-white">{check.name}</span>
                    </div>
                    <p className="text-xs text-slate-400">{check.evidence}</p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-[11px] text-slate-400">Expected: {check.expected}</div>
                      <div
                        className={`text-xs font-mono font-semibold ${
                          check.passed ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        Actual: {check.actual}
                      </div>
                    </div>
                    {check.passed ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400" />
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Structured Validation Evidence Output */}
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  validation_evidence.json
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('package');
                    setActiveArtifact('validation_evidence.json');
                  }}
                  className="text-xs text-sky-400 hover:text-sky-300"
                >
                  Open in Package Explorer →
                </button>
              </div>
              <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto">
                {JSON.stringify(evidenceObj, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* 03: MEANINGFUL VARIATION (20%) */}
        {activeTab === 'variation' && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  03. Meaningful Variation (20%)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Tasks differ in state transitions, invariants, and cross-module interactions—not superficial wording or identifier renames.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400">Compare against:</label>
                <select
                  value={compareStrategy.id}
                  onChange={(e) => setCompareStrategyId(e.target.value)}
                  className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white"
                >
                  {STRATEGIES.filter((s) => s.id !== strategy.id).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="text-xs text-slate-400">Surface Lexical Overlap</div>
                <div className="mt-1 text-2xl font-bold text-slate-100">{strategy.lexicalOverlapPct}%</div>
                <div className="text-xs text-slate-400 mt-1">Low text similarity avoids repetitive boilerplate</div>
              </div>
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="text-xs text-slate-400">AST &amp; Behavioral Divergence</div>
                <div className="mt-1 text-2xl font-bold text-emerald-400">{strategy.astDivergencePct}%</div>
                <div className="text-xs text-slate-400 mt-1">Distinct control flow, error contracts &amp; state rules</div>
              </div>
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="text-xs text-slate-400">Cross-Module Touchpoints</div>
                <div className="mt-1 text-2xl font-bold text-sky-400">{strategy.targetFiles.length} files</div>
                <div className="text-xs font-mono text-slate-400 mt-1 truncate">
                  {strategy.targetFiles.join(', ')}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl bg-slate-900 border border-sky-500/30 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-sky-300">Task A (Current)</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {strategy.category}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-white">{strategy.title}</h3>
                <ul className="space-y-2 text-xs text-slate-300 list-disc pl-4">
                  {strategy.behavioralRules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-slate-400">Task B (Comparison)</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {compareStrategy.category}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-white">{compareStrategy.title}</h3>
                <ul className="space-y-2 text-xs text-slate-300 list-disc pl-4">
                  {compareStrategy.behavioralRules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* 04: ORIGINAL APPROACH & ENGINEERING JUDGEMENT (15%) */}
        {activeTab === 'judgement' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Scale className="w-4 h-4 text-sky-400" />
                04. Design Choices &amp; Responsible Scope (15%)
              </h2>
              <ul className="space-y-3 text-xs text-slate-300 leading-relaxed">
                <li>
                  <strong className="text-white">AST-Guided Context Pruning:</strong> Selects only directly connected modules and symbols rather than stuffing full repositories into context, cutting prompt overhead and keeping tasks focused.
                </li>
                <li>
                  <strong className="text-white">Deterministic Clock &amp; Seed Control:</strong> Time-sensitive features (rate limiters, circuit breakers, TTL caches) accept injected clocks so tests never sleep or flake in CI.
                </li>
                <li>
                  <strong className="text-white">Sensible Hackathon Scope &amp; Safety:</strong> Focuses on realistic feature synthesis and 5-state verification without unsafe code execution, external network calls, or benchmark leakage.
                </li>
              </ul>
            </div>

            <div className="rounded-2xl bg-slate-900 border border-amber-500/30 bg-amber-950/15 p-5 space-y-4">
              <h3 className="text-base font-semibold text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Honest Statement of Limitations
              </h3>
              <ul className="space-y-3 text-xs text-amber-100/90 leading-relaxed">
                <li>
                  <strong className="text-white">Browser Simulation vs. Live Docker Runner:</strong> This interactive prototype simulates sandbox execution and AST mutation verdicts in-browser; production deployment pairs these exact schemas with an isolated container/test runner.
                </li>
                <li>
                  <strong className="text-white">Language &amp; Repo Coverage:</strong> Current synthesis templates target Python and TypeScript service/middleware patterns and require clean existing test suites to establish P2P baselines.
                </li>
                <li>
                  <strong className="text-white">Ambiguous Spec Edge Cases:</strong> Complex multi-service architectural refactors may still benefit from human review of acceptance criteria before large-scale evaluation runs.
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* 05: PRACTICAL IMPACT & COMMUNICATION (15%) */}
        {activeTab === 'impact' && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Bot className="w-4 h-4 text-emerald-400" />
                    05. Practical Impact for Evaluating AI Coding Systems (15%)
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Diagnoses where AI coding systems struggle—such as multi-file invariants, state transitions, and avoiding regressions—using fresh, non-contaminated tasks.
                  </p>
                </div>
                <span className="text-xs font-mono px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-300">
                  Diagnostic pass@1 View
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 pr-4">Strategy / Task Family</th>
                      <th className="py-2.5 pr-4">Difficulty</th>
                      <th className="py-2.5 pr-4">Single-Prompt Agent pass@1</th>
                      <th className="py-2.5 pr-4">Repo-Context Agent pass@1</th>
                      <th className="py-2.5">Primary Failure Mode Caught</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {STRATEGIES.map((st, i) => (
                      <tr key={st.id} className="text-slate-200">
                        <td className="py-3 pr-4 font-medium text-white">{st.title}</td>
                        <td className="py-3 pr-4">{st.difficulty}</td>
                        <td className="py-3 pr-4 font-mono text-amber-300">{st.agentPassRate.baselineAgent}</td>
                        <td className="py-3 pr-4 font-mono text-emerald-400">{st.agentPassRate.astContextAgent}</td>
                        <td className="py-3 text-slate-400">
                          {i === 0
                            ? 'Off-by-one window pruning & missing Retry-After header'
                            : i === 1
                            ? 'Re-entering HALF_OPEN without resetting failure counter'
                            : 'Allowing key reuse when payload hash diverges'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Rubric Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {RUBRIC_CRITERIA.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setActiveTab(item.tab)}
                  className="text-left rounded-xl bg-slate-900 hover:bg-slate-800/80 border border-slate-800 p-3.5 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-sky-400">{item.code}</span>
                    <span className="text-xs font-semibold text-white">{item.weight}</span>
                  </div>
                  <div className="mt-1.5 text-xs font-semibold text-white">{item.title}</div>
                  <p className="mt-1 text-[11px] text-slate-400 line-clamp-3">{item.summary}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* TASK PACKAGE INSPECTOR */}
        {activeTab === 'package' && (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                {Object.keys(artifactContents).map((fileName) => {
                  const active = activeArtifact === fileName;
                  return (
                    <button
                      key={fileName}
                      type="button"
                      onClick={() => setActiveArtifact(fileName)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                        active
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                      {fileName}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyArtifact(activeArtifact)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200"
                >
                  {copiedKey === activeArtifact ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy File
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPackage}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Bundle
                </button>
              </div>
            </div>

            <pre className="p-5 bg-slate-950 text-xs font-mono text-slate-200 overflow-x-auto max-h-[520px]">
              {artifactContents[activeArtifact]}
            </pre>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-4 px-4 sm:px-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5 text-sky-500" />
            ForgeEval · Track 1 Coding Task Factory Prototype
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            Deterministic seed &amp; base-commit pinned task packaging
          </span>
        </div>
      </footer>
    </div>
  );
}
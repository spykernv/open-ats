/**
 * Edge-case tests for the deterministic verdict.
 *
 * `computeVerdict` is the one place where the system decides something on its own
 * rather than asking a model, so its thresholds and its precedence order are the
 * part of the pipeline that must never drift. Every branch and every boundary of
 * server/pipeline/verdict.js is pinned here.
 *
 *   npm run test:unit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeVerdict } from "../../server/pipeline/verdict.js";

// Minimal artifact builders: each test states only what it is about.
const evaluation = (total_score) => ({ total_score });
const opportunity = (score) => ({ score });
const mapping = (...mappings) => ({ mappings });
const requirement = (over = {}) => ({
  requirement: "SQL",
  requirement_type: "MUST_HAVE",
  gap_type: "ACTUAL_EXPERIENCE_GAP",
  strength: "NONE",
  ...over,
});
const qcFail = (blocking = true) => ({ verdict: "FAIL", issues: [{ blocking, claim: "grew revenue 40%" }] });

test("a strong application with nothing blocking is APPLY_NOW and ready", () => {
  const r = computeVerdict({ evaluation: evaluation(91), opportunity: opportunity(80) });
  assert.equal(r.verdict, "APPLY_NOW");
  assert.equal(r.readiness, "APPLICATION_READY");
  assert.ok(r.reasons.length > 0);
});

test("88 is the APPLY_NOW threshold and 87 is not", () => {
  assert.equal(computeVerdict({ evaluation: evaluation(88) }).verdict, "APPLY_NOW");
  assert.equal(computeVerdict({ evaluation: evaluation(87) }).verdict, "IMPROVE_FIRST");
});

test("marginal gains reach APPLY_NOW below the score threshold", () => {
  const r = computeVerdict({
    evaluation: evaluation(80),
    comparison: { stop_condition: "APPLICATION_READY" },
  });
  assert.equal(r.verdict, "APPLY_NOW");
  assert.equal(r.readiness, "APPLICATION_READY");
});

test("a blocking quality-control failure never yields APPLY_NOW", () => {
  const r = computeVerdict({ evaluation: evaluation(95), qualityControl: qcFail() });
  assert.equal(r.verdict, "IMPROVE_FIRST");
  assert.equal(r.readiness, "CONTINUE_IMPROVING");
  assert.ok(r.reasons.some((x) => x.includes("contrôle qualité")));
});

test("a quality-control failure with no blocking issue does not hold the application back", () => {
  const r = computeVerdict({ evaluation: evaluation(95), qualityControl: qcFail(false) });
  assert.equal(r.verdict, "APPLY_NOW");
});

test("a low-value opportunity is LOW_PRIORITY even for an excellent candidate", () => {
  assert.equal(computeVerdict({ evaluation: evaluation(95), opportunity: opportunity(59) }).verdict, "LOW_PRIORITY");
  assert.equal(computeVerdict({ evaluation: evaluation(95), opportunity: opportunity(60) }).verdict, "APPLY_NOW");
});

test("a determinant must-have gap with a weak application is DO_NOT_APPLY", () => {
  const r = computeVerdict({ evaluation: evaluation(64), mapping: mapping(requirement()) });
  assert.equal(r.verdict, "DO_NOT_APPLY");
  assert.equal(r.readiness, "APPLICATION_STRUCTURALLY_WEAK");
  assert.deepEqual(r.mustHaveActualGaps, ["SQL"]);
});

test("65 is the DO_NOT_APPLY boundary: above it the same gap is LOW_PRIORITY", () => {
  const r = computeVerdict({ evaluation: evaluation(65), mapping: mapping(requirement()) });
  assert.equal(r.verdict, "LOW_PRIORITY");
  assert.equal(r.readiness, "APPLICATION_STRUCTURALLY_WEAK");
});

test("a determinant gap outranks a low-value opportunity", () => {
  const r = computeVerdict({
    evaluation: evaluation(50),
    opportunity: opportunity(30),
    mapping: mapping(requirement()),
  });
  assert.equal(r.verdict, "DO_NOT_APPLY");
});

test("a determinant gap can never be written around, however high the score", () => {
  const r = computeVerdict({ evaluation: evaluation(99), mapping: mapping(requirement()) });
  assert.equal(r.verdict, "LOW_PRIORITY");
  assert.notEqual(r.verdict, "APPLY_NOW");
});

test("a structurally weak comparison outranks an excellent score", () => {
  const r = computeVerdict({
    evaluation: evaluation(95),
    comparison: { stop_condition: "APPLICATION_STRUCTURALLY_WEAK" },
  });
  assert.equal(r.verdict, "LOW_PRIORITY");
  assert.equal(r.readiness, "APPLICATION_STRUCTURALLY_WEAK");
});

test("a positioning gap is not an experience gap and blocks nothing", () => {
  const r = computeVerdict({
    evaluation: evaluation(91),
    mapping: mapping(requirement({ gap_type: "POSITIONING_GAP" })),
  });
  assert.equal(r.verdict, "APPLY_NOW");
  assert.deepEqual(r.mustHaveActualGaps, []);
});

test("a nice-to-have experience gap is not a must-have gap", () => {
  const r = computeVerdict({
    evaluation: evaluation(91),
    mapping: mapping(requirement({ requirement_type: "NICE_TO_HAVE" })),
  });
  assert.equal(r.verdict, "APPLY_NOW");
  assert.deepEqual(r.mustHaveActualGaps, []);
});

test("a must-have gap with partial evidence is reported but is not determinant", () => {
  const r = computeVerdict({
    evaluation: evaluation(91),
    mapping: mapping(requirement({ strength: "WEAK" })),
  });
  assert.equal(r.verdict, "APPLY_NOW");
  assert.deepEqual(r.mustHaveActualGaps, ["SQL"]);
  assert.ok(r.reasons.some((x) => x.includes("SQL")));
});

test("every must-have experience gap is reported, determinant or not", () => {
  const r = computeVerdict({
    evaluation: evaluation(91),
    mapping: mapping(requirement({ requirement: "SQL", strength: "WEAK" }), requirement({ requirement: "Kubernetes" })),
  });
  assert.deepEqual(r.mustHaveActualGaps, ["SQL", "Kubernetes"]);
});

test("missing artifacts degrade to IMPROVE_FIRST instead of throwing", () => {
  const r = computeVerdict({});
  assert.equal(r.verdict, "IMPROVE_FIRST");
  assert.equal(r.readiness, "CONTINUE_IMPROVING");
  assert.deepEqual(r.mustHaveActualGaps, []);
  assert.ok(r.reasons.length > 0);
});

test("the same input always yields the same verdict", () => {
  const input = {
    evaluation: evaluation(72),
    opportunity: opportunity(77),
    mapping: mapping(requirement({ strength: "WEAK" })),
    qualityControl: { verdict: "PASS", issues: [] },
  };
  assert.deepEqual(computeVerdict(input), computeVerdict(input));
});

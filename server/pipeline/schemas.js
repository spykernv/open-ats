// zod/v4 is required: the SDK's zodOutputFormat helper reads v4 internals
// (z.toJSONSchema); passing a classic v3 schema throws before the API call.
import { z } from "zod/v4";

// Shared enums
export const RequirementType = z.enum([
  "MUST_HAVE",
  "STRONG_SIGNAL",
  "NICE_TO_HAVE",
  "CONTEXT",
  "CULTURAL_BEHAVIORAL",
]);

export const ProofStrength = z.enum(["STRONG", "MEDIUM", "WEAK"]);
export const MatchStrength = z.enum(["STRONG", "MEDIUM", "WEAK", "NONE"]);
export const GapType = z.enum(["POSITIONING_GAP", "ACTUAL_EXPERIENCE_GAP", "NONE"]);
export const Confidence = z.enum(["FACT", "STRONG_INFERENCE", "WEAK_INFERENCE"]);
export const Priority = z.enum(["CRITICAL", "HIGH_IMPACT", "MEDIUM", "OPTIONAL"]);

// STEP 1 — Job ingestion
export const JobParseSchema = z.object({
  job: z.object({
    title: z.string(),
    company: z.string().describe("Company name exactly as written in the posting; empty string if not identifiable"),
    business_unit: z.string(),
    location: z.string(),
    country: z.string(),
    contract_type: z.string().describe("e.g. VIE"),
    duration: z.string(),
    start_date: z.string(),
    compensation: z.string(),
    sector: z.string(),
    languages: z.array(z.object({ language: z.string(), level: z.string(), explicit: z.boolean() })),
    education_required: z.string(),
    experience_required: z.string(),
    responsibilities: z.array(z.string()),
    hard_skills: z.array(z.string()),
    soft_skills: z.array(z.string()),
    tools: z.array(z.string()),
    vie_details: z.string().describe("VIE-specific eligibility / program details mentioned in the post"),
    reconstructed_posting: z.string().describe("Full posting text reconstructed from the screenshots, preserving section structure"),
    ocr_uncertainties: z.array(z.string()).describe("Parts of the screenshots that were unreadable or uncertain"),
  }),
  requirements: z.array(
    z.object({
      requirement: z.string(),
      type: RequirementType,
      importance: z.number().min(1).max(5),
      evidence_from_job_post: z.string().describe("Quote or paraphrase from the posting that supports this requirement"),
      explicit: z.boolean().describe("true = explicitly stated in the posting, false = inferred"),
      estimated_weight: z.number().min(0).max(100).describe("Estimated weight in the screening decision, all requirements sum roughly to 100"),
    }),
  ),
});

// STEP 2 — Company research (structuring phase)
export const CompanyResearchSchema = z.object({
  company_name: z.string(),
  overview: z.string(),
  products_and_markets: z.string(),
  recent_situation: z.string().describe("Recent strategy, news, transformation initiatives relevant to this role"),
  presence_in_vie_country: z.string(),
  why_this_mission_exists: z.string().describe("Best hypothesis for why this VIE role exists, flagged as inference"),
  stated_values: z.string().describe("Values as officially communicated; do not convert slogans into facts"),
  findings: z.array(
    z.object({
      statement: z.string(),
      confidence: Confidence,
      source: z.string().describe("URL or source name; 'job posting' if derived from the posting"),
    }),
  ),
  sources: z.array(z.string()),
  research_available: z.boolean().describe("false if no web research could be performed"),
});

// STEP 3 — Recruiting thesis
export const RecruitingThesisSchema = z.object({
  mission_thesis: z.string().describe("Why this company is probably hiring this person"),
  top_business_problems: z.array(z.string()).min(3).max(5),
  ideal_candidate: z.object({
    profile_summary: z.string(),
    education: z.string(),
    experience: z.string(),
    key_skills: z.array(z.string()),
    differentiators: z.array(z.string()),
    realism_note: z.string().describe("Confirmation that this profile is realistic for a VIE, not an impossible senior profile"),
  }),
});

// STEP 12 — Opportunity scoring
export const OpportunityScoreSchema = z.object({
  score: z.number().min(0).max(100),
  tier: z.enum(["EXCEPTIONAL", "STRONG", "WORTH_APPLYING", "OPTIONAL", "LOW_PRIORITY"]),
  breakdown: z.array(
    z.object({
      criterion: z.string(),
      score: z.number(),
      max: z.number(),
      rationale: z.string(),
    }),
  ),
  summary: z.string(),
});

// STEP 4 — CV extraction / Evidence Bank
export const EvidenceBankSchema = z.object({
  candidate: z.object({
    name: z.string(),
    location: z.string(),
    languages: z.array(z.string()),
    education: z.array(z.string()),
    current_title: z.string(),
  }),
  experiences: z.array(
    z.object({
      title: z.string(),
      organization: z.string(),
      period: z.string(),
      summary: z.string(),
    }),
  ),
  evidence: z.array(
    z.object({
      id: z.string().describe("Short stable id like E1, E2..."),
      type: z.enum(["EXPERIENCE", "CLAIM", "METRIC", "SKILL", "TOOL", "DOMAIN", "SCOPE", "TEAM_SIZE", "INTERNATIONAL", "EDUCATION", "LANGUAGE"]),
      statement: z.string().describe("Verbatim or near-verbatim fact from the CV"),
      source_location: z.string().describe("Where in the CV this appears (section / experience name)"),
      proof_strength: ProofStrength,
    }),
  ),
  extraction_notes: z.array(z.string()).describe("Ambiguities or unreadable parts of the CV"),
});

// STEP 4b — Requirement → Evidence mapping
export const MappingSchema = z.object({
  mappings: z.array(
    z.object({
      requirement: z.string(),
      requirement_type: RequirementType,
      evidence_ids: z.array(z.string()),
      evidence_summary: z.string().describe("What evidence exists; empty-handed honesty if none"),
      strength: MatchStrength,
      gap_type: GapType.describe("NONE if strength is STRONG/MEDIUM; else whether the gap is positioning or actual experience"),
      notes: z.string(),
    }),
  ),
  coverage_summary: z.string(),
});

// STEP 5 — CV evaluation
export const CvEvaluationSchema = z.object({
  total_score: z.number().min(0).max(100),
  dimensions: z.array(
    z.object({
      dimension: z.string(),
      weight: z.number(),
      score: z.number().describe("Score obtained out of `weight`"),
      rationale: z.string(),
    }),
  ),
  weight_changes_explanation: z.string().describe("Explanation if weights differ from the suggested base, else empty"),
  filters: z.object({
    ats: z.object({ score: z.number().min(0).max(100), diagnosis: z.string(), details: z.array(z.string()) }),
    hr: z.object({ score: z.number().min(0).max(100), diagnosis: z.string(), details: z.array(z.string()) }),
    hiring_manager: z.object({ score: z.number().min(0).max(100), diagnosis: z.string(), details: z.array(z.string()) }),
    strategic: z.object({ score: z.number().min(0).max(100), diagnosis: z.string(), details: z.array(z.string()) }),
  }),
  summary: z.string(),
});

// STEP 6 — Adversarial review
export const AdversarialSchema = z.object({
  twenty_second_rejections: z
    .array(
      z.object({
        reason: z.string(),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
        probability: z.enum(["LOW", "MEDIUM", "HIGH"]),
        gap_type: GapType,
        fixable_by_rewriting: z.boolean(),
        fix: z.string().describe("Concrete fix if fixable; honest statement that it cannot be fixed by wording if not"),
      }),
    )
    .min(3),
  additional_risks: z.array(z.string()),
});

// STEP 7 — Competitive benchmark
export const BenchmarkSchema = z.object({
  competitors: z
    .array(
      z.object({
        profile_name: z.string(),
        description: z.string(),
        strengths: z.array(z.string()),
        weaknesses: z.array(z.string()),
        stronger_than_candidate: z.boolean(),
      }),
    )
    .min(3)
    .max(5),
  candidate_position: z.enum(["TOP_10", "TOP_25", "MIDDLE", "WEAK"]),
  rationale: z.string(),
  caveat: z.string().describe("Reminder that this is an internal estimate, not a real interview probability"),
});

// STEP 8 — Cover letter analysis
export const LetterAnalysisSchema = z.object({
  score: z.number().min(0).max(100),
  dimensions: z.array(
    z.object({
      dimension: z.string(),
      score: z.number().min(0).max(10),
      comment: z.string(),
    }),
  ),
  four_whys: z.object({
    why_this_company: z.object({ present: z.boolean(), quality: z.string() }),
    why_this_role: z.object({ present: z.boolean(), quality: z.string() }),
    why_me: z.object({ present: z.boolean(), quality: z.string() }),
    why_now: z.object({ present: z.boolean(), quality: z.string() }),
  }),
  cv_overlap: z.string().describe("Where the letter merely repeats the CV"),
  main_issues: z.array(z.string()),
  summary: z.string(),
});

// STEP 9 — Improvement plan
export const ImprovementPlanSchema = z.object({
  cv_changes: z.array(
    z.object({
      priority: Priority,
      current: z.string(),
      problem: z.string(),
      proposed: z.string(),
      why: z.string(),
      target_requirement: z.string(),
    }),
  ),
  letter_changes: z.array(
    z.object({
      priority: Priority,
      current: z.string(),
      problem: z.string(),
      proposed: z.string(),
      why: z.string(),
      target_requirement: z.string(),
    }),
  ),
  structural_recommendations: z.array(z.string()).describe("Title, summary, section order, experiences to expand/reduce, keywords"),
  identity_stability_note: z.string().describe("Confirmation that ~70-80% of positioning stays stable"),
});

// STEP 10 — Optimized versions
export const OptimizedCvSchema = z.object({
  optimized_cv_markdown: z.string().describe("Full optimized CV content in markdown, keeping the original structure to ease copy-paste"),
  bullet_changes: z.array(
    z.object({
      section: z.string(),
      before: z.string(),
      after: z.string(),
      rationale: z.string(),
      target_requirement: z.string(),
    }),
  ),
  unchanged_note: z.string().describe("What was deliberately left unchanged and why"),
});

export const OptimizedLetterSchema = z.object({
  optimized_letter: z.string().describe("Complete final version of the cover letter, ready to send"),
  key_changes: z.array(z.string()),
});

// Quality control
export const QualityControlSchema = z.object({
  verdict: z.enum(["PASS", "FAIL"]),
  issues: z.array(
    z.object({
      type: z.enum([
        "HALLUCINATION",
        "NEW_CLAIM",
        "CONTRADICTION",
        "METRIC_CHANGE",
        "INFLATION",
        "KEYWORD_STUFFING",
        "MEANING_CHANGE",
      ]),
      location: z.string(),
      detail: z.string(),
      offending_text: z.string(),
      blocking: z.boolean(),
    }),
  ),
  notes: z.string(),
});

// STEP 11 — Version comparison
export const VersionComparisonSchema = z.object({
  what_improved: z.array(z.string()),
  what_regressed: z.array(z.string()),
  what_still_blocks: z.array(z.string()),
  stop_condition: z.enum(["CONTINUE_IMPROVING", "APPLICATION_READY", "APPLICATION_STRUCTURALLY_WEAK"]),
  rationale: z.string(),
});

/**
 * Mock LLM provider: returns deterministic, schema-conforming canned data per pipeline stage.
 * Used to test the full pipeline end-to-end without an API key (LLM_PROVIDER=mock),
 * and automatically when no ANTHROPIC_API_KEY is configured.
 */

const generators = {
  job_parser: () => ({
    job: {
      title: "VIE Business Analyst - Digital Transformation",
      company: "DemoCorp Industries",
      business_unit: "Digital & Data",
      location: "Munich",
      country: "Germany",
      contract_type: "VIE",
      duration: "24 months",
      start_date: "January 2027",
      compensation: "Business France VIE allowance",
      sector: "Industrial manufacturing",
      languages: [
        { language: "English", level: "Fluent", explicit: true },
        { language: "German", level: "Appreciated", explicit: true },
      ],
      education_required: "Master's degree (business or engineering school)",
      experience_required: "First experience (internship) in analytics or consulting",
      responsibilities: [
        "Support the digital transformation roadmap of the business unit",
        "Build dashboards and KPIs for operational teams",
        "Coordinate between local teams and French headquarters",
      ],
      hard_skills: ["Data analysis", "Excel", "Power BI", "Project coordination"],
      soft_skills: ["Autonomy", "Communication", "Cross-functional work"],
      tools: ["Power BI", "Excel", "SAP"],
      vie_details: "Standard Business France VIE eligibility (EU national, under 28).",
      reconstructed_posting:
        "[MOCK] Reconstructed posting text from screenshots. Replace with real analysis by configuring ANTHROPIC_API_KEY.",
      ocr_uncertainties: ["Mock mode: screenshots were not actually read."],
    },
    requirements: [
      {
        requirement: "Data analysis and dashboarding (Power BI / Excel)",
        type: "MUST_HAVE",
        importance: 5,
        evidence_from_job_post: "Build dashboards and KPIs for operational teams",
        explicit: true,
        estimated_weight: 30,
      },
      {
        requirement: "Fluent English",
        type: "MUST_HAVE",
        importance: 5,
        evidence_from_job_post: "Fluent English required",
        explicit: true,
        estimated_weight: 15,
      },
      {
        requirement: "First experience in analytics or consulting",
        type: "STRONG_SIGNAL",
        importance: 4,
        evidence_from_job_post: "First experience (internship) in analytics or consulting",
        explicit: true,
        estimated_weight: 20,
      },
      {
        requirement: "Cross-functional coordination ability",
        type: "STRONG_SIGNAL",
        importance: 4,
        evidence_from_job_post: "Coordinate between local teams and French headquarters",
        explicit: true,
        estimated_weight: 15,
      },
      {
        requirement: "German language",
        type: "NICE_TO_HAVE",
        importance: 2,
        evidence_from_job_post: "German appreciated",
        explicit: true,
        estimated_weight: 5,
      },
      {
        requirement: "Interest in industrial sector",
        type: "CONTEXT",
        importance: 2,
        evidence_from_job_post: "Inferred from company sector",
        explicit: false,
        estimated_weight: 10,
      },
      {
        requirement: "Autonomy in an international environment",
        type: "CULTURAL_BEHAVIORAL",
        importance: 3,
        evidence_from_job_post: "Autonomy, cross-functional work",
        explicit: true,
        estimated_weight: 5,
      },
    ],
  }),

  company_research_search: () =>
    "[MOCK] No real web research performed. DemoCorp Industries is a fictional industrial group used to test the pipeline.",

  company_researcher: () => ({
    company_name: "DemoCorp Industries",
    overview: "[MOCK] Fictional industrial group, ~20k employees, HQ in France.",
    products_and_markets: "[MOCK] Industrial components for energy and automotive markets.",
    recent_situation: "[MOCK] Ongoing digital transformation program announced in 2026.",
    presence_in_vie_country: "[MOCK] German plant and regional sales office in Munich.",
    why_this_mission_exists:
      "[MOCK - WEAK_INFERENCE] The BU likely needs junior analytical capacity to support its transformation roadmap.",
    stated_values: "[MOCK] 'Innovation, safety, integrity' (official slogans, not verified culture).",
    findings: [
      {
        statement: "DemoCorp operates a plant in Bavaria.",
        confidence: "FACT",
        source: "https://example.com/democorp/locations",
      },
      {
        statement: "The digital roadmap prioritizes shopfloor data.",
        confidence: "STRONG_INFERENCE",
        source: "https://example.com/democorp/press",
      },
    ],
    sources: ["https://example.com/democorp"],
    research_available: false,
  }),

  recruiting_modeler: () => ({
    mission_thesis:
      "[MOCK] The BU needs an affordable, mobile junior profile to structure reporting and bridge HQ and the German site during its transformation program.",
    top_business_problems: [
      "Fragmented operational reporting across sites",
      "Slow coordination between HQ and the German BU",
      "Lack of analytical bandwidth for the transformation PMO",
      "Poor adoption of new digital tools by operational teams",
      "Insufficient visibility of KPIs for management",
    ],
    ideal_candidate: {
      profile_summary: "[MOCK] Business/engineering graduate with one strong analytics internship and international exposure.",
      education: "Master's from a business or engineering school",
      experience: "6-12 months of internships in analytics, consulting or PMO",
      key_skills: ["Power BI", "Excel", "stakeholder communication", "English"],
      differentiators: ["German basics", "industrial exposure", "prior VIE-country experience"],
      realism_note: "Profile is deliberately junior-realistic for a VIE.",
    },
  }),

  opportunity_scorer: () => ({
    score: 74,
    tier: "WORTH_APPLYING",
    breakdown: [
      { criterion: "Learning potential", score: 8, max: 10, rationale: "[MOCK] Transformation scope offers real learning." },
      { criterion: "Responsibility / ownership", score: 7, max: 10, rationale: "[MOCK] Coordination role with visible deliverables." },
      { criterion: "Environment quality", score: 7, max: 10, rationale: "[MOCK] Established industrial group." },
      { criterion: "Product / AI / strategy proximity", score: 6, max: 10, rationale: "[MOCK] Digital but not product-centric." },
      { criterion: "International exposure", score: 9, max: 10, rationale: "[MOCK] VIE in Germany with HQ interface." },
      { criterion: "Brand / CV signal", score: 7, max: 10, rationale: "[MOCK] Recognized in its sector." },
      { criterion: "Network & access to decision-makers", score: 7, max: 10, rationale: "[MOCK] BU management visibility." },
      { criterion: "Progression potential", score: 7, max: 10, rationale: "[MOCK] VIEs often converted locally." },
      { criterion: "Trajectory fit (product leader / entrepreneur)", score: 8, max: 10, rationale: "[MOCK] Transformation + coordination fits a product trajectory." },
      { criterion: "Compensation / conditions", score: 8, max: 10, rationale: "[MOCK] Standard VIE package in Germany." },
    ],
    summary: "[MOCK] Solid opportunity, worth a serious application effort.",
  }),

  cv_extractor: () => ({
    candidate: {
      name: "Candidate (mock)",
      location: "Paris, France",
      languages: ["French (native)", "English (C1)"],
      education: ["Master in Management, Demo Business School (2025)"],
      current_title: "Junior Business Analyst (internship)",
    },
    experiences: [
      {
        title: "Business Analyst Intern",
        organization: "RetailCo",
        period: "Jan 2025 - Jun 2025",
        summary: "Built sales dashboards in Power BI, automated weekly reporting.",
      },
      {
        title: "Project Assistant Intern",
        organization: "ConsultCo",
        period: "Jun 2024 - Dec 2024",
        summary: "Supported a PMO on an ERP migration, tracked milestones and risks.",
      },
    ],
    evidence: [
      { id: "E1", type: "TOOL", statement: "Built sales dashboards in Power BI", source_location: "RetailCo internship", proof_strength: "STRONG" },
      { id: "E2", type: "METRIC", statement: "Automated weekly reporting, saving ~4h/week", source_location: "RetailCo internship", proof_strength: "MEDIUM" },
      { id: "E3", type: "EXPERIENCE", statement: "Supported a PMO on an ERP migration", source_location: "ConsultCo internship", proof_strength: "STRONG" },
      { id: "E4", type: "LANGUAGE", statement: "English C1", source_location: "Languages section", proof_strength: "MEDIUM" },
      { id: "E5", type: "EDUCATION", statement: "Master in Management, Demo Business School", source_location: "Education section", proof_strength: "STRONG" },
    ],
    extraction_notes: ["Mock mode: CV file was not actually read in depth."],
  }),

  requirement_mapper: () => ({
    mappings: [
      {
        requirement: "Data analysis and dashboarding (Power BI / Excel)",
        requirement_type: "MUST_HAVE",
        evidence_ids: ["E1", "E2"],
        evidence_summary: "Power BI dashboards and reporting automation at RetailCo.",
        strength: "STRONG",
        gap_type: "NONE",
        notes: "",
      },
      {
        requirement: "Fluent English",
        requirement_type: "MUST_HAVE",
        evidence_ids: ["E4"],
        evidence_summary: "English C1 declared, no international work proof.",
        strength: "MEDIUM",
        gap_type: "NONE",
        notes: "Could be strengthened by highlighting English-speaking contexts.",
      },
      {
        requirement: "German language",
        requirement_type: "NICE_TO_HAVE",
        evidence_ids: [],
        evidence_summary: "No evidence of German on the CV.",
        strength: "NONE",
        gap_type: "ACTUAL_EXPERIENCE_GAP",
        notes: "Cannot be fixed by rewriting.",
      },
    ],
    coverage_summary: "[MOCK] Strong on analytics; weak on Germany-specific signals.",
  }),

  cv_evaluator: () => ({
    total_score: 68,
    dimensions: [
      { dimension: "Job / Mission Fit", weight: 30, score: 21, rationale: "[MOCK] Good analytics fit, weak sector fit." },
      { dimension: "Evidence & Demonstrated Impact", weight: 20, score: 13, rationale: "[MOCK] Some metrics, could be stronger." },
      { dimension: "ATS / Semantic Match", weight: 15, score: 10, rationale: "[MOCK] Key tools present, title mismatch." },
      { dimension: "Hiring Manager Fit", weight: 15, score: 10, rationale: "[MOCK] Credible but not differentiated." },
      { dimension: "Trajectory & Seniority Coherence", weight: 8, score: 6, rationale: "[MOCK] Coherent junior trajectory." },
      { dimension: "Industry / Company Relevance", weight: 5, score: 2, rationale: "[MOCK] No industrial exposure." },
      { dimension: "International / VIE Fit", weight: 4, score: 3, rationale: "[MOCK] Mobility implied, not proven." },
      { dimension: "Clarity & Readability", weight: 3, score: 3, rationale: "[MOCK] Clean layout." },
    ],
    weight_changes_explanation: "",
    filters: {
      ats: { score: 70, diagnosis: "[MOCK] Good keyword coverage, title should match the posting.", details: ["Power BI present", "Title mismatch"] },
      hr: { score: 65, diagnosis: "[MOCK] Understandable in 20s, motivation for Germany not visible.", details: ["Clear trajectory", "No Germany signal"] },
      hiring_manager: { score: 62, diagnosis: "[MOCK] Can do the reporting; coordination proof is thin.", details: ["Dashboards proven", "Coordination weakly evidenced"] },
      strategic: { score: 60, diagnosis: "[MOCK] Standard junior; differentiation limited.", details: ["No sector angle"] },
    },
    summary: "[MOCK] Decent baseline application that needs targeted repositioning.",
  }),

  adversarial_reviewer: () => ({
    twenty_second_rejections: [
      {
        reason: "Title and summary do not mirror the role",
        severity: "HIGH",
        probability: "HIGH",
        gap_type: "POSITIONING_GAP",
        fixable_by_rewriting: true,
        fix: "Retitle the CV header to 'Business Analyst - Data & Transformation'.",
      },
      {
        reason: "No visible link to Germany or the industrial sector",
        severity: "MEDIUM",
        probability: "MEDIUM",
        gap_type: "POSITIONING_GAP",
        fixable_by_rewriting: true,
        fix: "Surface any German coursework, industrial clients, or mobility signals that truly exist.",
      },
      {
        reason: "No German language",
        severity: "MEDIUM",
        probability: "MEDIUM",
        gap_type: "ACTUAL_EXPERIENCE_GAP",
        fixable_by_rewriting: false,
        fix: "Cannot be fixed by wording; only mitigated by strong English and mobility proof.",
      },
    ],
    additional_risks: ["[MOCK] Generic letter opening."],
  }),

  competitive_benchmark: () => ({
    competitors: [
      {
        profile_name: "Business school + corporate data internship",
        description: "Grande ecole profile with a data-heavy internship in a large industrial group.",
        strengths: ["Sector exposure", "Brand internships"],
        weaknesses: ["Often less hands-on tooling"],
        stronger_than_candidate: true,
      },
      {
        profile_name: "Junior engineer with project experience",
        description: "Engineering graduate with production/ops project work.",
        strengths: ["Technical credibility", "Industrial context"],
        weaknesses: ["Weaker business communication"],
        stronger_than_candidate: true,
      },
      {
        profile_name: "International junior already in Germany",
        description: "Candidate studying or interning in Germany, German B2.",
        strengths: ["Local fit", "Language"],
        weaknesses: ["Analytics may be thinner"],
        stronger_than_candidate: true,
      },
      {
        profile_name: "Generic business graduate",
        description: "Business graduate with unrelated internships.",
        strengths: ["Volume applicant"],
        weaknesses: ["No analytics proof"],
        stronger_than_candidate: false,
      },
    ],
    candidate_position: "MIDDLE",
    rationale: "[MOCK] Solid analytics but lacks sector and country signals that top competitors have.",
    caveat: "Internal estimate only; not a real probability of interview.",
  }),

  letter_evaluator: () => ({
    score: 55,
    dimensions: [
      { dimension: "Personalization", score: 4, comment: "[MOCK] Company named but generic." },
      { dimension: "Mission understanding", score: 5, comment: "[MOCK] Paraphrases the posting." },
      { dimension: "Company understanding", score: 4, comment: "[MOCK] No specific knowledge shown." },
      { dimension: "Trajectory fit", score: 6, comment: "[MOCK] Coherent." },
      { dimension: "Motivation credibility", score: 5, comment: "[MOCK] Germany motivation unexplained." },
      { dimension: "Proof", score: 5, comment: "[MOCK] Repeats CV bullets." },
      { dimension: "Concision", score: 7, comment: "[MOCK] Right length." },
      { dimension: "Credibility", score: 6, comment: "[MOCK] No overclaiming." },
      { dimension: "CV complementarity", score: 4, comment: "[MOCK] Too much overlap." },
    ],
    four_whys: {
      why_this_company: { present: true, quality: "[MOCK] Weak, interchangeable." },
      why_this_role: { present: true, quality: "[MOCK] Adequate." },
      why_me: { present: true, quality: "[MOCK] Repeats CV." },
      why_now: { present: false, quality: "[MOCK] Absent." },
    },
    cv_overlap: "[MOCK] Second paragraph repeats the two internships verbatim.",
    main_issues: ["Generic why-this-company", "Missing why-now", "CV repetition"],
    summary: "[MOCK] Serviceable but forgettable letter.",
  }),

  improvement_planner: () => ({
    cv_changes: [
      {
        priority: "CRITICAL",
        current: "Junior Business Analyst (internship)",
        problem: "Header does not mirror the target role.",
        proposed: "Business Analyst - Data & Digital Transformation",
        why: "ATS and 20-second HR scan both key on the title.",
        target_requirement: "Data analysis and dashboarding",
      },
      {
        priority: "HIGH_IMPACT",
        current: "Automated weekly reporting",
        problem: "Impact metric buried.",
        proposed: "Automated weekly sales reporting in Power BI (~4h/week saved for a 6-person team)",
        why: "Quantified impact is the strongest hiring-manager signal available in the evidence bank.",
        target_requirement: "Data analysis and dashboarding",
      },
    ],
    letter_changes: [
      {
        priority: "HIGH_IMPACT",
        current: "Generic opening paragraph",
        problem: "Interchangeable with any company.",
        proposed: "Open on the company's transformation program and the specific BU mission.",
        why: "Personalization is the letter's weakest scored dimension.",
        target_requirement: "Cross-functional coordination ability",
      },
    ],
    structural_recommendations: [
      "Move the RetailCo analytics internship above ConsultCo.",
      "Add a 2-line profile summary targeting the mission keywords that are truly supported.",
    ],
    identity_stability_note: "Core identity (junior analyst with PMO exposure) unchanged; ~25% repositioned toward the mission.",
  }),

  cv_optimizer: () => ({
    optimized_cv_markdown:
      "# Candidate (mock)\n**Business Analyst - Data & Digital Transformation**\n\n[MOCK] Optimized CV content. Configure ANTHROPIC_API_KEY for real optimization.\n\n## Experience\n- Business Analyst Intern, RetailCo - Built sales dashboards in Power BI; automated weekly reporting (~4h/week saved).\n- Project Assistant Intern, ConsultCo - Supported ERP migration PMO; tracked milestones and risks.",
    bullet_changes: [
      {
        section: "RetailCo",
        before: "Automated weekly reporting",
        after: "Automated weekly sales reporting in Power BI (~4h/week saved)",
        rationale: "Surfaces the existing metric; no new claim.",
        target_requirement: "Data analysis and dashboarding",
      },
    ],
    unchanged_note: "Education and ConsultCo bullets left as-is; already accurate and relevant.",
  }),

  letter_optimizer: () => ({
    optimized_letter:
      "[MOCK] Dear Hiring Team,\n\nOptimized letter content would appear here with a real API key...\n\nBest regards,\nCandidate",
    key_changes: ["Company-specific opening", "Added why-now paragraph", "Removed CV repetition"],
  }),

  quality_controller: () => ({
    verdict: "PASS",
    issues: [],
    notes: "[MOCK] No unsupported claims detected in mock content.",
  }),

  version_comparator: () => ({
    what_improved: ["[MOCK] Title now mirrors the role", "Metrics surfaced"],
    what_regressed: [],
    what_still_blocks: ["No German language (actual experience gap)"],
    stop_condition: "CONTINUE_IMPROVING",
    rationale: "[MOCK] Score improved but remains below 88 with fixable positioning gaps remaining.",
  }),
};

async function completeMock({ stage, schema, log = () => {} }) {
  const generator = generators[stage];
  if (!generator) {
    throw new Error(`Mock provider has no canned response for stage "${stage}"`);
  }
  // Simulate a small latency so the UI progress display is observable.
  // Raise MOCK_DELAY_MS to watch the live pipeline UI stage by stage.
  const delay = Number(process.env.MOCK_DELAY_MS);
  await new Promise((r) => setTimeout(r, Number.isFinite(delay) && delay >= 0 ? delay : 300));
  const raw = generator();
  log(`mock response served for stage ${stage}`);
  if (typeof raw === "string") return { text: raw };
  const data = schema ? schema.parse(raw) : raw;
  return { data, text: JSON.stringify(data, null, 2) };
}

export const mockProvider = {
  name: "mock",
  complete: completeMock,
};

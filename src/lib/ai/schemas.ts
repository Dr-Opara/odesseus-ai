import { z } from "zod";

export const resumeProfileSchema = z.object({
  summary: z.string(),
  yearsExperience: z.number().min(0),
  currentOrRecentTitle: z.string().nullable(),
  industries: z.array(z.string()),
  skills: z.array(z.string()),
  certifications: z.array(z.string()),
  education: z.array(z.object({
    degree: z.string(),
    field: z.string().nullable(),
    institution: z.string().nullable(),
  })),
  roles: z.array(z.object({
    title: z.string(),
    company: z.string().nullable(),
    start: z.string().nullable(),
    end: z.string().nullable(),
    responsibilities: z.array(z.string()),
    achievements: z.array(z.string()),
    skills: z.array(z.string()),
  })),
  verifiedFacts: z.array(z.string()),
});

export const matchAssessmentSchema = z.object({
  companyName: z.string(),
  roleTitle: z.string(),
  location: z.string().nullable(),
  workArrangement: z.string().nullable(),
  employmentType: z.string().nullable(),
  salaryText: z.string().nullable(),

  hardRequirements: z.array(z.object({
    requirement: z.string(),
    status: z.enum(["met", "partial", "missing", "unknown"]),
    evidence: z.string(),
    isCritical: z.boolean(),
  })),

  dimensions: z.object({
    requiredQualifications: z.object({
      score: z.number().min(0).max(100),
      evidence: z.array(z.string()),
      gaps: z.array(z.string()),
    }),
    professionalExperience: z.object({
      score: z.number().min(0).max(100),
      evidence: z.array(z.string()),
      gaps: z.array(z.string()),
    }),
    skillsAndTools: z.object({
      score: z.number().min(0).max(100),
      evidence: z.array(z.string()),
      gaps: z.array(z.string()),
    }),
    roleAndSeniority: z.object({
      score: z.number().min(0).max(100),
      evidence: z.array(z.string()),
      gaps: z.array(z.string()),
    }),
    industryDomain: z.object({
      score: z.number().min(0).max(100),
      evidence: z.array(z.string()),
      gaps: z.array(z.string()),
    }),
    educationAndCertifications: z.object({
      score: z.number().min(0).max(100),
      evidence: z.array(z.string()),
      gaps: z.array(z.string()),
    }),
    locationAndWorkArrangement: z.object({
      score: z.number().min(0).max(100),
      evidence: z.array(z.string()),
      gaps: z.array(z.string()),
    }),
    candidatePreferences: z.object({
      score: z.number().min(0).max(100),
      evidence: z.array(z.string()),
      gaps: z.array(z.string()),
    }),
  }),

  strongestMatches: z.array(z.string()).max(5),
  biggestGaps: z.array(z.string()).max(5),
  conciseSummary: z.string(),

  /**
   * Evaluated only when the job states a salary/range and the candidate has
   * stated a minimum. "unknown" — never a guessed "compatible" — when either
   * side is unstated.
   */
  salaryCompatibility: z.object({
    status: z.enum(["compatible", "incompatible", "unknown"]),
    explanation: z.string(),
  }),

  /**
   * Evaluated only when the job explicitly states a sponsorship/work-
   * authorization stance and the candidate has declared their own. Never
   * inferred from silence on either side.
   */
  sponsorshipCompatibility: z.object({
    status: z.enum(["compatible", "incompatible", "unknown"]),
    explanation: z.string(),
  }),
});

export type ResumeProfile = z.infer<typeof resumeProfileSchema>;
export type MatchAssessment = z.infer<typeof matchAssessmentSchema>;


export const tailoredResumeSchema = z.object({
  headline: z.string().nullable(),
  professionalSummary: z.string(),
  skills: z.array(z.string()),
  roles: z.array(z.object({
    title: z.string(),
    company: z.string().nullable(),
    start: z.string().nullable(),
    end: z.string().nullable(),
    bullets: z.array(z.string()),
  })),
  education: z.array(z.object({
    degree: z.string(),
    field: z.string().nullable(),
    institution: z.string().nullable(),
  })),
  certifications: z.array(z.string()),
});

export const resumeTailoringOutputSchema = z.object({
  tailoredResume: tailoredResumeSchema,
  changes: z.array(z.object({
    type: z.enum(["rewrite", "reorder", "emphasize", "clarify", "remove_irrelevant"]),
    section: z.string(),
    original: z.string().nullable(),
    revised: z.string().nullable(),
    reason: z.string(),
    verifiedEvidence: z.array(z.string()).min(1),
  })),
  notes: z.array(z.string()),
});

export type TailoredResume = z.infer<typeof tailoredResumeSchema>;
export type ResumeTailoringOutput = z.infer<typeof resumeTailoringOutputSchema>;


export const interviewReadinessSchema = z.object({
  executiveBrief: z.string(),
  interviewGoal: z.string(),
  focusAreas: z.array(z.object({
    topic: z.string(),
    whyItMatters: z.string(),
    verifiedEvidence: z.array(z.string()),
  })).max(8),
  likelyTopicAreas: z.array(z.object({
    topic: z.string(),
    rationale: z.string(),
  })).max(8),
  experienceExamples: z.array(z.object({
    label: z.string(),
    situation: z.string(),
    action: z.string(),
    result: z.string().nullable(),
    sourceEvidence: z.array(z.string()),
  })).max(8),
  questionsToAsk: z.array(z.string()).max(8),
  gapsToHandleHonestly: z.array(z.object({
    gap: z.string(),
    approach: z.string(),
  })).max(6),
  // Optional prep modules generated from the briefing (all backward-compatible;
  // old briefings omit these keys and parse successfully via .safeParse).
  likelyQuestions: z.array(z.string()).max(20).optional(),
  behavioralQuestions: z.array(z.object({ question: z.string(), focus: z.string() })).max(12).optional(),
  starPrompts: z.array(z.object({ prompt: z.string(), exampleLabel: z.string().nullable(), sourceEvidence: z.array(z.string()) })).max(10).optional(),
  technicalConceptQuestions: z.array(z.object({ concept: z.string(), question: z.string(), why: z.string() })).max(12).optional(),
  companySpecific: z.array(z.object({ area: z.string(), preparation: z.string(), verifiedEvidence: z.array(z.string()) })).max(10).optional(),
  questionsToAskInterviewer: z.array(z.string()).max(8).optional(),
  prepSummary: z.string().optional(),
});

export type InterviewReadiness = z.infer<typeof interviewReadinessSchema>;


export const roundHandoffSchema = z.object({
  summary: z.string(),
  buildOn: z.array(z.string()).max(8),
  avoidRepeating: z.array(z.string()).max(8),
  openThreads: z.array(z.string()).max(8),
  nextRoundFocus: z.array(z.string()).max(8),
});

export type RoundHandoff = z.infer<typeof roundHandoffSchema>;


export const liveGuidanceSchema = z.object({
  isQuestion: z.boolean(),
  questionText: z.string().nullable(),
  responseText: z.string().nullable(),
  structure: z.string().nullable(),
  verifiedEvidence: z.array(z.string()).max(8),
  caution: z.string().nullable(),
});

export type LiveGuidance = z.infer<typeof liveGuidanceSchema>;

export const postInterviewAnalysisSchema = z.object({
  factualSummary: z.string(),
  transcriptLimitations: z.array(z.string()).max(8),
  questionsAsked: z.array(z.string()).max(30),
  topicsDiscussed: z.array(z.string()).max(30),
  experiencesReferenced: z.array(z.string()).max(20),
  commitments: z.array(z.string()).max(20),
  answersToStrengthen: z.array(z.object({
    topic: z.string(),
    observation: z.string(),
    strongerApproach: z.string(),
  })).max(12),
  possibleNextRoundTopics: z.array(z.object({
    topic: z.string(),
    rationale: z.string(),
  })).max(10),
  followUpDraft: z.object({
    subject: z.string(),
    body: z.string(),
  }),
});

export type PostInterviewAnalysis = z.infer<typeof postInterviewAnalysisSchema>;

/**
 * Employer Fit Score (Phase 2R).
 *
 * Evidence-backed assessment of one application against one employer posting.
 * Every match cites resume evidence; gaps are stated as missing, never
 * filled in. Protected characteristics are never inputs: the scorer receives
 * only the job posting and the submitted resume, and the schema has no field
 * that could carry them.
 */
export const employerFitScoreSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  requiredMatches: z.array(z.object({
    requirement: z.string(),
    matched: z.boolean(),
    evidence: z.array(z.string()).max(6),
  })).max(20),
  preferredMatches: z.array(z.object({
    preference: z.string(),
    matched: z.boolean(),
    evidence: z.array(z.string()).max(6),
  })).max(20),
  missingQualifications: z.array(z.string()).max(20),
  missingSkills: z.array(z.string()).max(20),
  locationAlignment: z.object({
    aligned: z.boolean(),
    note: z.string(),
  }),
  blockers: z.array(z.object({
    blocker: z.string(),
    detail: z.string(),
  })).max(10),
  explanation: z.string(),
});

export type EmployerFitScore = z.infer<typeof employerFitScoreSchema>;

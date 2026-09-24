export type CareerJob = {
  slug: string;
  title: string;
  summary: string;
  responsibilities: string[];
  qualifications: string[];
  screeningQuestion: string;
};

export const careerJobs: CareerJob[] = [
  {
    slug: "founding-full-stack-product-engineer",
    title: "Founding Senior Full-Stack / Product Engineer",
    summary: "Help build Odesseus end to end across the candidate, employer, billing, and application experiences.",
    responsibilities: ["Ship product features across Next.js, Supabase, Stripe, and integrations.", "Own features from database and API through polished UI and production.", "Improve application workflows, reliability, performance, and developer velocity."],
    qualifications: ["Strong full-stack TypeScript/React experience.", "Experience shipping production SaaS products.", "Comfort working independently in an early-stage startup."],
    screeningQuestion: "Tell us about a product or major feature you shipped end to end and what you personally owned.",
  },
  {
    slug: "founding-applied-ai-engineer",
    title: "Founding Applied AI Engineer",
    summary: "Own the intelligence behind matching, Smart Apply, resume tailoring, application answers, and Odesseus Live.",
    responsibilities: ["Build and evaluate LLM workflows for job and resume intelligence.", "Optimize model routing, latency, quality, and token cost.", "Develop reliable structured outputs, evaluations, and AI safety guardrails."],
    qualifications: ["Hands-on production LLM/agent experience.", "Strong software engineering fundamentals.", "Experience with evaluation, prompting, structured generation, or RAG."],
    screeningQuestion: "Describe an AI or agent workflow you built, how you evaluated it, and how you improved reliability or cost.",
  },
  {
    slug: "founding-platform-devops-security-engineer",
    title: "Founding Platform / DevOps & Security Engineer",
    summary: "Build the reliable, secure platform that lets Odesseus scale application automation and AI workloads.",
    responsibilities: ["Own observability, CI/CD, queues, browser workers, infrastructure, and incident response.", "Strengthen Supabase, Vercel, secrets, access controls, and application security.", "Optimize infrastructure and browser-automation cost as volume grows."],
    qualifications: ["Production cloud/platform or SRE experience.", "Strong security and operational judgment.", "Experience with modern CI/CD, monitoring, databases, and web infrastructure."],
    screeningQuestion: "Tell us about a reliability, security, or infrastructure problem you owned in production and the measurable result.",
  },
  {
    slug: "founding-growth-product-marketing-lead",
    title: "Founding Growth & Product Marketing Lead",
    summary: "Turn Odesseus into a recognizable career platform for applicants, employers, and partners around the world.",
    responsibilities: ["Own acquisition experiments, positioning, content, SEO, partnerships, and conversion.", "Build the employer acquisition motion and hiring case studies.", "Measure funnels and turn product insights into repeatable growth loops."],
    qualifications: ["Growth or product-marketing experience for a technology product.", "Strong copy, experimentation, and analytics skills.", "Comfort operating hands-on with a startup budget."],
    screeningQuestion: "Describe a growth experiment you ran, the metric you targeted, and the result.",
  },
  {
    slug: "founding-customer-success-employer-operations",
    title: "Founding Customer Success & Employer Operations Lead",
    summary: "Create a high-trust experience for candidates and employers while helping shape the Odesseus marketplace.",
    responsibilities: ["Support applicants and employers and own escalations through resolution.", "Onboard employers and help them succeed with postings and candidate workflows.", "Turn recurring feedback into product and operational improvements."],
    qualifications: ["Customer success, recruiting operations, or marketplace operations experience.", "Excellent written and spoken communication.", "Strong organization and judgment in a fast-moving environment."],
    screeningQuestion: "Tell us about a difficult customer or operational issue you resolved and what you changed afterward.",
  },
];

export const careerJobBySlug = Object.fromEntries(careerJobs.map((job) => [job.slug, job])) as Record<string, CareerJob>;

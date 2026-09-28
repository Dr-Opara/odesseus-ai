-- Mock Interview Sessions (Phase 2M). Four new tables for mock interview functionality.

-- ---------------------------------------------------------------------------
-- 1. mock_interview_sessions
--    session_type: behavioral, technical_concept, system_design, mixed
--    status: in_progress, completed, cancelled
-- ---------------------------------------------------------------------------
create table if not exists public.mock_interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interview_id uuid not null references public.interviews(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  session_type text not null default 'behavioral'
    check (session_type in ('behavioral','technical_concept','system_design','mixed')),
  status text not null default 'in_progress'
    check (status in ('in_progress','completed','cancelled')),
  question_count integer not null default 0,
  context_snapshot jsonb not null default '{}'::jsonb,
  started_at timestamp with time zone default now(),
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  openai_session_id uuid
);

comment on table public.mock_interview_sessions is
'Mock interview session container; one per interview, type-specific';

create unique index if not exists mock_interview_sessions_user_interview_idx
  on public.mock_interview_sessions (user_id, interview_id);

-- Row-level security
alter table public.mock_interview_sessions enable row level security;

create policy "Users can view own mock sessions"
  on public.mock_interview_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own mock sessions"
  on public.mock_interview_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own mock sessions"
  on public.mock_interview_sessions for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. mock_interview_questions
--    category: BEHAVIORAL, ROLE_SPECIFIC, TECHNICAL_CONCEPT, STAR, LEADERSHIP, SITUATIONAL
--    order_index for sequencing; rationale is optional
-- ---------------------------------------------------------------------------
create table if not exists public.mock_interview_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.mock_interview_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  category text not null
    check (category in ('BEHAVIORAL','ROLE_SPECIFIC','TECHNICAL_CONCEPT','STAR','LEADERSHIP','SITUATIONAL')),
  question_text text not null,
  rationale text,
  order_index integer not null default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint mock_questions_unique_session_order
    unique (session_id, order_index)
);

comment on table public.mock_interview_questions is
'Generated mock interview questions, categorized and ordered';

create index if not exists mock_questions_session_idx
  on public.mock_interview_questions (session_id);

-- Row-level security for mock_interview_questions
alter table public.mock_interview_questions enable row level security;

create policy "Users can view own mock questions"
  on public.mock_interview_questions for select
  using (auth.uid() = user_id);

create policy "Users can insert own mock questions"
  on public.mock_interview_questions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own mock questions"
  on public.mock_interview_questions for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. mock_interview_answers
--    one answer per question; answer_source: text, transcript
-- ---------------------------------------------------------------------------
create table if not exists public.mock_interview_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.mock_interview_sessions(id) on delete cascade,
  question_id uuid references public.mock_interview_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  answer_text text not null,
  answer_source text not null default 'text'
    check (answer_source in ('text','transcript')),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint mock_answers_unique_session_question
    unique (session_id, question_id)
);

comment on table public.mock_interview_answers is
'Candidate answers to mock interview questions';

create index if not exists mock_answers_session_idx
  on public.mock_interview_answers (session_id);

-- Row-level security for mock_interview_answers
alter table public.mock_interview_answers enable row level security;

create policy "Users can view own mock answers"
  on public.mock_interview_answers for select
  using (auth.uid() = user_id);

create policy "Users can insert own mock answers"
  on public.mock_interview_answers for insert
  with check (auth.uid() = user_id);

create policy "Users can update own mock answers"
  on public.mock_interview_answers for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. mock_interview_feedback
--    one feedback row per question version; dimensions 1-5 each with notes
--    version_number defaults to 1; later versions allow iterative feedback
--    feedback JSON keys: clarity, relevance, specificity, starStructure,
--    completeness, strengthOfExample, jobAlignment (each 1-5) + note
-- ---------------------------------------------------------------------------
create table if not exists public.mock_interview_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.mock_interview_sessions(id) on delete cascade,
  question_id uuid not null references public.mock_interview_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  version_number integer not null default 1
    check (version_number >= 1),
  feedback jsonb not null default '{"clarity":0,"relevance":0,"specificity":0,"starStructure":0,"completeness":0,"strengthOfExample":0,"jobAlignment":0,"improvementSuggestions":[]}'::jsonb,
  note text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint mock_feedback_unique_session_question_version
    unique (session_id, question_id, version_number)
);

comment on table public.mock_interview_feedback is
'Structured feedback dimensions per question per version';

create index if not exists mock_feedback_session_idx
  on public.mock_interview_feedback (session_id);

-- Row-level security for mock_interview_feedback
alter table public.mock_interview_feedback enable row level security;

create policy "Users can view own mock feedback"
  on public.mock_interview_feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert own mock feedback"
  on public.mock_interview_feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can update own mock feedback"
  on public.mock_interview_feedback for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. Notification dedupe key reference (MOCK_INTERVIEW_FEEDBACK_READY)
--    The notification type MOCK_INTERVIEW_FEEDBACK_READY already exists in the
--    catalog (20261029000000_notifications.sql). This comment records the
--    association for the dedupe key pattern: mock:${sessionId}:feedback_ready
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. Index and stats
-- ---------------------------------------------------------------------------
analyze public.mock_interview_sessions;
analyze public.mock_interview_questions;
analyze public.mock_interview_answers;
analyze public.mock_interview_feedback;

-- End of 20261031000000_mock_interviews.sql
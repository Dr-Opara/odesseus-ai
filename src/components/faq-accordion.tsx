"use client";

import { useState } from "react";
import MobileScreen from "@/components/mobile/mobile-screen";

type FaqItem = readonly [question: string, answer: string];

function AccordionRow({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`m-card m-faq-row${open ? " is-open" : ""}`} onClick={() => setOpen((v) => !v)}>
      <span className="m-copy">
        <strong>{question}</strong>
        {open ? <small>{answer}</small> : null}
      </span>
      <b className="m-chevron">{open ? "−" : "＋"}</b>
    </div>
  );
}

export default function FaqAccordion({
  items,
  variant,
}: {
  items: readonly FaqItem[];
  variant: "desktop" | "mobile";
}) {
  const [query, setQuery] = useState("");
  const filtered = items.filter(([question]) =>
    question.toLowerCase().includes(query.trim().toLowerCase())
  );

  if (variant === "desktop") {
    return (
      <section className="figma-faq">
        <input
          className="input"
          style={{ marginBottom: 20, maxWidth: 420 }}
          placeholder="Search questions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="figma-two-grid">
          {filtered.map(([question, answer]) => (
            <article key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <MobileScreen index="27" title="FAQ" lead="Quick answers about Odesseus.ai.">
      <div className="m-search">
        <input
          placeholder="⌕ Search questions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="m-list">
        {filtered.map(([question, answer]) => (
          <AccordionRow key={question} question={question} answer={answer} />
        ))}
      </div>
    </MobileScreen>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Platform = "instagram" | "facebook" | "tiktok";

const emptySocial = (platform: Platform) => ({
  platform,
  handle: "",
  profileUrl: "",
  followerCount: "",
  averageReach: "",
  audienceCountry: "",
});

export default function PartnerApplicationForm() {
  const router = useRouter();
  const [selected, setSelected] = useState<Platform[]>(["instagram"]);
  const [socials, setSocials] = useState<Record<Platform, ReturnType<typeof emptySocial>>>({
    instagram: emptySocial("instagram"),
    facebook: emptySocial("facebook"),
    tiktok: emptySocial("tiktok"),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function togglePlatform(platform: Platform) {
    setSelected((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform]
    );
  }

  function updateSocial(platform: Platform, key: string, value: string) {
    setSocials((current) => ({
      ...current,
      [platform]: { ...current[platform], [key]: value },
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const form = new FormData(event.currentTarget);
    const sampleLinks = ["sample_1", "sample_2", "sample_3"]
      .map((name) => String(form.get(name) || "").trim())
      .filter(Boolean);
    const partnerships = form.getAll("partnership").map(String);

    const payload = {
      fullName: String(form.get("full_name") || ""),
      email: String(form.get("email") || ""),
      country: String(form.get("country") || ""),
      cityState: String(form.get("city_state") || "") || null,
      primaryNiche: String(form.get("primary_niche") || ""),
      audienceDescription: String(form.get("audience_description") || ""),
      motivation: String(form.get("motivation") || ""),
      sampleLinks,
      previousBrandExperience: String(form.get("previous_brand_experience") || "") || null,
      expectedRate: String(form.get("expected_rate") || "") || null,
      preferredPartnerships: partnerships,
      acceptedTerms: form.get("accepted_terms") === "on",
      socials: selected.map((platform) => ({
        platform,
        handle: socials[platform].handle,
        profileUrl: socials[platform].profileUrl,
        followerCount: Number(socials[platform].followerCount || 0),
        averageReach: socials[platform].averageReach ? Number(socials[platform].averageReach) : null,
        audienceCountry: socials[platform].audienceCountry || null,
      })),
    };

    try {
      const response = await fetch("/api/partners/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "We could not submit your application.");
        return;
      }
      router.push("/partners/apply?submitted=1");
      router.refresh();
    } catch {
      setError("We could not submit your application.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="partner-form">
      <div className="card partner-form-section">
        <h2>About you</h2>
        <div className="partner-form-grid">
          <label>Full name<input className="input" name="full_name" required /></label>
          <label>Email<input className="input" name="email" type="email" required /></label>
          <label>Country<input className="input" name="country" required /></label>
          <label>City / state <span className="muted">(optional)</span><input className="input" name="city_state" /></label>
        </div>
      </div>

      <div className="card partner-form-section">
        <h2>Your social presence</h2>
        <div className="partner-platform-pills">
          {(["instagram","facebook","tiktok"] as Platform[]).map((platform) => (
            <button
              type="button"
              key={platform}
              className={selected.includes(platform) ? "partner-platform active" : "partner-platform"}
              onClick={() => togglePlatform(platform)}
            >
              {platform === "tiktok" ? "TikTok" : platform[0].toUpperCase() + platform.slice(1)}
            </button>
          ))}
        </div>
        {selected.map((platform) => (
          <div key={platform} className="partner-social-block">
            <strong>{platform === "tiktok" ? "TikTok" : platform[0].toUpperCase() + platform.slice(1)}</strong>
            <div className="partner-form-grid">
              <label>Handle<input className="input" required value={socials[platform].handle} onChange={(e)=>updateSocial(platform,"handle",e.target.value)} placeholder="@handle" /></label>
              <label>Profile URL<input className="input" required type="url" value={socials[platform].profileUrl} onChange={(e)=>updateSocial(platform,"profileUrl",e.target.value)} /></label>
              <label>Followers<input className="input" required type="number" min="0" value={socials[platform].followerCount} onChange={(e)=>updateSocial(platform,"followerCount",e.target.value)} /></label>
              <label>Average views / reach<input className="input" type="number" min="0" value={socials[platform].averageReach} onChange={(e)=>updateSocial(platform,"averageReach",e.target.value)} /></label>
              <label>Primary audience country<input className="input" value={socials[platform].audienceCountry} onChange={(e)=>updateSocial(platform,"audienceCountry",e.target.value)} /></label>
            </div>
          </div>
        ))}
      </div>

      <div className="card partner-form-section">
        <h2>Creator profile</h2>
        <label>Primary niche
          <select className="input" name="primary_niche" required defaultValue="career_jobs">
            <option value="career_jobs">Career / Jobs</option>
            <option value="technology">Technology</option>
            <option value="ai">AI</option>
            <option value="education">Education</option>
            <option value="business">Business</option>
            <option value="lifestyle">Lifestyle</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>Tell us about your audience<textarea className="input" name="audience_description" rows={5} minLength={20} required /></label>
        <label>Why do you want to partner with Odesseus?<textarea className="input" name="motivation" rows={5} minLength={20} required /></label>
        <div className="partner-form-grid">
          <label>Best content link<input className="input" type="url" name="sample_1" required /></label>
          <label>Second content link <span className="muted">(optional)</span><input className="input" type="url" name="sample_2" /></label>
          <label>Third content link <span className="muted">(optional)</span><input className="input" type="url" name="sample_3" /></label>
          <label>Expected sponsored-post rate <span className="muted">(optional)</span><input className="input" name="expected_rate" placeholder="e.g. $300 / video" /></label>
        </div>
        <label>Previous brand collaborations <span className="muted">(optional)</span><textarea className="input" name="previous_brand_experience" rows={3} /></label>
      </div>

      <div className="card partner-form-section">
        <h2>How would you like to partner?</h2>
        <div className="partner-checkbox-grid">
          {[
            ["affiliate","Affiliate"],
            ["creator","Content Creator"],
            ["brand_ambassador","Brand Ambassador"],
            ["sponsored_campaign","Sponsored Campaigns"],
            ["open_to_all","Open to all"],
          ].map(([value,label]) => (
            <label key={value}><input type="checkbox" name="partnership" value={value} /> {label}</label>
          ))}
        </div>
        <label className="partner-terms-check">
          <input type="checkbox" name="accepted_terms" required />
          <span>I agree to the <a href="/partners/terms" target="_blank" rel="noreferrer">Odesseus Partner Program Terms</a>.</span>
        </label>
      </div>

      {error ? <div className="partner-form-error">{error}</div> : null}

      <div className="partner-form-submit">
        <button className="btn btn-primary" type="submit" disabled={busy || selected.length === 0}>
          {busy ? "Submitting…" : "Submit application"}
        </button>
      </div>
    </form>
  );
}

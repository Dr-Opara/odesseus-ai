/** Four-part onboarding progress indicator shown on screens 02-04 (Figma Mobile v1). */
export default function MobileOnboardingProgress({ step }: { step: 2 | 3 | 4 }) {
  return (
    <div className="m-onboarding-progress" aria-hidden="true">
      {[1, 2, 3, 4].map((segment) => (
        <span key={segment} className={segment <= step ? "is-filled" : ""} />
      ))}
    </div>
  );
}

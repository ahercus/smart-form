interface FitFormWordmarkProps {
  className?: string;
}

export function FitFormWordmark({ className }: FitFormWordmarkProps) {
  return (
    <span className={className}>
      <span className="font-[family-name:var(--font-jetbrains-mono)] font-bold text-primary">
        fit
      </span>
      <span className="font-[family-name:var(--font-sora)] font-extrabold">
        Form
      </span>
    </span>
  );
}

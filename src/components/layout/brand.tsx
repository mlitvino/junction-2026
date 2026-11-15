import Link from "next/link";

export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/buyer"
      onClick={onNavigate}
      className="flex min-h-16 items-center gap-3 px-6"
      aria-label="LUUKKU home"
    >
      <svg className="size-10 shrink-0" viewBox="8 12 96 96" fill="none" aria-hidden="true">
        <rect
          x="8"
          y="12"
          width="96"
          height="96"
          rx="22"
          fill="#0B0F14"
          stroke="#1E293B"
          strokeWidth="2"
        />
        <rect
          x="24"
          y="28"
          width="64"
          height="64"
          rx="12"
          stroke="#94A3B8"
          strokeWidth="2.5"
          strokeOpacity="0.45"
        />
        <rect
          x="38"
          y="36"
          width="36"
          height="48"
          rx="6"
          fill="#1E293B"
          stroke="#3B82F6"
          strokeWidth="2.5"
        />
        <path d="M16 60H56" stroke="#60A5FA" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M56 60H96" stroke="#10B981" strokeWidth="4.5" strokeLinecap="round" />
        <circle cx="56" cy="60" r="6" fill="#10B981" />
        <circle cx="56" cy="60" r="11" stroke="#10B981" strokeWidth="1.5" strokeOpacity="0.5" />
      </svg>
      <span>
        <span className="block text-2xl font-black leading-none tracking-[-0.04em]">LUUKKU</span>
        <span className="mt-1 block font-mono text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          by Valio Aimo®
        </span>
      </span>
    </Link>
  );
}

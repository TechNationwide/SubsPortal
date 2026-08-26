"use client";

import Image from "next/image";

type Props = {
  variant?: "full" | "mark";
  tone?: "brand" | "light";
  className?: string;
  priority?: boolean;
};

const LOGO = "/brand/nationwide-logo.png";

const SRC = {
  full: { brand: LOGO, light: LOGO },
  mark: { brand: LOGO, light: LOGO },
} as const;

export function BrandLogo({
  variant = "full",
  tone = "brand",
  className = "",
  priority = false,
}: Props) {
  const src = SRC[variant][tone];
  const isMark = variant === "mark";

  return (
    <span className={`brand-logo brand-logo--${variant} brand-logo--${tone} ${className}`.trim()}>
      <Image
        src={src}
        alt="Nationwide"
        width={isMark ? 500 : 500}
        height={isMark ? 307 : 307}
        priority={priority}
        className="brand-logo-img"
      />
    </span>
  );
}

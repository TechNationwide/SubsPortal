"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/auth";

type Props = {
  children: React.ReactNode;
  adminOnly?: boolean;
};

export function AuthGuard({ children, adminOnly = false }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    if (adminOnly && session.role !== "admin") {
      router.replace("/submit");
      return;
    }
    setReady(true);
  }, [router, adminOnly]);

  if (!ready) return null;
  return <>{children}</>;
}

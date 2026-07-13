import { AuthGuard } from "@/components/AuthGuard";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}

import { requireSession } from "@/lib/session";
import { Shell } from "@/components/shell/Shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return <Shell session={session}>{children}</Shell>;
}

import { brandIcon } from "@/lib/app/brand-icon";

export const dynamic = "force-static";

export function GET() {
  return brandIcon(512, true);
}

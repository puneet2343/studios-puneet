import { brandIcon } from "@/lib/brand-icon";

export async function GET() {
  return brandIcon(512, { rounded: true });
}

import { brandIcon } from "@/lib/brand-icon";

export async function GET() {
  return brandIcon(192, { padded: true });
}

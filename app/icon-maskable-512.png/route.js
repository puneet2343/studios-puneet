import { brandIcon } from "@/lib/brand-icon";

// Full-bleed version for Android launchers, which crop it to their own shape.
export async function GET() {
  return brandIcon(512, { padded: true });
}

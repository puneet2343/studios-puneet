import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";

// Recycle Bin and Duplicates open from Settings; this takes you back there.
export default function BackToSettings() {
  return (
    <div className="mx-auto w-full max-w-3xl px-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
      <Link href="/settings" className="inline-flex h-11 items-center gap-2 rounded-full pl-2.5 pr-4 text-sm font-medium text-zinc-300 hover:bg-white/5">
        <ArrowLeftIcon size={20} /> Settings
      </Link>
    </div>
  );
}

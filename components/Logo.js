import { useId } from "react";
import { logoSvg } from "@/lib/logo";

// The app's mark (see lib/logo.js): a lens with a landscape inside.
export default function Logo({ size = 36, className = "" }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <span
      className={`inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: logoSvg({ size, id: `l${id}` }) }}
    />
  );
}

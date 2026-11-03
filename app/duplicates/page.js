import BackToSettings from "@/components/shell/BackToSettings";
import Duplicates from "@/components/tools/Duplicates";

export const metadata = { title: "Duplicates · Puneet Studios" };

export default function Page() {
  return (
    <>
      <BackToSettings />
      <Duplicates />
    </>
  );
}

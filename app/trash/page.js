import BackToSettings from "@/components/shell/BackToSettings";
import RecycleBin from "@/components/tools/RecycleBin";

export const metadata = { title: "Recycle Bin · Puneet Studios" };

export default function Page() {
  return (
    <>
      <BackToSettings />
      <RecycleBin />
    </>
  );
}

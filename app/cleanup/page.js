import BackToSettings from "@/components/shell/BackToSettings";
import CleanupPage from "@/components/pages/CleanupPage";

export const metadata = { title: "Clean up · Puneet Studios" };

export default function Page() {
  return (
    <>
      <BackToSettings />
      <CleanupPage />
    </>
  );
}

import BackToSettings from "@/components/shell/BackToSettings";
import HistoryPage from "@/components/pages/HistoryPage";

export const metadata = { title: "Backup history · Puneet Studios" };

export default function Page() {
  return (
    <>
      <BackToSettings />
      <HistoryPage />
    </>
  );
}

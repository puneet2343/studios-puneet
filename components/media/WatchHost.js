"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toaster";
import { removeFiles, restoreFiles, setFavorite, useLibrary } from "@/components/library/store";
import Properties from "@/components/media/Properties";
import WatchPage from "@/components/media/WatchPage";
import { useWatch, watch } from "@/components/media/watch";
import useBackClose from "@/components/useBackClose";
import { haptic } from "@/lib/haptics";

// The video you're watching, for the whole app (in AppShell, outside the pages): the full
// watch page, or — swiped down, ⌄, or Back — the mini player above the tabs, which keeps
// playing while you browse. Tap the mini player to open it again; swipe it away to close.
export default function WatchHost() {
  const { file, items, mini, tools } = useWatch();
  const { files } = useLibrary();
  const toast = useToast();
  const [info, setInfo] = useState(false);

  // Back on the watch page shrinks it to the mini player, like YouTube.
  useBackClose(Boolean(file) && !mini, () => watch.minimize());
  useBackClose(info && Boolean(file) && !mini, () => setInfo(false));

  // Follow the library: favourite changes show at once; a video that was deleted closes.
  const live = file && files ? files.find((f) => f.path === file.path) : null;
  const gone = Boolean(file && files && !live);
  useEffect(() => {
    if (!gone) return;
    const t = setTimeout(() => watch.close(), 1500); // a rename re-opens it under its new name first
    return () => clearTimeout(t);
  }, [gone]);

  const favorite = useCallback(
    async (list, on) => {
      haptic("tap");
      const ok = await setFavorite(list, on);
      toast(!ok ? "Couldn't update favourites. Check the connection." : on ? "Added to Favourites" : "Removed from Favourites");
    },
    [toast]
  );
  const remove = useCallback(
    async (paths) => {
      haptic("tap");
      watch.close();
      const { ids, reason } = await removeFiles(paths);
      if (!ids.length) return toast(reason, { duration: 9000 });
      toast("Moved to Recycle Bin", {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: async () => {
            await restoreFiles(ids);
            toast("Restored");
          },
        },
      });
    },
    [toast]
  );

  if (!file) return null;
  const current = live ?? file;
  return (
    <>
      <WatchPage
        file={current}
        items={items}
        mini={mini}
        onMinimize={watch.minimize}
        onExpand={watch.expand}
        onClose={watch.close}
        onNavigate={watch.go}
        onDetails={() => setInfo(true)}
        hold={info}
        onFavorite={favorite}
        onDelete={remove}
        onRename={tools?.rename}
        onTrim={tools?.trim}
        onRotate={tools?.rotate}
        onExtractAudio={tools?.audio}
        onAddToAlbum={tools?.addToAlbum}
      />
      {info && !mini && <Properties file={current} onClose={() => setInfo(false)} />}
    </>
  );
}

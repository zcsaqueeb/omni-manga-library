"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MediaCard, MediaCardSkeleton } from "./media-card";
import type { MediaItem } from "@/lib/sources/types";

export function MediaGrid({ items, loading }: { items: MediaItem[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <MediaCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <MediaCard item={item} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

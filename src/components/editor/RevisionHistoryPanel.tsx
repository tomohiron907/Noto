import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { tauriSync } from "../../lib/tauri";
import type { FileRevision } from "../../lib/types";

interface Props {
  activeId: string;
  onClose: () => void;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatSize(bytes: string | null): string | null {
  if (!bytes) return null;
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RevisionHistoryPanel({ activeId, onClose }: Props) {
  const [revisions, setRevisions] = useState<FileRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    tauriSync
      .listRevisions(activeId)
      .then((data) => {
        setRevisions(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [activeId]);

  return (
    <div className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 tracking-wide uppercase">
          Revision History
        </span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="overflow-y-auto max-h-[60vh]">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400">
            Loading…
          </div>
        )}
        {!loading && error && (
          <div className="px-4 py-6 text-xs text-red-500 text-center">{error}</div>
        )}
        {!loading && !error && revisions.length === 0 && (
          <div className="px-4 py-6 text-xs text-gray-400 text-center">
            No revision history available
          </div>
        )}
        {!loading && !error && revisions.length > 0 && (
          <ul className="py-2">
            {revisions.map((rev, i) => {
              const isLatest = i === 0;
              const isLast = i === revisions.length - 1;
              const size = formatSize(rev.size);
              return (
                <li key={rev.id} className="flex gap-3 px-4 py-0">
                  {/* Graph column */}
                  <div className="flex flex-col items-center shrink-0 w-4">
                    {/* Line above dot */}
                    <div
                      className={`w-0.5 flex-none ${isLatest ? "h-2" : "h-2"} ${
                        isLatest ? "bg-transparent" : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    />
                    {/* Dot */}
                    <div
                      className={`w-2.5 h-2.5 rounded-full shrink-0 border-2 ${
                        isLatest
                          ? "border-green-500 bg-green-500"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                      }`}
                    />
                    {/* Line below dot */}
                    {!isLast && (
                      <div className="w-0.5 grow bg-gray-200 dark:bg-gray-700 min-h-[16px]" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="pb-3 pt-0.5 min-w-0">
                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug">
                      {formatDateTime(rev.modified_time)}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                      {[rev.modified_by, size].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { SubtitleBlock } from "@/app/actions"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Convert milliseconds to SRT time format (00:00:00,000)
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

export function generateSRT(subtitles: SubtitleBlock[]): string {
  return subtitles.map((sub, index) => {
    const start = formatTime(sub.offset);
    const end = formatTime(sub.offset + sub.duration);
    return `${index + 1}\n${start} --> ${end}\n${sub.text}\n`;
  }).join('\n');
}

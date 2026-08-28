'use client';

import {
  Combine,
  Crop,
  Eraser,
  FileImage,
  FileMinus,
  FilePlus,
  FileText,
  FileType,
  Grid2x2,
  Hash,
  ImageIcon,
  Images,
  LayoutGrid,
  Lock,
  PencilLine,
  PenLine,
  RotateCw,
  Scaling,
  Scissors,
  Shrink,
  Stamp,
  Unlock,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  Combine,
  Crop,
  Eraser,
  FileImage,
  FileMinus,
  FilePlus,
  FileType,
  Grid2x2,
  Hash,
  ImageIcon,
  Images,
  LayoutGrid,
  Lock,
  PencilLine,
  PenLine,
  RotateCw,
  Scaling,
  Scissors,
  Shrink,
  Stamp,
  Unlock,
};

export function ToolIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? FileText;
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}

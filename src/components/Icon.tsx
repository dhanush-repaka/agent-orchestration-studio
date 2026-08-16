import {
  type LucideProps,   ListChecks, Search, ClipboardList, FileCheck, Database,
  MousePointerClick, GitPullRequest, Bug, Activity, FileText, Bot, Play, Square,
  GitBranch, Shuffle, Route, Repeat, GitMerge, Combine, Clock, RotateCw,
  UserCheck, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Wand2, Filter,
  Map, Braces, File, Globe, Boxes, Github, Network, FolderOpen, Mail,
  MessageSquare, Hash, BarChart3, Webhook, Cpu, Sparkles, Brain, Settings, Upload,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  ListChecks, Search, ClipboardList, FileCheck, Database, MousePointerClick,
  GitPullRequest, Bug, Activity, FileText, Bot, Play, Square, GitBranch,
  Shuffle, Route, Repeat, GitMerge, Combine, Clock, RotateCw, UserCheck,
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Wand2, Filter, Map,
  Braces, File, Globe, Boxes, Github, Network, FolderOpen, Mail,
  MessageSquare, Hash, BarChart3, Webhook, Cpu, Sparkles, Brain, Settings, Upload,
};

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const C = ICON_MAP[name] ?? Bot;
  return <C {...props} />;
}

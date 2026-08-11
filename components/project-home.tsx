"use client";

import { useState } from "react";
import ProjectWorkspace from "@/components/project-workspace";
import SimpleProjectView from "@/components/simple-project-view";
import type { PublicSubjectCard } from "@/components/subject-library";
import type { ProductionProject } from "@/lib/project-types";
import type { StoredJob } from "@/lib/types";

export default function ProjectHome({ projects, jobs, subjects, onChanged, onCreateInShot }: {
  projects: ProductionProject[];
  jobs: StoredJob[];
  subjects: PublicSubjectCard[];
  onChanged: () => Promise<void> | void;
  onCreateInShot: (shotId: string) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  if (advanced) {
    return <div className="content-stack">
      <div className="notice"><span>当前为高级作品工作台：可以管理候选、Shot、定稿、媒体规格、转场、声音、字幕和成片。</span><button className="link-button" onClick={() => setAdvanced(false)}>返回简单作品页</button></div>
      <ProjectWorkspace projects={projects} jobs={jobs} subjects={subjects} onChanged={onChanged} onCreateInShot={onCreateInShot}/>
    </div>;
  }
  return <SimpleProjectView projects={projects} jobs={jobs} onChanged={onChanged} onAdvanced={() => setAdvanced(true)}/>;
}

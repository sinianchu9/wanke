export type ProjectShot = {
  id: string;
  projectId: string;
  name: string;
  brief: string;
  position: number;
  selectedJobId: string | null;
  jobIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProductionProject = {
  id: string;
  name: string;
  description: string;
  subjectIds: string[];
  shots: ProjectShot[];
  createdAt: string;
  updatedAt: string;
};

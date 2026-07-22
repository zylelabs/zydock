interface ProjectData {
  organizationId: string;
  name: string;
  slug: string;
  description?: string;
}

type Project = BaseDocument<ProjectData>;

interface EnvironmentData {
  organizationId: string;
  projectId: string;
  name: string;
  slug: string;
}

type Environment = BaseDocument<EnvironmentData>;

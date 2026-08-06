interface DeploymentCommit {
  sha: string;
  message: string;
  author: string;
  committedAt?: Date;
}

interface DeploymentStepResult {
  step: import('./deployment.schema').DeploymentStep;
  status: import('./deployment.schema').DeploymentStepStatus;
  detail?: string;
  durationMs: number;
}

interface DeploymentData {
  organizationId: string;
  applicationId: string;
  serverId: string;
  status: import('./deployment.schema').DeploymentStatus;
  trigger: import('./deployment.schema').DeploymentTrigger;
  triggeredBy?: string;
  branch: string;
  commit?: DeploymentCommit;
  imageTag?: string;
  containerId?: string;
  steps: DeploymentStepResult[];
  log: string[];
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  error?: string;
}

type Deployment = BaseDocument<DeploymentData>;

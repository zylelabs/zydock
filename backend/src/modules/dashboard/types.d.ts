interface DashboardData {
  domain: string;
  status: import('./dashboard.schema').DashboardStatus;
  lastError?: string;
  certificateIssuer?: string;
  certificateExpiresAt?: Date;
  appliedAt?: Date;
}

type Dashboard = BaseDocument<DashboardData>;

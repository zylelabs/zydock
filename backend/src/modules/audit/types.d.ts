interface AuditLogData {
  organizationId: string;
  userId: string;
  serverId: string;
  action: import('./audit-log.schema').AuditLogAction;
  containerId?: string;
  volume?: string;
  path?: string;
  startedAt: Date;
  endedAt?: Date;
}

type AuditLog = BaseDocument<AuditLogData>;
